/* ============================================================
   script.js — NexLupa unified JavaScript
   ============================================================ */

'use strict';

/* ── APP INIT FLAG ── */
var _motorInit = false;

/* ── OPEN / CLOSE APP ── */
function obrirApp() {
  var landing = document.getElementById('pageLanding');
  var app     = document.getElementById('pageApp');
  if (!landing || !app) return;

  landing.style.display = 'none';
  app.style.display     = 'flex';
  document.body.classList.add('app-active');
  app.scrollTop = 0;
  navTo('inici');

  if (!_motorInit) {
    _motorInit = true;
    try { checkLimit(); }    catch(e) { console.warn('checkLimit:', e); }
    try { updateCounter(); } catch(e) { console.warn('updateCounter:', e); }
    try { showOnboarding(); }catch(e) { console.warn('showOnboarding:', e); }
    try { loadConfig(); }    catch(e) { console.warn('loadConfig:', e); }
    try { updateBadges(); }  catch(e) { console.warn('updateBadges:', e); }
  }
}

function tornarLanding() {
  var landing = document.getElementById('pageLanding');
  var app     = document.getElementById('pageApp');
  if (!landing || !app) return;

  app.style.display     = 'none';
  landing.style.display = 'block';
  document.body.classList.remove('app-active');
  window.scrollTo(0, 0);
}

/* ── LANDING: reveal on scroll + botons CTA ── */
document.addEventListener('DOMContentLoaded', function () {
  /* Connectar tots els botons que obren l'app */
  ['btnObrirApp1', 'btnObrirApp2', 'btnObrirApp3'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', obrirApp);
  });

  /* Scroll-reveal for landing */
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) e.target.classList.add('visible');
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('#pageLanding .reveal').forEach(function (el) {
    obs.observe(el);
  });

  /* Drag-and-drop on image drop zone (only when app is initialised) */
  var drop = document.getElementById('imgDrop');
  if (drop) {
    drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      drop.style.borderColor = 'var(--gold)';
    });
    drop.addEventListener('dragleave', function () {
      drop.style.borderColor = '';
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        handleImg({ target: { files: [file] } });
      }
    });
  }
});

/* ── API KEY ── */
function getApiKey() {
  return localStorage.getItem('nxl_apikey') || '';
}
function saveApiKey(key) {
  localStorage.setItem('nxl_apikey', key.trim());
  var st = document.getElementById('apiKeyStatus');
  if (st) {
    if (key.trim()) {
      st.textContent = '✓ Clau configurada';
      st.style.color = 'var(--green)';
    } else {
      st.textContent = '';
    }
  }
}

/* ── EXAMPLE TEXTS ── */
var EX = {
  escola: "Bon dia, famílies,\n\nUs escrivim per recordar-vos que el proper divendres 11 d'abril celebrarem a l'escola la jornada esportiva de primavera.\n\nCaldrà que els nens portin roba esportiva adequada, una cantimplora d'aigua i protecció solar.\n\nÉs molt important que entregeu l'autorització signada abans del dijous 10 d'abril.\n\nA més, el termini per avisar d'intoleràncies alimentàries és el dimecres 9 d'abril.\n\nMoltes gràcies!",
  ampa:   "Hola a totes les famílies!\n\nLa propera reunió de l'AMPA serà el dimarts 15 d'abril a les 19h al saló d'actes. Votarem el pressupost de fi de curs.\n\nEl termini de pagament de les extraescolars del 2n trimestre és el 8 d'abril.\n\nBusquem voluntaris per a la festa de final de curs (20 de juny). Escriviu a ampa@escola.cat abans del 20 d'abril.\n\nGràcies!",
  feina:  "Hola equip,\n\nLlançament de la nova versió el 30 d'abril. Necessitem:\n- Assets de disseny finals abans del 18 d'abril\n- Revisió QA entre el 19 i el 23 d'abril\n- Presentació inversors pel 25 d'abril (Marc)\n\nDijous 10 reunió client Barcelona a les 10h. Confirmeu assistència abans de dimecres.\n\nPressupost Q2 per aprovar abans del 12 d'abril.\n\nSalutacions"
};

