const assert = require('node:assert/strict');
const test = require('node:test');
const { localDate, messageDate, validateAnalysis } = require('../lib/analysis-dates');

const today = '2026-11-12';
const now = new Date('2026-11-12T20:00:00Z');

function event(source, data, fontData = source, rest = {}) {
  return validateAnalysis({
    mainEvent: { title: 'Acte', data, fontData, ...rest },
    accions: []
  }, source, today, now);
}

test('Madrid already has a new calendar day while UTC is still on the previous one', () => {
  assert.equal(localDate(new Date('2026-11-11T23:15:00Z')), today);
});

test('audit 12, 15, 17, 25, 33 and 40: resolve upcoming dates and reject dates copied from examples', () => {
  for (const [phrase, correct] of [
    ['dimarts', '2026-11-17 18:00'], ['dijous que ve', '2026-11-19 17:00'],
    ['a partir de la setmana vinent passem a dimecres', '2026-11-18 17:45'],
    ['dilluns', '2026-11-16 18:00'], ['dissabte', '2026-11-14 18:30'],
    ['demà', '2026-11-13 18:00']
  ]) {
    assert.equal(event(phrase, correct).mainEvent.data, correct);
    assert.equal(event(phrase, '2026-05-02').mainEvent.data, null);
  }
});

test('audit 6 and 31: conflicting weekdays suppress the actionable date', () => {
  for (const [phrase, day] of [['divendres 26 de novembre', '2026-11-26'], ['dilluns 24 de novembre', '2026-11-24']]) {
    const result = event(phrase, day);
    assert.equal(result.mainEvent.data, null);
    assert.match(result.avisDates, /Confirma la data/);
  }
});

test('audit 19 and 42: infer an omitted month only when weekday and number agree nearby', () => {
  assert.equal(event('diumenge 13', '2026-12-13 10:00').mainEvent.data, '2026-12-13 10:00');
  assert.equal(event('dimecres 25', '2026-11-25 17:00').mainEvent.data, '2026-11-25 17:00');
});

test('audit 21: chat timestamp anchors tomorrow even on a later analysis date', () => {
  const source = '[12/11/26 18:45] Demà a les 17:30';
  assert.equal(messageDate(source, '2026-11-20'), today);
  assert.equal(validateAnalysis({ accions: [{ data: '2026-11-13 17:30', fontData: 'Demà' }] }, source, '2026-11-20', now).accions[0].data, '2026-11-13 17:30');
  assert.equal(event('Missatge reenviat: demà', '2026-11-13', 'demà').mainEvent.data, null);
});

test('audit 28: validate next-year installments and preserve explicit years', () => {
  for (const [phrase, expected] of [['15 de gener', '2027-01-15'], ['15 de març', '2027-03-15'], ['15/03/2026', '2026-03-15']]) {
    assert.equal(event(phrase, expected).mainEvent.data, expected);
  }
  assert.equal(event('15 de gener', '2026-01-15').mainEvent.data, null);
});

test('audit 4 and 46: retain end dates and each secondary time', () => {
  const range = event('13 de gener fins al 15 de gener', '2027-01-13', '13 de gener', { dataFi: '2027-01-15', fontDataFi: '15 de gener' });
  assert.equal(range.mainEvent.dataFi, '2027-01-15');
  const result = validateAnalysis({ mainEvent: { data: '2026-11-14 10:00', fontData: 'dissabte' }, esdeveniments: [
    { data: '2026-11-14 12:00', fontData: 'dissabte' }
  ], accions: [] }, 'dissabte', today, now);
  assert.equal(result.esdeveniments[0].data, '2026-11-14 12:00');
});

test('audit 38 and 50: optional stays P3 and expired and replacement deadlines coexist', () => {
  const result = validateAnalysis({ accions: [
    { tipus: 'tasca', opcional: true, prioritat: 'alta' },
    { tipus: 'tasca', prioritat: 'alta', termini: true, data: '2026-11-11', fontData: 'ahir, 11 de novembre' },
    { tipus: 'tasca', prioritat: 'alta', termini: true, data: '2026-11-14', fontData: 'aquest dissabte' }
  ] }, 'Va acabar ahir, 11 de novembre. Podeu pagar aquest dissabte.', today, now);
  assert.equal(result.accions[0].prioritat, 'baixa');
  assert.equal(result.accions[1].vencut, true);
  assert.equal(result.accions[2].data, '2026-11-14');
  assert.equal(result.accions[2].vencut, undefined);
});

test('impossible dates and missing source evidence cannot reach calendar actions', () => {
  assert.equal(event('30/02/2027', '2027-02-30').mainEvent.data, null);
  assert.equal(event('Abans del proper partit', '2026-11-14', 'dissabte').mainEvent.data, null);
});
