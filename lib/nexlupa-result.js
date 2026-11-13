'use strict';

// NexLupa: postprocessament determinista. Cap dada nova s'inventa.
// Compatible amb el contracte antic mainEvent/accions.
const { relativeHints, rebaseVerifiedTime, resolveWeekdayNumber, alternativeHours } = require('./date-evidence');
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
const OPTIONAL_RE = /\b(?:si vols|si voleu|si ho voleu|si es vol|si us ve be|si podeu|si cal|si escau|qui vulgui|qui vulguin|opcional|opcionalment|recomanable|si es desitja|si ho desitja|si ho desitgeu|si es desitgen|si ho vol|no obligatori|en cas (?:que|de)|si lo desea|opcionalmente|si quieren)\b/;
const MONEY_OBLIGATION_RE = /\b(?:quota|matricula|inscripcio|abonament|pagament|import pendent)\b[^\n.!?]{0,60}\b\d+(?:[.,]\d+)?\s*(?:€|euros?\b)/;
const MANDATORY_RE = /\b(?:pag(?:ar|ueu|ament|o)|quota|taxa|abonar|abone[us]?|transferencia|ingress|autoritzacio|autoritzar|signar|signeu|signatura|firmar|firmen|inscri(?:ure|ureu|pcio)|matricul|llicencia|lliurar|lliureu|entregar|entreguen|documentacio|obligatori)\b/;
function enforcePriority(action, source) {
  const t = norm(action.accio);
  const sentence = sentencesOf(source).find(sen => titleTokens(action.accio).slice(0, 3).filter(tok => norm(sen).includes(tok)).length >= 2);
  const optional = OPTIONAL_RE.test(t) || (sentence && OPTIONAL_RE.test(norm(sentence)) && !MANDATORY_RE.test(t));
  const before = action.prioritat;
  if (optional) action.prioritat = 'baixa';
  else if (action.tipus === 'tasca' && (MANDATORY_RE.test(t) || MONEY_OBLIGATION_RE.test(t))) action.prioritat = 'alta';
  if (action.prioritat !== before) action.prioritatCorregida = true;
}