function loadEx(k) {
  var el = document.getElementById('txt');
  if (el) el.value = EX[k] || '';
}

/* ── ACTION CHECKBOX ── */
function chk(el, row) {
  el.classList.toggle('on');
  el.innerHTML = el.classList.contains('on') ? '✓' : '';
  row.classList.toggle('done');
}

/* ── LAST RESULT ── */
var _lastData = null;

/* ── DEMO MODE ── */
var _demoMode = false;
var DEMO_RESULTS = {
  resum: "Jornada esportiva el divendres 11 d'abril. Cal portar roba esportiva i entregar l'autorització signada.",
  urgencia: 4,
  urgencia_text: "Termini proper — cal actuar avui",
  accions: [
    "Preparar roba esportiva i calçat",
    "Signar l'autorització",
    "Portar cantimplora i crema solar",
    "Avisar intoleràncies alimentàries"
  ],
  dates: [
    { descripcio: "Entregar autorització", data: "10 d'abril", urgent: true },
    { descripcio: "Avisar intoleràncies",  data: "9 d'abril",  urgent: true },
    { descripcio: "Jornada esportiva",     data: "11 d'abril", urgent: false }
  ]
};

function toggleDemo() {
  _demoMode = !_demoMode;
  var banner = document.getElementById('demoBanner');
  if (banner) banner.style.display = _demoMode ? 'block' : 'none';
  if (_demoMode) {
    navTo('inici');
    var txtEl = document.getElementById('txt');
    if (txtEl) txtEl.value = EX.escola;
    setTimeout(function () { render(DEMO_RESULTS); }, 300);
  } else {
    var txtEl2 = document.getElementById('txt');
    if (txtEl2) txtEl2.value = '';
    var res = document.getElementById('results');
    if (res) res.classList.remove('on');
  }
}

/* ── USAGE LIMIT ── */
var FREE_LIMIT = 3;

function getUsageToday() {
  var today = new Date().toDateString();
  var stored = JSON.parse(localStorage.getItem('nxl_usage') || '{}');
  if (stored.date !== today) return 0;
  return stored.count || 0;
}

function incrementUsage() {
  var today = new Date().toDateString();
  var count = getUsageToday() + 1;
  localStorage.setItem('nxl_usage', JSON.stringify({ date: today, count: count }));
  return count;
}

function checkLimit() {
  var used = getUsageToday();
  var banner = document.getElementById('limitBanner');
  var btn = document.getElementById('btnAnalyze');
  if (!banner || !btn) return true;
  if (used >= FREE_LIMIT) {
    banner.style.display = 'block';
    btn.disabled = true;
    btn.innerHTML = '🔒 Límit assolit — Activa Premium';
    var lc = document.getElementById('limitCount');
    if (lc) lc.textContent = used;
    return false;
  }
  banner.style.display = 'none';
  btn.disabled = false;
  btn.innerHTML = '🔍 &nbsp;Analitzar amb nexlupa';
  return true;
}

function updateCounter() {
  var used = getUsageToday();
  var el   = document.getElementById('usageText');
  var dots = document.getElementById('usageBar');
  if (!el || !dots) return;
  el.textContent = used + ' de ' + FREE_LIMIT + ' anàlisis usats avui';
  var html = '<div class="usage-dots">';
  for (var i = 0; i < FREE_LIMIT; i++) {
    var cls = i < used
      ? (used === FREE_LIMIT && i === FREE_LIMIT - 1 ? 'usage-dot last' : 'usage-dot used')
      : 'usage-dot';
    html += '<div class="' + cls + '"></div>';
  }
  html += '</div>';
  dots.innerHTML = html;
}

