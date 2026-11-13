'use strict';
// R11: proves sintètiques genèriques. No importen els casos privats R10.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const run=(raw,text)=>normalizeAnalysis({resum:'Circular',decisio:'Cap acció necessària',accions:[],...raw},text,'2026-11-12');
test('R11: ingressar diners amb venciment és P1 malgrat un complement opcional aliè',()=>{
 const d=run({accions:[{accio:'Ingressar 16 € abans del 19 de novembre',tipus:'tasca',prioritat:'baixa'},
 {accio:'Si en teniu, portar un barret opcional',tipus:'tasca',prioritat:'alta'}]},
 'Cal ingressar 16 € abans del 19 de novembre. Si en teniu, podeu portar un barret opcional.');
 assert.equal(d.accions[0].prioritat,'alta');assert.equal(d.accions[1].prioritat,'baixa');
});
test('R11: complement «si es vol» és P3, mentre el material obligatori és P2',()=>{
 const d=run({accions:[{accio:'Portar els mitjons per a l’actuació',tipus:'tasca',prioritat:'alta'},
 {accio:'Portar una fotografia si es vol',tipus:'tasca',prioritat:'mitja'}]},
 'Porteu els mitjons. La fotografia es pot portar si es vol.');
 assert.deepEqual(d.accions.map(a=>a.prioritat),['mitja','baixa']);
});
test('R11: mainEvent duplicat i el dia discordant sense data activa revisió',()=>{
 const msg='L’acte del grup serà dilluns 24 de novembre de 2026 a les 19:30.';
 const d=run({mainEvent:{title:'Acte del grup',data:null},esdeveniments:[{title:'Acte del grup',data:null}]},msg);
 assert.equal(d.revisioDates.requereixRevisio,true);
 assert.ok(d.esdeveniments.some(e=>e.dataDubtosa));
});
test('R11: recinte explícit amb adreça recupera nom sense inventar-lo',()=>{
 const msg='La trobada és el dissabte 5 de desembre a les 11:00 al Pavelló Nord de Tarragona (Carrer de la Llum 6, Tarragona).';
 const d=run({esdeveniments:[{title:'Trobada de famílies',data:'2026-12-05 11:00',lloc:null}]},msg);
 assert.equal(d.esdeveniments[0].lloc,'Pavelló Nord de Tarragona');
});
test('R11: si el model presenta fragments narratius però hi ha un recinte ancorat es corregeix',()=>{
 const msg='Presentació diumenge 6 de desembre al Teatre del Port de Roses (Carrer de les Ones 14, Roses).';
 const d=run({esdeveniments:[{title:'Presentació',data:'2026-12-06',lloc:'Teatre del diumenge 6 de desembre'}]},msg);
 assert.equal(d.esdeveniments[0].lloc,'Teatre del Port de Roses');
});
test('R11: una escola «sala de sempre» no crea una URL de Maps',()=>{
 const s=fs.readFileSync('app/script.js','utf8');
 const start=s.indexOf('function canOpenMaps('),end=s.indexOf('function _buildLlocLink(',start);
 const ctx={encodeURIComponent};vm.runInNewContext(s.slice(start,end),ctx);
 assert.equal(ctx.mapsSearchUrl('escola, a la sala de sempre'),null);
 assert.equal(ctx.mapsSearchUrl('a casa'),null);
 assert.match(ctx.mapsSearchUrl('Pavelló Nord de Tarragona'),/https:\/\/www\.google\.com\/maps\/search/);
});
