'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const TODAY='2026-11-12';
const run=(raw,text)=>normalizeAnalysis({resum:'Circular',decisio:'Cap acció necessària',accions:[],...raw},text,TODAY);
test('R10 P1: confirmar assistència amb termini no baixa per una clàusula «si en teniu»',()=>{
 const d=run({accions:[
 {accio:'Confirmar assistència abans del 23 de novembre',tipus:'tasca',dataFi:'2026-11-23',prioritat:'baixa'},
 {accio:'Si en teniu, portar una gorra',tipus:'tasca',prioritat:'alta'}]},
 'Heu de confirmar l’assistència abans del 23 de novembre; si en teniu, podeu portar una gorra.');
 assert.equal(d.accions[0].prioritat,'alta');assert.equal(d.accions[1].prioritat,'baixa');
});
test('R10 P1: confirmació no baixa per opcionalment en altra frase',()=>{
 const d=run({accions:[{accio:'Confirmar la plaça abans del 28 de novembre',tipus:'tasca',prioritat:'baixa'}]},
 'Confirmeu la plaça abans del 28 de novembre. Opcionalment podeu portar una llibreta.');
 assert.equal(d.accions[0].prioritat,'alta');
});
test('R10 P2: preparació de material manté prioritat mitjana amb opcional en frase diferent',()=>{
 const d=run({accions:[
 {accio:'Portar els mitjons i la motxilla',tipus:'tasca',prioritat:'baixa'},
 {accio:'Opcionalment portar un barret',tipus:'tasca',prioritat:'alta'}]},
 'Porteu els mitjons i la motxilla; opcionalment podeu portar un barret.');
 assert.deepEqual(d.accions.map(x=>x.prioritat),['mitja','baixa']);
});
test('R10 P1/P3: tasca combinada obligatori + opcional es desglossa',()=>{
 const d=run({accions:[{accio:'Confirmar assistència abans del 25 de novembre; opcionalment portar un quadern',tipus:'tasca',prioritat:'baixa',dataFi:'2026-11-25'}]},
 'Heu de confirmar assistència abans del 25 de novembre; opcionalment porteu un quadern.');
 assert.equal(d.accions.length,2);
 assert.equal(d.accions[0].prioritat,'alta');
 assert.equal(d.accions[1].prioritat,'baixa');
});
test('R10 nova data de representació no es cancel·la per una altra frase de suspensió',()=>{
 const d=run({esdeveniments:[
 {title:'Actuació musical',data:'2026-12-18 18:00'},
 {title:'Actuació musical suspesa',data:'2026-12-11 18:00'}]},
 'L’actuació musical del 11 de desembre queda suspesa. Nova data: 18 de desembre a les 18:00.');
 const fresh=d.esdeveniments.find(e=>e.data&&e.data.startsWith('2026-12-18'));
 assert.ok(fresh,'La nova representació ha de quedar disponible');
 assert.notEqual(fresh.estat,'suspes');
});
test('R10: una suspensió real sense nova data mai es publica com a celebració',()=>{
 const d=run({esdeveniments:[{title:'Trobada esportiva',data:'2026-11-21'}]},
 'La trobada esportiva de dissabte 21 de novembre queda suspesa. Ja comunicarem la nova data.');
 assert.equal(d.esdeveniments[0].estat,'suspes');
 assert.equal(d.esdeveniments[0].data,null);
});
test('R10: model sense data i amb avís de contradicció activa revisió',()=>{
 const d=run({avisDates:'El dia de setmana no coincideix amb el número, confirma la data',esdeveniments:[{title:'Conferència',data:null}]},
 'La conferència serà dimarts 26 de novembre.');
 assert.equal(d.revisioDates.requereixRevisio,true);
 assert.equal(d.esdeveniments[0].data,null);
 assert.equal(d.esdeveniments[0].dataDubtosa,true);
});
test('R10: quan no hi ha data ni contradicció no marca revisió fictícia',()=>{
 const d=run({esdeveniments:[{title:'Xerrada informativa',data:null}]},
 'Una xerrada informativa tindrà lloc aviat, anunciarem la data.');
 assert.equal(d.esdeveniments[0].data,null);
 assert.equal(d.revisioDates.requereixRevisio,false);
});