/* ── ANALYZE ── */
var _currentTab = 'text';
var _imgBase64  = null;

function switchTab(tab) {
  _currentTab = tab;
  var panelText = document.getElementById('panelText');
  var panelImg  = document.getElementById('panelImg');
  var tabText   = document.getElementById('tabText');
  var tabImg    = document.getElementById('tabImg');
  if (panelText) panelText.style.display = tab === 'text' ? 'block' : 'none';
  if (panelImg)  panelImg.style.display  = tab === 'img'  ? 'block' : 'none';
  if (tabText)   tabText.classList.toggle('active', tab === 'text');
  if (tabImg)    tabImg.classList.toggle('active',  tab === 'img');
}

function handleImg(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (ev) {
    _imgBase64 = ev.target.result;
    var preview     = document.getElementById('imgPreview');
    var dropContent = document.getElementById('imgDropContent');
    var dropZone    = document.getElementById('imgDrop');
    if (preview)     { preview.src = _imgBase64; preview.style.display = 'block'; }
    if (dropContent) dropContent.style.display = 'none';
    if (dropZone)    dropZone.classList.add('has-img');
  };
  reader.readAsDataURL(file);
}

async function analyze() {
  /* Demo mode bypass */
  if (_demoMode) { render(DEMO_RESULTS); return; }

  var apiKey = getApiKey();
  if (!apiKey) {
    showErr('⚠️ Falta la clau API. Ves a Config → Clau API per configurar-la.');
    return;
  }
  if (!checkLimit()) { navTo('premium'); return; }

  var isImg = _currentTab === 'img';
  var text  = (document.getElementById('txt') || {}).value || '';
  text = text.trim();

  if (!isImg && !text) return;
  if (isImg && !_imgBase64) return;

  var btn  = document.getElementById('btnAnalyze');
  var load = document.getElementById('loading');
  var res  = document.getElementById('results');
  var err  = document.getElementById('errMsg');

  btn.disabled = true;
  load.classList.add('on');
  res.classList.remove('on');
  err.classList.remove('on');

  var sys = [
    'Ets el motor d\'anàlisi de nexlupa. Retorna NOMÉS un JSON vàlid, sense markdown ni text addicional.',
    'Estructura exacta:',
    '{',
    '  "resum": "frase curta i accionable, màxim 2 línies",',
    '  "urgencia": 1-5,',
    '  "urgencia_text": "text curt sobre la urgència",',
    '  "accions": ["acció 1","acció 2","acció 3"],',
    '  "dates": [{"descripcio":"text","data":"data clara","urgent":true/false}]',
    '}',
    'Regles: accions en infinitiu, màxim 5. Dates només les explícites. Si no n\'hi ha, dates=[].',
    'Si reps una imatge, extreu primer el text visible i després analitza\'l.'
  ].join('\n');

  try {
    var userContent;
    if (isImg) {
      var mediaType = _imgBase64.split(';')[0].split(':')[1];
      var b64data   = _imgBase64.split(',')[1];
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64data } },
        { type: 'text',  text: "Extreu el text d'aquesta imatge/pantallàs i analitza'l com un missatge." }
      ];
    } else {
      userContent = 'Analitza:\n\n' + text;
    }

    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: sys,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    var d = await r.json();
    var rawText = d.content[0].text.replace(/```json|```/g, '').trim();
    var parsed  = JSON.parse(rawText);
    incrementUsage();
    checkLimit();
    updateCounter();
    render(parsed);
  } catch (ex) {
    showErr(apiKey
      ? 'Hi ha hagut un error. Torna-ho a intentar.'
      : '⚠️ Falta la clau API. Ves a Config → Clau API per configurar-la.');
  } finally {
    btn.disabled = false;
    load.classList.remove('on');
  }
}

function showErr(msg) {
  var err = document.getElementById('errMsg');
  if (!err) return;
  err.textContent = msg;
  err.classList.add('on');
}

