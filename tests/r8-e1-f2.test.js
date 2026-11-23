'use strict';
// R8 E1-E6, F1-F2: fixtures sintètics independents dels casos cecs.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizeAnalysis,extractUseful}=require('../lib/nexlupa-result');
const TODAY='2026-11-12';
function run(raw,src){return normalizeAnalysis({resum:'Circular',decisio:'Cap acció necessària',accions:[],...raw},src,TODAY);}
const SRC=fs.readFileSync(require('node:path').join(__dirname,'../app/script.js'),'utf8');

test('E1: domiciliació automàtica no genera tasca ni decisió de revisar càrrec',()=>{
 const r=run({
  decisio:'Revisar el càrrec de 70 €',
  accions:[{accio:'Revisar el càrrec de 70 €',tipus:'tasca',data:'2026-12-15',prioritat:'alta'}],
  recordatoris:[{text:'Quota domiciliada de 70 €',data:'2026-12-15'}]},
  'La quota de 70 € es carregarà automàticament per domiciliació el 15 de desembre.');
 assert.equal(r.accions.length,0);
 assert.doesNotMatch(r.decisio,/revisar el càrrec/i);
});
test('E1: obligació manual de pagar segueix sent tasca',()=>{
 const r=run({accions:[{accio:'Pagar 20 € de matrícula',tipus:'tasca',prioritat:'baixa',data:'2026-11-24'}]},
 'Cal pagar 20 € de matrícula abans del 24 de novembre.');
 assert.equal(r.accions.length,1);
 assert.equal(r.accions[0].prioritat,'alta');
});
test('E1: comproveu explícitament el càrrec manté l’acció',()=>{
 const r=run({accions:[{accio:'Comprovar el càrrec del 5 de desembre',tipus:'tasca',prioritat:'mitja'}]},
 'La quota va domiciliada. Comproveu el càrrec del 5 de desembre.');
 assert.equal(r.accions.length,1);
});
test('E2: IBAN vàlid ES seguit de paraula no consumeix prosa',()=>{
 const d=extractUseful('Pagueu a ES64 0049 1800 1234 5678 9012 indicant la referència', {});
 assert.deepEqual(d.iban,['ES64 0049 1800 1234 5678 9012']);
 assert.deepEqual(d.ibanInvalids,[]);
 assert.equal(d.avisos,undefined);
});
test('E2: IBAN espanyol invàlid es mostra separat i no utilitzable',()=>{
 const d=extractUseful('IBAN: ES12 1234 5678 9012 3456 7890 indicant el concepte', {});
 assert.deepEqual(d.iban,[]);
 assert.deepEqual(d.ibanInvalids,['ES12 1234 5678 9012 3456 7890']);
});
test('E3: data 26 numèrica queda visible però marcada com a dubtosa',()=>{
 const d=run({esdeveniments:[{title:'Sortida cultural',data:'2026-11-26'}]},
 'La sortida cultural és divendres 26 de novembre.');
 assert.equal(d.esdeveniments[0].data,'2026-11-26');
 assert.equal(d.esdeveniments[0].dataDubtosa,true);
 assert.equal(d.revisioDates.requereixRevisio,true);
});
test('E3: error adjacent no mou dilluns 24 al 23',()=>{
 const d=run({esdeveniments:[{title:'Partit',data:'2026-11-23'}]},
 'Partit dilluns 24 de novembre.');
 assert.equal(d.esdeveniments[0].data,'2026-11-24');
 assert.equal(d.esdeveniments[0].dataDubtosa,true);
});
test('E4: no deixar un parèntesi sol al final del lloc',()=>{
 const d=run({esdeveniments:[{title:'Exposició',data:'2026-11-24',lloc:'Aula de música 3)'}]},
 'Exposició el 24 de novembre a l’Aula de música 3.');
 assert.equal(d.esdeveniments[0].lloc,'Aula de música 3');
});
test('E4: reunió anul·lada genèrica no es duplica si hi ha reprogramació',()=>{
 const d=run({esdeveniments:[
   {title:'Reunió anul·lada',data:'2026-11-18'},
   {title:'Reunió de famílies',data:'2026-11-25'}]},
  'La reunió del 18 de novembre queda anul·lada; nova data de la reunió de famílies: 25 de novembre.');
 assert.equal(d.esdeveniments.length,1);
 assert.equal(d.esdeveniments[0].title,'Reunió de famílies');
});
test('E5: un esdeveniment genèric redundant no duplica el grup específic',()=>{
 const d=run({esdeveniments:[
  {title:'Festa escolar',data:'2026-12-18 17:00'},
  {title:'Festa escolar grup A',data:'2026-12-18 17:00'}]},
  'La festa escolar del grup A serà el 18 de desembre a les 17:00.');
 assert.equal(d.esdeveniments.length,1);
});
test('E6: material de preparació i higiene no queden en baixa',()=>{
 const d=run({accions:[
  {accio:'Portar esmorzar',tipus:'tasca',prioritat:'baixa'},
  {accio:'Revisar el cabell per polls',tipus:'tasca',prioritat:'baixa'},
  {accio:'Comprar vestuari abans del 25 de novembre',tipus:'tasca',prioritat:'baixa'}]},
  'Cal portar esmorzar i revisar el cabell per polls. Comprar vestuari abans del 25 de novembre.');
 assert.deepEqual(d.accions.map(a=>a.prioritat),['mitja','mitja','mitja']);
});
test('E6: abans del dijous sense número obté un termini provisional',()=>{
 const d=run({accions:[{accio:'Lliurar el formulari abans del dijous',tipus:'tasca',prioritat:'alta'}]},
  'Heu de lliurar el formulari abans del dijous.');
 assert.equal(d.accions[0].dataFi||d.accions[0].data,'2026-11-19');
 assert.equal(d.accions[0].tipus,'tasca');
});
function fnFromScript(name,next) {
 const start=SRC.indexOf('function '+name+'(');
 const end=SRC.indexOf('function '+next+'(',start+1);
 assert.ok(start>=0&&end>start, 'function block present '+name);
 return SRC.slice(start,end);
}
test('F1: Google Maps genera enllaç només per recinte concret',()=>{
 const code=fnFromScript('canOpenMaps','_buildLlocLink');
 const ctx={encodeURIComponent,document:{createElement(){throw Error('UI forbidden')}}};
 vm.runInNewContext(code,ctx);
 const url=ctx.mapsSearchUrl('Pavelló Nou (Carrer Major, 3)');
 assert.match(url,/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
 assert.match(decodeURIComponent(url),/Pavelló Nou/);
 assert.equal(ctx.mapsSearchUrl('escola'),null);
 assert.equal(ctx.mapsSearchUrl('mateix pavelló'),null);
});
test('F1: les dades de calendari i de compartir contenen l’enllaç Maps segur',()=>{
 assert.match(SRC,/details \+= '\\nMapa: ' \+ actionMapUrl/);
 assert.match(SRC,/if \(mapUrl\) lines\.push\('  🗺️ ' \+ mapUrl\)/);
 assert.match(SRC,/mapsBtn\.href\s*=\s*mapsSearchUrl\(mainEvent\.lloc\)/);
});
test('F2: la vista limita a tres i conserva un desplegable accessible',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../app/index.html'),'utf8');
 assert.match(SRC,/rankedTasks\.slice\(0,3\)/);
 assert.match(SRC,/rankedTasks\.slice\(3\)/);
 assert.match(SRC,/remainingTasks\.forEach/);
 assert.match(SRC,/moreBtn\.setAttribute\('aria-expanded'/);
 assert.match(html,/id="nx-more-actions-toggle"/);
 assert.match(html,/id="nx-more-actions-content"/);
});
test('F2: l’ordenació prioritza alta amb termini abans que baixa',()=>{
 const ctx={};
 vm.runInNewContext(fnFromScript('applyPriorityHeuristics','formatGCalDateTime'),ctx);
 const data=[
  {accio:'Opcional',prioritat:'baixa'},
  {accio:'Mitja',prioritat:'mitja'},
  {accio:'Alta tardana',prioritat:'alta',data:'2026-12-20'},
  {accio:'Alta propera',prioritat:'alta',data:'2026-11-20'},
  {accio:'Alta sense data',prioritat:'alta'}];
 const sorted=ctx.applyPriorityHeuristics(data).map(a=>a.accio);
 assert.deepEqual(Array.from(sorted.slice(0,3)),['Alta propera','Alta tardana','Alta sense data']);
 assert.equal(sorted.length,5);
});
