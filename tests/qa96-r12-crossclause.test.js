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
