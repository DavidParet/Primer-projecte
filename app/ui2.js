/* NexLupa UI 2.1 — sistema gràfic del vídeo V9f aplicat a l'app real.
 * Principis:
 *  - NO toca script.js, el motor QA96, les dades ni les integracions. Només llegeix el DOM i
 *    variables globals en mode lectura (_historial, _allTasques) per decorar el que ja existeix.
 *  - Reversible: s'activa només si <body class="ui2">; «?ui2=off» o NexLupaUI2.disable() la retiren del tot.
 *  - Si aquest fitxer falla, l'app continua funcionant amb el seu indicador d'anàlisi original. */
(function () {
  'use strict';
  var doc = document, body = doc.body;
  if (!body || !body.classList.contains('ui2')) return;
  if (/[?&]ui2=off\b/.test(location.search)) { body.classList.remove('ui2'); return; }
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var observers = [];

  /* ---------------- pictogrames del vídeo (traç 48×48, punta arrodonida) ---------------- */
  var P = {
    lupa: '<circle cx="27" cy="27" r="17"/><path d="M40 40L57 57" stroke-width="5.7"/>',
    sign: '<path d="M12 6h18l8 8v28H12z" stroke-linejoin="round"/><path d="M30 6v8h8"/><path d="M18 30l5 5 9-11" stroke-linecap="round" stroke-linejoin="round"/>',
    doc: '<path d="M10 4h20l10 10v30H10z" stroke-linejoin="round"/><path d="M30 4v10h10M17 27h16M17 34h16M17 20h8" stroke-linecap="round" stroke-linejoin="round"/>',
    pay: '<rect x="5" y="12" width="38" height="26" rx="5"/><path d="M5 20h38M12 31h9" stroke-linecap="round"/>',
    alert: '<path d="M24 6L44 40H4z" stroke-linejoin="round"/><path d="M24 18v10M24 33.5v.5" stroke-linecap="round"/>',
    bag: '<path d="M14 18a10 10 0 0 1 20 0v22a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" stroke-linejoin="round"/><path d="M20 9V6h8v3M18 31h12" stroke-linecap="round"/>',
    clock: '<circle cx="24" cy="24" r="18"/><path d="M24 13v12l8 5" stroke-linecap="round" stroke-linejoin="round"/>',
    school: '<path d="M4 18L24 8l20 10-20 10z" stroke-linejoin="round"/><path d="M12 24v10c6 6 18 6 24 0V24"/>',
    cal: '<rect x="6" y="9" width="36" height="33" rx="6"/><path d="M6 20h36M16 5v8M32 5v8" stroke-linecap="round"/>',
    calchk: '<rect x="6" y="9" width="36" height="33" rx="6"/><path d="M6 20h36M16 5v8M32 5v8M16 31l6 6 10-11" stroke-linecap="round" stroke-linejoin="round"/>',
    pin: '<path d="M24 45C14 31 10 25 10 18a14 14 0 0 1 28 0c0 7-4 13-14 27z" stroke-linejoin="round"/><circle cx="24" cy="18" r="5"/>',
    mail: '<rect x="4" y="10" width="40" height="28" rx="5"/><path d="M6 13l18 14 18-14" stroke-linejoin="round"/>',
    cam: '<rect x="4" y="14" width="40" height="28" rx="6"/><path d="M16 14l3-6h10l3 6"/><circle cx="24" cy="28" r="8"/>',
    bell: '<path d="M12 33V21a12 12 0 0 1 24 0v12l4 4H8z" stroke-linejoin="round"/><path d="M20 42a4 4 0 0 0 8 0" stroke-linecap="round"/>',
    ticket: '<path d="M5 14h38v7a3 3 0 0 0 0 6v7H5v-7a3 3 0 0 0 0-6z" stroke-linejoin="round"/><path d="M30 14v20" stroke-dasharray="3 3"/>',
    music: '<path d="M18 36V10l20-5v26" stroke-linejoin="round"/><circle cx="12" cy="36" r="6"/><circle cx="32" cy="31" r="6"/>',
    spark: '<path d="M24 4l5 14 14 6-14 6-5 14-5-14-14-6 14-6z" stroke-linejoin="round"/>',
    check: '<path d="M10 25l9 9 19-21" stroke-linecap="round" stroke-linejoin="round"/>',
    info: '<circle cx="24" cy="24" r="18"/><path d="M24 21v12M24 14.5v.5" stroke-linecap="round"/>',
    home: '<path d="M6 22L24 7l18 15v19a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" stroke-linejoin="round"/><path d="M19 44V30h10v14" stroke-linejoin="round"/>',
    tasks: '<path d="M12 6h18l8 8v28H12z" stroke-linejoin="round"/><path d="M30 6v8h8"/><path d="M18 30l5 5 9-11" stroke-linecap="round" stroke-linejoin="round"/>',
    history: '<path d="M8 24a16 16 0 1 0 5-11.6" stroke-linecap="round"/><path d="M7 6v8h8" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 15v10l7 4" stroke-linecap="round" stroke-linejoin="round"/>',
    gear: '<circle cx="24" cy="24" r="7"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M9.9 9.9l5 5M33.1 33.1l5 5M9.9 38.1l5-5M33.1 14.9l5-5" stroke-linecap="round"/>',
    star: '<path d="M24 5l5.9 12 13.1 1.9-9.5 9.3 2.2 13.1L24 35.1l-11.7 6.2 2.2-13.1L5 18.9 18.1 17z" stroke-linejoin="round"/>',
    user: '<circle cx="24" cy="17" r="8"/><path d="M8 42c2-8 8-12 16-12s14 4 16 12" stroke-linecap="round"/>',
    palette: '<path d="M24 6a18 18 0 1 0 0 36c3 0 4-2 3-4s0-5 3-5h5a7 7 0 0 0 7-7C42 14 34 6 24 6z" stroke-linejoin="round"/><circle cx="15" cy="22" r="2"/><circle cx="21" cy="14" r="2"/><circle cx="31" cy="15" r="2"/>',
    trash: '<path d="M8 12h32M18 12V7h12v5M12 12l2 30h20l2-30" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v15M28 20v15" stroke-linecap="round"/>',
    pen: '<path d="M30 8l10 10-22 22H8V30z" stroke-linejoin="round"/><path d="M26 12l10 10"/>',
    share: '<circle cx="36" cy="10" r="5"/><circle cx="12" cy="24" r="5"/><circle cx="36" cy="38" r="5"/><path d="M16.5 21.5l15-8.5M16.5 26.5l15 8.5"/>',
    copy: '<rect x="16" y="16" width="26" height="26" rx="5"/><path d="M32 16V9a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v20a3 3 0 0 0 3 3h7" stroke-linecap="round"/>',
    users: '<circle cx="17" cy="17" r="6"/><circle cx="33" cy="19" r="5"/><path d="M5 40c1-7 6-11 12-11s11 4 12 11M29 30c6 0 11 3 13 10" stroke-linecap="round"/>',
    free: '<rect x="6" y="12" width="36" height="24" rx="8"/><path d="M15 20v9M15 20h5M15 24h4M25 29v-9h4a2.5 2.5 0 0 1 0 5h-4M29 25l3 4" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  function ico(name, size, sw) {
    var vb = name === 'lupa' ? '0 0 64 64' : '0 0 48 48';
    return '<svg class="ui2-svg" width="' + size + '" height="' + size + '" viewBox="' + vb + '" fill="none" stroke="currentColor" stroke-width="' + (sw || 3.2) + '" aria-hidden="true" focusable="false">' + (P[name] || P.check) + '</svg>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function injected(tag, cls, html) { var e = el(tag, cls, html); e.classList.add('ui2-injected'); return e; }
  /* guarda l'HTML original abans de modificar-lo, per poder-lo restaurar */
  function keep(e) { if (!e.hasAttribute('data-ui2-html')) e.setAttribute('data-ui2-html', encodeURIComponent(e.innerHTML)); }

  /* pictograma segons el contingut real del text (només visual, no reclassifica res) */
  var RULES = [
    [/autoritzaci|signa[dr]|firma|formulari|full d.inscripci|inscripci|matr[ií]cula|document|certificat/i, 'sign'],
    [/pag(a|ar|ament)|€|euros?\b|import|quota|rebut|transfer[eè]ncia|bizum/i, 'pay'],
    [/al·l[eè]rg|alergi|intoleranc|medicaci|avisar|aviseu|confirma|urgent/i, 'alert'],
    [/esmorzar|dinar|berenar|aigua|roba|motxilla|bata|xandall|portar|dur |material|preparar|equipatge|samarreta/i, 'bag'],
    [/correu|e-?mail|gmail/i, 'mail'],
    [/entrada|ticket|bitllet|reserva/i, 'ticket'],
    [/concert|m[uú]sica|festa|revetlla|actuaci/i, 'music'],
    [/classes?\b|curs escolar|tutor|graduaci|lectiu|vacances|festiu/i, 'school'],
    [/\b\d{1,2}[:.]\d{2}\b|\bh\b|hora|autocar|puntual|sortida/i, 'clock'],
    [/escola|institut/i, 'school'],
    [/reuni|tutoria|entrevista/i, 'users']
  ];
  /* «Termini» només per a dates límit reals (inscriure's, pagar, confirmar, signar, retornar… abans d'una data).
     Preparar o portar material per a l'activitat és una tasca, no un termini. */
  var DEADLINE = /avisa|comunica|notifica|inscri|matr[ií]cul|pag(a|ar|ament)|abona|ingr[eé]s|transfer|bizum|confirm|signa|firma|autoritz|retorn|entreg|lliura|presenta|envia|sol·licit|sollicit|reserva|apunta|respon|abans d|fins a?l? |termini|l[ií]mit|com a m[àa]xim|data m[àa]xima/i;
  var PREP = /^(?:portar|dur|preparar|endur|agafar|vestir|posar|recordar portar|cal portar|cal dur)\b/i;
  function isDeadline(text) { var t = String(text || '').trim(); return DEADLINE.test(t) && !(PREP.test(t) && !/abans d|fins a?l? |termini|l[ií]mit/i.test(t)); }
  function pick(text, fallback) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(text)) return RULES[i][1];
    return fallback;
  }

  /* ---------------- dates (només format visual de dades que ja dona el motor) ---------------- */
  var MSHORT = ['gen', 'feb', 'març', 'abr', 'maig', 'juny', 'jul', 'ago', 'set', 'oct', 'nov', 'des'];
  var MLONG = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
  var DAYS = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
  function parseShown(text) {   /* «Divendres 18 de des», «Dijous 10 des · 13:00» */
    var m = /(\d{1,2})\s+(?:de\s+|d')?(gen|feb|març|abr|maig|juny|jul|ago|set|oct|nov|des)\w*/i.exec(text || '');
    if (!m) return null;
    var t = /(\d{1,2}):(\d{2})/.exec(text || '');
    return { day: +m[1], mon: m[2].toLowerCase(), time: t ? (+t[1]) + ':' + t[2] + ' h' : null };
  }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' de ' + MLONG[d.getMonth()];
  }
  function monKey(mon) { var i = MSHORT.indexOf(mon); return i < 0 ? 99 : i; }

  /* ---------------- resultats ---------------- */
  var LABELS = { 'nx-p1-block': 'P1 · Imprescindible', 'nx-p2-block': 'P2 · Preparació', 'nx-info-block': 'P3 · Informació' };
  function decorateLabels() {
    Object.keys(LABELS).forEach(function (id) {
      var lab = doc.querySelector('#' + id + ' > .nx-section-label'); if (!lab || lab.hasAttribute('data-ui2-html')) return;
      keep(lab); lab.innerHTML = '<span>' + LABELS[id] + '</span>';
    });
    var ev = doc.querySelector('#nx-event-block > .nx-section-label');
    if (ev && !ev.hasAttribute('data-ui2-html')) { keep(ev); ev.classList.add('ui2-head', 'ui2-sec'); ev.innerHTML = '<span class="ui2-head-ico">' + ico('cal', 22, 3.4) + '</span><span>Calendari</span>'; }
    var lab2 = doc.getElementById('nx-decisio-label');
    if (lab2 && !lab2.hasAttribute('data-ui2-html')) { keep(lab2); lab2.classList.add('ui2-head'); lab2.innerHTML = '<span class="ui2-head-ico">' + ico('spark', 20, 3.4) + '</span><span>Resum</span>'; }
  }

  function decorateCard(c) {
    if (c.getAttribute('data-ui2') === '1') return;
    var iconEl = c.querySelector('.nx-card-icon'); if (!iconEl) return;
    c.setAttribute('data-ui2', '1');
    var t = (c.querySelector('.nx-card-text') || c).textContent || '';
    var info = (iconEl.textContent || '').indexOf('ℹ') >= 0;
    c.setAttribute('data-ui2-kind', info ? 'info' : 'task');
    keep(iconEl); iconEl.classList.add('ui2-ico');
    var icName = pick(t, info ? 'info' : 'check'); iconEl.setAttribute('data-ui2-icon', icName);
    iconEl.innerHTML = ico(icName, 18, 3.4);
    var dates = c.querySelectorAll('.nx-card-date');
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i], txt = d.textContent || '';
      if (/vençut|confirma|per confirmar|passada|ja ha passat|possibles|no coincideix/i.test(txt)) { d.classList.add('ui2-warn'); continue; }
      var p = parseShown(txt); if (!p) continue;
      keep(d);
      var pre = (!info && i === 0 && !/^Fins/.test(txt) && isDeadline(t)) ? '<span class="ui2-term">Termini:</span> ' : '';
      d.innerHTML = '<span class="ui2-date-ico">' + ico('cal', 15, 3.6) + '</span><span>' + pre + esc(txt) + '</span>';
      d.classList.add('ui2-date');
    }
    var btn = c.querySelector('.nx-btn-cal');
    if (btn && !btn.hasAttribute('data-ui2-html')) {
      keep(btn); btn.innerHTML = ico('calchk', 15, 3.6) + '<span>Afegir</span>';
      if (!btn.hasAttribute('aria-label')) { btn.setAttribute('aria-label', 'Afegir al calendari'); btn.setAttribute('data-ui2-aria', '1'); }
      btn.setAttribute('title', 'Afegir al calendari');
    }
  }

  function decorateEvent(card) {
    if (card.getAttribute('data-ui2') === '1') return;
    card.setAttribute('data-ui2', '1');
    var name = card.querySelector('.nx-event-name');
    var chips = [].slice.call(card.querySelectorAll('.nx-event-chip'));
    var dateChip = null, timeChip = null;
    chips.forEach(function (ch) {
      var tx = ch.textContent || '';
      if (!dateChip && /^📅/.test(tx)) dateChip = ch;
      else if (!timeChip && /^🕒/.test(tx)) timeChip = ch;
    });
    var p = dateChip ? parseShown(dateChip.textContent) : null;
    var time = timeChip ? (timeChip.textContent.replace(/[^\d:]/g, '').replace(/^0(\d)/, '$1') + ' h') : null;
    var row = injected('div', 'ui2-cal-row');
    var box = p ? '<div class="ui2-datebox"><b>' + p.day + '</b><span>' + esc(p.mon.toUpperCase()) + '</span></div>'
      : '<div class="ui2-datebox ui2-nodate"><span>DATA</span><span>?</span></div>';
    row.innerHTML = box + '<div class="ui2-cal-title">' + esc(name ? name.textContent : '') + '</div>' + (time ? '<div class="ui2-cal-time">' + esc(time) + '</div>' : '');
    card.insertBefore(row, card.firstChild);
    card.classList.add('ui2-event');
    if (dateChip) dateChip.classList.add('ui2-hide');
    if (timeChip) timeChip.classList.add('ui2-hide');
    if (name) name.classList.add('ui2-hide');
    /* fitxes de dades (com a l'anàlisi de fotos del vídeo) per a la resta de dades reals */
    chips.forEach(function (ch) {
      if (ch === dateChip || ch === timeChip || ch.hasAttribute('data-ui2-html')) return;
      var tx = ch.textContent || '', name2 = 'info', lab = 'Detall';
      if (/^📍/.test(tx)) { name2 = 'pin'; lab = 'Lloc'; }
      else if (/^⏳/.test(tx)) { name2 = 'clock'; lab = /Avui|Demà/.test(tx) ? '' : 'Falten'; }
      else if (/^👥/.test(tx)) { name2 = 'users'; lab = 'Edat'; }
      else if (/^Fins/.test(tx)) { name2 = 'cal'; lab = 'Fins'; }
      keep(ch); ch.classList.add('ui2-tile');
      var val = tx.replace(/^(📍|⏳|👥|📅|🕒)️?\s*/, '').replace(/^Fins:\s*/, '');
      ch.innerHTML = '<span class="ui2-tile-ico">' + ico(name2, 14, 3.6) + '</span><span class="ui2-tile-txt">' + (lab ? '<small>' + lab + '</small> ' : '') + esc(val) + '</span>';
    });
    var btns = card.querySelectorAll('.nx-event-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i]; if (b.hasAttribute('data-ui2-html')) continue; keep(b);
      var isMaps = b.classList.contains('nx-event-btn-maps');
      b.innerHTML = ico(isMaps ? 'pin' : 'calchk', 15, 3.6) + '<span>' + (isMaps ? 'Maps' : 'Afegir') + '</span>';
      if (!b.hasAttribute('aria-label')) { b.setAttribute('aria-label', isMaps ? 'Obrir a Google Maps' : 'Afegir al calendari'); b.setAttribute('data-ui2-aria', '1'); }
    }
  }

  /* Terminis: llista separada del calendari (no són cites). Només mostra el que ja hi ha a les targetes. */
  function buildTerminis() {
    var res = doc.getElementById('results'); if (!res) return;
    var old = doc.getElementById('ui2-terminis');
    var rows = [];
    var cards = res.querySelectorAll('.nx-p1-card, .nx-p2-card, .nx-info-card');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i]; if (c.getAttribute('data-ui2-kind') !== 'task') continue;
      if (!isDeadline((c.querySelector('.nx-card-text') || {}).textContent)) continue;
      var d = c.querySelector('.nx-card-date.ui2-date'); if (!d) continue;
      var p = parseShown(d.textContent); if (!p) continue;
      var pr = c.classList.contains('nx-p1-card') ? 'p1' : c.classList.contains('nx-p2-card') ? 'p2' : 'p3';
      rows.push({ p: p, pr: pr, t: (c.querySelector('.nx-card-text') || {}).textContent || '' });
    }
    rows.sort(function (a, b) { return (monKey(a.p.mon) - monKey(b.p.mon)) || (a.p.day - b.p.day); });
    var sig = rows.map(function (r) { return r.pr + r.p.day + r.p.mon + r.t; }).join('|');
    var evb0 = doc.getElementById('nx-event-block'), evOn = !!(evb0 && evb0.style.display !== 'none');
    sig += evOn ? '#ev' : '#noev';
    if (old && old.getAttribute('data-sig') === sig) return;          /* res ha canviat: no es toca el DOM (evita bucles) */
    if (old) old.parentNode.removeChild(old);
    if (!rows.length) return;
    var blk = injected('div', 'ui2-terminis'); blk.id = 'ui2-terminis'; blk.setAttribute('data-sig', sig);
    var html = '<div class="ui2-subhead">' + ico('calchk', 18, 3.4) + '<span>Terminis</span><small>dates límit, no són cites</small></div>';
    rows.forEach(function (r) {
      html += '<div class="ui2-cal-row ui2-termini ui2-' + r.pr + '"><div class="ui2-datebox"><b>' + r.p.day + '</b><span>' + esc(r.p.mon.toUpperCase()) +
        '</span></div><div class="ui2-cal-title"><small>Termini</small>' + esc(r.t) + '</div>' + (r.p.time ? '<div class="ui2-cal-time">' + esc(r.p.time) + '</div>' : '') + '</div>';
    });
    blk.innerHTML = html;
    var evb = doc.getElementById('nx-event-block');
    var anchor = doc.getElementById('nx-what-block') || doc.getElementById('nx-p1-block');
    if (evb && evb.style.display !== 'none') evb.appendChild(blk);
    else if (anchor && anchor.parentNode) {
      blk.insertAdjacentHTML('afterbegin', '<div class="nx-section-label ui2-head ui2-sec"><span class="ui2-head-ico">' + ico('cal', 22, 3.4) + '</span><span>Calendari</span></div>');
      anchor.parentNode.insertBefore(blk, anchor);
    }
  }

  function updateCounts() {
    var res = doc.getElementById('results'); if (!res) return;
    [['#nx-p1-block > .nx-section-label', '.nx-p1-card'], ['#nx-p2-block > .nx-section-label', '.nx-p2-card'],
     ['#nx-info-block > .nx-section-label', '#nx-info-content .nx-info-card, #nx-more-actions-content .nx-info-card']].forEach(function (m) {
      var label = doc.querySelector(m[0]); if (!label) return;
      var n = res.querySelectorAll(m[1]).length;
      if (n > 0) label.setAttribute('data-ui2-count', String(n)); else label.removeAttribute('data-ui2-count');
    });
    /* fitxes del Resum (com al vídeo): recompte de targetes reals per prioritat */
    var blk = doc.querySelector('.nx-decisio-block'); if (!blk) return;
    var c1 = res.querySelectorAll('.nx-p1-card').length, c2 = res.querySelectorAll('.nx-p2-card').length;
    var c3 = res.querySelectorAll('#nx-info-content .nx-info-card, #nx-more-actions-content .nx-info-card').length;
    var sig = c1 + '/' + c2 + '/' + c3, tiles = doc.getElementById('ui2-sumtiles');
    if (tiles && tiles.getAttribute('data-sig') === sig) return;
    if (tiles) tiles.parentNode.removeChild(tiles);
    if (!(c1 + c2 + c3)) return;
    tiles = injected('div', 'ui2-sumtiles'); tiles.id = 'ui2-sumtiles'; tiles.setAttribute('data-sig', sig);
    var h = '';
    [[c1, 'p1', 'P1', 'Imprescindible'], [c2, 'p2', 'P2', 'Preparació'], [c3, 'p3', 'P3', 'Informació']].forEach(function (x) {
      if (x[0]) h += '<div class="ui2-sumtile ui2-' + x[1] + '"><b>' + x[0] + '</b><span>' + x[2] + '</span><small>' + x[3] + '</small></div>';
    });
    tiles.innerHTML = h; blk.parentNode.insertBefore(tiles, blk.nextSibling);
  }

  var NOACT = /^(?:cap acci[oó] necess[aà]ria|no cal fer res|no has de fer res|no hi ha cap acci[oó] necess[aà]ria)\.?$/i;
  function informativeSummary() {      /* només presentació: usa el resum que ja ha donat el motor */
    var el2 = doc.getElementById('nx-decisio'), D = window._lastData;
    var rb = doc.getElementById('nx-resum-block');   /* el resum ja és a dalt: no es repeteix al peu */
    if (rb) rb.classList.toggle('ui2-hide', !!(el2 && el2.classList.contains('nx-no-action') && D && typeof D.resum === 'string' && D.resum.trim() && !NOACT.test(D.resum.trim())));
    if (!el2 || !el2.classList.contains('nx-no-action') || el2.classList.contains('ui2-informative')) return;
    var r = D && typeof D.resum === 'string' ? D.resum.trim() : '';
    if (!r || NOACT.test(r)) return;
    el2.removeAttribute('data-ui2-html'); keep(el2);
    el2.innerHTML = '<span class="ui2-sum-main">' + esc(r) + '</span><span class="ui2-sum-note">' + ico('check', 12, 4.5) + 'Cap acció obligatòria</span>';
    el2.classList.add('ui2-informative');
    var lab = doc.getElementById('nx-decisio-label'); if (lab && lab.style.display === 'none') { lab.style.display = ''; lab.setAttribute('data-ui2-shown', '1'); }
  }
  function dedupeFuture() {          /* «Pròximament» no repeteix un acte que ja surt al Calendari */
    var fb = doc.getElementById('nx-future-block'); if (!fb || fb.style.display === 'none') return;
    var evs = [].map.call(doc.querySelectorAll('#nx-event-content .nx-event-card'), function (c) {
      var t = (c.querySelector('.nx-event-name') || {}).textContent || '', dc = c.querySelector('.ui2-datebox b');
      return { words: words(t), day: dc ? dc.textContent : null };
    });
    var cards = fb.querySelectorAll('#nx-future-content .nx-info-card'), hidden = 0;
    [].forEach.call(cards, function (c) {
      var t = (c.querySelector('.nx-card-text') || c).textContent || '', d = (c.querySelector('.nx-card-date') || {}).textContent || '';
      var p = parseShown(d), w = words(t);
      var dup = evs.some(function (e) {
        var common = w.filter(function (x) { return e.words.indexOf(x) >= 0; }).length;
        return common >= 2 || (common >= 1 && p && e.day && +e.day === p.day);
      });
      if (dup) { c.classList.add('ui2-hide'); hidden++; } else c.classList.remove('ui2-hide');
    });
    fb.classList.toggle('ui2-hide', cards.length > 0 && hidden === cards.length);
  }
  function words(t) {
    return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)
      .filter(function (x) { return x.length >= 4 && !/^(?:amb|dels|les|per|que|una|aquest|aquesta|seran|sera)$/.test(x); });
  }
  function decorateDecision() {
    informativeSummary();
    var blk = doc.querySelector('.nx-decisio-block');
    if (!blk || blk.querySelector('.ui2-done-pill')) return;
    blk.insertBefore(injected('div', 'ui2-done-pill', ico('check', 14, 4.5) + '<span>Anàlisi completada</span>'), blk.firstChild);
  }

  function tasksHead() {
    var p1 = doc.getElementById('nx-p1-block'); if (!p1 || !p1.parentNode) return;
    var vis = ['nx-p1-block', 'nx-p2-block', 'nx-info-block', 'nx-more-actions-block'].some(function (id) {
      var e = doc.getElementById(id);
      return e && e.style.display !== 'none' && !!e.querySelector('.nx-p1-card, .nx-p2-card, .nx-info-card');
    });
    var h = doc.getElementById('ui2-tasks-head');
    if (!h) {
      h = injected('div', 'nx-section-label ui2-head ui2-sec'); h.id = 'ui2-tasks-head';
      h.innerHTML = '<span class="ui2-head-ico">' + ico('tasks', 22, 3.4) + '</span><span>Tasques</span>';
      p1.parentNode.insertBefore(h, p1);
    }
    if (h.classList.contains('ui2-hide') === vis) h.classList.toggle('ui2-hide', !vis);
  }

  var busy = false;
  function onResults() {
    if (busy) return; busy = true;
    try {
      var res = doc.getElementById('results'); if (!res) return;
      decorateDecision(); decorateLabels();
      var cards = res.querySelectorAll('.nx-p1-card, .nx-p2-card, .nx-info-card'); for (var i = 0; i < cards.length; i++) decorateCard(cards[i]);
      var evs = res.querySelectorAll('.nx-event-card'); for (var j = 0; j < evs.length; j++) decorateEvent(evs[j]);
      if (res.classList.contains('on')) buildTerminis();
      tasksHead();
      dedupeFuture();
      updateCounts();
      decorateStatic();
    } catch (e) { if (window.console) console.warn('UI2', e); } finally { busy = false; }
  }

  /* ---------------- pictogrames de la interfície fixa (sense emojis) ---------------- */
  var NAV = [['#navInici > span', 'home'], ['#navTasques > span', 'tasks'], ['#navHistorial > span', 'history'], ['#navConfig > span', 'gear']];
  var EMO = [['✉️', 'mail'], ['🆓', 'free'], ['⭐', 'star'], ['👤', 'user'], ['🎨', 'palette'], ['🗑️', 'trash'], ['🕐', 'history'], ['✅', 'tasks'],
    ['✏️', 'pen'], ['📷', 'cam'], ['💬', 'share'], ['📋', 'copy'], ['🔍', 'lupa'], ['📅', 'cal'], ['👥', 'users'], ['🔔', 'bell'], ['⚡', 'spark'], ['➕', 'calchk'], ['😊', 'user']];
  function swapLead(e, size) {     /* substitueix l'emoji inicial d'un botó/etiqueta pel pictograma */
    if (!e || e.hasAttribute('data-ui2-html')) return;
    var t = (e.textContent || '').trim();
    for (var i = 0; i < EMO.length; i++) {
      var k = EMO[i][0], k2 = k.replace(/️/g, '');
      var hit = t.indexOf(k) === 0 ? k : (t.indexOf(k2) === 0 ? k2 : null);
      if (!hit) continue;
      if (e.children.length > 1) return;   /* estructura complexa: no es toca */
      keep(e);
      var rest = t.slice(hit.length).replace(/^️/, '').trim();
      e.innerHTML = '<span class="ui2-lead">' + ico(EMO[i][1], size, EMO[i][1] === 'lupa' ? 5 : 3.4) + '</span>' + (rest ? '<span>' + esc(rest) + '</span>' : '');
      if (e.id === 'tabImg') e.innerHTML = e.innerHTML.replace(/\s*·\s*Premium/, ' <span class="ui2-tab-prem">Premium</span>');
      e.classList.add('ui2-swapped');
      return;
    }
  }
  function premiumMarks() {
    [].forEach.call(doc.querySelectorAll('#pagePremium strong.compare-no'), function (e) {
      if (e.hasAttribute('data-ui2-html') || !/✕\s*Free/.test(e.textContent)) return;
      keep(e); e.classList.add('ui2-notinc'); e.innerHTML = '<span class="ui2-xmark" aria-hidden="true">✕</span><span>No inclòs al Free</span>';
    });
    [].forEach.call(doc.querySelectorAll('#pagePremium .pchk-item.no'), function (e) {
      if (e.hasAttribute('data-ui2-html')) return;
      var sp = e.querySelector('span'); if (!sp) return;
      keep(e); e.classList.add('ui2-neutral'); e.innerHTML = '<span class="ui2-neutral-ico" aria-hidden="true">' + ico('info', 15, 3.4) + '</span><span>' + esc(sp.textContent) + '</span>';
    });
  }
  function brandName() {    /* al text del lema: «NexLupa» (el logotip gràfic neXlupa no es toca) */
    var b = doc.querySelector('.logo-tagline .lt-brand');
    if (b && !b.hasAttribute('data-ui2-html') && /nexlupa/i.test(b.textContent)) { keep(b); b.textContent = b.textContent.replace(/nexlupa/i, 'NexLupa'); }
  }
  function decorateStatic() {
    brandName();
    premiumMarks();
    NAV.forEach(function (s) {
      var e = doc.querySelector(s[0]); if (!e || e.hasAttribute('data-ui2-html')) return;
      keep(e); e.classList.add('ui2-nav-ico'); e.innerHTML = ico(s[1], 22, 3.2);
    });
    [].forEach.call(doc.querySelectorAll('.c-icon, .feat-icon-sm'), function (e) { swapLead(e, 22); });
    [].forEach.call(doc.querySelectorAll('.tab-btn, .nx-btn-wa, .nx-btn-copy, .btn-premium-header, .premium-badge, .cfg-danger-btn, .app-feat-item, .btn-buy-hero, #premiumPromoCard button, .conv-title strong'), function (e) { swapLead(e, 17); });
    var avatar = doc.querySelector('#pageConfig .card div[style*="border-radius:50%"]'); swapLead(avatar, 26);
    var motor = doc.querySelector('#pageConfig .card[style*="text-align:center"] > div'); swapLead(motor, 34);
  }

  /* ---------------- pantalla Tasques (vista UI 2.1 sobre les dades existents) ---------------- */
  function taskInfo(text) {   /* data i tipus de l'acció a l'historial (només lectura) */
    var H = window._historial; if (!Array.isArray(H)) return null;
    var key = String(text || '').trim().toLowerCase();
    for (var i = H.length - 1; i >= 0; i--) {
      var acc = (H[i] && H[i].accions) || [];
      for (var j = 0; j < acc.length; j++) {
        var a = acc[j], t = typeof a === 'string' ? a : (a && (a.accio || a.text || a.descripcio)) || '';
        if (String(t).trim().toLowerCase() === key) return typeof a === 'object' ? a : null;
      }
    }
    return null;
  }
  function buildTasksView() {
    var page = doc.getElementById('pageTasques'), list = doc.getElementById('tasquesList'); if (!page || !list) return;
    var old = doc.getElementById('ui2-tasks'); if (old) old.parentNode.removeChild(old);
    var T = Array.isArray(window._allTasques) ? window._allTasques : null;
    if (!T) { page.classList.remove('ui2-tv'); return; }
    var view = injected('div', 'ui2-tasks'); view.id = 'ui2-tasks';
    var pend = T.filter(function (t) { return !t.done; }), done = T.filter(function (t) { return t.done; });
    var html = '<h2 class="ui2-page-title"><span class="ui2-head-ico">' + ico('tasks', 22, 3.4) + '</span>Tasques i prioritats</h2>';
    if (!T.length) html += '<p class="ui2-empty">Encara no hi ha tasques pendents.</p>';
    [['alta', 'p1', 'P1 · Imprescindible'], ['mitja', 'p2', 'P2 · Preparació'], ['baixa', 'p3', 'P3 · Informació']].forEach(function (g) {
      var items = pend.filter(function (t) { return (t.prioritat || 'baixa') === g[0]; });
      if (!items.length) return;
      html += '<div class="nx-section-label ui2-chip-' + g[1] + '" data-ui2-count="' + items.length + '"><span>' + g[2] + '</span></div>';
      items.forEach(function (t) { html += taskCard(t, g[1]); });
    });
    if (done.length) {
      html += '<div class="ui2-subhead ui2-done-head">' + ico('check', 16, 4) + '<span>Completades</span><small>' + done.length + '</small></div>';
      done.forEach(function (t) { html += taskCard(t, 'done'); });
    }
    view.innerHTML = html;
    page.insertBefore(view, page.firstChild);
    page.classList.add('ui2-tv');
    [].forEach.call(view.querySelectorAll('.ui2-tchk'), function (b) {
      b.addEventListener('click', function () { proxyCheck(b.getAttribute('data-text')); });
    });
  }
  function taskCard(t, pr) {
    var a = taskInfo(t.text) || {}, info = a.tipus === 'informatiu';
    var alt = (a.dataAlternatives && typeof window.formatAlternatives === 'function') ? window.formatAlternatives(a.dataAlternatives) : null;
    var date = alt ? alt + ' · cal confirmar-ne una' : (a.data ? longDate(a.data) : null);
    var dateHtml = date ? '<div class="ui2-tdate">' + ico('cal', 15, 3.6) + '<span>' + (info || pr === 'done' || !isDeadline(t.text) ? '' : '<span class="ui2-term">Termini:</span> ') + esc(date) + '</span></div>' : '';
    if (a.vençut) dateHtml += '<div class="ui2-tdate ui2-warn">Termini vençut: cal comprovar si encara es pot gestionar</div>';
    var icName = pick(t.text, info ? 'info' : 'check');
    return '<div class="ui2-tcard ui2-' + pr + '"><span class="ui2-ico" data-ui2-icon="' + icName + '">' + ico(icName, 18, 3.4) + '</span>' +
      '<div class="ui2-tbody"><div class="ui2-ttitle">' + (t.isNew && !t.done ? '<span class="ui2-new" title="Nova" aria-label="Nova">Nou</span>' : '') + esc(t.text) + '</div>' + dateHtml + '</div>' +
      '<button type="button" class="ui2-tchk' + (t.done ? ' on' : '') + '" data-text="' + esc(t.text) + '" aria-pressed="' + (t.done ? 'true' : 'false') +
      '" aria-label="' + (t.done ? 'Marcar com a pendent' : 'Marcar com a feta') + '"><span class="ui2-tchk-dot">' + ico('check', 12, 5) + '</span></button></div>';
  }
  function proxyCheck(text) {     /* fa servir el control original: la lògica de desar és la de script.js */
    var items = doc.querySelectorAll('#tasquesList .tsk-item');
    for (var i = 0; i < items.length; i++) {
      var title = items[i].querySelector('.tsk-title'); if (!title) continue;
      var t = title.textContent.replace(/^NOU/, '').trim();
      if (t === text) { var chk = items[i].querySelector('.tsk-chk'); if (chk) chk.click(); return; }
    }
  }

  /* ---------------- il·luminació per pantalla ---------------- */
  var PAGES = { pageInici: 'inici', pageTasques: 'tasques', pageHistorial: 'historial', pageConfig: 'config', pagePremium: 'premium' };
  function updatePage() {
    var cur = 'inici';
    Object.keys(PAGES).forEach(function (id) { var p = doc.getElementById(id); if (p && p.style.display !== 'none' && id !== 'pageInici') cur = PAGES[id]; });
    if (body.getAttribute('data-ui2-page') !== cur) {
      body.setAttribute('data-ui2-page', cur);
      if (cur !== 'inici' && scan) abortScan();
    }
    if (cur === 'tasques') buildTasksView();
    syncHeader();
  }

  /* ---------------- transició d'anàlisi: lupa sola → X → esclat de la X → resum ---------------- */
  var scan = null, scanStart = 0, scanTimer = null, finishing = false;
  var MIN_SCAN = 500;                      /* només per evitar un parpelleig si l'API respon a l'instant */
  var XFX = (2026 - 1480 - 12) / 1070, XFY = 472 / 837;   /* centre del rombe daurat dins ui2-x.png (retall del logotip oficial) */
  var HL = /(\b(?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)(?:\s+\d{1,2}(?:\s+de\s+[a-zç]+)?)?\b|\babans\s+del?\s+(?:(?:dia|dilluns|dimarts|dimecres|dijous|divendres)\s+)?\d{1,2}(?:\s+de\s+[a-zç]+)?\b|\b\d{1,2}\s+de\s+(?:gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)\b|\b\d{1,2}[.:]\d{2}(?:\s*h\b)?|\b\d+(?:[.,]\d+)?\s*€|\bautoritzaci[oó](?:\s+signada)?\b|\bal·l[eè]rgi[a-z]*|\bpagament\b)/gi;
  function buildText() {
    var raw = (doc.getElementById('txt') || {}).value || '';
    if (!raw.trim()) raw = 'Analitzant la imatge…';
    raw = raw.trim().slice(0, 900);
    var out = '', last = 0, m, n = 0; HL.lastIndex = 0;
    while ((m = HL.exec(raw)) && n < 14) { out += esc(raw.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; n++; }
    return out + esc(raw.slice(last));
  }
  function navHeight() { var n = doc.querySelector('.bottom-nav'); return n ? Math.round(n.getBoundingClientRect().height) : 0; }

  function startScan() {
    if (scan) return;
    try {
      finishing = false;
      scan = el('div', 'ui2-scan ui2-scan24' + (REDUCED ? ' still' : '')); scan.setAttribute('role', 'status'); scan.setAttribute('aria-live', 'polite');
      scan.style.bottom = navHeight() + 'px';               /* la navegació continua accessible */
      scan.appendChild(el('div', 'ui2-scan-bg'));
      var wait = el('div', 'ui2-wait');
      var box = el('div', 'ui2-lupa-box');
      var lupa = el('img', 'ui2-lupa-still'); lupa.src = 'assets/ui2-lupa-sola.png'; lupa.alt = '';
      box.appendChild(lupa); box.appendChild(el('div', 'ui2-lens-glow'));
      box.appendChild(el('div', 'ui2-lens-orbit', '<i></i>'));   /* punt de llum que recorre el vidre: la lupa «pensa» */
      wait.appendChild(box); wait.appendChild(el('div', 'ui2-wait-txt', 'Llegint el teu missatge…'));
      scan.appendChild(wait);
      if (!REDUCED) {
        var xw = el('div', 'ui2-xwrap'); var xi = el('img', 'ui2-x'); xi.src = 'assets/ui2-x.png'; xi.alt = ''; xw.appendChild(xi); scan.appendChild(xw);
        scan.appendChild(el('div', 'ui2-bloom')); scan.appendChild(el('div', 'ui2-ring'));
        scan.addEventListener('click', function () { if (finishing) quickEnd(); });   /* tocar durant el final: salta l'animació */
      }
      body.appendChild(scan);
      body.classList.add('ui2-scanning');                    /* només ara s'amaga l'indicador original */
      scanStart = Date.now();
      requestAnimationFrame(function () { if (scan) scan.classList.add('on'); });
    } catch (e) { abortScan(); }
  }
  function finishScan(success) {
    if (!scan || finishing) return;
    finishing = true;
    var s0 = scan, wait = Math.max(0, MIN_SCAN - (Date.now() - scanStart));
    setTimeout(function () {
      try {
        var s = scan; if (!s || s !== s0) return;
        if (!success || REDUCED) { end(s, success && !REDUCED); return; }
        /* 1) la lupa i el text es dissolen */
        s.classList.add('fading');
        setTimeout(function () {
          if (scan !== s) return;
          /* 2) apareix la X; la llum convergeix al rombe i s'il·lumina */
          s.classList.add('xin');
          var xw = s.querySelector('.ui2-xwrap'), sr = s.getBoundingClientRect();
          setTimeout(function () {
            if (scan !== s) return;
            var xr = xw.getBoundingClientRect();
            var xc = xr.left - sr.left + xr.width * XFX, yc = xr.top - sr.top + xr.height * XFY, sparks = [];
            for (var k = 0; k < 9; k++) {
              var a = k / 9 * Math.PI * 2 + 0.3, rr = 90 + (k % 3) * 18;
              var sp = el('div', 'ui2-spark'); s.appendChild(sp);
              sp.style.transform = 'translate(' + (xc - 3 + Math.cos(a) * rr) + 'px,' + (yc - 3 + Math.sin(a) * rr) + 'px)'; sparks.push(sp);
            }
            requestAnimationFrame(function () {
              sparks.forEach(function (sp, k) {
                sp.style.transition = 'transform .42s cubic-bezier(.5,0,.75,0) ' + (k * 0.012) + 's, opacity .15s';
                sp.style.opacity = 1; sp.style.transform = 'translate(' + (xc - 3) + 'px,' + (yc - 3) + 'px) scale(.5)';
              });
            });
            s.classList.add('xglow');
            var bloom = s.querySelector('.ui2-bloom'), ring = s.querySelector('.ui2-ring');
            [bloom, ring].forEach(function (e) { e.style.left = xc + 'px'; e.style.top = yc + 'px'; });
            /* 3) esclat càlid de la mateixa X */
            setTimeout(function () {
              if (scan !== s) return;
              sparks.forEach(function (sp) { sp.remove(); });
              s.classList.add('xburst');
              /* 4) el resum entra amb la llum de l'esclat */
              setTimeout(function () { end(s, true); }, 260);
            }, 460);
          }, 240);
        }, 280);
      } catch (e) { abortScan(); }
    }, wait);
  }
  function quickEnd() { if (scan) end(scan, true); }
  function end(s, success) {
    var res = doc.getElementById('results');
    if (res && success) { res.classList.remove('ui2-emerge'); void res.offsetWidth; res.classList.add('ui2-emerge'); setTimeout(function () { res.classList.remove('ui2-emerge'); }, 1400); }
    s.classList.add('out');
    body.classList.remove('ui2-scanning');
    if (scan === s) { scan = null; finishing = false; }
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 420);
  }
  function abortScan() {
    clearTimeout(scanTimer); body.classList.remove('ui2-scanning');
    var s = scan; scan = null; finishing = false;
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /* ---------------- capçalera compacta en desplaçar (mòbil) ---------------- */
  /* Capçalera compacta segons l'estat (resultat visible o fora d'Inici), MAI segons la posició del scroll:
     canviar-ne l'alçada mentre el dit llisca encongia/estirava el contenidor i el contingut saltava. */
  function syncHeader() {
    var res = doc.getElementById('results');
    var want = !!(res && res.classList.contains('on')) || body.getAttribute('data-ui2-page') !== 'inici';
    if (body.classList.contains('ui2-hdr-compact') !== want) body.classList.toggle('ui2-hdr-compact', want);
  }
  /* ---------------- reversibilitat completa ---------------- */
  function disable() {
    observers.forEach(function (o) { o.disconnect(); }); observers = [];
    body.classList.remove('ui2-hdr-compact');
    abortScan();
    [].forEach.call(doc.querySelectorAll('.ui2-injected'), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    [].forEach.call(doc.querySelectorAll('[data-ui2-html]'), function (e) { e.innerHTML = decodeURIComponent(e.getAttribute('data-ui2-html')); e.removeAttribute('data-ui2-html'); });
    [].forEach.call(doc.querySelectorAll('[data-ui2-shown]'), function (e) { e.style.display = 'none'; e.removeAttribute('data-ui2-shown'); });
    [].forEach.call(doc.querySelectorAll('[data-ui2-aria]'), function (e) { e.removeAttribute('aria-label'); e.removeAttribute('title'); e.removeAttribute('data-ui2-aria'); });
    [].forEach.call(doc.querySelectorAll('[data-ui2-count],[data-ui2],[data-ui2-kind],[data-ui2-icon]'), function (e) { ['data-ui2-count', 'data-ui2', 'data-ui2-kind', 'data-ui2-icon'].forEach(function (a) { e.removeAttribute(a); }); });
    ['ui2-hide', 'ui2-tile', 'ui2-date', 'ui2-warn', 'ui2-ico', 'ui2-event', 'ui2-head', 'ui2-sec', 'ui2-nav-ico', 'ui2-swapped', 'ui2-tv', 'ui2-emerge', 'ui2-informative', 'ui2-notinc', 'ui2-neutral', 'ui2-ready'].forEach(function (c) {
      [].forEach.call(doc.querySelectorAll('.' + c), function (e) { e.classList.remove(c); });
    });
    body.classList.remove('ui2', 'ui2-scanning'); body.removeAttribute('data-ui2-page');
  }

  /* ---------------- arrencada ---------------- */
  function watch(target, opts, fn) { if (!target) return; var o = new MutationObserver(fn); o.observe(target, opts); observers.push(o); }
  function decorateHistory() {
    [].forEach.call(doc.querySelectorAll('#historyList .hist-item'), function (h) {
      if (h.querySelector('.ui2-hist-ico')) return;
      h.insertBefore(injected('span', 'ui2-hist-ico ui2-ico', ico(pick(h.textContent, 'doc'), 16, 3.4)), h.firstChild);
      if (!h.querySelector('.ui2-hist-go')) h.appendChild(injected('span', 'ui2-hist-go', '<svg width="14" height="14" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" aria-hidden="true"><path d="M18 10l14 14-14 14" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
    });
  }
  var VERSION = '2.8.0';
  function buildTag() {
    var sc = doc.querySelector('script[src*="ui2.js"]'), m = sc && /[?&]v=([0-9a-f]{6,})/i.exec(sc.getAttribute('src') || '');
    return m ? m[1].slice(0, 8) : 'local';
  }
  function versionMark() {
    var cfg = doc.querySelector('#pageConfig .card[style*="text-align:center"]'); if (!cfg || doc.getElementById('ui2-ver')) return;
    var v = injected('div', 'ui2-ver', 'Interfície ' + VERSION + ' · ' + esc(buildTag())); v.id = 'ui2-ver'; cfg.appendChild(v);
  }
  /* error: missatge clar i botó per tornar-ho a provar; el text introduït es conserva (script.js no l'esborra) */
  function errRetry() {
    var err = doc.getElementById('errMsg'); if (!err) return;
    var b = doc.getElementById('ui2-retry'), on = err.classList.contains('on');
    if (on && !b) {
      b = injected('button', 'ui2-retry', ico('history', 15, 3.6) + '<span>Tornar-ho a provar</span>'); b.id = 'ui2-retry'; b.type = 'button';
      b.addEventListener('click', function () { if (typeof window.analyze === 'function') window.analyze(); });
      err.parentNode.insertBefore(b, err.nextSibling);
    }
    if (b) b.style.display = on ? '' : 'none';
    if (on) { try { err.scrollIntoView({ block: 'center' }); } catch (e) {} }
  }
  /* «Analitzar ara»: reflex de llum suau només quan hi ha text o imatge a punt (mai durant l'anàlisi) */
  function syncReady() {
    var btn = doc.getElementById('btnAnalyze'); if (!btn) return;
    var txt = (doc.getElementById('txt') || {}).value || '';
    var img = window._currentTab === 'img' ? !!window._imgBase64 : false;
    var ready = !btn.disabled && !body.classList.contains('ui2-scanning') && (window._currentTab === 'img' ? img : txt.trim().length > 0);
    if (btn.classList.contains('ui2-ready') !== ready) btn.classList.toggle('ui2-ready', ready);
  }
  function watchReady() {
    var t = doc.getElementById('txt'); if (t) t.addEventListener('input', syncReady);
    var i = doc.getElementById('imgInput'); if (i) i.addEventListener('change', function () { setTimeout(syncReady, 350); setTimeout(syncReady, 1200); });
    ['tabText', 'tabImg'].forEach(function (id) { var b = doc.getElementById(id); if (b) b.addEventListener('click', function () { setTimeout(syncReady, 0); }); });
    var btn = doc.getElementById('btnAnalyze'); if (btn) watch(btn, { attributes: true, attributeFilter: ['disabled'] }, syncReady);
    watch(body, { attributes: true, attributeFilter: ['class'] }, function () {
      var b = doc.getElementById('btnAnalyze'), want = !!b && b.classList.contains('ui2-ready');
      if (want && body.classList.contains('ui2-scanning')) b.classList.remove('ui2-ready');
    });
    syncReady();
  }
  function init() {
    watchReady();
    decorateStatic(); updatePage(); decorateHistory(); versionMark();
    var load = doc.getElementById('loading'), res = doc.getElementById('results');
    watch(load, { attributes: true, attributeFilter: ['class'] }, function () {
      if (load.classList.contains('on')) startScan();
      else if (scan && !(res && res.classList.contains('on'))) setTimeout(function () { if (scan && !(res && res.classList.contains('on'))) finishScan(false); }, 60);
    });
    watch(res, { attributes: true, attributeFilter: ['class'] }, function () { syncHeader(); if (res.classList.contains('on')) { onResults(); if (scan) finishScan(true); } });
    watch(res, { childList: true, subtree: true }, function () { onResults(); });
    ['nx-p1-block', 'nx-p2-block', 'nx-info-block', 'nx-more-actions-block', 'nx-future-block', 'nx-event-block'].forEach(function (id) {
      watch(doc.getElementById(id), { attributes: true, attributeFilter: ['style'] }, function () { onResults(); });
    });
    watch(doc.getElementById('tasquesList'), { childList: true }, function () { if (body.getAttribute('data-ui2-page') === 'tasques') buildTasksView(); });
    ['pageInici', 'pageTasques', 'pageHistorial', 'pageConfig', 'pagePremium'].forEach(function (id) {
      watch(doc.getElementById(id), { attributes: true, attributeFilter: ['style'] }, updatePage);
    });
    watch(doc.getElementById('historyList'), { childList: true }, decorateHistory);
    watch(doc.getElementById('errMsg'), { attributes: true, attributeFilter: ['class'] }, errRetry);
  }
  try { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init(); }
  catch (e) { body.classList.remove('ui2-scanning'); }
  window.NexLupaUI2 = { version: VERSION, build: buildTag(), icon: ico, disable: disable };
})();
