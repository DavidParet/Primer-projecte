/* ============================================================
   script.js — nexlupa unified JavaScript
   ============================================================ */

'use strict';

/* ── KILL OLD SERVICE WORKERS & STALE CACHES ── */
(function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
  }
  if ('caches' in window) {
    caches.keys().then(function (names) {
      names.forEach(function (name) { caches.delete(name); });
    });
  }
})();

/* ── LOCALSTORAGE MIGRATION (v1 → v3) ── */
(function () {
  var LS_VER = '3';
  if (localStorage.getItem('nxl_ver') === LS_VER) return;
  try {
    var raw = JSON.parse(localStorage.getItem('nxl_tasks') || '[]');
    raw = raw.map(function (t) {
      if (!t.text) {
        t.text = String(t.accio || t.descripcio || t.action || '').trim();
      }
      if (!t.prioritat) t.prioritat = 'baixa';
      /* v3: mark all non-done tasks as isNew so priority colors and NOU badge show */
      if (!t.done) t.isNew = true;
      return t;
    }).filter(function (t) { return t.text; });
    localStorage.setItem('nxl_tasks', JSON.stringify(raw));
  } catch (e) { /* localStorage inaccessible */ }
  localStorage.setItem('nxl_ver', LS_VER);
})();

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

  /* Pre-omplir textarea amb text de demo si està buit */
  var txtEl = document.getElementById('txt');
  if (txtEl && !txtEl.value.trim()) { txtEl.value = DEFAULT_TEXT; }

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

  /* Cerca historial en temps real */
  var histSearch = document.getElementById('historySearch');
  if (histSearch) {
    histSearch.addEventListener('input', function () {
      renderHistory(histSearch.value);
    });
  }

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


/* ── EXAMPLE TEXTS ── */
var DEFAULT_TEXT = "Hola famílies,\n\nEsperem que estigueu tots bé! 😊\n\nUs escrivim per recordar-vos algunes coses de cara als propers dies. Sabem que hi ha moltes comunicacions i pot ser difícil estar al dia de tot.\n\nAquest divendres 11 d'abril celebrarem la jornada esportiva a l'escola. L'activitat començarà a les 17:00 i està previst que duri aproximadament fins a les 19:30, tot i que pot variar una mica segons com evolucioni la tarda.\n\nÉs important que els alumnes portin roba esportiva adequada i còmoda. També recomanem portar una ampolla d'aigua.\n\nRecordeu que és imprescindible portar l'autorització signada. Sense aquesta autorització no podran participar a l'activitat.\n\nEn cas que algun alumne tingui intoleràncies alimentàries o necessitats especials, si us plau, feu-nos-ho saber amb antelació responent a aquest mateix correu.\n\nA més, la setmana vinent començarem els preparatius per la sortida de final de curs, de la qual us enviarem informació més detallada pròximament.\n\nMoltes gràcies per la vostra col·laboració i confiança!\n\nSalutacions,\nEquip docent";

