'use strict';
// Independent QA3 regression tests. Do not read or inspect the private QA20 holdout set.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const {alternativeHours}=require('../lib/date-evidence');
const REF='2026-11-12';
const run=(data,source)=>normalizeAnalysis({resum:'x',accions:[],...data},source,REF);
test('R1 · resultat passat sense data NO hereta el dimarts del nou entrenament',()=>{
  const d=run({esdeveniments:[{title:'Resultat del partit',data:null}]},
    'Ahir es va jugar el partit i el marcador va ser 3 a 1. Dimarts entrenarem de nou.');
  assert.equal(d.esdeveniments[0].data,null);
});
test('R1 · l’acte relatiu que apareix en la mateixa frase continua funcionant',()=>{
  const d=run({esdeveniments:[{title:'Assaig de ball',data:null}]},
    'Dimarts tenim assaig de ball a les 17:00.');
  assert.equal(d.esdeveniments[0].data,'2026-11-17');
});
test('R2 · dues hores alternatives detectades i el calendari queda bloquejat',()=>{
  assert.deepEqual(alternativeHours('El partit serà a les 18:00 o 19:00.'),['18:00','19:00']);
  const d=run({esdeveniments:[{title:'Partit',data:'2026-11-21 18:00'}]},
    'El partit dissabte 21 de novembre serà a les 18:00 o 19:00.');
  assert.equal(d.esdeveniments[0].data,'2026-11-21');
  assert.equal(d.esdeveniments[0].dataDubtosa,true);
  assert.match(d.avisDates,/hores alternatives/);
});
test('R2 · una franja 18:00 a 19:00 no és una alternativa',()=>{
  assert.deepEqual(alternativeHours('Entrenament de 18:00 a 19:00.'),[]);
});
test('R2 · una hora alternativa en data relativa no es presenta com a segura',()=>{
  const d=run({esdeveniments:[{title:'Partit',data:'2026-10-01 18:00'}]},
    'Demà partit a les 18:00 o 19:00.');
  assert.equal(d.esdeveniments[0].data,'2026-11-13');
  assert.equal(d.esdeveniments[0].dataDubtosa,true);
});
test('R3 · esdeveniments homònims en dues sales no es fusionen',()=>{
  const d=run({esdeveniments:[
    {title:'Assaig',data:'2026-11-20 18:00',lloc:'Sala 1'},
    {title:'Assaig',data:'2026-11-20 18:00',lloc:'Sala 2'}]},'Assajos a Sala 1 i Sala 2');
  assert.equal(d.esdeveniments.length,2);
});
test('R3 · mainEvent i esdeveniments exactament idèntics se segueixen deduplicant',()=>{
  const d=run({mainEvent:{title:'Partit',data:'2026-11-21'},
    esdeveniments:[{title:'Partit',data:'2026-11-21'}]},'Partit dissabte 21 de novembre');
  assert.equal(d.esdeveniments.length,1);
});
test('R4 · quota econòmica formulada com a tasca no es queda P3',()=>{
  const d=run({accions:[{accio:'Quota 25 € de la matrícula',tipus:'tasca',prioritat:'baixa'}]},
    'Quota 25 € de la matrícula de bàsquet.');
  assert.equal(d.accions[0].prioritat,'alta');
});
const client=fs.readFileSync(path.join(__dirname,'../app/script.js'),'utf8');
function extractFunction(name){
  const m=client.match(new RegExp('^function '+name+'\\([^]*?^\\}', 'm'));
  assert.ok(m,'Missing frontend function '+name);
  return m[0];
}
function calendarUrl(action){
  let opened=null;
  const body={appendChild(){},removeChild(){}};
  const ctx={document:{body,createElement(){return{click(){opened=this.href}}}},
    URLSearchParams,Date,_lastData:{resum:'Campus de Nadal'}};
  vm.createContext(ctx);
  vm.runInContext(extractFunction('addActionToCalendar'),ctx);
  ctx.addActionToCalendar(action);
  return opened&&new URL(opened);
}
test('R5 · campus 28–30 desembre amb hora inicial no es redueix a una hora',()=>{
  const url=calendarUrl({accio:'Campus de Nadal',data:'2026-12-28 09:00',dataFi:'2026-12-30'});
  assert.ok(url);
  assert.equal(url.searchParams.get('dates'),'20261228/20261231');
  assert.match(url.searchParams.get('details'),/diversos dies/);
});
test('R5 · una jornada amb hora d’inici i hora de fi manté la durada real',()=>{
  const url=calendarUrl({accio:'Sessió',data:'2026-12-28 09:00',dataFi:'2026-12-28 12:30'});
  assert.equal(url.searchParams.get('dates'),'20261228T090000/20261228T123000');
});
test('R6 · codi antic perillós que suposava demà ha desaparegut',()=>{
  assert.doesNotMatch(client,/^function (?:parseDate|toGCalDate|addSingleToCalendar|exportCalendar)\s*\(/m);
});