/* ── RENDER RESULTS ── */
function render(d) {
  if (!document.getElementById('resum')) return;
  _lastData = d;

  document.getElementById('resum').textContent = d.resum || '';

  /* Urgency dots */
  var dotsEl = document.getElementById('urgDots');
  dotsEl.innerHTML = '';
  for (var i = 1; i <= 5; i++) {
    var dot = document.createElement('div');
    dot.className = 'u-dot' + (i <= d.urgencia ? (d.urgencia >= 4 ? ' hot' : ' on') : '');
    dotsEl.appendChild(dot);
  }
  var urgTxt = document.getElementById('urgTxt');
  if (urgTxt) urgTxt.textContent = d.urgencia_text || '';

  /* Actions */
  var actEl = document.getElementById('actions');
  actEl.innerHTML = '';
  (d.accions || []).forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'act-item';
    var box = document.createElement('div');
    box.className = 'act-chk';
    box.onclick = function () { chk(box, row); };
    var txt = document.createElement('span');
    txt.textContent = a;
    row.appendChild(box);
    row.appendChild(txt);
    actEl.appendChild(row);
  });

  /* Dates */
  var datesEl   = document.getElementById('dates');
  var datesCard = document.getElementById('datesCard');
  var btnCal    = document.getElementById('btnCalendar');
  datesEl.innerHTML = '';
  if (d.dates && d.dates.length > 0) {
    datesCard.style.display = 'block';
    if (btnCal) btnCal.style.display = 'flex';
    d.dates.forEach(function (dt) {
      var row   = document.createElement('div');
      row.className = 'date-item';
      var desc  = document.createElement('span');
      desc.className = 'date-desc';
      desc.textContent = dt.descripcio;
      var right = document.createElement('div');
      right.style.cssText = 'display:flex;gap:6px;align-items:center;flex-shrink:0;';
      var badge = document.createElement('span');
      badge.className = 'date-badge' + (dt.urgent ? ' hot' : '');
      badge.textContent = dt.data;
      var calBtn = document.createElement('button');
      calBtn.textContent = '📅';
      calBtn.title = 'Afegir al Google Calendar';
      calBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;padding:2px;';
      calBtn.onclick = function () { addSingleToCalendar(dt); };
      right.appendChild(badge);
      right.appendChild(calBtn);
      row.appendChild(desc);
      row.appendChild(right);
      datesEl.appendChild(row);
    });
  } else {
    datesCard.style.display = 'none';
    if (btnCal) btnCal.style.display = 'none';
  }

  var res = document.getElementById('results');
  res.classList.add('on');
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });

  saveToHistorial(d);
}

function reset() {
  var res = document.getElementById('results');
  var txt = document.getElementById('txt');
  var err = document.getElementById('errMsg');
  if (res) res.classList.remove('on');
  if (txt) txt.value = '';
  if (err) err.classList.remove('on');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── CALENDAR EXPORT ── */
var MONTHS = {
  'gener':1,'febrer':2,'marc':3,'abril':4,'maig':5,'juny':6,
  'juliol':7,'agost':8,'setembre':9,'octubre':10,'novembre':11,'desembre':12,
  'enero':1,'febrero':2,'marzo':3,'mayo':5,'junio':6,'julio':7,
  'agosto':8,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12,
  'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
  'july':7,'august':8,'september':9,'october':10,'november':11,'december':12
};

function parseDate(str) {
  var now  = new Date();
  var year = now.getFullYear();
  var m1   = str.match(/(\d{1,2})\s+(?:de\s+)?([a-zç]+)/i);
  if (m1) {
    var day = parseInt(m1[1]);
    var mon = MONTHS[m1[2].toLowerCase()];
    if (mon) return new Date(year, mon - 1, day);
  }
  var m2 = str.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m2) {
    var d2 = parseInt(m2[1]), mo = parseInt(m2[2]);
    var y  = m2[3] ? parseInt(m2[3]) : year;
    return new Date(y < 100 ? 2000 + y : y, mo - 1, d2);
  }
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

function toGCalDate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return '' + y + m + d;
}

