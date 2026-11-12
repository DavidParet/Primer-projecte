'use strict';

// NexLupa: postprocessament determinista. Cap dada nova s'inventa.
// Compatible amb el contracte antic mainEvent/accions.
const ZONE = 'Europe/Madrid';
const DAYS = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];
const MONTHS = {
  gener: 1, febrer: 2, marc: 3, abril: 4, maig: 5, juny: 6, juliol: 7,
  agost: 8, setembre: 9, octubre: 10, novembre: 11, desembre: 12,
  enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, octubre: 10, november: 11, december: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, august: 8,
  september: 9, october: 10
};
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function madridToday(clock) {
  const value = clock || new Date();
  const ymd = new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
  return ymd;
}
function validIsoDate(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) return null;
  if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59)) return null;
  // Els 00:00 sense hora indicada s'han de representar sense hora.
  return m[4] === undefined || m[4] === '00' && m[5] === '00' ? m[1] + '-' + m[2] + '-' + m[3] : s;
}
function weekdayForISO(date) {
  return DAYS[new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay()];
}
function extractSourceWeekdays(source) {
  const re = /\b(dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+(?:dia\s+)?(\d{1,2})(?:\s*(?:de\s+)?([a-zà-ü]+)|\/(\d{1,2})(?:\/(\d{2,4}))?)?/gi;
  const out = [];
  let match;
  const toCa = {lunes:'dilluns',martes:'dimarts',miercoles:'dimecres',jueves:'dijous',viernes:'divendres',sabado:'dissabte',domingo:'diumenge'};
  while ((match = re.exec(source || '')) !== null) {
    const w = norm(match[1]);
    const day = +match[2];
    if (day < 1 || day > 31) continue;
    const month = match[4] ? +match[4] : (match[3] ? MONTHS[norm(match[3])] || null : null);
    let year = match[5] ? +match[5] : null;
    if (year !== null && year < 100) year += 2000;
    out.push({ text: match[0], weekday: toCa[w] || w, day, month, year });
  }
  return out;
}
function dateConflict(date, references) {
  if (!date) return null;
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  // Compara únicament referències que permeten identificar el dia, no totes les dates del missatge.
  return references.find(r => r.day === d && (!r.month || r.month === m) && (!r.year || r.year === y) &&
    r.weekday !== weekdayForISO(date)) || null;
}
function unique(items) {
  return [...new Set(items.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
}
function extractUseful(source, fromAI) {
  const input = String(source || '');
  const raw = fromAI && typeof fromAI === 'object' ? fromAI : {};
  const urls = unique((input.match(/https?:\/\/[^\s<>"')\]]+/gi) || []).map(s => s.replace(/[.,;!?]+$/, '')));
  const ibans = unique((input.match(/\bES\d{2}(?:[\s-]?\d{4}){5}\b/gi) || []).map(s => s.replace(/\s+/g, ' ').trim()));
  const imports = unique(input.match(/\b\d{1,6}(?:[.,]\d{1,3})?\s*€/g) || []);
  const telefons = unique(input.match(/(?:\+34[\s.-]?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g) || []);
  const altres = unique(Array.isArray(raw.altres) ? raw.altres.filter(v => typeof v === 'string') : []);
  // Els valors afegits per IA només s'accepten si tenen suport literal al text.
  for (const key of ['enllacos', 'iban', 'imports', 'telefons']) {
    if (!Array.isArray(raw[key])) continue;
    for (const val of raw[key]) {
      if (typeof val !== 'string') continue;
      const stripped = val.replace(/\s+/g, '').toLowerCase();
      if (!input.replace(/\s+/g, '').toLowerCase().includes(stripped)) continue;
      if (key === 'enllacos' && /^https?:\/\//i.test(val)) urls.push(val);
      if (key === 'iban') ibans.push(val);
      if (key === 'imports') imports.push(val);
      if (key === 'telefons') telefons.push(val);
    }
  }
  return { enllacos: unique(urls), iban: unique(ibans), imports: unique(imports), telefons: unique(telefons), altres };
}
function normalizeAnalysis(raw, source, dateReference) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const refs = extractSourceWeekdays(source);
  const warnings = [];
  const originalWarning = typeof input.avisDates === 'string' ? input.avisDates.trim() : '';
  if (originalWarning) warnings.push(originalWarning);
  const suspiciousDates = [];
  function normalizedDate(value, context) {
    if (!value || value === 'null') return null;
    const iso = validIsoDate(value);
    if (!iso) {
      warnings.push('Cal confirmar la data de ' + context + ': el format no és vàlid.');
      suspiciousDates.push(context);
      return null;
    }
    const conflict = dateConflict(iso, refs);
    if (conflict) {
      warnings.push('El missatge diu «' + conflict.text + '», però el ' + iso.slice(0, 10) + ' és ' + weekdayForISO(iso) + '. Confirma la data.');
      suspiciousDates.push(context);
      return null; // No enviar una data contradictòria al calendari.
    }
    return iso;
  }
  const actions = Array.isArray(input.accions) ? input.accions : [];
  const accions = [];
  const events = [];
  function eventFrom(e, origin) {
    if (!e || typeof e !== 'object') return;
    const title = String(e.title || e.accio || '').trim();
    if (!title) return;
    const date = normalizedDate(e.data, 'l’esdeveniment «' + title + '»');
    const end = normalizedDate(e.dataFi, 'la fi de «' + title + '»');
    events.push({title, data:date, dataFi:end && date && end >= date ? end : null,
      lloc:typeof e.lloc === 'string' ? e.lloc.trim() || null : null,
      edat:typeof e.edat === 'string' ? e.edat.trim() || null : null,
      origen: origin});
  }
  eventFrom(input.mainEvent, 'principal');
  if (Array.isArray(input.esdeveniments)) input.esdeveniments.forEach(e => eventFrom(e, 'llista'));
  actions.forEach(a => {
    if (!a || typeof a !== 'object' || !String(a.accio || '').trim()) return;
    if (a.tipus === 'calendari') {
      eventFrom({title:a.accio,data:a.data,dataFi:a.dataFi,lloc:a.lloc,edat:a.edat}, 'legacy');
      return;
    }
    accions.push({
      ...a,
      accio: String(a.accio).trim(),
      tipus: a.tipus === 'informatiu' ? 'informatiu' : 'tasca',
      data: normalizedDate(a.data, '«' + a.accio + '»'),
      dataFi: normalizedDate(a.dataFi, 'la fi de «' + a.accio + '»'),
      prioritat: ['alta','mitja','baixa'].includes(a.prioritat) ? a.prioritat : 'baixa',
      lloc: typeof a.lloc === 'string' ? a.lloc.trim() || null : null,
      enllac: typeof a.enllac === 'string' && /^https?:\/\//i.test(a.enllac) ? a.enllac : null
    });
  });
  const dedupEvents = [];
  for (const e of events) {
    if (!dedupEvents.some(old => norm(old.title) === norm(e.title) && old.data === e.data)) dedupEvents.push(e);
  }
  const reminders = Array.isArray(input.recordatoris) ? input.recordatoris : [];
  const recordatoris = reminders.filter(r => r && typeof r === 'object' && typeof (r.text || r.titol) === 'string')
    .map(r => ({text: String(r.text || r.titol).trim(),data: normalizedDate(r.data, 'l’avís futur'), tipus:'informatiu'}))
    .filter(r => r.text);
  // Els terminis vençuts són fets reals, no es descarten ni es transformen en un acte.
  const today = validIsoDate(dateReference) || madridToday();
  accions.forEach(a => {
    if (a.tipus === 'tasca' && a.data && a.data.slice(0, 10) < today &&
      /(?:termini|abans|fins|pagament|lliur|entreg|inscri|inscrip|vencut|vençut)/i.test(a.accio)) {
      a.vençut = true;
    }
  });
  return {
    ...input,
    mainEvent: dedupEvents[0] || null,
    esdeveniments: dedupEvents.map(({origen,...e}) => e),
    accions, recordatoris,
    dadesUtils: extractUseful(source, input.dadesUtils),
    avisDates: unique(warnings).join(' ') || null,
    revisioDates: { requereixRevisio: suspiciousDates.length > 0, camps: suspiciousDates }
  };
}
module.exports = { ZONE, madridToday, validIsoDate, weekdayForISO, extractSourceWeekdays, dateConflict, extractUseful, normalizeAnalysis };