var EX = {
  escola: DEFAULT_TEXT,
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

/* ── NORMALIZE RESULT ── */
function normalizeResult(raw) {
  var d = raw || {};

  var resum = d.resum;
  if (typeof resum !== 'string') resum = String(resum || '');

  var accions = d.accions;
  if (!Array.isArray(accions)) accions = [];
  accions = accions.slice(0, 3).map(function (a) {
    if (typeof a === 'string') return a.trim();
    if (a && typeof a === 'object') return String(a.accio || a.text || a.descripcio || a.action || '').trim();
    return String(a || '').trim();
  }).filter(function (a) { return a.length > 0; });

  var dates = d.dates;
  if (!Array.isArray(dates)) dates = [];
  dates = dates.map(function (dt) {
    if (!dt) return null;
    if (typeof dt === 'string') return { descripcio: dt, data: '', urgent: false };
    if (typeof dt !== 'object') return null;
    var desc = String(dt.descripcio || dt.text || dt.description || '').trim();
    var data = String(dt.data || dt.date || dt.fecha || '').trim();
    if (!desc) return null;
    return { descripcio: desc, data: data, urgent: !!dt.urgent };
  }).filter(function (dt) { return dt !== null; });

  return {
    resum:         resum,
    urgencia:      Math.min(5, Math.max(1, parseInt(d.urgencia) || 1)),
    urgencia_text: typeof d.urgencia_text === 'string' ? d.urgencia_text : String(d.urgencia_text || ''),
    accions:       accions,
    dates:         dates
  };
}

/* ── FORMAT DATE ── */
var _DIES  = ['Diumenge','Dilluns','Dimarts','Dimecres','Dijous','Divendres','Dissabte'];
var _MESOS = ['gener','febrer','març','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];

function formatDate(str) {
  if (!str || typeof str !== 'string') return '';
  var now  = new Date();
  var year = now.getFullYear();
  var d    = null;

  var timeMatch = str.match(/(\d{1,2}):(\d{2})/);
  var timeSuffix = timeMatch ? ' · ' + timeMatch[0] : '';

  var m1 = str.match(/(\d{1,2})\s+(?:de\s+)?([a-zç]+)/i);
  if (m1) {
    var day = parseInt(m1[1]);
    var mon = MONTHS[m1[2].toLowerCase()];
    if (mon) d = new Date(year, mon - 1, day);
  }

  if (!d) {
    var m2 = str.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (m2) {
      var d2 = parseInt(m2[1]), mo = parseInt(m2[2]);
      var y2 = m2[3] ? parseInt(m2[3]) : year;
      d = new Date(y2 < 100 ? 2000 + y2 : y2, mo - 1, d2);
    }
  }

  if (!d || isNaN(d.getTime())) return str;
  return _DIES[d.getDay()] + ' · ' + d.getDate() + ' ' + _MESOS[d.getMonth()] + timeSuffix;
}

/* ── DEMO MODE ── */
var _demoMode = false;
var DEMO_RESULTS = {
  resum: "Jornada esportiva divendres 11 d'abril a les 17:00. Cal portar roba esportiva i autorització signada.",
  decisio: "Preparar i assistir a la jornada esportiva",
  urgent: "medium",
  accions: [
    { accio: "Preparar roba esportiva", tipus: "tasca", data: null, prioritat: "alta" },
    { accio: "Signar l'autorització", tipus: "tasca", data: null, prioritat: "alta" },
    { accio: "Afegir la jornada al calendari", tipus: "calendari", data: "2025-04-11 17:00", prioritat: "mitja" }
  ],
  dates: [
    { descripcio: "Jornada esportiva", data: "Div. 17:00", urgent: false }
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
var DEV_MODE = true; /* proves il·limitades — canviar a false per activar límit */
var FREE_LIMIT = 3;

function getUsageToday() {
  if (DEV_MODE) return 0;
  var today = new Date().toDateString();
  var stored = JSON.parse(localStorage.getItem('nxl_usage') || '{}');
  if (stored.date !== today) return 0;
  return stored.count || 0;
}

function incrementUsage() {
  if (DEV_MODE) return 0;
  var today = new Date().toDateString();
  var count = getUsageToday() + 1;
  localStorage.setItem('nxl_usage', JSON.stringify({ date: today, count: count }));
  return count;
}

function checkLimit() {
  if (DEV_MODE) return true;
  var used = getUsageToday();
  var banner = document.getElementById('limitBanner');
  var btn = document.getElementById('btnAnalyze');
  if (!banner || !btn) return true;
  if (used >= FREE_LIMIT) {
    banner.style.display = 'block';
    btn.disabled = true;
    btn.innerHTML = 'Límit diari assolit';
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
  el.textContent = used >= FREE_LIMIT
    ? 'Límit assolit. Torna demà per 3 anàlisis més.'
    : used + ' de ' + FREE_LIMIT + ' anàlisis avui';
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
function _inputCard() { return document.querySelector('#pageInici .app-col-right .card'); }
function hideInputCard() {
  var c = _inputCard(); if (c) c.style.display = 'none';
  var h = document.querySelector('.app-main-headline'); if (h) h.style.display = 'none';
}
function showInputCard() {
  var c = _inputCard(); if (c) c.style.display = '';
  var h = document.querySelector('.app-main-headline'); if (h) h.style.display = '';
}

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
  /* ── DEMO: mode demo activat ── */
  if (_demoMode) {
    var btnD  = document.getElementById('btnAnalyze');
    var loadD = document.getElementById('loading');
    var resD  = document.getElementById('results');
    var errD  = document.getElementById('errMsg');
    hideInputCard();
    var _colD = document.querySelector('#pageInici .app-col-right');
    if (_colD) _colD.scrollTop = 0;
    if (btnD)  btnD.disabled = true;
    if (loadD) loadD.classList.add('on');
    if (resD)  resD.classList.remove('on');
    if (errD)  errD.style.display = 'none';
    setTimeout(function () {
      if (loadD) loadD.classList.remove('on');
      if (btnD)  btnD.disabled = false;
      render(DEMO_RESULTS);
    }, 1200);
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

  hideInputCard();
  var _colR = document.querySelector('#pageInici .app-col-right');
  if (_colR) _colR.scrollTop = 0;
  btn.disabled = true;
  load.classList.add('on');
  res.classList.remove('on');
  err.classList.remove('on');

  try {
    var body = isImg ? { image: _imgBase64 } : { text: text };

    var r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    var d = await r.json();

    if (!r.ok) {
      throw new Error(d.error || 'Hi ha hagut un error. Torna-ho a intentar.');
    }

    incrementUsage();
    checkLimit();
    updateCounter();
    render(d);
  } catch (ex) {
    showInputCard();
    showErr(ex.message || 'Hi ha hagut un error. Torna-ho a intentar.');
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

/* ── FORMAT DATA LLEGIBLE (ISO format: YYYY-MM-DD HH:MM o YYYY-MM-DDTHH:MM) ── */
function formatActionDate(str) {
  if (!str || str === 'null') return null;
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (!m) return str;
  var DAYS   = ['Diumenge','Dilluns','Dimarts','Dimecres','Dijous','Divendres','Dissabte'];
  var MONTHS = ['gen','feb','març','abr','maig','juny','jul','ago','set','oct','nov','des'];
  var dt = new Date(+m[1], +m[2]-1, +m[3]);
  var out = DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()];
  if (m[4] && !(m[4] === '00' && m[5] === '00')) out += ' · ' + m[4] + ':' + m[5];
  return out;
}

/* ── PRIORITY HEURISTICS ── */
function applyPriorityHeuristics(accions) {
  var _eventRe    = /actuaci|concert|excursi|jornada|espectacle|representaci|festival|parti[dt]|final|visita\s+m[eè]d|reunió/i;
  var _deadlineRe = /pagar|lliurar|signar|entregar|termini|data\s+l[ií]mit|pla[çc]|renovar/i;
  var _prepRe     = /assaig|recollir|recollida|portar|dur\s|comprar|preparar|arribar\s+abans|inscri[ub]|confirmar/i;

  /* Retorna true si la data és una hora concreta dins les properes 24h */
  function isWithin24h(dateStr) {
    if (!dateStr || dateStr === 'null') return false;
    var m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (!m || !m[4] || (m[4] === '00' && m[5] === '00')) return false;
    var dt   = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
    var diff = dt - new Date();
    return diff >= 0 && diff <= 86400000; /* 24h en ms */
  }

  /* Índexs del primer event, primer deadline i primer ALTA de la IA */
  var mainEventIdx    = -1;
  var mainDeadlineIdx = -1;
  var aiAltaIdx       = -1;

  accions.forEach(function (a, i) {
    var txt = String(a.accio || '');
    if (mainEventIdx    === -1 && _eventRe.test(txt))     mainEventIdx    = i;
    if (mainDeadlineIdx === -1 && _deadlineRe.test(txt))  mainDeadlineIdx = i;
    if (aiAltaIdx       === -1 && a.prioritat === 'alta') aiAltaIdx       = i;
  });

  /* Si cap keyword coincideix, permet 1 ALTA de la IA com a fallback */
  var altaFallback = (mainEventIdx === -1 && mainDeadlineIdx === -1) ? aiAltaIdx : -1;

  /* Primera passada: prioritat base */
  var result = accions.map(function (a, i) {
    var txt    = String(a.accio || '');
    var isPrep = _prepRe.test(txt);
    var hasDate = !!(a.data && String(a.data) !== 'null');
    var prioritat;

    if (i === mainEventIdx || i === mainDeadlineIdx || i === altaFallback) {
      prioritat = 'alta';
    } else if (isPrep || hasDate || a.prioritat === 'mitja') {
      prioritat = 'mitja';
    } else {
      prioritat = 'baixa';
    }

    return Object.assign({}, a, { prioritat: prioritat });
  });

  /* Segona passada: regla temporal — hora concreta dins 24h → +1 nivell (màx 2 ALTA total) */
  var altaCount = result.filter(function (a) { return a.prioritat === 'alta'; }).length;
  result = result.map(function (a) {
    if (!isWithin24h(a.data)) return a;
    if (a.prioritat === 'baixa') return Object.assign({}, a, { prioritat: 'mitja' });
    if (a.prioritat === 'mitja' && altaCount < 2) {
      altaCount++;
      return Object.assign({}, a, { prioritat: 'alta' });
    }
    return a;
  });

  return result;
}

/* ── CALENDAR PER ACTION ── */
function formatGCalDateTime(d) {
  var y  = d.getFullYear();
  var mo = String(d.getMonth() + 1).padStart(2, '0');
  var dy = String(d.getDate()).padStart(2, '0');
  var h  = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return '' + y + mo + dy + 'T' + h + mi + '00';
}

function addActionToCalendar(a) {
  var rawDate = String(a.data || '');
  if (!rawDate || rawDate === 'null') return;
  /* Suporta YYYY-MM-DD HH:MM i YYYY-MM-DDTHH:MM */
  var m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  var startStr, endStr;
  if (m) {
    var hasTime = m[4] && !(m[4] === '00' && m[5] === '00');
    if (hasTime) {
      var dt  = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
      var dt2 = new Date(dt.getTime() + 60 * 60 * 1000);
      startStr = formatGCalDateTime(dt);
      endStr   = formatGCalDateTime(dt2);
    } else {
      var d0 = new Date(+m[1], +m[2]-1, +m[3]);
      var d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
      startStr = toGCalDate(d0);
      endStr   = toGCalDate(d1);
    }
  } else {
    var pd  = parseDate(rawDate);
    var pd2 = new Date(pd); pd2.setDate(pd2.getDate() + 1);
    startStr = toGCalDate(pd);
    endStr   = toGCalDate(pd2);
  }
  var details = (_lastData && _lastData.resum ? '📌 ' + _lastData.resum + '\n\n' : '') + 'Generat per nexlupa';
  var calParams = { action: 'TEMPLATE', text: String(a.accio || ''), dates: startStr + '/' + endStr, details: details };
  if (a.lloc) calParams.location = a.lloc;
  var params  = new URLSearchParams(calParams);
  /* Anchor click evita que el popup blocker talli l'obertura */
  var url  = 'https://calendar.google.com/calendar/render?' + params.toString();
  var link = document.createElement('a');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ── RENDER PRINCIPAL ── */
function renderResult(d) {
  hideInputCard();
  _lastData = d;

  var decisio  = (d.decisio || '').trim();
  var noAction = decisio.toLowerCase() === 'cap acció necessària';
  var accions  = (d.accions || []).map(function(a) {
    if (typeof a === 'string') return { accio: a, tipus: 'tasca', data: null, prioritat: 'baixa', lloc: null };
    if (!a || typeof a !== 'object') return null;
    var txt = typeof a.accio === 'string' ? a.accio : String(a.accio || a.text || a.descripcio || '');
    return { accio: txt.trim(), tipus: a.tipus || 'tasca', data: a.data || null, prioritat: a.prioritat || 'baixa', lloc: a.lloc || null };
  }).filter(function(a) { return a && a.accio.length > 0; });
  accions = applyPriorityHeuristics(accions);

  /* DECISIÓ */
  var decisioEl    = document.getElementById('nx-decisio');
  var decisioLabel = document.getElementById('nx-decisio-label');
  if (decisioEl) {
    if (noAction) {
      decisioEl.innerHTML = '<span class="nx-check">✔</span> No has de fer res';
      decisioEl.className = 'nx-decisio-text nx-no-action';
      if (decisioLabel) decisioLabel.style.display = 'none';
    } else {
      decisioEl.textContent = decisio || d.resum || '';
      decisioEl.className   = 'nx-decisio-text';
      if (decisioLabel) decisioLabel.style.display = '';
    }
  }

  /* ACCIONS */
  var actionsEl = document.getElementById('nx-actions');
  if (actionsEl) {
    actionsEl.innerHTML = '';
    if (!noAction && accions.length > 0) {
      accions.forEach(function(a) {
        var icon    = a.tipus === 'calendari' ? '📅' : a.tipus === 'informatiu' ? 'ℹ️' : '✅';
        var fmtDate = formatActionDate(a.data);
        var prior   = a.prioritat || 'baixa';

        var card = document.createElement('div');
        card.className = 'nx-action-card nx-prior-' + prior;

        var top = document.createElement('div');
        top.className = 'nx-action-top';

        var iconEl = document.createElement('span');
        iconEl.className = 'nx-action-icon';
        iconEl.textContent = icon;

        var textEl = document.createElement('span');
        textEl.className = 'nx-action-text';
        textEl.textContent = String(a.accio);

        top.appendChild(iconEl);
        top.appendChild(textEl);

        if (prior === 'alta' || prior === 'mitja') {
          var pill = document.createElement('span');
          pill.className = 'nx-prior-pill nx-prior-pill-' + prior;
          pill.textContent = prior === 'alta' ? 'Alta' : 'Mitja';
          top.appendChild(pill);
        }

        card.appendChild(top);

        if (fmtDate) {
          var dateEl = document.createElement('div');
          dateEl.className = 'nx-action-date';
          dateEl.textContent = fmtDate;
          card.appendChild(dateEl);
        }

        if (a.lloc) {
          var llocEl = document.createElement('a');
          llocEl.className = 'nx-action-lloc';
          llocEl.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a.lloc);
          llocEl.target = '_blank';
          llocEl.rel = 'noopener noreferrer';
          llocEl.textContent = '📍 ' + a.lloc;
          card.appendChild(llocEl);
        }

        if (a.data && a.data !== 'null') {
          var calBtn = document.createElement('button');
          calBtn.className = 'nx-btn-cal';
          calBtn.textContent = '📅 Afegir al calendari';
          (function(action) { calBtn.onclick = function() { addActionToCalendar(action); }; }(a));
          card.appendChild(calBtn);
        }

        actionsEl.appendChild(card);
      });
    }
  }

  /* RESUM */
  var resumEl    = document.getElementById('nx-resum');
  var resumBlock = document.getElementById('nx-resum-block');
  if (resumEl) resumEl.textContent = d.resum || '';
  if (resumBlock) resumBlock.style.display = d.resum ? 'block' : 'none';

  /* legacy hidden els (calendar export, history) */
  var legResum = document.getElementById('resum');
  if (legResum) legResum.textContent = d.resum || '';
  var legDates = document.getElementById('dates');
  if (legDates) legDates.innerHTML = '';
  var legDatesCard = document.getElementById('datesCard');
  if (legDatesCard) legDatesCard.style.display = 'none';

  /* SHOW — amagar loader aquí evita el frame on coexisteixen */
  var loadEl = document.getElementById('loading');
  if (loadEl) loadEl.classList.remove('on');
  var res = document.getElementById('results');
  res.classList.add('on');
  var colEl = document.querySelector('#pageInici .app-col-right');
  if (colEl) colEl.scrollTop = 0;
  setTimeout(function() {
    if (colEl) colEl.scrollTop = 0;
    if (res) res.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, 80);

  saveToHistorial(Object.assign({}, d, { accions: accions }));
}

function render(d) {
  renderResult(d);
}

function reset() {
  showInputCard();
  var res = document.getElementById('results');
  var txt = document.getElementById('txt');
  var err = document.getElementById('errMsg');
  if (res) res.classList.remove('on');
  if (txt) txt.value = '';
  if (err) err.classList.remove('on');
  var colEl  = document.querySelector('#pageInici .app-col-right');
  var mainEl = document.querySelector('#pageApp main');
  if (colEl)  colEl.scrollTop  = 0;
  if (mainEl) mainEl.scrollTop = 0;
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
function tipusIcon(tipus) {
  return tipus === 'calendari' ? '📅' : tipus === 'informatiu' ? 'ℹ️' : '✅';
}

function buildShareText(d) {
  var lines = [];

  lines.push('✦ NexLupa');
  lines.push('');

  var decisio = (d.decisio || d.resum || '').trim();
  if (!decisio || decisio.toLowerCase() === 'cap acció necessària') {
    lines.push('No cal fer cap acció.');
  } else {
    lines.push(decisio);
  }

  /* Normalitzar accions i aplicar heurístiques */
  var rawAccions = (d.accions || []).map(function(a) {
    var isObj = typeof a === 'object' && a !== null;
    var text  = isObj
      ? (typeof a.accio === 'string' ? a.accio : String(a.accio || a.text || a.descripcio || ''))
      : String(a);
    text = text.trim();
    var data  = isObj ? (a.data || null) : null;
    var prior = isObj ? (a.prioritat || 'baixa') : 'baixa';
    return text ? { accio: text, data: data, prioritat: prior } : null;
  }).filter(Boolean);

  var accions = applyPriorityHeuristics(rawAccions).map(function(a) {
    return { text: a.accio, data: a.data };
  });

  /* Ordenar: primer les que tenen data */
  accions.sort(function(a, b) {
    if (a.data && !b.data) return -1;
    if (!a.data && b.data) return  1;
    return 0;
  });

  if (accions.length > 0) {
    lines.push('');
    lines.push('📌 Què cal fer:');
    accions.forEach(function(a, i) {
      if (i > 0) lines.push('');
      lines.push('→ ' + a.text);
      if (a.data && a.data !== 'null') {
        var fmtDate = formatActionDate(a.data);
        if (fmtDate) lines.push(fmtDate);
      }
    });
  }

  if (d.resum && d.resum !== decisio) {
    lines.push('');
    lines.push('Resum:');
    lines.push(d.resum);
  }

  lines.push('');
  lines.push('—');
  lines.push('Generat amb NexLupa');
  lines.push('De la informació a la decisió');
  lines.push('nexlupa.app');

  return lines.join('\n');
}

function buildSharePreviewHTML(d) {
  var decisio = d.decisio || '';
  var noAction = decisio === 'cap acció necessària' || (!decisio && (!d.accions || d.accions.length === 0));
  var html = '<div class="sc-brand">NexLupa ✦</div>';
  html += '<div class="sc-sep"></div>';

  if (noAction) {
    html += '<div class="sc-decisio sc-no-action">✔ Cap acció necessària</div>';
  } else {
    html += '<div class="sc-decisio">' + escHtml(decisio.toUpperCase()) + '</div>';
  }

  if (d.accions && d.accions.length > 0) {
    html += '<div class="sc-sep"></div><div class="sc-actions">';
    d.accions.forEach(function (a) {
      var isObj = typeof a === 'object' && a !== null;
      var text  = isObj ? a.accio : a;
      var tipus = isObj ? (a.tipus || 'tasca') : 'tasca';
      var data  = isObj ? a.data : null;
      html += '<div class="sc-act-row">';
      html += '<span class="sc-act-icon">' + tipusIcon(tipus) + '</span>';
      html += '<span class="sc-act-text">' + escHtml(text);
      if (data) html += '<span class="sc-act-date"> · ' + escHtml(data) + '</span>';
      html += '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="sc-sep"></div>';
  if (d.resum) html += '<div class="sc-resum">' + escHtml(d.resum) + '</div>';
  html += '<div class="sc-footer">Generat amb NexLupa · nexlupa.app</div>';
  return html;
}

function buildShareURL(d) {
  var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  return window.location.href.split('?')[0] + '?r=' + encoded;
}

function shareWhatsApp() {
  if (!_lastData) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(buildShareText(_lastData)), '_blank');
}

function copyCardText() {
  if (!_lastData) return;
  var text = buildShareText(_lastData);
  navigator.clipboard.writeText(text).then(function () {
    var btn = document.getElementById('btnCopy');
    var ok  = document.getElementById('copyOk');
    if (btn) { btn.classList.add('copied'); btn.innerHTML = '<span>✓</span> Copiat!'; }
    if (ok)  ok.classList.add('on');
    setTimeout(function () {
      if (btn) { btn.classList.remove('copied'); btn.textContent = '📋 Copiar'; }
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
var _allTasques = (function() {
  var raw = JSON.parse(localStorage.getItem('nxl_tasks') || '[]');
  /* Dedup legacy tasks and ensure isNew/prioritat fields */
  var seen = {};
  return raw.filter(function(t) {
    var key = String(t.text || '').trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    if (!t.prioritat) t.prioritat = 'baixa';
    return true;
  });
}());
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
  else if (page === 'historial') { document.getElementById('pageHistorial').style.display = 'block'; renderHistory(); }
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

/* Retorna una còpia de l'historial ordenada del més nou al més antic */
function getHistory() {
  return _historial.slice().reverse();
}

function _accionText(a) {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') return String(a.accio || a.text || '');
  return String(a || '');
}

function saveToHistorial(d) {
  /* Nova anàlisi → les tasques anteriors "noves" passen a "pendents" */
  _allTasques.forEach(function (t) {
    if (t.isNew && !t.done) t.isNew = false;
  });

  var now     = new Date();
  var dateStr = now.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })
              + ' · '
              + now.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
  var cleanAccions = (d.accions || []).filter(function(a) { return !!_accionText(a); });
  var cleanDates   = (d.dates   || []).filter(function(dt) { return dt && String(dt.descripcio || dt.text || '').trim(); });

  var entry = {
    id:            Date.now(),
    timestamp:     now.toISOString(),
    date:          dateStr,
    resum:         d.resum         || '',
    urgent:        d.urgent        || '',
    urgencia:      d.urgencia      || 0,
    urgencia_text: d.urgencia_text || '',
    accions:       cleanAccions,
    dates:         cleanDates
  };
  _historial.push(entry);
  if (_historial.length > 30) _historial.shift();
  localStorage.setItem('nxl_hist', JSON.stringify(_historial));

  var src = (d.resum || '').substring(0, 40) + '...';
  (d.accions || []).forEach(function (a) {
    var txt = _accionText(a);
    if (!txt) return;
    var prior = (a && typeof a === 'object') ? (a.prioritat || 'baixa') : 'baixa';
    var existingIdx = -1;
    for (var ei = 0; ei < _allTasques.length; ei++) {
      if (_allTasques[ei].text.trim().toLowerCase() === txt.trim().toLowerCase()) {
        existingIdx = ei; break;
      }
    }
    if (existingIdx >= 0) {
      if (!_allTasques[existingIdx].done) {
        _allTasques[existingIdx].isNew    = true;
        _allTasques[existingIdx].prioritat = prior;
        _allTasques[existingIdx].src      = src;
      }
    } else {
      _allTasques.push({ text: txt, src: src, done: false, id: Date.now() + Math.random(), isNew: true, prioritat: prior });
    }
  });
  localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
  updateBadges();
  renderHistory();
}

function renderHistory(query) {
  var el = document.getElementById('historyList');
  if (!el) return;

  var all = getHistory(); // newest first

  /* Filtre de cerca */
  var q = (query || '').toLowerCase().trim();
  var items = q ? all.filter(function (item) {
    var text = [
      item.resum || '',
      (item.accions || []).map(_accionText).join(' '),
      (item.dates   || []).map(function (d) { return d.descripcio || ''; }).join(' ')
    ].join(' ').toLowerCase();
    return text.includes(q);
  }) : all;

  /* Sense resultats */
  if (items.length === 0) {
    el.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:24px 0;">' +
      (q ? 'No s\'ha trobat cap anàlisi.' : 'Encara no hi ha anàlisis guardades.') + '</p>';
    return;
  }

  el.innerHTML = '';
  items.forEach(function (item) {
    var div = document.createElement('div');
    div.className = 'hist-item';
    var numAccions = item.accions ? item.accions.length : 0;
    var numDates   = item.dates   ? item.dates.length   : 0;
    var metaParts  = [escHtml(item.date)];
    if (numAccions > 0) metaParts.push(numAccions + ' accions');
    if (numDates   > 0) metaParts.push(numDates   + ' dates');
    div.innerHTML =
      '<div class="hist-title">' + escHtml(item.resum) + '</div>' +
      '<div class="hist-meta">' + metaParts.join(' &nbsp;·&nbsp; ') + '</div>';
    div.onclick = function () { render(item); navTo('inici'); };
    el.appendChild(div);
  });
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
    var numAccions = item.accions ? item.accions.length : 0;
    var numDates   = item.dates   ? item.dates.length   : 0;
    var metaParts  = [escHtml(item.date)];
    if (numAccions > 0) metaParts.push(numAccions + ' accions');
    if (numDates   > 0) metaParts.push(numDates   + ' dates');
    div.innerHTML =
      '<div class="hist-title">' + escHtml(item.resum) + '</div>' +
      '<div class="hist-meta">' + metaParts.join(' · ') + '</div>';
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

  var priorOrder = { alta: 0, mitja: 1, baixa: 2 };
  var sorted = _allTasques.slice().sort(function(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done && !b.done) {
      if (!!a.isNew !== !!b.isNew) return a.isNew ? -1 : 1;
      var pa = priorOrder[a.prioritat] !== undefined ? priorOrder[a.prioritat] : 2;
      var pb = priorOrder[b.prioritat] !== undefined ? priorOrder[b.prioritat] : 2;
      return pa - pb;
    }
    return 0;
  });

  el.innerHTML = '';
  var _sections = [
    { key: 'new',     items: sorted.filter(function(t){ return !t.done && t.isNew; }),  label: 'Noves'     },
    { key: 'pending', items: sorted.filter(function(t){ return !t.done && !t.isNew; }), label: 'Pendents'  },
    { key: 'done',    items: sorted.filter(function(t){ return t.done; }),              label: 'Completades'}
  ];
  _sections.forEach(function(sec) {
    if (sec.items.length === 0) return;
    var sep = document.createElement('div');
    sep.className = 'tsk-section-sep';
    sep.textContent = sec.label;
    el.appendChild(sep);
    sec.items.forEach(function (t) {
      var realIdx = _allTasques.indexOf(t);
      var div = document.createElement('div');
      var stateClass = t.done ? ' done' : (t.isNew ? ' tsk-new' : ' tsk-pending');
      div.className = 'tsk-item' + stateClass;

      var chkEl = document.createElement('div');
      chkEl.className = 'tsk-chk';
      if (t.done) chkEl.classList.add('tsk-chk-done');
      if (t.done) chkEl.innerHTML = '✓';

      (function (idx) {
        chkEl.onclick = function () {
          _allTasques[idx].done  = !_allTasques[idx].done;
          _allTasques[idx].isNew = false;
          localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
          updateBadges();
          renderTasques();
        };
      }(realIdx));

      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      var prior = !t.done ? (t.prioritat || 'baixa') : '';
      var priorClass = prior ? 'tsk-prior-' + prior : '';
      var isDark = document.body.classList.contains('dark');
      var priorColor = '';
      if (prior === 'alta')  priorColor = isDark ? '#f87171' : '#e53935';
      else if (prior === 'mitja') priorColor = isDark ? '#f5b400' : '#c07000';
      else if (prior === 'baixa') priorColor = isDark ? '#e0e0e0' : '#2e2e2e';
      var priorStyle = priorColor ? ' style="color:' + priorColor + '"' : '';
      var nouBadge = (t.isNew && !t.done) ? '<span class="tsk-badge-nou">NOU</span>' : '';
      info.innerHTML =
        '<div class="tsk-title ' + priorClass + '"' + priorStyle + '>' + nouBadge + escHtml(t.text) + '</div>' +
        '<div class="tsk-src">' + escHtml(t.src) + '</div>';

      div.appendChild(chkEl);
      div.appendChild(info);
      el.appendChild(div);
    });
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
  renderHistory();
}

function clearTasques() {
  if (!confirm('Esborrar totes les tasques completades?')) return;
  _allTasques = _allTasques.filter(function (t) { return !t.done; });
  localStorage.setItem('nxl_tasks', JSON.stringify(_allTasques));
  updateBadges();
  renderTasques();
}

/* ── UTILITY ── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
