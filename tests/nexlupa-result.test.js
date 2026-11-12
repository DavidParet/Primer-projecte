'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  madridToday, validIsoDate, weekdayForISO, extractSourceWeekdays,
  extractUseful, normalizeAnalysis
} = require('../lib/nexlupa-result');
const analyze = (raw, source, today='2026-11-12') => normalizeAnalysis(raw, source, today);

test('Calendari: novembre 2026, Europe/Madrid i any de traspàs', () => {
  assert.equal(weekdayForISO('2026-11-12'), 'dijous');
  assert.equal(weekdayForISO('2026-11-26'), 'dijous');
  assert.equal(validIsoDate('2026-02-30'), null);
  assert.equal(validIsoDate('2028-02-29'), '2028-02-29');
  assert.equal(validIsoDate('2026-11-12 25:00'), null);
  assert.equal(validIsoDate('2026-11-12 00:00'), '2026-11-12');
  assert.equal(validIsoDate('2026-11-12 18:30'), '2026-11-12 18:30');
  assert.match(madridToday(new Date('2026-11-12T12:00:00Z')), /^2026-11-12$/);
});
test('Dies de la setmana en castellà i català', () => {
  const refs = extractSourceWeekdays('divendres 26 de novembre; miércoles 18/11/2026');
  assert.equal(refs.length, 2);
  assert.equal(refs[0].weekday, 'divendres');
  assert.equal(refs[1].weekday, 'dimecres');
  assert.equal(refs[1].month, 11);
});
test('Cas 6: contradicció divendres 26, no correcció silenciosa', () => {
  const d = analyze({resum:'x',mainEvent:{title:'Sortida',data:'2026-11-26'},accions:[]},
    'Sortida divendres 26 de novembre');
  assert.equal(d.esdeveniments[0].data, null);
  assert.match(d.avisDates, /dijous/);
});
test('Cas 31: contradicció dilluns 24', () => {
  const d = analyze({resum:'x',mainEvent:{title:'Entrenament',data:'2026-11-24'},accions:[]},
    'Ens veiem dilluns 24.');
  assert.equal(d.esdeveniments[0].data, null);
  assert.match(d.avisDates, /dimarts/);
});
test('Cas 3: sense accions amb dia sense classe al calendari', () => {
  const d = analyze({resum:'x',decisio:'cap acció necessària',
    esdeveniments:[{title:'No hi ha classe',data:'2026-11-13'}],accions:[]},
    'Demà divendres no hi ha classe');
  assert.equal(d.accions.length, 0);
  assert.equal(d.esdeveniments[0].data, '2026-11-13');
});
test('Cas 4: colònies amb interval de 3 dies i import/IBAN', () => {
  const d = analyze({resum:'x',mainEvent:{title:'Colònies 5è',data:'2027-01-13'},
    esdeveniments:[{title:'Colònies 5è',data:'2027-01-13',dataFi:'2027-01-15'}],
    accions:[{accio:'Pagar abans de 30/11',data:'2026-11-30',prioritat:'alta'}]},
    'Colònies del 13 al 15 de gener 2027. 125 € transferència ES91 2100 0418 4502 0005 1332.');
  assert.equal(d.esdeveniments.length, 1);
  assert.equal(d.esdeveniments[0].dataFi, '2027-01-15');
  assert.equal(d.dadesUtils.iban.length, 1);
  assert.equal(d.dadesUtils.imports.length, 1);
});
test('Cas 9: conserva més de dos esdeveniments', () => {
  const events = [7,8,9,10,11,12].map(n => ({title:'Dia '+n,data:'2026-12-'+String(n).padStart(2,'0')}));
  const d = analyze({resum:'x',esdeveniments:events,accions:[]},'Sis dates futures');
  assert.equal(d.esdeveniments.length, 6);
});
test('Cas 14: no elimina tasques quan hi ha més de 4', () => {
  const actions = Array.from({length:8},(_,i)=>({accio:'Tasca '+i,tipus:'tasca',prioritat:'mitja'}));
  const d = analyze({resum:'x',accions:actions},'Vuit tasques');
  assert.equal(d.accions.length,8);
});
test('Cas 19: diumenge 13 de desembre de 2026 es manté', () => {
  const d = analyze({resum:'x',mainEvent:{title:'Estrena',data:'2026-12-13'},accions:[]},
    'Estrena diumenge 13 de desembre');
  assert.equal(d.esdeveniments[0].data,'2026-12-13');
  assert.equal(d.avisDates,null);
});
test('Cas 22: dos anys diferents es mantenen', () => {
  const d = analyze({resum:'x',esdeveniments:[
    {title:'2026',data:'2026-12-22'},{title:'2027',data:'2027-01-08'}],accions:[]},
    '22/12/2026 i 08/01/2027');
  assert.equal(d.esdeveniments.length,2);
});
test('Cas 35 i 39: múltiples hores i tipus diferents', () => {
  const d = analyze({resum:'x',esdeveniments:[
    {title:'Convocatòria',data:'2026-11-14 09:00'},
    {title:'Sortida autocar',data:'2026-11-14 09:30'},
    {title:'Assaig',data:'2026-12-19 10:00'}],accions:[]},'14/11 i 19/12');
  assert.deepEqual(d.esdeveniments.map(e=>e.data),['2026-11-14 09:00','2026-11-14 09:30','2026-12-19 10:00']);
});
test('Cas 37: dos URL originals sense inventar dominis', () => {
  const d = analyze({resum:'x',accions:[],dadesUtils:{enllacos:['https://fals.example']}},
    'Vídeo https://example.org/video i fotos https://example.org/fotos');
  assert.equal(d.dadesUtils.enllacos.length,2);
  assert.ok(!d.dadesUtils.enllacos.includes('https://fals.example'));
});
test('Cas 47: imports diferents conservats', () => {
  const d = analyze({resum:'x',accions:[]},'Quota anual 420 €, mensualitat 42 € i bonificació 130 €.');
  assert.equal(d.dadesUtils.imports.length,3);
});
test('Cas 50: termini vençut no esdevé esdeveniment futur', () => {
  const d = analyze({resum:'x',accions:[
    {accio:'Pagament abans del 11/11',data:'2026-11-11',tipus:'tasca',prioritat:'alta'}]},
    'El termini de pagament del 11/11 ja ha passat.');
  assert.equal(d.esdeveniments.length,0);
  assert.equal(d.accions[0].vençut,true);
  assert.equal(d.accions[0].data,'2026-11-11');
});
test('Recordatoris només informatius, sense programació automàtica', () => {
  const d = analyze({resum:'x',decisio:'cap acció necessària',accions:[],
    recordatoris:[{text:"Inscripcions obertes l'1 de març",data:'2027-03-01'}]},'Obrirem l’1 de març.');
  assert.equal(d.recordatoris.length,1);
  assert.equal(d.recordatoris[0].tipus,'informatiu');
});
test('Dades estranyes i horaris impossibles no creen calendaris falsos', () => {
  const d = analyze({resum:'x',mainEvent:{title:'Torneig',data:'2026-11-42 29:70'},
    accions:[{accio:'Participar',data:'diumenge que ve',tipus:'tasca'}]},'El torneig és diumenge');
  assert.equal(d.esdeveniments[0].data,null);
  assert.equal(d.accions[0].data,null);
  assert.ok(d.avisDates);
});
