'use strict';
// R9: regressions sintètiques públiques. Els 50 casos nous d'avaluació seran privats,
// definits DESPRÉS de congelar el codi i no emprats per ajustar aquest commit.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizeAnalysis,extractUseful,ibanValid}=require('../lib/nexlupa-result');
const TODAY='2026-11-12';
const run=(model,source)=>normalizeAnalysis({resum:'Circular escolar',decisio:'Cap acció necessària',accions:[],...model},source,TODAY);
const BAD='ES12 1234 5678 9012 3456 7890';
const GOOD='ES91 2100 0418 4502 0005 1332';
const srcJS=fs.readFileSync(require('node:path').join(__dirname,'../app/script.js'),'utf8');

test('R9: IBAN invàlid a tasca, decisió i resum es bloqueja explícitament',()=>{
 const d=run({resum:'Pagar al compte '+BAD,decisio:'Fer pagament de 125 € al '+BAD,
   accions:[{accio:'Pagar 125 € al compte '+BAD+' abans de desembre',tipus:'tasca',prioritat:'alta',dataFi:'2026-11-30'}]},
  'Cal fer transferència de 125 € abans del 30 de novembre al número de compte '+BAD+'.');
 assert.equal(d.dadesUtils.iban.length,0);
 assert.deepEqual(d.dadesUtils.ibanInvalids,[BAD]);
 for(const line of [d.resum,d.decisio,...d.accions.map(a=>a.accio)]) {
  assert.doesNotMatch(line,/ES12\s*1234/i);
 }
 assert.match(d.decisio,/No paguis fins a verificar-lo/i);
 assert.match(d.accions[0].accio,/NO facis la transferència/i);
 assert.equal(d.accions[0].pagamentBloquejat,true);
 assert.equal(d.revisioDates.requereixRevisio,true);
 assert.match(d.avisDates,/Compte bancari no vàlid/);
});
test('R9: IBAN vàlid no bloqueja una transferència exigida',()=>{
 const d=run({decisio:'Cal pagar 30 €',accions:[{accio:'Pagar 30 €',tipus:'tasca',prioritat:'alta'}]},
   'Cal transferir 30 € al compte '+GOOD+'.');
 assert.deepEqual(d.dadesUtils.iban,[GOOD]);
 assert.equal(d.accions[0].pagamentBloquejat,undefined);
 assert.doesNotMatch(d.decisio,/IMPORTANT: l’IBAN indicat és invàlid/);
});
test('R9: els descomptes 10% i 5% condicionals són UNA alternativa P3',()=>{
 const d=run({decisio:'Pagar amb descompte',
   accions:[
    {accio:'Pagar la quota anual amb un descompte del 10% abans del 30 de novembre',tipus:'tasca',data:'2026-11-30',prioritat:'alta'},
    {accio:'Pagar la quota anual amb un descompte del 5% abans del 15 de desembre',tipus:'tasca',data:'2026-12-15',prioritat:'alta'}]},
   'La quota anual és 420 €. Es farà un descompte del 10% si es paga abans del 30 de novembre i del 5% si es paga abans del 15 de desembre.');
 assert.equal(d.accions.length,1);
 assert.equal(d.accions[0].prioritat,'baixa');
 assert.match(d.accions[0].accio,/10%.*o 5%/);
 assert.match(d.accions[0].accio,/No són pagaments acumulatius/);
});
test('R9: tres terminis obligatoris de pagament es mantenen com a tres tasques P1',()=>{
 const d=run({accions:[
   {accio:'Pagar primer termini de matrícula 20 €',tipus:'tasca',data:'2026-11-20',prioritat:'alta'},
   {accio:'Pagar segon termini de matrícula 20 €',tipus:'tasca',data:'2026-12-20',prioritat:'alta'},
   {accio:'Pagar tercer termini de matrícula 20 €',tipus:'tasca',data:'2027-01-20',prioritat:'alta'}]},
   'Cal pagar tres terminis de matrícula de 20 € el 20 de novembre, el 20 de desembre i el 20 de gener de 2027.');
 assert.equal(d.accions.length,3);
 assert.ok(d.accions.every(a=>a.prioritat==='alta'));
});
test('R9: P1 autorització obligatòria; P2 material; P3 proposta opcional',()=>{
 const d=run({accions:[
  {accio:'Lliurar autorització signada obligatòria',tipus:'tasca',prioritat:'baixa'},
  {accio:'Portar esmorzar i ampolla d’aigua',tipus:'tasca',prioritat:'alta'},
  {accio:'Si voleu, portar un quadern opcional',tipus:'tasca',prioritat:'alta'}]},
  'Cal lliurar autorització signada obligatòria. Porteu esmorzar i ampolla d’aigua. Si voleu podeu portar un quadern opcional.');
 assert.deepEqual(d.accions.map(a=>a.prioritat),['alta','mitja','baixa']);
});
test('R9: higiene amb recomanació de tractament condicional és P2',()=>{
 const d=run({accions:[{accio:'Revisar el cap dels infants aquesta nit i aplicar tractament si cal',tipus:'tasca',prioritat:'baixa'}]},
  'Avís de polls: reviseu el cap dels infants i, si cal, apliqueu tractament.');
 assert.equal(d.accions[0].prioritat,'mitja');
});
test('R9: plaça de reserva no es converteix en ubicació de Google Maps',()=>{
 const d=run({esdeveniments:[{title:'Primera classe de violí',data:'2027-01-11',lloc:'plaça'}]},
  'Per reservar plaça al curs cal abonar 40 €. Primera classe el 11 de gener de 2027.');
 assert.equal(d.esdeveniments[0].lloc,null);
});
test('R9: el filtre de mapes només enllaça recintes concrets',()=>{
 const a=srcJS.indexOf('function canOpenMaps('),b=srcJS.indexOf('function _buildLlocLink(',a);
 assert.ok(a>=0 && b>a);
 const ctx={encodeURIComponent};
 vm.runInNewContext(srcJS.slice(a,b),ctx);
 for(const generic of ['plaça','casa','escola','mateix pavelló','sala 2','pati'])assert.equal(ctx.mapsSearchUrl(generic),null);
 assert.match(ctx.mapsSearchUrl('Pavelló de la Marina, Barcelona'),/maps\/search\/\?api=1&query=/);
 assert.match(decodeURIComponent(ctx.mapsSearchUrl('Plaça de la Vila, Badalona')),/Plaça de la Vila/);
});
test('R9: tres prioritats top 3 i venciment dataFi respectats sense perdre tasques',()=>{
 const a=srcJS.indexOf('function applyPriorityHeuristics('),b=srcJS.indexOf('function formatGCalDateTime(',a);
 assert.ok(a>=0&&b>a);
 const ctx={};
 vm.runInNewContext(srcJS.slice(a,b),ctx);
 const input=[
  {accio:'Opcional',prioritat:'baixa'},
  {accio:'Material',prioritat:'mitja',data:'2026-11-14'},
  {accio:'P1 tardà',prioritat:'alta',dataFi:'2026-12-20'},
  {accio:'P1 urgent',prioritat:'alta',dataFi:'2026-11-16'},
  {accio:'P1 sense data',prioritat:'alta'},
  {accio:'Reunió',prioritat:'mitja',data:'2026-11-13'}
 ];
 const out=ctx.applyPriorityHeuristics(input);
 assert.equal(out.length,6);
 assert.deepEqual(Array.from(out.slice(0,3).map(x=>x.accio)),['P1 urgent','P1 tardà','P1 sense data']);
 assert.match(srcJS,/rankedTasks\.slice\(3\)/);
 assert.match(srcJS,/Veure-les totes/);
});
