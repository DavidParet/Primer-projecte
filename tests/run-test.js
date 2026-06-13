'use strict';
/**
 * Test reproduïble del motor de prioritats.
 * Extreu la lògica de app/script.js per confirmar que el fallback funciona.
 * JSON d'entrada: tests/test-event.json (cas de la Festa del Bàsquet)
 */

const fs   = require('fs');
const path = require('path');

// ── JSON D'ENTRADA ──────────────────────────────────────────────────────────
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-event.json'), 'utf8'));
console.log('\n══ JSON D\'ENTRADA ══════════════════════════════════════');
console.log(JSON.stringify(d, null, 2));

// ── LÒGICA EXTRETA DE app/script.js (renderResult) ─────────────────────────

function normalizeAccions(raw) {
  return (raw || []).map(function(a) {
    if (!a || typeof a !== 'object') return null;
    var txt = typeof a.accio === 'string' ? a.accio : String(a.accio || '');
    return {
      accio:    txt.trim(),
      tipus:    a.tipus || 'tasca',
      data:     a.data  || null,
      prioritat:(a.prioritat || 'baixa').toLowerCase(),
      lloc:     a.lloc  || null
    };
  }).filter(function(a) { return a && a.accio.length > 0; });
}

var _evtKeyRe2 = /\b(festa|jornada|torneig|reuni[oó]|sortida|acte|festival|excursi[oó]|espectacle)\b/i;

function extractMainEventAndFilter(mainEvent, accions) {
  var srcIdx = -1;
  if (!mainEvent) {
    for (var i = 0; i < accions.length; i++) {
      if (accions[i].tipus === 'calendari') {
        mainEvent = { title: accions[i].accio, data: accions[i].data, lloc: accions[i].lloc };
        srcIdx = i; break;
      }
    }
  }
  if (!mainEvent) {
    for (var j = 0; j < accions.length; j++) {
      var a = accions[j];
      if (a.data && (a.lloc || _evtKeyRe2.test(a.accio || ''))) {
        mainEvent = { title: a.accio, data: a.data, lloc: a.lloc };
        srcIdx = j; break;
      }
    }
  }
  if (srcIdx !== -1) {
    accions = accions.filter(function(_, idx) { return idx !== srcIdx; });
  }
  return { mainEvent: mainEvent, accions: accions };
}

function categorizeAccions(accions) {
  var p1 = [], p2 = [], info = [];
  accions.forEach(function(a) {
    if (a.tipus === 'calendari') return;
    if (/^(assistir|participar|anar\s+a|acudir)\b/i.test(a.accio)) return;
    if (a.prioritat === 'alta')       p1.push(a);
    else if (a.prioritat === 'mitja') p2.push(a);
    else                              info.push(a);
  });
  return { p1: p1, p2: p2, info: info };
}

// ── EXECUCIÓ ────────────────────────────────────────────────────────────────
var accions = normalizeAccions(d.accions);
var result  = extractMainEventAndFilter(d.mainEvent, accions);
var cats    = categorizeAccions(result.accions);

// ── JSON NORMALITZAT ────────────────────────────────────────────────────────
console.log('\n══ JSON NORMALITZAT (accions filtrades) ════════════════');
console.log('mainEvent:', JSON.stringify(result.mainEvent, null, 2));
console.log('accions restants:', JSON.stringify(result.accions, null, 2));

// ── RESULTAT RENDERITZAT ────────────────────────────────────────────────────
console.log('\n══ RESULTAT RENDERITZAT ════════════════════════════════');
if (result.mainEvent) {
  console.log('  ┌─ [CARD ESDEVENIMENT PRINCIPAL] ─────────────────────');
  console.log('  │  Nom:  ' + result.mainEvent.title);
  console.log('  │  Data: ' + (result.mainEvent.data || '—'));
  console.log('  │  Lloc: ' + (result.mainEvent.lloc || '—'));
  console.log('  └──────────────────────────────────────────────────────');
} else {
  console.log('  [NO EVENT CARD] ← ❌ PROBLEMA');
}
cats.p1.forEach(function(a)   { console.log('  [ALTA]  ✅ ' + a.accio); });
cats.p2.forEach(function(a)   { console.log('  [MITJA] ⚠️  ' + a.accio + '  ← ❌ NO HAURIA SER AQUÍ'); });
cats.info.forEach(function(a) { console.log('  [INFO]  ℹ️  ' + a.accio); });

// ── VEREDICTE ───────────────────────────────────────────────────────────────
console.log('\n══ VEREDICTE ═══════════════════════════════════════════');
var ok_event = result.mainEvent !== null;
var ok_p2    = cats.p2.length === 0;
var ok_p2_no_bàsquet = !cats.p2.some(function(a) {
  return /bàsquet|basquet|festa|jornada|torneig/i.test(a.accio);
});

console.log('mainEvent detectat:           ' + (ok_event ? '✅' : '❌'));
console.log('P2 buit (sense event):        ' + (ok_p2    ? '✅' : '❌'));
console.log('Cap event a P2:               ' + (ok_p2_no_bàsquet ? '✅' : '❌'));

var passed = ok_event && ok_p2 && ok_p2_no_bàsquet;
console.log('\nRESULTAT FINAL: ' + (passed ? '✅ TEST PASSAT' : '❌ TEST FALLIT'));
console.log('════════════════════════════════════════════════════════\n');
process.exit(passed ? 0 : 1);
