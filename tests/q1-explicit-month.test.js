'use strict';
// Q1 · Cas «7 de novembre» que es mostrava com «7 de desembre / Falten 12 dies» (prova en Android real, 25/11/2026).
// El text original de la Marxeta no és al repositori: aquest cas reprodueix el patró amb un text neutre.
// Marcat com a «todo» fins que s'aprovi el canvi al motor (lib/nexlupa-result.js); llavors s'ha de treure el todo.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeAnalysis } = require('../lib/nexlupa-result');

const REF = '2026-11-25';
const SRC = 'Bon dia! El proper dissabte 7 de novembre fem la marxa popular. Sortida a les 10:00 des de la plaça.';
const MODEL = {
  resum: 'Marxa popular el 7 de desembre a les 10:00.', decisio: 'Cap acció necessària',
  accions: [], recordatoris: [{ text: 'Marxa popular', data: '2026-12-07' }],
  esdeveniments: [{ title: 'Marxa popular', data: '2026-12-07 10:00', lloc: 'plaça' }]
};

test('Q1: el mes explícit del missatge no es pot canviar (7 de novembre ≠ 7 de desembre)', { todo: 'pendent d’aprovar el canvi al motor' }, () => {
  const r = normalizeAnalysis(JSON.parse(JSON.stringify(MODEL)), SRC, REF);
  const ev = r.esdeveniments[0];
  assert.strictEqual(ev.data.slice(0, 10), '2026-11-07', 'calendari');
  assert.ok(ev.passada, 'una data passada es marca per confirmar, no es mou al futur');
  assert.ok(!/desembre/.test(r.resum), 'resum coherent amb l’original');
  assert.strictEqual((r.recordatoris[0].data || '').slice(0, 10), '2026-11-07', 'Pròximament');
  assert.ok(r.revisioDates.requereixRevisio, 'exportació bloquejada fins a confirmar');
});

test('Q1: una data que coincideix amb el mes explícit no es toca', () => {
  const ok = JSON.parse(JSON.stringify(MODEL));
  ok.esdeveniments[0].data = '2026-11-07 10:00'; ok.recordatoris[0].data = '2026-11-07'; ok.resum = 'Marxa popular el 7 de novembre.';
  const r = normalizeAnalysis(ok, SRC, REF);
  assert.strictEqual(r.esdeveniments[0].data.slice(0, 10), '2026-11-07');
});
