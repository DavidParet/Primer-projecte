'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const run=(raw,source)=>normalizeAnalysis({resum:'Circular',decisio:'Cal revisar',accions:[],...raw},source,'2026-11-12');
test('R12: completar un imprès obligatori abans de la data és P1',()=>{
 const d=run({accions:[{accio:'Completar el document abans del 29 de novembre',tipus:'tasca',dataFi:'2026-11-29',prioritat:'baixa'}]},
 'Heu de completar el document abans del 29 de novembre.');
 assert.equal(d.accions[0].prioritat,'alta');
});
test('R12: omplir full amb data de lliurament és P1',()=>{
 const d=run({accions:[{accio:'Omplir el full abans del 1 de desembre',tipus:'tasca',prioritat:'baixa'}]},
 'Cal omplir el full abans del 1 de desembre.');
 assert.equal(d.accions[0].prioritat,'alta');
});
test('R12: omplir opcionalment no es converteix en obligatori',()=>{
 const d=run({accions:[{accio:'Si voleu, completar el formulari opcional abans del 28 de novembre',tipus:'tasca',prioritat:'alta'}]},
 'Si voleu, podeu completar el formulari opcional abans del 28 de novembre.');
 assert.equal(d.accions[0].prioritat,'baixa');
});
test('R12: material necessari no es contamina pel regal opcional de la mateixa frase',()=>{
 const d=run({accions:[{accio:'Preparar una carpeta i aigua per al taller',tipus:'tasca',prioritat:'baixa'},
 {accio:'Portar una fotografia si es vol',tipus:'tasca',prioritat:'alta'}]},
 'Cal preparar una carpeta i aigua per al taller; si es vol, portar una fotografia.');
 assert.deepEqual(d.accions.map(x=>x.prioritat),['mitja','baixa']);
});
test('R12: ofertes alternatives sense pagament doble queden com una sola opció P3',()=>{
 const d=run({accions:[
 {accio:'Realitzar el pagament abans del 25 de novembre amb 11% de descompte',tipus:'tasca',dataFi:'2026-11-25',prioritat:'alta'},
 {accio:'Realitzar el pagament abans del 8 de desembre amb 3% de descompte',tipus:'tasca',dataFi:'2026-12-08',prioritat:'alta'}]},
 'Hi ha dues formes alternatives no acumulables: si es fa el pagament abans del 25 de novembre hi ha un 11% de descompte; qui prefereixi pagar abans del 8 de desembre té el 3% de descompte. No són dos pagaments.');
 assert.equal(d.accions.length,1);
 assert.equal(d.accions[0].prioritat,'baixa');
 assert.match(d.accions[0].accio,/11%.*o 3%/);
});
test('R12: dos terminis obligatoris sense descompte continuen sent dues P1',()=>{
 const d=run({accions:[
 {accio:'Pagar primer termini de 18 €',tipus:'tasca',dataFi:'2026-11-25',prioritat:'baixa'},
 {accio:'Pagar segon termini de 18 €',tipus:'tasca',dataFi:'2026-12-20',prioritat:'baixa'}]},
 'Cal pagar dos terminis: 18 € abans del 25 de novembre i 18 € abans del 20 de desembre.');
 assert.equal(d.accions.length,2);
 assert.ok(d.accions.every(x=>x.prioritat==='alta'));
});
test('R12: revisió preventiva del cap i avís si cal és P2, no P1',()=>{
 const d=run({accions:[{accio:'Revisar el cabell i avisar el centre si es detecten polls',tipus:'tasca',prioritat:'alta'}]},
 'Reviseu el cabell per polls i aviseu el centre si es detecta algun cas.');
 assert.equal(d.accions[0].prioritat,'mitja');
});
