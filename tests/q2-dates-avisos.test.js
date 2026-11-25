'use strict';
// Q2 · Data passada ≠ contradicció de dia de la setmana; dates alternatives conservades. Referència 25/11/2026.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const REF = '2026-11-25';
const SRC = 'Recordeu que la sortida és el divendres 25 de setembre. Cal portar l’autorització a secretaria el 4 o 18 d’octubre.';
const model = d => ({ resum: 'x', decisio: 'x', recordatoris: [],
  accions: [{ accio: 'Portar l’autorització a secretaria el 4 o 18 d’octubre', data: '2026-10-04', prioritat: 'alta', tipus: 'tasca' }],
  esdeveniments: [{ title: 'Sortida', data: d }] });

for (const y of ['2025', '2026', '2027']) {
  test('Q2: «divendres 25 de setembre» amb any ' + y + ' del model → 25/09/2026 (divendres), data passada, sense contradicció', () => {
    const r = normalizeAnalysis(model(y + '-09-25'), SRC, REF);
    const e = r.esdeveniments[0];
    assert.strictEqual(e.data, '2026-09-25');
    assert.ok(e.passada);
    assert.ok(!/no coincideix|però el .* és/.test(r.avisDates || ''), 'cap avís de dia de la setmana');
    assert.strictEqual(e.motiuDubte, 'Aquesta data ja ha passat');
  });
}

test('Q2: «el 4 o 18 d’octubre» conserva les dues opcions i queda per confirmar (no s’exporta)', () => {
  const r = normalizeAnalysis(model('2026-09-25'), SRC, REF);
  const a = r.accions[0];
  assert.deepStrictEqual(a.dataAlternatives, ['2026-10-04', '2026-10-18']);
  assert.ok(a.dataDubtosa, 'el client bloqueja l’exportació amb dataDubtosa');
  assert.strictEqual(a.motiuDubte, 'Dues dates possibles: cal confirmar-ne una');
  assert.ok(r.revisioDates.requereixRevisio);
});

test('Q2: una contradicció real de dia de la setmana continua marcada', () => {
  const src = 'La reunió és el dilluns 25 de setembre.';
  const r = normalizeAnalysis({ resum: 'x', decisio: 'x', accions: [], recordatoris: [], esdeveniments: [{ title: 'Reunió', data: '2026-09-25' }] }, src, REF);
  assert.ok(r.esdeveniments[0].dataDubtosa);
  assert.strictEqual(r.esdeveniments[0].motiuDubte, 'El dia de la setmana no coincideix amb la data');
});
