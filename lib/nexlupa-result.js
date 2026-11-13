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
// Longitud ISO 13616 per país; ES és exactament 24 caràcters.
const IBAN_LENGTHS={ES:24,DE:22,FR:27,GB:22,IT:27,PT:25,NL:18,BE:16,CH:21,AT:20,IE:22,LU:20,AD:24,MC:27,GR:27,PL:28,DK:18,NO:15,SE:24,FI:18,CZ:24,SK:24,SI:19,HR:21,HU:28,RO:24,BG:22,EE:20,LT:20,LV:21,MT:31,CY:28,IS:26,LI:21};
function clipIbanCandidate(text) {
  const input=String(text||''), country=input.slice(0,2).toUpperCase();
  const limit=IBAN_LENGTHS[country]||34;
  let count=0,end=0;
  for (let i=0;i<input.length;i++){
    if (/[A-Za-z0-9]/.test(input[i])) count++;
    if (count>limit) break;
    end=i+1;
    if(count===limit)break;
  }
  return count>=15 ? input.slice(0,end).trim() : null;
}
// IBAN: només es mostra si el dígit de control (mòdul 97) és vàlid.
function ibanValid(value) {
  const v = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  if (IBAN_LENGTHS[v.slice(0,2)] && v.length!==IBAN_LENGTHS[v.slice(0,2)]) return false;
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
  const ibansRaw = unique((input.match(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,8}\b/gi) || [])
    .map(clipIbanCandidate).filter(Boolean).map(s=>s.replace(/\s+/g,' ').trim()));
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
      if (key === 'iban') {
        const trimmed=clipIbanCandidate(val);
        if(trimmed)ibansRaw.push(trimmed);
      }
      if (key === 'imports') imports.push(val);
      if (key === 'telefons') telefons.push(val);
    }
  }
  // Conservem els IBAN invàlids literalment, però NO dins del camp iban:
  // aquest camp només conté valors vàlids que altres integracions podrien utilitzar.
  // Els invàlids són estrictament informatius i no es poden proposar per pagar.
  const ibans = [], ibansInvalids = [];
  for (const v of unique(ibansRaw)) (ibanValid(v) ? ibans : ibansInvalids).push(v);
  if (ibansInvalids.length) avisos.push('IBAN no vàlid. Confirma’l amb l’emissor abans de fer cap transferència. No utilitzis aquest número per pagar.');
  const out = {
    enllacos: unique(urls),
    iban: unique(ibans),
    ibanInvalids: unique(ibansInvalids),
    imports: unique(imports),
    telefons: unique(telefons),
    altres
  };
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
const OPTIONAL_RE = /\b(?:si vols|si voleu|si ho voleu|si es vol|si us ve be|si podeu|si cal|si escau|qui vulgui|qui vulguin|opcional|opcionalment|recomanable|si es desitja|si ho desitja|si ho desitgeu|si es desitgen|si ho vol|no obligatori|en cas (?:que|de)|si lo desea|opcionalmente|si quieren|podeu|podreu|demaneu un altre dia|si en teniu)\b/;
const MONEY_OBLIGATION_RE = /\b(?:quota|matricula|inscripcio|abonament|pagament|import pendent)\b[^\n.!?]{0,60}\b\d+(?:[.,]\d+)?\s*(?:€|euros?\b)/;
const MANDATORY_RE = /\b(?:pag(?:ar|ueu|ament|o)|quota|taxa|abonar|abone[us]?|transferencia|ingress|autoritzacio|autoritzar|signar|signeu|signatura|firmar|firmen|inscri(?:ure|ureu|pcio)|matricul|llicencia|lliurar|lliureu|entregar|entreguen|documentacio|obligatori)\b/;
function enforcePriority(action, source) {
  const t = norm(action.accio);
  const sentence = sentencesOf(source).find(sen => titleTokens(action.accio).slice(0, 3).filter(tok => norm(sen).includes(tok)).length >= 2);
  const explicitMandatoryConfirmation = /\b(?:confirmar|confirmeu|confirmacio|respondre|respon(?:eu|dre)|avisar|aviseu|inscriure|lliurar|pag(?:ar|ueu))\b/.test(t) &&
    /\b(?:abans|fins|termini|com a maxim|com a màxim)\b/.test(t+' '+norm(source));
  const optionalStart = /^(?:si voleu|si es vol|si us ve be|opcional(?:ment)?|si en teniu|qui vulgui|podeu|podreu)\b/.test(t);
  const optionalTail = /\b(?:si en teniu|si cal|opcionalment|si voleu)\b/.test(t);
  const optional = !explicitMandatoryConfirmation && (optionalStart ||
    (optionalTail && !/\b(?:confirmar|confirmeu|confirmacio|respondre|avisar|aviseu|heu de|cal lliurar|obligatori)\b/.test(t)) ||
    (sentence && OPTIONAL_RE.test(norm(sentence)) && !MANDATORY_RE.test(t) &&
      !/\b(?:confirmar|confirmeu|confirmacio|respondre|avisar|aviseu|portar|porteu|dur)\b/.test(t)));
  const before = action.prioritat;
  const registration = /\b(?:sol\W?licit|solicitud|solicitar|beca|ajut|ayuda|inscripcio|inscriure|matricul|admissio|presentar documentacio)\b/.test(t);
  const strict = /\b(?:abans|fins|termini|data limit|ultim dia|fora de termini|no es tindran en compte|obligatori|fecha limite|plazo|deadline)\b/.test(t+' '+norm(source));
  const health = /\b(?:polls|piojos|contagi|infeccio|salut|sanitari|alerta sanitaria|revisar el cap)\b/.test(t);
  const criticalDoc=/\b(?:obligatori(?:a|s|es)?|signada|signat|signades|signats|imprescindible|autoritzacio signada)\b/.test(t) &&
    !/\b(?:no obligatori|no obligatoria)\b/.test(t);
  const healthCheck=health && /\b(?:revisar|reviseu|comproveu|detectar|tractar|tractament)\b/.test(t);
  const preparationOnly=/\b(?:portar|porteu|dur|esmorzar|aigua|vestuari|maillot|samarreta|equipacio|material|mitjons|bambes|esterilla)\b/.test(t) &&
    !MANDATORY_RE.test(t) && !MONEY_OBLIGATION_RE.test(t);
  if (criticalDoc) action.prioritat='alta';
  else if (healthCheck && /\b(?:reviseu|revisar el cap|revisar els cabells|comprovar)\b/.test(t)) action.prioritat='mitja';
  else if (explicitMandatoryConfirmation) action.prioritat='alta';
  else if (optional) action.prioritat='baixa';
  else if (preparationOnly) action.prioritat='mitja';
  else if (action.tipus==='tasca' && ((registration && strict) || MANDATORY_RE.test(t) || MONEY_OBLIGATION_RE.test(t))) action.prioritat='alta';
  else if (action.tipus==='tasca' && health && action.prioritat==='baixa') action.prioritat='mitja';
  const preparation=/\b(?:portar|porteu|dur|esmorzar|aigua|vestuari|maillot|samarreta|equipacio|material)\b/.test(t);
  if (action.tipus==='tasca' && !optional && action.prioritat==='baixa' &&
      (health || preparation)) action.prioritat='mitja';
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
  const RECURRING = /\b(?:tots els|totes les|cada|setmanal(?:ment)?|els (?:dilluns|dimarts|dimecres|dijous|divendres|dissabtes?|diumenges?)|todos los|todas las|cada semana|semanal|los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos))\b/;
  const semanticBlock = SUSPENDED.test(nsrc) || RECURRING.test(nsrc);
  const singleEvent = !semanticBlock && !!relative.date && uniqueEventTitles.length === 1 &&
    sourceEvents.every(e => mentionedNearRelative(e.title || e.accio)) &&
    !sourceEvents.some(e => e.dataFi) && !datedTasks.length && !datedReminders.length;
  const singleTask = !semanticBlock && !!relative.date && uniqueEventTitles.length === 0 &&
    taskRaw.length === 1 && mentionedNearRelative(taskRaw[0].accio) &&
    !taskRaw[0].dataFi && !datedReminders.length;
  const warnings = [];
  // Evidència flexible: articles, contraccions, carrer entre parèntesis.
  // No inventa un nom: el retorn és la proposta ancorada o un fragment literal.
  const plainPlace = t => norm(t).replace(/[’'().,;:/-]/g,' ').replace(/\s+/g,' ').trim();
  const normalizedSourcePlace = plainPlace(source);
  const venueMatches = Array.from(String(source).matchAll(/\b(?:Auditori|Pavelló|Poliesportiu|Teatre|Sala|Aula|Parc|Centre Cívic|Escola|Piscina|Camp|Gimnàs|Estadi|Biblioteca|Museu|Restaurant|Casal|Plaça|Carrer|Avinguda|Pista)\b[^\n.!?;:]{0,65}/gi))
    .map(x=>x[0].trim()
      .split(/\s+(?:serà|sera|tindrà|tindra|comença|comenca|a les|el (?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|\d{1,2})|amb|quan|perquè|perque|i (?:dilluns|dimarts|dimecres|dijous|divendres)|per al|al curs|en el curs)\b/i)[0]
      .replace(/[,;:.]+$/,'').trim())
    .filter(x=>x.length>=5 && x.length<=60 && x.split(/\s+/).length<=6);
  const uniqueVenues=[...new Set(venueMatches.map(v=>plainPlace(v)))];
  function groundedLocation(value, title) {
    if (typeof value==='string') {
      const open=(value.match(/\(/g)||[]).length, close=(value.match(/\)/g)||[]).length;
      if (close>open) value=value.replace(/\)+\s*$/,'').trim();
    }
    if (typeof value !== 'string' || !value.trim()) {
      // Només si hi ha un únic recinte explícit i no s'ha proposat un altre.
      return !fromImage && uniqueVenues.length===1 ? venueMatches[0] : null;
    }
    const place=value.trim();
    // «Reservar plaça» no és un lloc, i «escola» sola no identifica una adreça.
    if (/^(?:placa|plaça|reserva|casa|escola|centre|local|pati|gimnas|teatre|pavello)$/i.test(plainPlace(place))) return null;
    if (place.length>60 || place.split(/\s+/).length>6) {
      // Evitar fragments de frase al lloc, també si apareixen literalment al text.
      return uniqueVenues.length===1 ? venueMatches[0] : null;
    }
    const normalizedPlace=plainPlace(place).replace(/^(?:a|al|als|a l|a la|el|la|l)\s+/,'');
    if (fromImage || normalizedSourcePlace.includes(normalizedPlace)) return place;
    const strongWords=normalizedPlace.split(' ').filter(x=>x.length>=4 && !/^(?:carrer|placa|avinguda|municipal|centre|pavello|sala)$/.test(x));
    const grounded=venueMatches.find(v=>strongWords.length && strongWords.every(t=>plainPlace(v).includes(t)));
    if (grounded) return grounded;
    // Quan hi ha un únic lloc literal, no substituir-lo per un de suposat.
    if (uniqueVenues.length===1) return venueMatches[0];
    warnings.push('Cal confirmar la ubicació de «'+title+'»: no consta al missatge original.');
    suspiciousDates.push('la ubicació de «'+title+'»');
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
    // Dia i número incompatibles: el model NO pot moure l'acte al dia adjacent.
    const adjacentConflict = refs.find(r => {
      if ((r.month && r.month !== +iso.slice(5,7)) || (r.year && r.year !== +iso.slice(0,4))) return false;
      if (!r.month && refs.length!==1) return false;
      const stated = iso.slice(0,4)+'-'+String(r.month).padStart(2,'0')+'-'+String(r.day).padStart(2,'0');
      if (!validIsoDate(stated) || weekdayForISO(stated)===r.weekday) return false;
      if (weekdayForISO(iso)!==r.weekday || Math.abs(daysBetween(iso,stated))>1) return false;
      return !explicitDayMonthInSource(source,iso);
    });
    if (adjacentConflict) {
      warnings.push('El missatge diu «'+adjacentConflict.text+'», però el dia de la setmana no correspon al número. Es conserva el número, pendent de confirmació.');
      suspiciousDates.push(context);
      return iso.slice(0,4)+'-'+String(adjacentConflict.month || +iso.slice(5,7)).padStart(2,'0')+
        '-'+String(adjacentConflict.day).padStart(2,'0')+iso.slice(10);
    }
    // D1: una data explícita 30 de novembre no es pot moure per un «dimecres 30»
    // d'una altra frase. Els conflictes dia/número amb mes explícit continuen bloquejats.
    const sourceAnchored = explicitDayMonthInSource(source,iso);
    const conflict = dateConflict(iso, sourceAnchored
      ? refs.filter(r=>!!r.month)
      : refs);
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
      warnings.push('El missatge diu «' + conflict.text + '», però el ' + iso.slice(0, 10) + ' és ' + weekdayForISO(iso) + '. Es conserva el número, pendent de confirmació.');
      suspiciousDates.push(context);
      return iso; // E3: data visible però dataDubtosa; el client bloqueja exportació automàtica.
    }
    return iso;
  }
  // D2: el model pot ometre una data que apareix clarament al missatge.
  // Només inferir quan una frase de l'acte n'ofereix UN únic dia coherent;
  // mai inventar un dia davant de referències contradictòries.
  function recoverMissingEventDate(title) {
    const sentences = sentencesOf(source);
    const tokens = titleTokens(title);
    const relevant = sentences.filter(sen => {
      const n=norm(sen);
      return tokens.some(t=>n.includes(t)) || (sourceEvents.length===1 && sentences.length===1);
    });
    if (relevant.length!==1) return null;
    const sentence = relevant[0], declared=extractSourceWeekdays(sentence);
    if (declared.length===1) {
      const r=declared[0];
      if (r.month) {
        const y=r.year || +referenceToday.slice(0,4);
        const date=String(y)+'-'+String(r.month).padStart(2,'0')+'-'+String(r.day).padStart(2,'0');
        if (!validIsoDate(date) || weekdayForISO(date)!==r.weekday) return null;
        return date;
      }
      return resolveWeekdayNumber(r.weekday,r.day,referenceToday,3) || null;
    }
    if (declared.length>1 || ABSOLUTE_DATE.test(norm(sentence))) return null;
    const matches=[...norm(sentence).matchAll(new RegExp(WEEKDAY_WORD.source,'g'))].map(m=>m[1]);
    if (matches.length!==1) return null;
    const weekday=matches[0];
    let cand=referenceToday;
    for(let k=0;k<7;k++){cand=isoAddDays(referenceToday,k+1);if(weekdayForISO(cand)===weekday)return cand;}
    return null;
  }
  const actions = Array.isArray(input.accions) ? input.accions : [];
  const accions = [];
  const events = [];
  function eventFrom(e, origin) {
    if (!e || typeof e !== 'object') return;
    const title = String(e.title || e.accio || '').trim();
    if (!title) return;
    const beforeDateWarnings = suspiciousDates.length;
    const date = normalizedDate(e.data, 'l’esdeveniment «' + title + '»', singleEvent) ||
      (!e.data ? recoverMissingEventDate(title) : null);
    const end = normalizedDate(e.dataFi, 'la fi de «' + title + '»');
    const matchingConflicts=extractSourceWeekdays(source).filter(r=>r.month &&
      validIsoDate((r.year||+referenceToday.slice(0,4))+'-'+String(r.month).padStart(2,'0')+'-'+String(r.day).padStart(2,'0')) &&
      weekdayForISO((r.year||+referenceToday.slice(0,4))+'-'+String(r.month).padStart(2,'0')+'-'+String(r.day).padStart(2,'0'))!==r.weekday);
    if(!date && matchingConflicts.length && sourceEvents.length===1) {
      warnings.push('La data de «'+title+'» conté un dia de setmana incompatible amb el número.');
      suspiciousDates.push('l’esdeveniment «'+title+'»');
    }
    let dataDubtosa = suspiciousDates.length > beforeDateWarnings;
    if(!date && /\b(?:no coincideix|data dubtosa|confirma la data|dia incorrecte|dia de setmana incorrecte)\b/.test(
      norm(String(input.avisDates||'')+' '+String(input.resum||'')))) {
      dataDubtosa=true;
      suspiciousDates.push('l’esdeveniment «'+title+'» (data contradictòria)');
      warnings.push('La data de «'+title+'» no està confirmada; revisa el dia i el número.');
    }
    // No exportar suspensions ni recurrències com un esdeveniment puntual confirmat.
    const titleNorm = norm(title);
    const namedCancellation = /(?:suspes|suspesa|suspen|cancel|anul|ajorn|aplac|suspendid|aplazad)/.test(titleNorm) && !/recuper|reprogram/.test(titleNorm);
    const cancelSentences=sentencesOf(source).filter(sen=>CANCEL_PARTICIPLE.test(norm(sen)));
    const sourceHasReprogramming=/\b(?:nova data|nova actuacio|nou concert|reprogram|recuper|en lloc de|passa al|passa a|sera finalment|sera el|nou dia)\b/.test(nsrc);
    // «Us avisarem de la nova data» no és una reprogramació datada.
    // Exigim evidència explícita de la data NOVA a una clàusula no cancel·lada.
    const dateIsNew=date && sourceHasReprogramming && cancelSentences.every(sen=>
      !explicitDayMonthInSource(sen,date) && !norm(sen).includes(date.slice(0,10))) &&
      sentencesOf(source).some(sen=>!CANCEL_PARTICIPLE.test(norm(sen)) &&
        (explicitDayMonthInSource(sen,date) || norm(sen).includes(date.slice(0,10)) ||
        (extractSourceWeekdays(sen).some(w=>w.weekday===weekdayForISO(date.slice(0,10)) &&
          (w.day===+date.slice(8,10))))));
    const genericCancellation = !dateIsNew && sentenceAbout(title, date, source, CANCEL_PARTICIPLE, sourceEvents.length) &&
      !/recuper|reprogram/.test(titleNorm);
    const cancelled = namedCancellation || genericCancellation;
    // Recurrent: una frase recurrent («els dimarts ...») que parla d'aquest acte i sense data absoluta pròpia.
    const relatedRecurrence = sentencesOf(source).some(sen => {
      const n=norm(sen);
      const match=RECURRING.test(n) && !ABSOLUTE_DATE.test(n);
      if (!match) return false;
      return titleTokens(title).some(t=>n.includes(t)) ||
        (sourceEvents.length===1 && sentencesOf(source).length===1);
    });
    // Un model pot haver inventat una data per una activitat realment setmanal;
    // un acte amb data explícita a la font és puntual i mai es reclassifica.
    const recurring = !cancelled && relatedRecurrence &&
      !(date && explicitDayMonthInSource(source,date)) &&
      !/\b(?:excepcionalment|puntualment|excepcionalmente|solo este)\b/.test(nsrc);
    if (cancelled) {
      // E4: «Reunió anul·lada» genèrica és un avís de canvi, no un nou esdeveniment exportable.
      if (sourceEvents.length>1 &&
          /^(?:reunio|activitat|acte|esdeveniment)\s+(?:anul|susp|cancel)/.test(titleNorm) &&
          /\b(?:nova data|reprogram|trasllad|passa a|sera el|sera dimecres|sera dijous)\b/.test(nsrc)) return;
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
    // E1: el càrrec automàtic no obliga la família a revisar ni a fer un segon pagament.
    const actionText=norm(a.accio);
    const automated=/\b(?:domiciliacio|domiciliat|domiciliada|carrec automatic|carregara|es cobrara|es fara per domiciliacio)\b/.test(nsrc);
    const inventedAudit=/\b(?:comprovar|revisar|verificar|assegurar|controlar)\b.{0,65}\b(?:carrec|quota|pagament|cobrament|domiciliacio)\b/.test(actionText);
    const explicitAudit=sentencesOf(source).some(sen =>
      /\b(?:heu de|cal |comproveu|reviseu|verifiqueu|comprovar|revisar|verificar)\b.{0,50}\b(?:carrec|quota|pagament|domiciliacio)\b/.test(norm(sen)));
    if (automated && inventedAudit && !explicitAudit) return;
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
      // D7: una ubicació opcional de tasca no produeix advertiments d'esdeveniment.
      lloc: typeof a.lloc==='string' && plainPlace(a.lloc).length<=60 &&
        normalizedSourcePlace.includes(plainPlace(a.lloc)) ? a.lloc : null,
      enllac: typeof a.enllac === 'string' && /^https?:\/\//i.test(a.enllac) && (fromImage || String(source || '').includes(a.enllac)) ? a.enllac : null
    });
  });
  const dedupEvents = [];
  for (const e of events) {
    // Fusió conservadora (HEAD + night): un FALS DUPLICAT només mostra dos cops un acte; una FALSA FUSIÓ en fa perdre un.
    // Per això només es fusiona amb títol idèntic, mateixa data/hora, mateix estat, durada, lloc i edat compatibles.
    const similar = dedupEvents.find(old =>
      (old.data === e.data || (old.data && e.data &&
        old.data.slice(0,10)===e.data.slice(0,10) &&
        (old.data.length===10 || e.data.length===10))) &&
      (old.estat || null) === (e.estat || null) &&
      norm(old.title).replace(/^(?:sortida|inici|tornada)\s+(?:de\s+|del\s+|a\s+)?/,'') ===
        norm(e.title).replace(/^(?:sortida|inici|tornada)\s+(?:de\s+|del\s+|a\s+)?/,'') &&
      (!old.dataFi || !e.dataFi || old.dataFi === e.dataFi) &&
      (!old.lloc || !e.lloc || norm(old.lloc) === norm(e.lloc)) &&
      (!old.edat || !e.edat || norm(old.edat) === norm(e.edat)));
    if (similar) {
      if ((!similar.data || similar.data.length===10) && e.data && e.data.length>10) similar.data=e.data;
      if (!similar.dataFi && e.dataFi) similar.dataFi = e.dataFi;
      if (e.dataDubtosa) similar.dataDubtosa = true;
      if (e.estat) { similar.estat = e.estat; similar.data = null; similar.dataOriginal = e.dataOriginal || similar.dataOriginal; }
      if (!similar.lloc && e.lloc) similar.lloc = e.lloc;
      if (!similar.edat && e.edat) similar.edat = e.edat;
    } else dedupEvents.push(e);
  }
  // E5: un acte genèric sense curs/grup és redundant si té una versió específica
  // del mateix acte, dia i hora. No fusionar dos grups específics diferents.
  for (let i=dedupEvents.length-1;i>=0;i--) {
    const e=dedupEvents[i]; if(!e.data||e.estat)continue;
    const nt=norm(e.title);
    if (!/^(?:reunio|festa|jornada|activitat|festival|exhibicio)\b/.test(nt))continue;
    const specific=/\b(?:\d+(?:r|t|e|a)|primaria|infantil|grup\s*[a-z0-9]|classe\s*[a-z0-9]|curs\s*\d)\b/.test(nt);
    if (specific)continue;
    const other=dedupEvents.find((c,j)=>j!==i&&c.data&&c.data===e.data&&
      norm(c.title).startsWith(nt)&&
      norm(c.title).length>nt.length+3);
    if(other) dedupEvents.splice(i,1);
  }
  // D8: eliminar una fila «paraigua» del calendari quan els dies del rang
  // ja són representats per almenys dues sessions independents verificables.
  for (let i=dedupEvents.length-1;i>=0;i--) {
    const umbrella=dedupEvents[i];
    if (!umbrella.data || !umbrella.dataFi || umbrella.estat) continue;
    const start=umbrella.data.slice(0,10),end=umbrella.dataFi.slice(0,10);
    if (end<=start) continue;
    const names=titleTokens(umbrella.title);
    const children=dedupEvents.filter((candidate,j)=>
      j!==i && candidate.data && !candidate.estat &&
      candidate.data.slice(0,10)>=start && candidate.data.slice(0,10)<=end &&
      (!candidate.dataFi || candidate.dataFi.slice(0,10)<=end) &&
      names.some(t=>titleTokens(candidate.title).includes(t)));
    if (new Set(children.map(e=>e.data.slice(0,10))).size>=2) dedupEvents.splice(i,1);
  }
  const reminders = Array.isArray(input.recordatoris) ? input.recordatoris : [];
  const recordatoris = reminders.filter(r => r && typeof r === 'object' && typeof (r.text || r.titol) === 'string')
    .map(r => ({text: String(r.text || r.titol).trim(),data: normalizedDate(r.data, 'l’avís futur'), tipus:'informatiu'}))
    .filter(r => r.text);
  // Tasques explicitades com a recordatoris: no perdre obligacions de la família.
  // La tasca derivada exigeix evidència literal al missatge.
  const existingTaskText=new Set(accions.map(a=>norm(a.accio)));
  function addGroundedTask(label,date,priority,kind) {
    const k=norm(label), due=(date||'').slice(0,10);
    if (existingTaskText.has(k)) return;
    if (accions.some(a=>{
      const ad=(a.dataFi||a.data||'').slice(0,10);
      if (!ad || !due || ad!==due) return false;
      if (kind==='pagament') return /\b(?:pagament|quota|matricula|carrec|domiciliacio|pagar|abonar)\b/.test(norm(a.accio));
      return titleTokens(a.accio).some(t=>k.includes(t));
    })) return;
    accions.push({accio:label,tipus:'tasca',data:date||null,dataFi:null,prioritat:priority,dataDubtosa:false,lloc:null,enllac:null});
    existingTaskText.add(k);
  }
  recordatoris.forEach(r=>{
    const n=norm(r.text), src=norm(source), due=r.data;
    if (/\b(?:cal portar|porteu|portar|heu de dur|cal dur)\b/.test(n) &&
        /\b(?:cal portar|porteu|portar|heu de dur|cal dur)\b/.test(src) &&
        titleTokens(r.text).some(t=>src.includes(t))) addGroundedTask(r.text,due,'mitja','material');
    const amount=/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)/.exec(n);
    const supportedPayment = due && amount &&
      sentencesOf(source).some(sen=>{
        const text=norm(sen);
        return text.includes(amount[1]) &&
          /\b(?:comproveu|comprovar|reviseu|revisar|verifiqueu|verificar|heu de pagar|cal pagar|pagueu|aboneu)\b/.test(text) &&
          (explicitDayMonthInSource(sen,due) || text.includes(due));
      });
    if (supportedPayment && !/\b(?:domiciliacio|domiciliat|domiciliada|carrec automatic|es carregara|es cobrara)\b/.test(src) &&
        /\b(?:quota|pagament|cobrament|domiciliacio|matricula|carregara)\b/.test(n)) {
      const dd=due.slice(8,10)+'/'+due.slice(5,7);
      const bank=/\b(?:domiciliacio|carrec|cobrara|cobrament|carregara)\b/.test(n);
      addGroundedTask((bank?'Comprovar el càrrec domiciliat de ':'Comprovar el pagament de ')+amount[1]+' € del '+dd,due,'mitja','pagament');
    }
    if (due && /\b(?:comandes|comanda)\b/.test(n) && /\b(?:samarreta|vestuari|equipacio)\b/.test(n) &&
        /\b(?:obligatori|obligatoria|heu de|cal comprar|han de)\b/.test(src) &&
        /\b(?:samarreta|vestuari|equipacio)\b/.test(src)) {
      addGroundedTask('Fer la comanda de la samarreta obligatòria abans del '+due.slice(8,10)+'/'+due.slice(5,7),due,'alta','comanda');
    }
  });
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
    // Una referència «dimarts 8» pot descriure un recordatori, no l'esdeveniment «dimarts 22».
    // Comptar TOTES les dates estructurades evita reassignar un altre acte que ja té data pròpia.
    const all = [...dedupEvents, ...accions, ...recordatoris];
    const coincideix = all.some(x => [x.data, x.dataFi].some(v => v && +v.slice(8, 10) === r.day && weekdayForISO(v.slice(0, 10)) === r.weekday));
    if (coincideix) return;
    const cand = resolveWeekdayNumber(r.weekday, r.day, today, 3);
    if (!cand) return;
    const misplaced = dedupEvents.filter(e => e.data &&
      weekdayForISO(e.data.slice(0, 10)) === r.weekday &&
      +e.data.slice(8, 10) !== r.day &&
      // Mai sobrescriure un dia/mes explícits amb una altra referència del mateix missatge.
      !explicitDayMonthInSource(source, e.data.slice(0, 10)));
    if (misplaced.length === 1) {
      const e = misplaced[0];
      e.dataOriginal = e.data; e.data = cand + e.data.slice(10); e.dataDubtosa = true;
      warnings.push('Hem interpretat «' + r.text + '» com el ' + fmtDM(cand) + '. Confirma-ho, i revisa també els altres dies de la setmana esmentats al missatge.');
      suspiciousDates.push(r.text);
    }
    // Una menció de dia vàlida però no vinculada a l'acte no genera avís fals.

  });
  // (C) «abans de dijous» sense número, amb un acte posterior de data explícita: és el dijous de la setmana de l'acte.
  const bareDeadline = new Set();
  const nsource = norm(source);
  const bareRe = new RegExp('\\b(?:abans (?:de|del|d\\W)\\s*|fins (?:a|al|el|a el)\\s+|antes del\\s+|hasta el\\s+)' + WEEKDAYS_CA_RE + '\\b(?!\\s*\\d)', 'g');
  let bm; while ((bm = bareRe.exec(nsource)) !== null) bareDeadline.add(bm[1]);
  const anchor = dedupEvents.filter(e => e.data && !e.estat && e.data.slice(0, 10) >= today && explicitDayMonthInSource(source, e.data.slice(0, 10)))
    .map(e => e.data.slice(0, 10)).sort()[0];
  if (bareDeadline.size===1) {
    const tasks=accions.filter(a=>a.tipus==='tasca');
    const weekday=[...bareDeadline][0];
    if (tasks.length===1 && !tasks[0].data && !tasks[0].dataFi &&
        /\b(?:abans|fins|antes|hasta)\b/.test(norm(tasks[0].accio)+' '+nsource)) {
      const base=anchor||today;
      let target=null;
      for (let k=1;k<=7;k++){
        const day=isoAddDays(base,anchor?-k:k);
        if (norm(weekdayForISO(day))===weekday){target=day;break;}
      }
      if (target){
        tasks[0].dataFi=target;tasks[0].dataDubtosa=true;
        warnings.push('«Abans de '+weekday+'» s’ha interpretat provisionalment com '+fmtDM(target)+'. Confirma el termini.');
        suspiciousDates.push(tasks[0].accio);
      }
    }
  }
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
  // D9: un complement opcional no ha d'abaixar la prioritat de l'obligació.
  for (const action of [...accions]) {
    if (action.tipus!=='tasca') continue;
    const pieces=action.accio.split(/\s*;\s*(?=si\s|opcional)|\s+i,?\s*(?=si\s+(?:voleu|cal|es\s+vol))/i);
    if (pieces.length!==2) continue;
    const required=pieces[0].trim(),extra=pieces[1].trim();
    if (!/\b(?:obligatori|obligatoria|signad|heu de|cal |autoritzacio|lliur|entreg)/.test(norm(required)) ||
        !OPTIONAL_RE.test(norm(extra))) continue;
    const evidence=titleTokens(extra).filter(t=>norm(source).includes(t));
    if (evidence.length<1) continue;
    action.accio=required;
    enforcePriority(action,source);
    accions.push({...action,accio:extra,prioritat:'baixa',prioritatCorregida:true});
  }
  // R10: separar la confirmació/lliurament exigits d'una opció en una altra clàusula.
  for(const action of [...accions]){
    if(action.tipus!=='tasca')continue;
    const parts=action.accio.split(/\s*(?:;|\bi\b)\s*(?=(?:opcionalment|si en teniu|si voleu|si cal)\b)/i);
    if(parts.length!==2)continue;
    const main=norm(parts[0]),other=norm(parts[1]);
    if(!/\b(?:confirmar|confirmeu|respondre|avisar|lliurar|entregar|autoritzacio|pagament|pagar|portar)\b/.test(main) ||
      !OPTIONAL_RE.test(other) || !titleTokens(parts[1]).some(t=>nsrc.includes(t)))continue;
    action.accio=parts[0].trim();
    enforcePriority(action,source);
    accions.push({...action,accio:parts[1].trim(),prioritat:'baixa',prioritatCorregida:true});
  }
  // R9: descomptes condicionals són ALTERNATIUS i no dos pagaments exigibles.
  const conditionalDiscount=/\b(?:descompte|descuento|discount)\b/.test(nsrc) &&
    /\b(?:si es paga|si pagueu|si pagas|si se paga|en cas de pagar)\b/.test(nsrc) &&
    [...nsrc.matchAll(/\d{1,2}\s*%/g)].length>=2;
  if(conditionalDiscount){
    const options=accions.filter(a=>a.tipus==='tasca' &&
      /\b(?:descompte|descuento|discount)\b/.test(norm(a.accio)) &&
      /\b(?:pagar|pagament|abonar|abona)\b/.test(norm(a.accio)));
    const rates=[...new Set(options.flatMap(a=>[...a.accio.matchAll(/\d{1,2}\s*%/g)].map(x=>x[0])))];
    if(options.length>=2 && rates.length>=2){
      const texts=options.map(a=>{
        const percent=/\d{1,2}\s*%/.exec(a.accio);
        const date=(a.dataFi||a.data||'').slice(0,10);
        return percent ? percent[0]+(date?' fins al '+fmtDM(date):''):null;
      }).filter(Boolean);
      const idx=accions.indexOf(options[0]);
      const dates=options.map(a=>(a.dataFi||a.data||'').slice(0,10)).filter(Boolean).sort();
      for(const a of options)accions.splice(accions.indexOf(a),1);
      accions.splice(Math.min(idx,accions.length),0,{
        accio:'Opcional: escollir UNA modalitat de pagament anticipat amb descompte: '+
          texts.join(' o ')+'. No són pagaments acumulatius.',
        tipus:'tasca',prioritat:'baixa',data:null,dataFi:dates[0]||null,
        dataDubtosa:false,lloc:null,enllac:null
      });
    }
  }
  // R9: cap compte bancari amb mod-97 invàlid no pot aparèixer com a ordre utilitzable.
  const useful=extractUseful(source,input.dadesUtils,{fromImage});
  const invalidAccounts=useful.ibanInvalids||[];
  function scrubInvalidIban(value){
    if(typeof value!=='string')return value;
    for(const bad of invalidAccounts){
      const expression=bad.replace(/[\s-]/g,'').split('').join('[\\s-]*');
      value=value.replace(new RegExp(expression,'gi'),'[IBAN invàlid: no utilitzar]');
    }
    return value;
  }
  const invalidTransfer=invalidAccounts.length>0 &&
    /\b(?:transferencia|transferir|transfer|iban|numero de compte|cuenta bancaria)\b/.test(nsrc);
  if(invalidTransfer){
    for(const a of accions){
      const payment=/\b(?:pag(?:ar|ament|ueu|o)|abonar|transfer(?:encia|ir)|ingressar)\b/.test(norm(a.accio));
      a.accio=scrubInvalidIban(a.accio);
      if(payment){
        a.accio='NO facis la transferència fins que l’emissor confirmi un IBAN vàlid. '+a.accio;
        a.pagamentBloquejat=true;
        a.prioritat='alta';
        a.dataDubtosa=true;
      }
    }
    warnings.push('Compte bancari no vàlid: no facis cap transferència fins a confirmar les dades amb l’emissor.');
    suspiciousDates.push('confirmació de l’IBAN abans del pagament');
  } else accions.forEach(a=>{a.accio=scrubInvalidIban(a.accio)});
  recordatoris.forEach(r=>{r.text=scrubInvalidIban(r.text)});
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
  let rawDecision = typeof input.decisio === 'string' ? input.decisio.trim() : '';
  if (!pendingActions.length &&
      /\b(?:domiciliacio|domiciliat|domiciliada|carrec automatic|es carregara|es cobrara|es fa per domiciliacio)\b/.test(nsrc) &&
      /\b(?:revisar|comprovar|verificar|controlar)\b.{0,60}\b(?:carrec|pagament|quota|domiciliacio)\b/.test(norm(rawDecision)) &&
      !sentencesOf(source).some(sen=>/\b(?:cal|heu de|comproveu|reviseu|verifiqueu)\b.{0,55}\b(?:carrec|pagament|quota|domiciliacio)\b/.test(norm(sen)))) {
    rawDecision='El càrrec és domiciliat; el missatge no demana cap pagament manual.';
  }
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
    resum: scrubInvalidIban(humanizeIsoDates(input.resum, refYear)),
    decisio: invalidTransfer
      ? 'IMPORTANT: l’IBAN indicat és invàlid. No paguis fins a verificar-lo amb l’emissor. '+
        scrubInvalidIban(humanizeIsoDates(resolvedDecision,refYear))
      : scrubInvalidIban(humanizeIsoDates(resolvedDecision, refYear)),
    mainEvent: dedupEvents[0] || null,
    esdeveniments: dedupEvents.map(({origen,...e}) => e),
    accions, recordatoris,
    dadesUtils: useful,
    avisDates: unique(warnings).join(' ') || null,
    revisioDates: { requereixRevisio: suspiciousDates.length > 0 ||
      dedupEvents.some(e => e.passada) || accions.some(a => a.passada),
      camps: unique(suspiciousDates.concat(
        dedupEvents.filter(e => e.passada).map(e => e.title),
        accions.filter(a => a.passada).map(a => a.accio))) }
  };
}
module.exports = { humanizeIsoDates, ZONE, madridToday, validIsoDate, weekdayForISO, extractSourceWeekdays, dateConflict, extractUseful, ibanValid, normalizeAnalysis };
