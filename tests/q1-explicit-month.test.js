'use strict';
// Q1 · Cas «7 de novembre» que es mostrava com «7 de desembre / Falten 12 dies» (prova en Android real, 25/11/2026).
// El text original de la Marxeta no és al repositori: aquest cas reprodueix el patró amb un text neutre.
// Correcció aprovada el 25/11/2026.
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

test('Q1: el mes explícit del missatge no es pot canviar (7 de novembre ≠ 7 de desembre)', () => {
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

// Cas Marxeta amb les dades visibles a les captures del mòbil (el text complet original no és al repositori).
const MARXETA = 'La 6a Marxeta Infantil de la UME tindrà lloc el proper 7 de novembre, amb sortida des de la plaça Jaume Balmes. ' +
  'Per a infants de 3 a 13 anys. Inscripció: 3 euros.';
const MARXETA_MODEL = {
  resum: 'La 6a Marxeta Infantil de la UME tindrà lloc el 7 de desembre amb sortida des de la plaça Jaume Balmes.',
  decisio: 'Cap acció necessària', accions: [],
  recordatoris: [{ text: 'La 6a Marxeta Infantil de la UME serà el 7 de desembre amb sortida des de la plaça Jaume Balmes.', data: '2026-12-07' }],
  esdeveniments: [{ title: '6a Marxeta Infantil de la UME', data: '2026-12-07', lloc: 'plaça Jaume Balmes', edat: '3 a 13 anys' }]
};

test('Q1 Marxeta: calendari, resum, Pròximament i exportació coherents amb «7 de novembre»', () => {
  const r = normalizeAnalysis(JSON.parse(JSON.stringify(MARXETA_MODEL)), MARXETA, REF);
  const ev = r.esdeveniments[0];
  assert.strictEqual(ev.data, '2026-11-07');
  assert.ok(ev.passada, 'ja ha passat: es marca, no es converteix en futura');
  assert.ok(!/desembre/.test(r.resum) && /7 de novembre/.test(r.resum));
  assert.strictEqual(r.recordatoris[0].data, '2026-11-07');
  assert.ok(!/desembre/.test(r.recordatoris[0].text));
  assert.ok(r.revisioDates.requereixRevisio, 'el client bloqueja l’exportació automàtica');
  assert.ok(/novembre|07\/11/.test(r.avisDates));
});

test('Q1 Marxeta: l’API no demana al model «corregir» una data explícita passada', async () => {
  const Module = require('module');
  const calls = [];
  const reply = { resum: 'La 6a Marxeta Infantil de la UME el 7 de novembre.', decisio: 'Cap acció necessària', accions: [], recordatoris: [],
    esdeveniments: [{ title: '6a Marxeta Infantil de la UME', data: '2026-11-07', lloc: 'plaça Jaume Balmes' }] };
  const fake = function () { return { chat: { completions: { create: async (o) => { calls.push(o); return { choices: [{ message: { content: JSON.stringify(calls.length > 1 ? { ...reply, esdeveniments: [{ ...reply.esdeveniments[0], data: '2026-12-07' }] } : reply) } }] }; } } } }; };
  const origLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'openai' ? fake : origLoad.call(this, req, ...rest); };
  const path = require.resolve('../api/analyze');
  delete require.cache[path];
  const prevEnv = { ...process.env };
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'fix/qa96-deterministic-dates-20261112';
  try {
    const handler = require(path);
    let body = null;
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { body = b; return this; } };
    await handler({ method: 'POST', headers: {}, body: { text: MARXETA, testReferenceDate: REF } }, res);
    assert.strictEqual(calls.length, 1, 'cap reconsulta');
    assert.strictEqual(body.esdeveniments[0].data, '2026-11-07');
    assert.ok(body.esdeveniments[0].passada);
  } finally {
    Module._load = origLoad; delete require.cache[path]; process.env = prevEnv;
  }
});
