'use strict';

// NexLupa: postprocessament determinista. Cap dada nova s'inventa.
// Compatible amb el contracte antic mainEvent/accions.
const { relativeHints, rebaseVerifiedTime, resolveWeekdayNumber } = require('./date-evidence');
const ZONE = 'Europe/Madrid';
const DAYS = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];
const MONTHS = {
  gener: 1, febrer: 2, marc: 3, abril: 4, maig: 5, juny: 6, juliol: 7,
  agost: 8, setembre: 9, octubre: 10, novembre: 11, desembre: 12,
  enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12
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
// IBAN: només es mostra si el dígit de control (mòdul 97) és vàlid.
function ibanValid(value) {
  const v = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rem = (rem * 10 + +d) % 97;
  }
  return rem === 1;
}
const AMOUNT_RE = /(?<![\d.,])(\d{1,3}(?:[.  ]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?\b|eur\b)|€\s*(\d{1,3}(?:[.  ]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])/gi;
function extractAmounts(input) {
  const out = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(input)) !== null) out.push(m[0].replace(/\s+/g, ' ').trim());
  return out;
}
function extractPhones(input) {
  // Primer s'eliminen IBAN, URL i imports perquè els seus dígits no es llegeixin com a telèfon.
  const cleaned = input
    .replace(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}\b/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(AMOUNT_RE, ' ');
  return (cleaned.match(/(?<![\d])(?:\+34[\s.-]?)?[6789]\d(?:[\s.-]?\d){7}(?![\d])/g) || []).map(s => s.trim());
}
function extractUseful(source, fromAI, opts) {
  const fromImage = !!(opts && opts.fromImage);
  const input = String(source || '');
  const raw = fromAI && typeof fromAI === 'object' ? fromAI : {};
  const urls = unique((input.match(/https?:\/\/[^\s<>"')\]]+/gi) || []).map(s => s.replace(/[.,;!?]+$/, '')));
  // Enllaços sense esquema (forms.gle/..., www.escola.cat/..., bit.ly/...) i correus: no es poden perdre.
  const bare = input.replace(/https?:\/\/\S+/gi, ' ');
  (bare.match(/(?<![@\w.\/-])(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"')\]]*)?|(?:forms\.gle|bit\.ly|tinyurl\.com|goo\.gl|docs\.google\.com|drive\.google\.com|photos\.app\.goo\.gl|photos\.google\.com|youtu\.be|t\.me|wa\.me|meet\.google\.com|zoom\.us|[a-z0-9-]+\.(?:cat|com|org|net|es|eu)\/)[^\s<>"')\]]*)/gi) || [])
    .forEach(u => urls.push('https://' + u.replace(/[.,;!?]+$/, '')));
  const emails = unique((input.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || []).map(e => e.replace(/[.,;!?]+$/, '')));
  const ibansRaw = unique((input.match(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}\b/gi) || []).map(s => s.replace(/\s+/g, ' ').trim()));
  const imports = extractAmounts(input);
  const telefons = extractPhones(input);
  const compact = input.replace(/\s+/g, '').toLowerCase();
  const inText = val => compact.includes(val.replace(/\s+/g, '').toLowerCase());
  const altres = unique(emails.concat(Array.isArray(raw.altres) ? raw.altres.filter(v =>
    typeof v === 'string' && (fromImage || inText(v))) : []));
  const avisos = [];
  // Valors afegits per la IA: amb text, cal suport literal; amb imatge no n'hi ha, així que es marquen.
  for (const key of ['enllacos', 'iban', 'imports', 'telefons']) {
    if (!Array.isArray(raw[key])) continue;
    for (const val of raw[key]) {
      if (typeof val !== 'string' || !val.trim()) continue;
      if (!fromImage && !inText(val)) continue;
      if (key === 'enllacos' && /^https?:\/\//i.test(val)) urls.push(val);
      if (key === 'iban') ibansRaw.push(val);
      if (key === 'imports') imports.push(val);
      if (key === 'telefons') telefons.push(val);
    }
  }
  const ibans = [], ibansInvalids = [];
  for (const v of unique(ibansRaw)) (ibanValid(v) ? ibans : ibansInvalids).push(v);
  if (ibansInvalids.length) avisos.push('Hi ha un IBAN amb dígit de control no vàlid; no es mostra: ' + ibansInvalids.join(', '));
  const out = { enllacos: unique(urls), iban: unique(ibans), imports: unique(imports), telefons: unique(telefons), altres };
  if (avisos.length) out.avisos = avisos;
  if (fromImage) out.origenImatge = true; // dades llegides d'una imatge: l'usuari les ha de comprovar
  return out;
}
// ── Semàntica a nivell de FRASE (no de missatge sencer) ──
const STOP = new Set(['de','del','la','el','les','els','per','amb','que','una','uns','unes','dels','al','a','i','o','en','no','si','es','se','tots','totes','cada']);
function sentencesOf(source) {
  return String(source || '').split(/(?<=[.!?\n])\s+|\n+/).map(x => x.trim()).filter(Boolean);
}
function titleTokens(title) {
  return norm(title).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP.has(t) &&
    !/^(?:suspes|suspesa|activitat|esdeveniment|recuperacio)$/.test(t));
}
// Cancel·lat: participi («queda suspès», «s'ha anul·lat», «cancel·lat») en una frase que parla d'aquest acte
// i que no apunta a un altre dia que el de l'acte. Els infinitius («cancel·lar la inscripció») no compten.
const CANCEL_PARTICIPLE = /\b(?:suspes|suspesa|suspesos|cancel\W{0,2}lat|cancel\W{0,2}lada|anul\W{0,2}lat|anul\W{0,2}lada|ajornat|ajornada|aplacat|aplacada|suspendido|suspendida|cancelado|cancelada|anulado|anulada|aplazado|aplazada)\b/;
const WEEKDAY_WORD = /\b(dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
function sentenceAbout(title, date, source, regex, eventCount) {
  const tokens = titleTokens(title);
  const evWeekday = date ? norm(weekdayForISO(date.slice(0, 10))) : null;
  const ca2es = {dilluns:'lunes',dimarts:'martes',dimecres:'miercoles',dijous:'jueves',divendres:'viernes',dissabte:'sabado',diumenge:'domingo'};
  return sentencesOf(source).some(sen => {
    const n = norm(sen);
    if (!regex.test(n)) return false;
    const sharesTitle = tokens.some(t => n.includes(t));
    // Si l'acte és l'únic i la frase no nomena res més concret, s'hi refereix.
    const sentenceWeekday = (n.match(WEEKDAY_WORD) || [])[1];
    if (sentenceWeekday && evWeekday && sentenceWeekday !== evWeekday && ca2es[evWeekday] !== sentenceWeekday && ca2es[sentenceWeekday] !== evWeekday) return false;
    return sharesTitle || (eventCount === 1 && tokens.length === 0);
  });
}
// Prioritat mínima per contracte (P1: pagament, autorització, inscripció, document obligatori; P3: opcionals).
const ABSOLUTE_DATE = /\b(?:\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}\s+(?:de\s+)?(?:gener|febrer|marc|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre|enero|febrero|marzo|mayo|junio|julio|agosto|septiembre|noviembre|diciembre))\b/;
const OPTIONAL_RE = /\b(?:si vols|si voleu|si ho voleu|si es vol|si us ve be|si podeu|si cal|si escau|qui vulgui|qui vulguin|opcional|opcionalment|recomanable|no obligatori|en cas (?:que|de)|si lo desea|opcionalmente|si quieren)\b/;
const MANDATORY_RE = /\b(?:pag(?:ar|ueu|ament|o)|quota|taxa|abonar|abone[us]?|transferencia|ingress|autoritzacio|autoritzar|signar|signeu|signatura|firmar|firmen|inscri(?:ure|ureu|pcio)|matricul|llicencia|lliurar|lliureu|entregar|entreguen|documentacio|obligatori)\b/;
function enforcePriority(action, source) {
  const t = norm(action.accio);
  const sentence = sentencesOf(source).find(sen => titleTokens(action.accio).slice(0, 3).filter(tok => norm(sen).includes(tok)).length >= 2);
  const optional = OPTIONAL_RE.test(t) || (sentence && OPTIONAL_RE.test(norm(sentence)) && !MANDATORY_RE.test(t));
  const before = action.prioritat;
  if (optional) action.prioritat = 'baixa';
  else if (action.tipus === 'tasca' && MANDATORY_RE.test(t)) action.prioritat = 'alta';
  if (action.prioritat !== before) action.prioritatCorregida = true;
}
function normalizeAnalysis(raw, source, dateReference, sourceDate, opts) {
  const fromImage = !!(opts && opts.fromImage);
  const input = raw && typeof raw === 'object' ? raw : {};
  const refs = extractSourceWeekdays(source);
  const referenceToday = (validIsoDate(dateReference) || madridToday()).slice(0,10);
  const relativeBase = (validIsoDate(sourceDate) || referenceToday).slice(0,10);
  const relative = relativeHints(source, relativeBase);
  const actionsRaw = Array.isArray(input.accions) ? input.accions : [];
  const sourceEvents = [input.mainEvent,
    ...(Array.isArray(input.esdeveniments) ? input.esdeveniments : []),
    ...actionsRaw.filter(a => a && a.tipus === 'calendari').map(a => ({title:a.accio,data:a.data,dataFi:a.dataFi}))
  ].filter(e => e && typeof (e.title || e.accio) === 'string' && String(e.title || e.accio).trim());
  const uniqueEventTitles = unique(sourceEvents.map(e => norm(e.title || e.accio)));
  const taskRaw = actionsRaw.filter(a => a && a.tipus !== 'calendari' && String(a.accio || '').trim());
  const datedTasks = taskRaw.filter(a => a.data || a.dataFi);
  const datedReminders = (Array.isArray(input.recordatoris) ? input.recordatoris : []).filter(a => a && a.data);
  // Only one independent date target is safe for a global relative-date correction.
  // L'override per data relativa NO s'aplica a suspensions/cancel·lacions ni a activitats recurrents.
  const nsrc = norm(source);
  const SUSPENDED = /\b(?:suspes|suspesa|suspen|cancel\W{0,2}lat|anul\W{0,2}lat|ajornat|aplacat|nova data|ja (?:us )?(?:avisarem|informarem)|suspendid|aplazad|cancelad|anulad)/;
  const RECURRING = /\b(?:tots els|totes les|cada|els (?:dilluns|dimarts|dimecres|dijous|divendres|dissabtes?|diumenges?)|todos los|todas las|los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos))\b/;
  const semanticBlock = SUSPENDED.test(nsrc) || RECURRING.test(nsrc);
  const singleEvent = !semanticBlock && !!relative.date && uniqueEventTitles.length === 1 &&
    !sourceEvents.some(e => e.dataFi) && !datedTasks.length && !datedReminders.length;
  const singleTask = !semanticBlock && !!relative.date && uniqueEventTitles.length === 0 &&
    taskRaw.length === 1 && !taskRaw[0].dataFi && !datedReminders.length;
  const warnings = [];
  const originalWarning = typeof input.avisDates === 'string' ? input.avisDates.trim() : '';
  if (originalWarning) warnings.push(originalWarning);
  const suspiciousDates = [];
  function normalizedDate(value, context, relativeOverride) {
    if (relativeOverride && relative.date) {
      return rebaseVerifiedTime(value, relative.date, source);
    }
    if (!value || value === 'null') return null;
    const iso = validIsoDate(value);
    if (!iso) {
      warnings.push('Cal confirmar la data de ' + context + ': el format no és vàlid.');
      suspiciousDates.push(context);
      return null;
    }
    const conflict = dateConflict(iso, refs);
    if (conflict) {
      // Sense mes («diumenge 13»): es resol amb la propera data real del calendari en lloc de descartar-la.
      const resolved = !conflict.month && !conflict.year
        ? resolveWeekdayNumber(conflict.weekday, conflict.day, referenceToday, 3) : null;
      if (resolved) {
        const [yy, mm, dd] = resolved.split('-');
        warnings.push('Hem interpretat «' + conflict.text + '» com el ' + dd + '/' + mm + '/' + yy + '. Confirma-ho.');
        suspiciousDates.push(context);
        return iso.length > 10 ? resolved + iso.slice(10) : resolved;
      }
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
    const beforeDateWarnings = suspiciousDates.length;
    const date = normalizedDate(e.data, 'l’esdeveniment «' + title + '»', singleEvent);
    const end = normalizedDate(e.dataFi, 'la fi de «' + title + '»');
    const dataDubtosa = suspiciousDates.length > beforeDateWarnings;
    // No exportar suspensions ni recurrències com un esdeveniment puntual confirmat.
    const titleNorm = norm(title);
    const namedCancellation = /(?:suspes|suspesa|suspen|cancel|anul|ajorn|aplac|suspendid|aplazad)/.test(titleNorm) && !/recuper|reprogram/.test(titleNorm);
    const genericCancellation = sentenceAbout(title, date, source, CANCEL_PARTICIPLE, sourceEvents.length) &&
      !/recuper|reprogram/.test(titleNorm);
    const cancelled = namedCancellation || genericCancellation;
    // Recurrent: una frase recurrent («els dimarts ...») que parla d'aquest acte i sense data absoluta pròpia.
    const recurring = !cancelled && sentenceAbout(title, date, source, RECURRING, sourceEvents.length) &&
      !sentencesOf(source).some(sen => RECURRING.test(norm(sen)) && ABSOLUTE_DATE.test(norm(sen))) &&
      !/\b(?:excepcionalment|puntualment|excepcionalmente|solo este)\b/.test(nsrc);
    if (cancelled) {
      events.push({title, data:null, dataOriginal:date, estat:'suspes', dataFi:null,
        lloc:typeof e.lloc === 'string' ? e.lloc.trim() || null : null,
        edat:typeof e.edat === 'string' ? e.edat.trim() || null : null, origen: origin});
      return;
    }
    if (recurring) {
      events.push({title, data:null, dataOriginal:date, estat:'recurrent', dataFi:null,
        lloc:typeof e.lloc === 'string' ? e.lloc.trim() || null : null,
        edat:typeof e.edat === 'string' ? e.edat.trim() || null : null, origen: origin});
      return;
    }
    // Dues hores alternatives explícites no són una hora confirmada.
    // Només s'aplica a la frase de l'acte, no a altres activitats del missatge.
    const ambiguousTime = date && sentencesOf(source).some(sen => {
      const n = norm(sen);
      const alternatives = /\\b([01]?\\d|2[0-3]):[0-5]\\d\\s*(?:o|u|\\/)\\s*([01]?\\d|2[0-3]):[0-5]\\d\\b/.exec(n);
      if (!alternatives) return false;
      const related = titleTokens(title).some(t => n.includes(t)) ||
        (sourceEvents.length === 1 && sentencesOf(source).length === 1);
      return related && [alternatives[1], alternatives[2]].some(t => date.endsWith(t));
    });
    if (ambiguousTime) {
      warnings.push('Hi ha dues hores alternatives per a «' + title + '». Confirma l’hora abans d’exportar.');
      suspiciousDates.push('l’hora de «' + title + '»');
    }
    if (end && date && end < date) {
      warnings.push('La data de fi de «' + title + '» és anterior a la data d’inici. Confirma les dates.');
      suspiciousDates.push('la fi de «' + title + '»');
    }
    events.push({title, data:date, dataDubtosa: dataDubtosa || !!ambiguousTime || !!(end && date && end < date), dataFi:end && date && end >= date ? end : null,
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
    const warningsBefore = suspiciousDates.length;
    const parsedDate = normalizedDate(a.data, '«' + a.accio + '»', singleTask);
    const parsedEnd = normalizedDate(a.dataFi, 'la fi de «' + a.accio + '»');
    accions.push({
      ...a,
      accio: String(a.accio).trim(),
      tipus: a.tipus === 'informatiu' ? 'informatiu' : 'tasca',
      data: parsedDate,
      dataFi: parsedEnd,
      dataDubtosa: suspiciousDates.length > warningsBefore,
      prioritat: ['alta','mitja','baixa'].includes(a.prioritat) ? a.prioritat : 'baixa',
      lloc: typeof a.lloc === 'string' ? a.lloc.trim() || null : null,
      enllac: typeof a.enllac === 'string' && /^https?:\/\//i.test(a.enllac) && (fromImage || String(source || '').includes(a.enllac)) ? a.enllac : null
    });
  });
  const dedupEvents = [];
  for (const e of events) {
    const similar = dedupEvents.find(old => old.data === e.data &&
      (norm(old.title) === norm(e.title) ||
        (norm(old.title).length > 6 && norm(e.title).includes(norm(old.title))) ||
        (norm(e.title).length > 6 && norm(old.title).includes(norm(e.title)))));
    if (similar) {
      if (!similar.dataFi && e.dataFi) similar.dataFi = e.dataFi;
      if (e.dataDubtosa) similar.dataDubtosa = true;
      if (e.estat) { similar.estat = e.estat; similar.data = null; similar.dataOriginal = e.dataOriginal || similar.dataOriginal; }
      if (!similar.lloc && e.lloc) similar.lloc = e.lloc;
      if (!similar.edat && e.edat) similar.edat = e.edat;
    } else dedupEvents.push(e);
  }
  const reminders = Array.isArray(input.recordatoris) ? input.recordatoris : [];
  const recordatoris = reminders.filter(r => r && typeof r === 'object' && typeof (r.text || r.titol) === 'string')
    .map(r => ({text: String(r.text || r.titol).trim(),data: normalizedDate(r.data, 'l’avís futur'), tipus:'informatiu'}))
    .filter(r => r.text);
  // Els terminis vençuts són fets reals, no es descarten ni es transformen en un acte.
  const today = referenceToday;
  accions.forEach(a => {
    if (a.tipus === 'tasca' && a.data && a.data.slice(0, 10) < today && !sourceDate &&
      (/(?:termini|abans|fins|pagament|lliur|entreg|inscri|inscrip|vencut|vençut)/i.test(a.accio) ||
       String(source || '').includes(a.data.slice(0, 4)))) {
      a.vençut = true;   // data passada amb any explícit al missatge: és un termini vençut, no un error de data
    }
    if (a.tipus === 'tasca') enforcePriority(a, source);
  });
  // Qualsevol acte passat requereix revisió abans d'exportar-lo, fins i tot amb any explícit.
  // sourceDate indica una comunicació històrica: no jutgem el seu calendari amb el rellotge actual.
  const markPast = e => {
    if (e.data && e.data.slice(0, 10) < today && !e.vençut && !sourceDate) {
      e.passada = true;
      warnings.push('La data ' + e.data.slice(0, 10) + ' de «' + (e.title || e.accio) + '» ja ha passat. Confirma-la.');
    }
  };
  dedupEvents.forEach(markPast);
  accions.forEach(markPast);
  return {
    ...input,
    mainEvent: dedupEvents[0] || null,
    esdeveniments: dedupEvents.map(({origen,...e}) => e),
    accions, recordatoris,
    dadesUtils: extractUseful(source, input.dadesUtils, { fromImage }),
    avisDates: unique(warnings).join(' ') || null,
    revisioDates: { requereixRevisio: suspiciousDates.length > 0 ||
      dedupEvents.some(e => e.passada) || accions.some(a => a.passada),
      camps: unique(suspiciousDates.concat(
        dedupEvents.filter(e => e.passada).map(e => e.title),
        accions.filter(a => a.passada).map(a => a.accio))) }
  };
}
module.exports = { ZONE, madridToday, validIsoDate, weekdayForISO, extractSourceWeekdays, dateConflict, extractUseful, ibanValid, normalizeAnalysis };