// ── Reconciliació determinista (2a ronda sobre respostes reals) ──
const MONTHS_CA = ['gener','febrer','març','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];
const WEEKDAYS_CA_RE = '(dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)';
function isoAddDays(iso, n) {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b.slice(0, 10) + 'T12:00:00Z') - new Date(a.slice(0, 10) + 'T12:00:00Z')) / 86400000);
}
function fmtDM(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
// Dates ISO escrites dins el text visible («abans del 2026-12-11») → «11 de desembre».
function humanizeIsoDates(text, refYear) {
  if (typeof text !== 'string') return text;
  return text.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b(?![ T]\d{2}:\d{2})/g, (all, y, m, d) => {
    const mi = +m - 1;
    if (mi < 0 || mi > 11) return all;
    const dd = +d;
    const article = [1, 8, 11].includes(dd) || dd === 1 ? '' : '';
    return dd + (/^(?:[aeiouh])/i.test(MONTHS_CA[mi]) ? ' d’' : ' de ') + MONTHS_CA[mi] + (+y !== refYear ? ' de ' + y : '');
  });
}
function hasTodayEvidence(source, today) {
  const n = norm(source);
  const [y, m, d] = today.split('-').map(Number);
  const monthRe = norm(MONTHS_CA[m - 1]);
  return new RegExp('\\b(?:avui|hui|hoy|today|ara mateix|aquesta nit|aquest vespre|aquesta tarda|aquest mati|esta noche|esta tarde|aquesta hora)\\b').test(n) ||
    new RegExp('\\b' + norm(weekdayForISO(today)) + '\\b').test(n) ||
    new RegExp('\\b0?' + d + '\\s*(?:de\\s+|d\\W)?' + monthRe + '\\b').test(n) ||
    new RegExp('\\b0?' + d + '\\s*/\\s*0?' + m + '\\b').test(n);
}
function explicitDayMonthInSource(source, iso) {
  const n = norm(source), d = +iso.slice(8, 10), m = +iso.slice(5, 7);
  return new RegExp('\\b0?' + d + '\\s*(?:de\\s+|d\\W)?' + norm(MONTHS_CA[m - 1]) + '\\b').test(n) ||
    new RegExp('\\b0?' + d + '\\s*/\\s*0?' + m + '\\b').test(n);
}
function normalizeAnalysis(raw, source, dateReference, sourceDate, opts) {
  const fromImage = !!(opts && opts.fromImage);
  const input = raw && typeof raw === 'object' ? raw : {};
  const refs = extractSourceWeekdays(source);
  const referenceToday = (validIsoDate(dateReference) || madridToday()).slice(0,10);
  const relativeBase = (validIsoDate(sourceDate) || referenceToday).slice(0,10);
  const relative = relativeHints(source, relativeBase);
  const ambiguousTimes = alternativeHours(source);
  const relativeSentences = sentencesOf(source).filter(s => relativeHints(s,relativeBase).hasRelative);
  function mentionedNearRelative(title) {
    if (relativeSentences.length !== 1) return false;
    // One short sentence can safely supply a single event's relative date.
    if (sentencesOf(source).length === 1 &&
        !/\b(?:ahir|ayer|anteayer|resultat|marcador|ja es va jugar|va acabar|ha acabat)\b/.test(norm(source)) &&
        !/\b(?:resultat|marcador|partit passat|entrenament passat)\b/.test(norm(title))) return true;
    const tokens = titleTokens(title);
    return tokens.length > 0 && tokens.some(t => norm(relativeSentences[0]).includes(t)) &&
      !/\b(?:resultat|marcador|passat|finalitzat)\b/.test(norm(title));
  }
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
    sourceEvents.every(e => mentionedNearRelative(e.title || e.accio)) &&
    !sourceEvents.some(e => e.dataFi) && !datedTasks.length && !datedReminders.length;
  const singleTask = !semanticBlock && !!relative.date && uniqueEventTitles.length === 0 &&
    taskRaw.length === 1 && mentionedNearRelative(taskRaw[0].accio) &&
    !taskRaw[0].dataFi && !datedReminders.length;
  const warnings = [];
  // Les ubicacions proposades per la IA només són fiables si consten al text.
  function groundedLocation(value, title) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const place = value.trim();
    if (fromImage || norm(source).includes(norm(place))) return place;
    warnings.push('Cal confirmar la ubicació de «' + title + '»: no consta al missatge original.');
    suspiciousDates.push('la ubicació de «' + title + '»');
    return null;
  }
  const originalWarning = typeof input.avisDates === 'string' ? input.avisDates.trim() : '';
  if (originalWarning) warnings.push(originalWarning);
  const suspiciousDates = [];
  function normalizedDate(value, context, relativeOverride) {
    if (relativeOverride && relative.date) {
      const candidate = rebaseVerifiedTime(value, relative.date, source);
      if (ambiguousTimes.length) {
        warnings.push('El missatge ofereix dues hores alternatives; confirma l’hora de ' + context + '.');
        suspiciousDates.push(context);
        return candidate.slice(0,10);
      }
      return candidate;
    }
    if (!value || value === 'null') return null;
    const iso = validIsoDate(value);
    if (!iso) {
      warnings.push('Cal confirmar la data de ' + context + ': el format no és vàlid.');
      suspiciousDates.push(context);
      return null;
    }
    const conflict = dateConflict(iso, refs);
    // Never present one unconfirmed alternative hour as a certain calendar event.
    if (ambiguousTimes.length && (iso.length === 10 || ambiguousTimes.includes(iso.slice(11,16)))) {
      warnings.push('El missatge ofereix dues hores alternatives; confirma l’hora de ' + context + '.');
      suspiciousDates.push(context);
      return iso.slice(0,10);
    }
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
        lloc:groundedLocation(e.lloc, title),
        edat:typeof e.edat === 'string' ? e.edat.trim() || null : null, origen: origin});
      return;
    }
    if (recurring) {
      events.push({title, data:null, dataOriginal:date, estat:'recurrent', dataFi:null,
        lloc:groundedLocation(e.lloc, title),
        edat:typeof e.edat === 'string' ? e.edat.trim() || null : null, origen: origin});
      return;
    }
    // Dues hores alternatives explícites no són una hora confirmada.
    // Només s'aplica a la frase de l'acte, no a altres activitats del missatge.
    const ambiguousTime = date && sentencesOf(source).some(sen => {
      const n = norm(sen);
      const alternatives = /\b((?:[01]?\d|2[0-3]):[0-5]\d)\s*(?:o|u|\/)\s*((?:[01]?\d|2[0-3]):[0-5]\d)\b/.exec(n);
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
      lloc:groundedLocation(e.lloc, title),
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
    const invertedRange = !!(parsedDate && parsedEnd && parsedEnd < parsedDate);
    if (invertedRange) {
      warnings.push('La data de fi de «' + a.accio + '» és anterior a la data d’inici. Confirma les dates.');
      suspiciousDates.push('la fi de «' + a.accio + '»');
    }
    accions.push({
      ...a,
      accio: String(a.accio).trim(),
      tipus: a.tipus === 'informatiu' ? 'informatiu' : 'tasca',
      data: parsedDate,
      dataFi: invertedRange ? null : parsedEnd,
      dataDubtosa: suspiciousDates.length > warningsBefore,
      prioritat: ['alta','mitja','baixa'].includes(a.prioritat) ? a.prioritat : 'baixa',
      lloc: groundedLocation(a.lloc, String(a.accio).trim()),
      enllac: typeof a.enllac === 'string' && /^https?:\/\//i.test(a.enllac) && (fromImage || String(source || '').includes(a.enllac)) ? a.enllac : null
    });
  });
  const dedupEvents = [];
  for (const e of events) {
    // Fusió conservadora (HEAD + night): un FALS DUPLICAT només mostra dos cops un acte; una FALSA FUSIÓ en fa perdre un.
    // Per això només es fusiona amb títol idèntic, mateixa data/hora, mateix estat, durada, lloc i edat compatibles.
    const similar = dedupEvents.find(old =>
      old.data === e.data &&
      (old.estat || null) === (e.estat || null) &&
      norm(old.title) === norm(e.title) &&
      (!old.dataFi || !e.dataFi || old.dataFi === e.dataFi) &&
      (!old.lloc || !e.lloc || norm(old.lloc) === norm(e.lloc)) &&
      (!old.edat || !e.edat || norm(old.edat) === norm(e.edat)));
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
  const deadlineOf = x => ((x.dataFi && !x.data) ? x.dataFi : (x.dataFi || x.data) || '').slice(0, 10);
  // (A) Un acte/tasca amb data = avui però sense cap indici d'«avui» al missatge és una data inventada pel model.
  if (!sourceDate && !hasTodayEvidence(source, today)) {
    dedupEvents.forEach(e => {
      if (e.data && e.data.slice(0, 10) === today && !e.estat) {
        e.dataOriginal = e.data; e.data = null; e.dataDubtosa = true;
        warnings.push('El missatge no indica la data de «' + e.title + '»; confirma-la abans d’afegir-la al calendari.');
        suspiciousDates.push('l’esdeveniment «' + e.title + '»');
      }
    });
    accions.forEach(a => {
      if (a.data && a.data.slice(0, 10) === today && a.tipus === 'tasca') {
        a.data = null; a.dataDubtosa = true;
        warnings.push('El missatge no indica la data de «' + a.accio.slice(0, 60) + '»; confirma-la.');
        suspiciousDates.push(a.accio);
      }
    });
  }
  // (B) «diumenge 13» (sense mes) que no coincideix amb cap data del resultat: s'hi força la propera data real.
  extractSourceWeekdays(source).filter(r => !r.month && !r.year).forEach(r => {
    const all = [...dedupEvents, ...accions];
    const coincideix = all.some(x => [x.data, x.dataFi].some(v => v && +v.slice(8, 10) === r.day && weekdayForISO(v.slice(0, 10)) === r.weekday));
    if (coincideix) return;
    const cand = resolveWeekdayNumber(r.weekday, r.day, today, 3);
    if (!cand) return;
    const misplaced = dedupEvents.filter(e => e.data && weekdayForISO(e.data.slice(0, 10)) === r.weekday && +e.data.slice(8, 10) !== r.day);
    if (misplaced.length === 1) {
      const e = misplaced[0];
      e.dataOriginal = e.data; e.data = cand + e.data.slice(10); e.dataDubtosa = true;
      warnings.push('Hem interpretat «' + r.text + '» com el ' + fmtDM(cand) + '. Confirma-ho, i revisa també els altres dies de la setmana esmentats al missatge.');
    } else {
      warnings.push('«' + r.text + '» no coincideix amb cap data del resultat (possiblement el ' + fmtDM(cand) + '); confirma-la.');
    }
    suspiciousDates.push(r.text);
  });
  // (C) «abans de dijous» sense número, amb un acte posterior de data explícita: és el dijous de la setmana de l'acte.
  const bareDeadline = new Set();
  const nsource = norm(source);
  const bareRe = new RegExp('\\b(?:abans (?:de|del|d\\W)\\s*|fins (?:a|al|el|a el)\\s+|antes del\\s+|hasta el\\s+)' + WEEKDAYS_CA_RE + '\\b(?!\\s*\\d)', 'g');
  let bm; while ((bm = bareRe.exec(nsource)) !== null) bareDeadline.add(bm[1]);
  const anchor = dedupEvents.filter(e => e.data && !e.estat && e.data.slice(0, 10) >= today && explicitDayMonthInSource(source, e.data.slice(0, 10)))
    .map(e => e.data.slice(0, 10)).sort()[0];
  if (anchor && bareDeadline.size) {
    accions.forEach(a => {
      ['dataFi', 'data'].forEach(field => {
        const v = a[field] && a[field].slice(0, 10);
        if (!v || !bareDeadline.has(norm(weekdayForISO(v))) || v >= anchor || daysBetween(v, anchor) < 7) return;
        let c = anchor;
        for (let k = 1; k <= 7; k++) { c = isoAddDays(anchor, -k); if (norm(weekdayForISO(c)) === norm(weekdayForISO(v))) break; }
        a[field] = c + a[field].slice(10); a.dataDubtosa = true;
        warnings.push('Hem interpretat «abans de ' + weekdayForISO(c) + '» com el ' + fmtDM(c) + ' (setmana de l’acte del ' + fmtDM(anchor) + '). Confirma-ho.');
        suspiciousDates.push(a.accio);
      });
    });
  }
  accions.forEach(a => {
    const due = deadlineOf(a);
    if (a.tipus === 'tasca' && due && due < today && !sourceDate &&
      (/(?:termini|abans|fins|pagament|lliur|entreg|inscri|inscrip|vencut|vençut)/i.test(a.accio) ||
       String(source || '').includes(due.slice(0, 4)))) {
      a.vençut = true;   // data passada amb any explícit al missatge: és un termini vençut, no un error de data
    }
    if (a.tipus === 'tasca') enforcePriority(a, source);
  });
  // Qualsevol acte passat requereix revisió abans d'exportar-lo, fins i tot amb any explícit.
  // sourceDate indica una comunicació històrica: no jutgem el seu calendari amb el rellotge actual.
  const markPast = e => {
    const due = deadlineOf(e);
    if (due && due < today && !e.vençut && !sourceDate) {
      e.passada = true;
      warnings.push('La data ' + due + ' de «' + (e.title || e.accio) + '» ja ha passat. Confirma-la.');
    }
  };
  dedupEvents.forEach(markPast);
  accions.forEach(markPast);
  // El motor no pot concloure «cap acció necessària» quan hi ha tasques reals.
  // La decisió substitutiva reutilitza només accions ja verificades, sense inventar-ne.
  const pendingActions = accions.filter(a => a.tipus === 'tasca');
  const rawDecision = typeof input.decisio === 'string' ? input.decisio.trim() : '';
  const noActionDecision = /^(?:cap accio necessaria|no cal fer res|no hi ha cap accio necessaria|ninguna accion necesaria|no action required)\.?$/.test(norm(rawDecision));
  const resolvedDecision = pendingActions.length && (!rawDecision || noActionDecision)
    ? (pendingActions.length === 1 ? pendingActions[0].accio :
      'Hi ha ' + pendingActions.length + ' tasques pendents: ' +
      pendingActions.slice(0, 2).map(a => a.accio.replace(/[.!?]$/, '')).join('; ') +
      (pendingActions.length > 2 ? '…' : '.'))
    : rawDecision;
  const refYear = +today.slice(0, 4);
  accions.forEach(a => { a.accio = humanizeIsoDates(a.accio, refYear); });
  recordatoris.forEach(r => { r.text = humanizeIsoDates(r.text, refYear); });
  return {
    ...input,
    resum: humanizeIsoDates(input.resum, refYear),
    decisio: humanizeIsoDates(resolvedDecision, refYear),
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
module.exports = { humanizeIsoDates, ZONE, madridToday, validIsoDate, weekdayForISO, extractSourceWeekdays, dateConflict, extractUseful, ibanValid, normalizeAnalysis };
