'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const run = (raw, source) => normalizeAnalysis(raw, source, '2026-11-12');

test('R12: una data contradictòria no es pot exportar com a confirmada', () => {
  const result = run({
    resum: 'Acte', mainEvent: { title: 'Acte del centre', data: '2026-11-24' },
    esdeveniments: [{ title: 'Acte del centre', data: '2026-11-24' }], accions: []
  }, 'L’acte del centre serà dilluns 24 de novembre.');
  assert.equal(result.esdeveniments.length, 1);
  assert.equal(result.esdeveniments[0].dataDubtosa, true);
  assert.equal(result.revisioDates.requereixRevisio, true);
});

test('R12: material necessari no es rebaixa per una altra opció', () => {
  const result = run({ resum:'Sortida', accions:[
    { tipus:'tasca', accio:'Portar cantimplora', prioritat:'baixa' },
    { tipus:'tasca', accio:'Portar gorra si en teniu', prioritat:'baixa' }
  ]}, 'Per a la sortida cal portar cantimplora; opcionalment, porteu gorra si en teniu.');
  const required = result.accions.find(a => /cantimplora/i.test(a.accio));
  assert.ok(required);
  assert.equal(required.prioritat, 'mitja');
});

test('R12: lloc genèric no es converteix en recinte verificat', () => {
  const result = run({ resum:'Trobada', mainEvent:{
    title:'Trobada', data:'2026-11-21', lloc:'la sala de sempre'
  }, accions:[] }, 'La trobada serà el 21/11 a la sala de sempre.');
  assert.equal(result.esdeveniments[0].lloc, null);
});

test('R12: formulari obligatori amb termini conserva P1 malgrat opció separada', () => {
  const result = run({ resum:'Inscripció', accions:[
    { tipus:'tasca', accio:'Omplir el formulari obligatori abans del 20 de novembre', prioritat:'baixa' },
    { tipus:'tasca', accio:'Portar una fotografia si voleu', prioritat:'alta' }
  ]}, 'Cal omplir el formulari obligatori abans del 20 de novembre; si voleu, podeu portar una fotografia.');
  const required = result.accions.find(a => /formulari/i.test(a.accio));
  const optional = result.accions.find(a => /fotografia/i.test(a.accio));
  assert.ok(required && optional);
  assert.equal(required.prioritat, 'alta');
  assert.equal(optional.prioritat, 'baixa');
});

test('R12: avís sanitari de revisió manté P2 sense generar urgència P1', () => {
  const result = run({ resum:'Avís sanitari', accions:[
    { tipus:'tasca', accio:'Revisar el cap per detectar polls', prioritat:'baixa' }
  ]}, 'Avís sanitari: reviseu el cap dels infants per detectar polls.');
  const check = result.accions.find(a => /revisar/i.test(a.accio));
  assert.ok(check);
  assert.equal(check.prioritat, 'mitja');
});
