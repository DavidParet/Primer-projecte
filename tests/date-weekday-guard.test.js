'use strict';
// Protecció general de dates: dues mencions del mateix dia de la setmana poden ser actes diferents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const refDate = '2026-11-12';

test('una festa dimarts 8 en un recordatori no pot moure una activitat del dimarts 22', () => {
  const src = 'Dilluns 7 de desembre activitat suspesa. El dimarts 8 és festiu. ' +
    'Última sessió dimarts 22 de desembre a les 13:00.';
  const res = normalizeAnalysis({
    esdeveniments:[
      {title:'Activitat suspesa',data:'2026-12-07'},
      {title:'Última sessió',data:'2026-12-22 13:00'}
    ],
    recordatoris:[{text:'Dimarts 8 és festiu',data:'2026-12-08'}]
  }, src, refDate);
  assert.equal(res.esdeveniments[1].data, '2026-12-22 13:00');
  assert.equal(res.recordatoris[0].data, '2026-12-08');
});

test('una data explícita continua protegida encara que no existeixi el recordatori festiu', () => {
  const src = 'El dimarts 8 és festiu, i el dimarts 22 de desembre hi ha l’acte final.';
  const res = normalizeAnalysis({
    esdeveniments:[{title:'Acte final',data:'2026-12-22'}]
  }, src, refDate);
  assert.equal(res.esdeveniments[0].data, '2026-12-22');
});

test('sense mes explícit continua sent possible resoldre diumenge 13 de forma conservadora', () => {
  const src = 'Assaig general diumenge 13 a les 10h.';
  const res = normalizeAnalysis({
    esdeveniments:[{title:'Assaig general',data:'2026-11-15 10:00'}]
  }, src, refDate);
  assert.equal(res.esdeveniments[0].data, '2026-12-13 10:00');
  assert.equal(res.esdeveniments[0].dataDubtosa, true);
});
