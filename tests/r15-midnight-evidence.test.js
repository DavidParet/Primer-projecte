'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');

test('an explicitly stated 00:00 is preserved on a single scheduled event', () => {
  const result = normalizeAnalysis({mainEvent:{title:'Reunió de famílies',data:'2026-11-25 00:00'}},
    'La reunió de famílies serà el 25/11/2026 a les 00:00.', '2026-11-21');
  assert.equal(result.mainEvent.data, '2026-11-25 00:00');
  assert.equal(result.mainEvent.dataDubtosa, false);
});

test('a model-proposed 00:00 without source evidence remains date-only', () => {
  const result = normalizeAnalysis({mainEvent:{title:'Reunió de famílies',data:'2026-11-25 00:00'}},
    'La reunió de famílies serà el 25/11/2026.', '2026-11-21');
  assert.equal(result.mainEvent.data, '2026-11-25');
});

test('an isolated midnight must not contaminate an unrelated event', () => {
  const result = normalizeAnalysis({
    esdeveniments:[{title:'Reunió de famílies',data:'2026-11-25 00:00'},
      {title:'Partit',data:'2026-11-26 17:00'}]},
    'La reunió de famílies serà el 25/11/2026. El partit és el 26/11/2026 a les 17:00 i les inscripcions tanquen a les 00:00.',
    '2026-11-21');
  assert.equal(result.esdeveniments[0].data, '2026-11-25');
});
