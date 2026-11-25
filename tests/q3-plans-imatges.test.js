'use strict';
// PLANS (25/11/2026): l'anàlisi d'imatges és exclusiva de Premium i es comprova al servidor abans de consumir l'API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

function loadHandler(calls) {
  const fake = function () { return { chat: { completions: { create: async (o) => { calls.push(o);
    return { choices: [{ message: { content: JSON.stringify({ resum: 'x', decisio: 'x', accions: [], recordatoris: [], esdeveniments: [] }) } }] }; } } } }; };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'openai' ? fake : orig.call(this, req, ...rest); };
  const p = require.resolve('../api/analyze'); delete require.cache[p];
  try { return require(p); } finally { Module._load = orig; }
}
async function call(handler, body, headers) {
  let out = null, code = 200;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(b) { out = b; return this; } };
  await handler({ method: 'POST', headers: headers || {}, body }, res);
  return { code, out };
}

test('Petició directa d’imatge sense permís: 403 abans de consumir l’API', async () => {
  const calls = []; const h = loadHandler(calls);
  const r = await call(h, { image: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.out.code, 'PREMIUM_REQUIRED');
  assert.strictEqual(calls.length, 0, 'no s’ha cridat el model');
});

test('Un indicador de Premium enviat pel navegador no obre les imatges', async () => {
  const calls = []; const h = loadHandler(calls);
  const r = await call(h, { image: 'data:image/png;base64,iVBORw0KGgo=', premium: true, plan: 'premium' }, { 'x-nexlupa-plan': 'premium' });
  assert.strictEqual(r.code, 403);
  assert.strictEqual(calls.length, 0);
});

test('El text continua disponible (FREE)', async () => {
  const calls = []; const h = loadHandler(calls);
  const r = await call(h, { text: 'Demà hi ha reunió a les 17:00 a l’escola.' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(calls.length, 1);
});

test('Textos de l’app: cap pantalla diu que el FREE inclou imatges ni pinta el límit gratuït en vermell', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  assert.ok(!/Anàlisi de text i imatges/.test(html));
  assert.ok(!/class="compare-no"[^>]*>[^<]*(3 al dia|3 anàlisis)/.test(html), 'límit gratuït en text neutre');
  assert.ok(!/✖\s*<span>Amb el FREE/.test(html), 'sense creu al costat del FREE');
  assert.ok(/Anàlisi d’imatges i captures<\/span><span class="compare-status"><span class="compare-cell"><span class="compare-none">/.test(html));
  assert.ok(/Informe setmanal PDF/.test(html));
  assert.ok(/Afegir manualment a Google Calendar<\/span><span class="compare-status"><span class="compare-cell"><strong class="compare-yes">✓ Free/.test(html));
  assert.ok(/Obrir ubicacions a Maps<\/span><span class="compare-status"><span class="compare-cell"><strong class="compare-yes">✓ Free/.test(html));
});
