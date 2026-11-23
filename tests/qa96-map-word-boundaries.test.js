'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const run = (source, lloc) => normalizeAnalysis(
  { mainEvent: { title: 'Concert', data: '2026-12-02 19:00', lloc } },
  source, '2026-11-23'
);

test('map grounding rejects a proposed venue that is only a prefix of a longer word', () => {
  const result = run('Concert el 2/12 a les 19 a Salamandra.', 'Sala');
  assert.equal(result.mainEvent.lloc, null);
});

test('map grounding retains a literal explicitly named venue', () => {
  const result = run('Concert el 2/12 a les 19 a la Sala Apolo.', 'Sala Apolo');
  assert.equal(result.mainEvent.lloc, 'Sala Apolo');
});

test('map grounding does not mistake a prefix of a named venue for a whole name', () => {
  const result = run('Concert el 2/12 a les 19 al Teatre Nacional.', 'Teatre Nacio');
  assert.notEqual(result.mainEvent.lloc, 'Teatre Nacio');
});