function addSingleToCalendar(dt) {
  var date    = parseDate(dt.data);
  var nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  var params = new URLSearchParams({
    action:  'TEMPLATE',
    text:    dt.descripcio,
    dates:   toGCalDate(date) + '/' + toGCalDate(nextDay),
    details: '📌 ' + ((_lastData && _lastData.resum) || '') + '\n\nGenerat per nexlupa'
  });
  window.open('https://calendar.google.com/calendar/render?' + params.toString(), '_blank');
}

function exportCalendar() {
  if (!_lastData || !_lastData.dates || _lastData.dates.length === 0) return;
  var resum = _lastData.resum || 'nexlupa';
  _lastData.dates.forEach(function (dt, i) {
    var date    = parseDate(dt.data);
    var nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    var params = new URLSearchParams({
      action:  'TEMPLATE',
      text:    dt.descripcio,
      dates:   toGCalDate(date) + '/' + toGCalDate(nextDay),
      details: '📌 ' + resum + '\n\nGenerat per nexlupa'
    });
    setTimeout(function () {
      window.open('https://calendar.google.com/calendar/render?' + params.toString(), '_blank');
    }, i * 400);
  });
}

/* ── SHARE ── */
function buildShareText(d) {
  var txt = '🔍 *nexlupa* — Resum del missatge\n\n';
  txt += '⭐ *Resum:* ' + d.resum + '\n\n';
  if (d.accions && d.accions.length > 0) {
    txt += '✅ *Accions:*\n';
    d.accions.forEach(function (a) { txt += '  • ' + a + '\n'; });
    txt += '\n';
  }
  if (d.dates && d.dates.length > 0) {
    txt += '📅 *Dates:*\n';
    d.dates.forEach(function (dt) { txt += '  • ' + dt.descripcio + ': ' + dt.data + '\n'; });
    txt += '\n';
  }
  txt += '_Generat amb nexlupa · La lupa que treballa sola_';
  return txt;
}

function buildShareURL(d) {
  var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  return window.location.href.split('?')[0] + '?r=' + encoded;
}

function shareWhatsApp() {
  if (!_lastData) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(buildShareText(_lastData)), '_blank');
}

function copyLink() {
  if (!_lastData) return;
  var url = buildShareURL(_lastData);
  navigator.clipboard.writeText(url).then(function () {
    var btn = document.getElementById('btnCopy');
    var ok  = document.getElementById('copyOk');
    if (btn) { btn.classList.add('copied'); btn.innerHTML = '<span>✓</span> Copiat!'; }
    if (ok)  ok.classList.add('on');
    setTimeout(function () {
      if (btn) { btn.classList.remove('copied'); btn.innerHTML = '<span>🔗</span> Copiar link'; }
      if (ok)  ok.classList.remove('on');
    }, 3000);
  });
}

/* ── ONBOARDING ── */
var OB_STEPS = [
  { icon: '🔍', title: 'Benvingut a nexlupa', desc: 'La lupa que treballa sola. Enganxa qualsevol missatge llarg i obtens el que importa en 10 segons.' },
  { icon: '✅', title: 'Resum + Accions + Dates', desc: 'nexlupa extreu automàticament el resum, les tasques pendents i les dates importants de qualsevol missatge.' },
  { icon: '📅', title: 'Tot sincronitzat', desc: 'Afegeix les dates al Google Calendar, comparteix per WhatsApp i guarda historial de tots els missatges analitzats.' }
];
var _obStep = 0;

function showOnboarding() {
  if (localStorage.getItem('nxl_ob_done')) return;
  var el = document.getElementById('onboarding');
  if (el) el.style.display = 'flex';
}

