const timeZone = 'Europe/Madrid';
const weekdays = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];
const months = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
const dayPattern = weekdays.join('|');
const monthPattern = months.join('|');

function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(now);
}

function isoDay(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  const expected = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  return value === expected ? value : null;
}

function shiftDay(day, offset) {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function weekday(day) {
  return weekdays[new Date(day).getUTCDay()];
}

function messageDate(source, today) {
  const stamps = [...source.matchAll(/^\s*\[(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?=\s|,|\])/gm)];
  const days = [...new Set(stamps.map(([, day, month, year]) =>
    isoDay(year.length === 2 ? 2000 + Number(year) : Number(year), Number(month), Number(day))
  ).filter(Boolean))];
  if (days.length > 1 || (!days.length && /\b(?:missatge reenviat|forwarded message|mensaje reenviado)\b/i.test(source))) return null;
  return days[0] || today;
}

function resolveDate(phrase, anchor, proposedDay) {
  const text = phrase.toLocaleLowerCase('ca').normalize('NFC');
  const namedDays = [...text.matchAll(new RegExp('\\b(' + dayPattern + ')\\b', 'g'))];
  const dayName = namedDays[0]?.[1];
  const written = text.match(new RegExp('\\b(\\d{1,2})\\s+d[e’\']\\s*(' + monthPattern + ')(?:\\s+d[e’\']\\s*(\\d{4}))?\\b'));
  const numeric = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/);
  const relative = text.match(/(?:^|[^\p{L}])(abans-d['’]ahir|demà passat|avui|ahir|demà)(?!\p{L})/u)?.[1];

  // Contextual references such as "diumenge 13 ... dimarts és l'estrena"
  // contain more than one weekday. Avoid treating the first as the target.
  if (namedDays.length > 1) return anchor ? {} : { conflict: true };
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = isoDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return !date || (dayName && weekday(date) !== dayName) ? { conflict: true } : { date };
  }

  if (written || numeric) {
    const match = written || numeric;
    const month = written ? months.indexOf(match[2]) + 1 : Number(match[2]);
    const [anchorYear] = (anchor || proposedDay).split('-').map(Number);
    const explicitYear = match[3] && (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]));
    const day = Number(match[1]);
    let date = isoDay(explicitYear || anchorYear, month, day);
    if (!explicitYear && anchor && date && date < anchor && !/\b(?:ahir|passat|passada|vençut|acabar|vèncer)\b/.test(text)) {
      date = isoDay(anchorYear + 1, month, day);
    }
    if (!date || (dayName && weekday(date) !== dayName)) return { conflict: true };
    return { date };
  }

  if (relative) {
    if (!anchor) return { conflict: true };
    const offsets = { 'abans-d\'ahir': -2, 'abans-d’ahir': -2, 'ahir': -1, 'avui': 0, 'demà': 1, 'demà passat': 2 };
    const date = shiftDay(anchor, offsets[relative]);
    return dayName && weekday(date) !== dayName ? { conflict: true } : { date };
  }

  if (!dayName) return {};
  if (!anchor) return { conflict: true };
  const numbered = text.match(new RegExp('\\b' + dayName + '\\s+(\\d{1,2})(?![\\d:/])'));
  if (numbered) {
    const wanted = Number(numbered[1]);
    // A missing month can be inferred from a unique match in the coming weeks.
    const date = Array.from({ length: 35 }, (_, index) => shiftDay(anchor, index))
      .find(candidate => Number(candidate.slice(8)) === wanted && weekday(candidate) === dayName);
    return date ? { date } : { conflict: true };
  }

  const dayIndex = weekdays.indexOf(dayName);
  const anchorIndex = weekdays.indexOf(weekday(anchor));
  const followingWeek = /setmana vinent/.test(text);
  const next = /que ve|vinent|proper|pròxim/.test(text);
  const delta = followingWeek
    ? (7 - (anchorIndex + 6) % 7) + (dayIndex + 6) % 7
    : (dayIndex - anchorIndex + 7) % 7 || (next ? 7 : 0);
  return { date: shiftDay(anchor, delta) };
}

function validateAnalysis(result, source, today, now = new Date()) {
  const anchor = messageDate(source, today);
  const warnings = new Set();
  if (typeof result.avisDates === 'string' && result.avisDates.trim()) warnings.add(result.avisDates.trim());
  const madridClock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const normalizedSource = source.normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase('ca');
  const items = [result.mainEvent, ...(Array.isArray(result.esdeveniments) ? result.esdeveniments : []), ...result.accions];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.tipus === 'informatiu' || item.opcional === true) item.prioritat = 'baixa';
    const label = item.title || item.accio || 'Data';
    for (const [field, evidence] of [['data', 'fontData'], ['dataFi', 'fontDataFi']]) {
      if (!item[field]) continue;
      const date = typeof item[field] === 'string' && item[field].match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]([01]\d|2[0-3]):([0-5]\d))?$/);
      const phrase = typeof item[evidence] === 'string' ? item[evidence].trim().replace(/\s+/g, ' ').normalize('NFC') : '';
      const day = date && isoDay(Number(date[1]), Number(date[2]), Number(date[3]));
      const resolution = day && phrase ? resolveDate(phrase, anchor, day) : {};
      const ungrounded = source && (!phrase || !normalizedSource.includes(phrase.toLocaleLowerCase('ca')));
      if (!day || ungrounded || resolution.conflict || (resolution.date && day !== resolution.date)) {
        warnings.add(label + ' · Confirma la data' + (phrase && !ungrounded ? ' («' + phrase + '»).' : '.'));
        item[field] = null;
      } else {
        item[field] = day + (date[4] ? ' ' + date[4] + ':' + date[5] : '');
      }
      delete item[evidence];
    }
    if (item.dataFi && (!item.data || item.dataFi < item.data)) item.dataFi = null;
    if (item.termini === true && item.data && (item.data.slice(0, 10) < today || (item.data.startsWith(today + ' ') && item.data.slice(11) < madridClock))) {
      item.vencut = true;
    }
  }

  result.avisDates = [...warnings].join(' ');
  return result;
}

module.exports = { localDate, messageDate, validateAnalysis, weekday };
