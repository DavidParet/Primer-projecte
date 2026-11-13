'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const run = (raw, source) => normalizeAnalysis(raw, source, '2026-11-12');

test('QA96: a location cannot be grounded by a substring of a different name', () => {
  const d = run({ esdeveniments: [{ title: 'Assaig', data: '2026-11-20 18:00', lloc: 'Sala' }] },
    'Assaig el 20/11 a les 18:00 al Salamandra.');
  assert.equal(d.esdeveniments[0].lloc, null);
  assert.equal(d.esdeveniments[0].dataDubtosa, true);
  assert.equal(d.revisioDates.requereixRevisio, true);
});

test('QA96: explicit standalone location is preserved', () => {
  const d = run({ esdeveniments: [{ title: 'Assaig', data: '2026-11-20 18:00', lloc: 'Sala' }] },
    'Assaig el 20/11 a les 18:00 a la Sala.');
  assert.equal(d.esdeveniments[0].lloc, 'Sala');
  assert.equal(d.esdeveniments[0].dataDubtosa, false);
});

test('QA96: accents and punctuation do not invalidate a literal location', () => {
  const d = run({ accions: [{ accio: 'Portar document', tipus: 'tasca', lloc: 'Pavelló' }] },
    'Portar document al Pavelló, si us plau.');
  assert.equal(d.accions[0].lloc, 'Pavelló');
  assert.equal(d.accions[0].dataDubtosa, false);
});