function nextStep() {
  _obStep++;
  if (_obStep >= OB_STEPS.length) { closeOnboarding(); return; }
  var s = OB_STEPS[_obStep];
  document.getElementById('obIcon').textContent  = s.icon;
  document.getElementById('obTitle').textContent = s.title;
  document.getElementById('obDesc').textContent  = s.desc;
  document.getElementById('obStep').textContent  = 'PAS ' + (_obStep + 1) + ' DE ' + OB_STEPS.length;
  document.getElementById('obBtn').textContent   = _obStep === OB_STEPS.length - 1 ? 'Començar →' : 'Continua →';
  for (var i = 0; i < OB_STEPS.length; i++) {
    var dotEl = document.getElementById('obDot' + i);
    if (dotEl) dotEl.classList.toggle('active', i === _obStep);
  }
}

function closeOnboarding() {
  localStorage.setItem('nxl_ob_done', '1');
  var el = document.getElementById('onboarding');
  if (el) el.style.display = 'none';
}

/* ── NAVIGATION ── */
var _allTasques = JSON.parse(localStorage.getItem('nxl_tasks') || '[]');
var _historial  = JSON.parse(localStorage.getItem('nxl_hist')  || '[]');

function navTo(page) {
  var pages = ['pageInici', 'pageHistorial', 'pageTasques', 'pageConfig', 'pagePremium'];
  pages.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  /* Show/hide app hero */
  var appHero = document.querySelector('#pageApp .app-hero');
  if (appHero) appHero.style.display = page === 'inici' ? 'block' : 'none';

  if      (page === 'inici')    { document.getElementById('pageInici').style.display = 'block'; }
  else if (page === 'historial') { document.getElementById('pageHistorial').style.display = 'block'; renderHistorial(); }
  else if (page === 'tasques')   { document.getElementById('pageTasques').style.display = 'block'; renderTasques(); }
  else if (page === 'config')    { document.getElementById('pageConfig').style.display = 'block'; }
  else if (page === 'premium')   {
    document.getElementById('pagePremium').style.display = 'block';
    var appEl = document.getElementById('pageApp');
    if (appEl) appEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Nav active state */
  var navMap = { inici: 'navInici', historial: 'navHistorial', tasques: 'navTasques', config: 'navConfig' };
  ['navInici','navHistorial','navTasques','navConfig'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (navMap[page]) {
    var activeNav = document.getElementById(navMap[page]);
    if (activeNav) activeNav.classList.add('active');
  }
}

/* ── HISTORIAL & TASQUES ── */
function saveToHistorial(d) {
  var now     = new Date();
  var dateStr = now.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  var entry   = Object.assign({}, d, { date: dateStr, id: Date.now() });
  _historial.push(entry);
  if (_historial.length > 20) _historial.shift();
  localStorage.setItem('nxl_hist', JSON.stringify(_historial));

  (d.accions || []).forEach(function (a) {
    _allTasques.push({ text: a, src: d.resum.substring(0, 40) + '...', done: false, id: Date.now() + Math.random() });
  });
  localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
  updateBadges();
}

function renderHistorial() {
  var el = document.getElementById('historialList');
  if (!el) return;
  if (_historial.length === 0) {
    el.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:24px 0;">Encara no hi ha missatges analitzats.</p>';
    return;
  }
  el.innerHTML = '';
  var reversed = _historial.slice().reverse();
  reversed.forEach(function (item) {
    var div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML =
      '<div class="hist-title">' + escHtml(item.resum) + '</div>' +
      '<div class="hist-meta">' + escHtml(item.date) + ' · ' + (item.accions ? item.accions.length : 0) + ' accions · ' + (item.dates ? item.dates.length : 0) + ' dates</div>';
    div.onclick = function () { render(item); navTo('inici'); };
    el.appendChild(div);
  });
}

function renderTasques() {
  var el = document.getElementById('tasquesList');
  if (!el) return;
  if (_allTasques.length === 0) {
    el.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:24px 0;">Encara no hi ha tasques pendents.</p>';
    return;
  }
  el.innerHTML = '';
  _allTasques.forEach(function (t, i) {
    var div = document.createElement('div');
    div.className = 'tsk-item' + (t.done ? ' done' : '');

    var chkEl = document.createElement('div');
    chkEl.style.cssText = 'width:22px;height:22px;border-radius:7px;border:2px solid var(--border);flex-shrink:0;margin-top:1px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;color:transparent;transition:all .2s;';
    if (t.done) {
      chkEl.style.background   = 'var(--green)';
      chkEl.style.borderColor  = 'var(--green)';
      chkEl.style.color        = 'white';
      chkEl.innerHTML          = '✓';
    }
    (function (idx) {
      chkEl.onclick = function () {
        _allTasques[idx].done = !_allTasques[idx].done;
        localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
        updateBadges();
        renderTasques();
      };
    }(i));

    var info = document.createElement('div');
    info.innerHTML = '<div style="font-size:14px;font-weight:500;">' + escHtml(t.text) + '</div><div class="tsk-src">' + escHtml(t.src) + '</div>';
    div.appendChild(chkEl);
    div.appendChild(info);
    el.appendChild(div);
  });
}

function updateBadges() {
  var hBadge  = document.getElementById('badgeHistorial');
  var tBadge  = document.getElementById('badgeTasques');
  var pending = _allTasques.filter(function (t) { return !t.done; }).length;
  if (hBadge) { hBadge.textContent = _historial.length; hBadge.style.display = _historial.length > 0 ? 'flex' : 'none'; }
  if (tBadge) { tBadge.textContent = pending;            tBadge.style.display = pending > 0          ? 'flex' : 'none'; }
}

/* ── CONFIG ── */
function loadConfig() {
  var cfg = JSON.parse(localStorage.getItem('nxl_cfg') || '{}');
  var nomEl = document.getElementById('cfgNom');
  if (nomEl && cfg.nom) nomEl.value = cfg.nom;

  var key   = getApiKey();
  var keyEl = document.getElementById('cfgApiKey');
  var stEl  = document.getElementById('apiKeyStatus');
  if (key && keyEl) keyEl.value = key;
  if (key && stEl)  { stEl.textContent = '✓ Clau configurada'; stEl.style.color = 'var(--green)'; }

  if (cfg.dark) {
    document.body.classList.add('dark');
    var darkEl = document.getElementById('cfgDark');
    if (darkEl) darkEl.checked = true;
  }
  var notifEl  = document.getElementById('cfgNotif');
  var remindEl = document.getElementById('cfgRemind');
  if (notifEl  && cfg.notif  === false) notifEl.checked  = false;
  if (remindEl && cfg.remind === false) remindEl.checked = false;
}

function saveConfig() {
  var nomEl    = document.getElementById('cfgNom');
  var darkEl   = document.getElementById('cfgDark');
  var notifEl  = document.getElementById('cfgNotif');
  var remindEl = document.getElementById('cfgRemind');
  var cfg = {
    nom:    nomEl    ? nomEl.value    : '',
    dark:   darkEl   ? darkEl.checked   : false,
    notif:  notifEl  ? notifEl.checked  : true,
    remind: remindEl ? remindEl.checked : true
  };
  localStorage.setItem('nxl_cfg', JSON.stringify(cfg));
}

function toggleDark() {
  document.body.classList.toggle('dark');
  saveConfig();
}

function clearHistorial() {
  if (!confirm('Esborrar tot l\'historial?')) return;
  _historial = [];
  localStorage.removeItem('nxl_hist');
  updateBadges();
  renderHistorial();
  alert('Historial esborrat!');
}

function clearTasques() {
  if (!confirm('Esborrar totes les tasques completades?')) return;
  _allTasques = _allTasques.filter(function (t) { return !t.done; });
  localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
  updateBadges();
  alert('Tasques completades esborrades!');
}

/* ── UTILITY ── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
