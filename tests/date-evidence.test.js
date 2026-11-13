'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {relativeHints,rebaseVerifiedTime}=require('../lib/date-evidence');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const analyze=(raw,source,today='2026-11-12',sourceDate)=>
  normalizeAnalysis(raw,source,today,sourceDate);

test('QA: demà i passat demà es resolen amb data fixa',()=>{
  assert.equal(relativeHints('Demà no hi ha classe','2026-11-12').date,'2026-11-13');
  assert.equal(relativeHints('Passat demà hi ha torneig','2026-11-12').date,'2026-11-14');
  assert.equal(relativeHints('Pasado mañana no entrenamos','2026-11-12').date,'2026-11-14');
});
test('QA: dijous que ve és 19/11 i dilluns sense adjectiu és 16/11',()=>{
  assert.equal(relativeHints('Dijous que ve a les 17h','2026-11-12').date,'2026-11-19');
  assert.equal(relativeHints('dilluns entrenament','2026-11-12').date,'2026-11-16');
  assert.equal(relativeHints('sábado partido','2026-11-12').date,'2026-11-14');
  assert.equal(relativeHints('miércoles que ve partido','2026-11-12').date,'2026-11-18');
});
test('QA: dos dies diferents no es corregeixen globalment',()=>{
  const hints=relativeHints('Demà tenim partit i dilluns classe','2026-11-12');
  assert.equal(hints.date,null);
  assert.equal(hints.ambiguous,true);
});
test('QA: dates explicites no es reinterpreten com dates relatives',()=>{
  for(const s of ['Divendres 26 de novembre','Divendres 26','el 14/11 és el partit',
    'dijous 19 de novembre','demà 2026-11-13']){
    assert.equal(relativeHints(s,'2026-11-12').date,null,s);
  }
});
test('QA: matí castellà no és demà',()=>{
  assert.equal(relativeHints('Por la mañana salimos a las 9','2026-11-12').date,null);
});
test('QA: preservem hores només si apareixen literalment en el missatge',()=>{
  assert.equal(rebaseVerifiedTime('2026-05-04 17:00','2026-11-19','Dijous que ve a les 17:00'),
    '2026-11-19 17:00');
  assert.equal(rebaseVerifiedTime('2026-05-04 17:00','2026-11-19','Dijous que ve'),
    '2026-11-19');
});
test('QA cas 15: corregeix dijous que ve mal resolt pel model',()=>{
  const data=analyze({resum:'x',mainEvent:{title:'Robòtica',data:'2026-05-04 17:00'},
    accions:[]},'Dijous que ve recuperem robòtica a les 17:00');
  assert.equal(data.mainEvent.data,'2026-11-19 17:00');
});
test('QA: demà sense data de la IA es recupera al calendari',()=>{
  const data=analyze({resum:'x',esdeveniments:[{title:'No hi ha classe',data:null}],
    accions:[]},'Demà divendres no hi ha classe.');
  assert.equal(data.esdeveniments[0].data,'2026-11-13');
  assert.equal(data.accions.length,0);
});
test('QA: si hi ha una tasca sense esdeveniment, n’ajusta el termini inequívoc',()=>{
  const data=analyze({resum:'x',accions:[{accio:'Portar la bata',data:'2026-08-10'}]},
    'Demà cal portar la bata.');
  assert.equal(data.accions[0].data,'2026-11-13');
});
test('QA: manté intactes tasques múltiples i dates mixtes',()=>{
  const data=analyze({resum:'x',esdeveniments:[
    {title:'Partit',data:'2026-11-13'},{title:'Classe',data:'2026-11-16'}],
    accions:[{accio:'Pagar',data:'2026-11-17'}]},
    'Demà partit, dilluns classe, pagar dimarts.');
  assert.deepEqual(data.esdeveniments.map(x=>x.data),['2026-11-13','2026-11-16']);
  assert.equal(data.accions[0].data,'2026-11-17');
});
test('QA: un mail antic utilitza la seva data original com base',()=>{
  const data=analyze({resum:'x',mainEvent:{title:'Visita',data:'2026-11-13'},accions:[]},
    'Demà fem la visita','2026-11-12','2026-11-10');
  assert.equal(data.esdeveniments[0].data,'2026-11-11');
});
test('QA: cap enllaç inventat a una tasca ni altres dades auxiliars',()=>{
  const data=analyze({resum:'x',accions:[
    {accio:'Reservar',enllac:'https://inventat.example/reserva'}],
    dadesUtils:{altres:['Pagament confirmat inventat']}},
    'Cal reservar les entrades a secretaria.');
  assert.equal(data.accions[0].enllac,null);
  assert.deepEqual(data.dadesUtils.altres,[]);
});
test('QA: continua bloquejant el conflicte dia/data del 26',()=>{
  const data=analyze({resum:'x',mainEvent:{title:'Sortida',data:'2026-11-26'},accions:[]},
    'Sortida divendres 26 de novembre');
  assert.equal(data.mainEvent.data,'2026-11-26');
  assert.equal(data.mainEvent.dataDubtosa,true);
  assert.match(data.avisDates,/dijous/);
});
