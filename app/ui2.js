/* NexLupa UI 2.0 — comportament visual (vídeo V9f com a referència).
 * Principi: NO toca script.js ni el motor QA96. Només observa el DOM que ja genera
 * l'aplicació i hi aplica icones, comptadors i l'animació corporativa (lupa + X).
 * Si aquest fitxer falla o no es carrega, l'aplicació funciona exactament igual. */
(function () {
  'use strict';
  var doc = document;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- icones (mateixos traços que al vídeo) ---------- */
  var P = {
    lupa: '<circle cx="27" cy="27" r="17"/><path d="M40 40L57 57" stroke-width="5.7"/>',
    sign: '<path d="M12 6h18l8 8v28H12z" stroke-linejoin="round"/><path d="M30 6v8h8"/><path d="M18 30l5 5 9-11" stroke-linecap="round" stroke-linejoin="round"/>',
    pay: '<rect x="5" y="12" width="38" height="26" rx="5"/><path d="M5 20h38M12 31h9" stroke-linecap="round"/>',
    bag: '<path d="M14 18a10 10 0 0 1 20 0v22a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" stroke-linejoin="round"/><path d="M20 9V6h8v3M18 31h12" stroke-linecap="round"/>',
    alert: '<path d="M24 6L44 40H4z" stroke-linejoin="round"/><path d="M24 18v10M24 33.5v.5" stroke-linecap="round"/>',
    clock: '<circle cx="24" cy="24" r="18"/><path d="M24 13v12l8 5" stroke-linecap="round" stroke-linejoin="round"/>',
    school: '<path d="M4 18L24 8l20 10-20 10z" stroke-linejoin="round"/><path d="M12 24v10c6 6 18 6 24 0V24"/>',
    cal: '<rect x="6" y="9" width="36" height="33" rx="6"/><path d="M6 20h36M16 5v8M32 5v8" stroke-linecap="round"/>',
    pin: '<path d="M24 45C14 31 10 25 10 18a14 14 0 0 1 28 0c0 7-4 13-14 27z" stroke-linejoin="round"/><circle cx="24" cy="18" r="5"/>',
    home: '<path d="M6 22L24 7l18 15v19a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" stroke-linejoin="round"/><path d="M19 44V30h10v14" stroke-linejoin="round"/>',
    tasks: '<rect x="8" y="6" width="32" height="38" rx="5"/><path d="M15 18l4 4 8-8M15 32h18" stroke-linecap="round" stroke-linejoin="round"/>',
    gear: '<circle cx="24" cy="24" r="7"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M9.9 9.9l5 5M33.1 33.1l5 5M9.9 38.1l5-5M33.1 14.9l5-5" stroke-linecap="round"/>',
    ticket: '<path d="M5 14h38v7a3 3 0 0 0 0 6v7H5v-7a3 3 0 0 0 0-6z" stroke-linejoin="round"/><path d="M30 14v20" stroke-dasharray="3 3"/>',
    mail: '<rect x="4" y="10" width="40" height="28" rx="5"/><path d="M6 13l18 14 18-14" stroke-linejoin="round"/>',
    check: '<path d="M10 25l9 9 19-21" stroke-linecap="round" stroke-linejoin="round"/>',
    info: '<circle cx="24" cy="24" r="18"/><path d="M24 21v12M24 14.5v.5" stroke-linecap="round"/>'
  };
  function ico(name, size, sw) {
    var vb = name === 'lupa' ? '0 0 64 64' : '0 0 48 48';
    return '<svg width="' + size + '" height="' + size + '" viewBox="' + vb + '" fill="none" stroke="currentColor" stroke-width="' + (sw || 3.2) + '" aria-hidden="true">' + P[name] + '</svg>';
  }
  /* tria d'icona per contingut del text (només visual) */
  var RULES = [
    [/autoritzaci|signa|firma|formulari|document/i, 'sign'],
    [/pag(a|ar|ament)|€|euros?\b|import|quota|rebut/i, 'pay'],
    [/al·l[eè]rg|alergi|avis(ar|eu)|confirma/i, 'alert'],
    [/esmorzar|dinar|aigua|roba|motxilla|portar|material|preparar/i, 'bag'],
    [/\b\d{1,2}[:.]\d{2}\b|\bh\b|hora|autocar|puntual/i, 'clock'],
    [/classe|escola|curs|tutor/i, 'school'],
    [/correu|email|gmail/i, 'mail'],
    [/entrada|ticket|bitllet|reserva/i, 'ticket']
  ];
  function pick(text, fallback) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(text)) return RULES[i][1];
    return fallback;
  }

  function decorateCards(root) {
    var cards = root.querySelectorAll('.nx-p1-card, .nx-p2-card, .nx-info-card');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], iconEl = c.querySelector('.nx-card-icon');
      if (!iconEl || iconEl.classList.contains('ui2-ico')) continue;
      var t = (c.querySelector('.nx-card-text') || c).textContent || '';
      var info = c.classList.contains('nx-info-card');
      iconEl.setAttribute('data-ui2-orig', iconEl.textContent);
      iconEl.classList.add('ui2-ico');
      iconEl.innerHTML = ico(pick(t, info ? 'info' : 'check'), 24, 3.4);
    }
  }

  /* comptadors: compten totes les targetes de cada prioritat (visibles + plegades) */
  function updateCounts() {
    var res = doc.getElementById('results'); if (!res) return;
    var map = [
      ['#nx-p1-block .nx-section-label', '.nx-p1-card'],
      ['#nx-p2-block .nx-section-label', '.nx-p2-card'],
      ['#nx-info-block .nx-section-label', '.nx-info-card']
    ];
    map.forEach(function (m) {
      var label = doc.querySelector(m[0]); if (!label) return;
      var n = res.querySelectorAll(m[1]).length;
      if (m[1] === '.nx-info-card') n = res.querySelectorAll('#nx-info-content .nx-info-card, #nx-more-actions-content .nx-info-card').length;
      if (n > 0) label.setAttribute('data-ui2-count', String(n)); else label.removeAttribute('data-ui2-count');
    });
  }

  /* xips i botons: l'emoji inicial es substitueix per la icona lineal del vídeo (el text no canvia) */
  var EMO = [['📅', 'cal'], ['🕒', 'clock'], ['📍', 'pin'], ['⏳', 'clock'], ['👥', 'school'], ['🗺️', 'pin'], ['🗺', 'pin'], ['💰', 'pay'], ['⚠️', 'alert'], ['🏫', 'school']];
  function decorateChips(root) {
    var els = root.querySelectorAll('.nx-event-chip, .nx-event-btn, .nx-what-detail-chip, .nx-btn-cal');
    for (var i = 0; i < els.length; i++) {
      var e = els[i]; if (e.getAttribute('data-ui2')) continue;
      var t = e.textContent;
      for (var k = 0; k < EMO.length; k++) {
        if (t.indexOf(EMO[k][0]) === 0) {
          var rest = t.slice(EMO[k][0].length).replace(/^\uFE0F/, '').trim();
          e.setAttribute('data-ui2', '1'); e.setAttribute('data-ui2-orig', t);
          e.innerHTML = '<span class="ui2-chip-ico">' + ico(EMO[k][1], 15, 3.6) + '</span>' + esc(rest);
          break;
        }
      }
    }
    var lab = doc.getElementById('nx-decisio-label');
    if (lab && !lab.getAttribute('data-ui2')) { lab.setAttribute('data-ui2', '1'); lab.textContent = lab.textContent.replace(/^[^A-Za-zÀ-ÿ]+/, ''); }
  }

  function decorateDecision() {
    var blk = doc.querySelector('.nx-decisio-block');
    if (!blk || blk.querySelector('.ui2-done-pill')) return;
    var pill = doc.createElement('div');
    pill.className = 'ui2-done-pill';
    pill.innerHTML = ico('check', 14, 4.5) + '<span>Anàlisi completada</span>';
    blk.insertBefore(pill, blk.firstChild);
  }

  /* ---------- navegació inferior: icones lineals ---------- */
  function decorateNav() {
    var map = { navInici: 'home', navTasques: 'tasks', navHistorial: 'clock', navConfig: 'gear' };
    Object.keys(map).forEach(function (id) {
      var b = doc.getElementById(id); if (!b) return;
      var s = b.querySelector('span'); if (!s || s.classList.contains('ui2-nav-ico')) return;
      s.classList.add('ui2-nav-ico'); s.setAttribute('data-ui2-orig', s.textContent); s.innerHTML = ico(map[id], 22, 3.2);
    });
  }

  /* ---------- animació corporativa: escaneig amb la lupa i explosió a la X ---------- */
  var scan = null, scanStart = 0, scanTimer = null, finishing = false;
  var MIN_SCAN = 1700;   /* durada mínima perquè l'animació es llegeixi, encara que l'API respongui de pressa */
  var XFX = 2026 / 5630, XFY = 472 / 1020;   /* centre del rombe daurat de la X al logotip oficial */

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* ressalta els fragments amb dades rellevants (dates, hores, imports, terminis) */
  var HL = /(\b(?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)(?:\s+\d{1,2}(?:\s+de\s+[a-zç]+)?)?\b|\babans\s+del?\s+(?:(?:dia|dilluns|dimarts|dimecres|dijous|divendres)\s+)?\d{1,2}(?:\s+de\s+[a-zç]+)?\b|\b\d{1,2}\s+de\s+(?:gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)\b|\b\d{1,2}[.:]\d{2}(?:\s*h\b)?|\b\d+(?:[.,]\d+)?\s*€|\bautoritzaci[oó](?:\s+signada)?\b|\bal·l[eè]rgi[a-z]*|\bpagament\b)/gi;
  function buildText() {
    var raw = (doc.getElementById('txt') || {}).value || '';
    if (!raw.trim()) raw = 'Analitzant la imatge…';
    raw = raw.trim().slice(0, 900);
    var out = '', last = 0, m, n = 0; HL.lastIndex = 0;
    while ((m = HL.exec(raw)) && n < 14) { out += esc(raw.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; n++; }
    return out + esc(raw.slice(last));
  }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  function startScan() {
    if (scan || !doc.body.classList.contains('ui2')) return;
    finishing = false;
    scan = el('div', 'ui2-scan'); scan.setAttribute('aria-hidden', 'true');
    scan.appendChild(el('div', 'ui2-scan-bg'));
    var card = el('div', 'ui2-scan-card', buildText()); scan.appendChild(card);
    var lupa = el('img', 'ui2-lupa'); lupa.src = 'assets/ui2-lupa.png'; lupa.alt = ''; scan.appendChild(lupa);
    scan.appendChild(el('div', 'ui2-status', 'La lupa està treballant per tu…'));
    var logo = el('img', 'ui2-logo'); logo.src = 'assets/ui2-logo.png'; logo.alt = ''; scan.appendChild(logo);
    scan.appendChild(el('div', 'ui2-flash')); scan.appendChild(el('div', 'ui2-ring')); scan.appendChild(el('div', 'ui2-ring r2')); scan.appendChild(el('div', 'ui2-core'));
    doc.body.appendChild(scan);
    scanStart = Date.now();
    requestAnimationFrame(function () { scan && scan.classList.add('on'); });
    var marks = card.querySelectorAll('mark'), i = 0;
    function step() {
      if (!scan || finishing) return;
      var cr = card.getBoundingClientRect(), sr = scan.getBoundingClientRect();
      var target = marks.length ? marks[i % marks.length] : null, x, y;
      if (target) {
        var r = target.getBoundingClientRect();
        if (r.bottom > cr.bottom - 10) { card.scrollTop += r.top - cr.top - 40; r = target.getBoundingClientRect(); }
        x = r.left + r.width / 2; y = r.top + r.height / 2; target.classList.add('lit');
      } else { x = cr.left + cr.width * (0.25 + 0.5 * Math.random()); y = cr.top + cr.height * (0.2 + 0.6 * Math.random()); }
      /* centre de la lent ≈ (40%, 40%) de la imatge */
      lupa.style.transform = 'translate(' + (x - sr.left - 34) + 'px,' + (y - sr.top - 32) + 'px)';
      i++;
      if (marks.length && i % marks.length === 0) { for (var k = 0; k < marks.length; k++) marks[k].classList.remove('lit'); card.scrollTop = 0; }
      scanTimer = setTimeout(step, REDUCED ? 600 : 330);
    }
    setTimeout(step, 120);
  }

  function finishScan(success) {
    if (!scan || finishing) return;
    finishing = true;
    var wait = Math.max(0, MIN_SCAN - (Date.now() - scanStart));
    setTimeout(function () {
      clearTimeout(scanTimer);
      var s = scan; if (!s) return;
      var res = doc.getElementById('results');
      if (!success || REDUCED) { end(s, res, success); return; }
      s.classList.add('fading');                           /* l'ombrejat daurat s'esvaeix */
      var logo = s.querySelector('.ui2-logo');
      s.classList.add('converge');                         /* apareix el logotip oficial */
      setTimeout(function () {
        var lr = logo.getBoundingClientRect(), sr = s.getBoundingClientRect();
        var xc = lr.left - sr.left + lr.width * XFX, yc = lr.top - sr.top + lr.height * XFY;
        /* l'energia de les frases convergeix a la X */
        var marks = s.querySelectorAll('mark'), sparks = [];
        for (var k = 0; k < Math.min(18, Math.max(8, marks.length * 2)); k++) {
          var m = marks.length ? marks[k % marks.length].getBoundingClientRect() : { left: sr.width * Math.random(), top: sr.height * Math.random(), width: 0, height: 0 };
          var sp = el('div', 'ui2-spark'); s.appendChild(sp);
          var x0 = m.left - sr.left + m.width * ((k * 0.37) % 1), y0 = m.top - sr.top + m.height / 2;
          sp.style.transform = 'translate(' + x0 + 'px,' + y0 + 'px)'; sparks.push([sp, x0, y0]);
        }
        requestAnimationFrame(function () {
          sparks.forEach(function (a, k) {
            a[0].style.transition = 'transform .62s cubic-bezier(.5,0,.75,0) ' + (k * 0.012) + 's, opacity .2s';
            a[0].style.opacity = 1; a[0].style.transform = 'translate(' + (xc - 3) + 'px,' + (yc - 3) + 'px) scale(.6)';
          });
        });
        var core = s.querySelector('.ui2-core'), flash = s.querySelector('.ui2-flash'), rings = s.querySelectorAll('.ui2-ring');
        [core, flash, rings[0], rings[1]].forEach(function (e) { e.style.left = xc + 'px'; e.style.top = yc + 'px'; });
        core.style.transition = 'opacity .35s, transform .35s'; setTimeout(function () { core.style.opacity = 1; core.style.transform = 'scale(2.2)'; }, 380);
        setTimeout(function () {                            /* explosió elegant a la X */
          sparks.forEach(function (a) { a[0].remove(); });
          core.style.opacity = 0;
          s.classList.add('burst');
          for (var q = 0; q < 26; q++) {
            var p = el('div', 'ui2-spark'); s.appendChild(p);
            var ang = q / 26 * 6.283 + (q % 3) * .3, d = 90 + (q * 37 % 9) * 22;
            p.style.transform = 'translate(' + (xc - 3) + 'px,' + (yc - 3) + 'px)'; p.style.opacity = 1;
            (function (p, ang, d) { requestAnimationFrame(function () { p.style.transition = 'transform .8s cubic-bezier(.1,.7,.2,1), opacity .8s ease'; p.style.transform = 'translate(' + (xc - 3 + Math.cos(ang) * d) + 'px,' + (yc - 3 + Math.sin(ang) * d * .85 + 30) + 'px) scale(.4)'; p.style.opacity = 0; }); })(p, ang, d);
          }
          setTimeout(function () { end(s, res, true); }, 380);
        }, 700);
      }, 380);
    }, wait);
  }
  function end(s, res, success) {
    if (res && success) { res.classList.remove('ui2-emerge'); void res.offsetWidth; res.classList.add('ui2-emerge'); }
    s.classList.add('out');
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); if (scan === s) scan = null; finishing = false; }, 480);
  }

  /* ---------- observadors (no modifiquen la lògica existent) ---------- */
  function onResults() {
    var res = doc.getElementById('results'); if (!res) return;
    decorateDecision(); decorateCards(res); decorateChips(res); updateCounts();
  }
  function init() {
    doc.body.classList.add('ui2');
    decorateNav();
    var load = doc.getElementById('loading'), res = doc.getElementById('results');
    if (load) new MutationObserver(function () {
      if (load.classList.contains('on')) startScan();
      else if (scan && !(res && res.classList.contains('on'))) setTimeout(function () { if (scan && !(res && res.classList.contains('on'))) finishScan(false); }, 60);
    }).observe(load, { attributes: true, attributeFilter: ['class'] });
    if (res) {
      new MutationObserver(function () { if (res.classList.contains('on')) { onResults(); if (scan) finishScan(true); } })
        .observe(res, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(function () { onResults(); }).observe(res, { childList: true, subtree: true });
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  window.NexLupaUI2 = { version: '2.0.0', icon: ico };
})();
