'use strict';
// R7 regressions sintètiques: cap missatge original dels 50 ni dels 20 cecs.
const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeAnalysis} = require('../lib/nexlupa-result');
const TODAY='2026-11-12';
function run(model,source){return normalizeAnalysis({resum:'Circular',decisio:'Cap acció necessària',accions:[],...model},source,TODAY);}
test('D1: termini explícit de novembre no salta al desembre per dimecres 30 genèric',()=>{
 const x=run({esdeveniments:[{title:'Tornada esportiva',data:'2026-12-30'}],
  accions:[{accio:'Pagar el transport abans del 30 de novembre',tipus:'tasca',dataFi:'2026-11-30',prioritat:'alta'}]},
  'La tornada serà dimecres 30 al vespre. El transport s’ha de pagar abans del 30 de novembre.');
 assert.equal(x.accions[0].dataFi,'2026-11-30');
});
test('D1: el contradicció real de calendari segueix bloquejada',()=>{
 const x=run({esdeveniments:[{title:'Sessió de joc',data:'2026-11-23 17:30'}]},
  'Sessió de joc dilluns 24 de novembre a les 17:30.');
 assert.equal(x.esdeveniments[0].data,null);
 assert.equal(x.revisioDates.requereixRevisio,true);
});
test('D2: data omesa amb dimarts 24 coherent recupera 24 de novembre',()=>{
 const x=run({esdeveniments:[{title:'Xerrada de ciència',data:null}]},
  'La xerrada de ciència es farà dimarts 24 de novembre a la biblioteca.');
 assert.equal(x.esdeveniments[0].data,'2026-11-24');
});
test('D2: dia de setmana sense número infereix proper dimarts amb un sol acte',()=>{
 const x=run({esdeveniments:[{title:'Sessió d’astronomia',data:null}]},
  'La sessió d’astronomia es farà dimarts.');
 assert.equal(x.esdeveniments[0].data,'2026-11-17');
});
test('D2: dia amb número contradictori no es completa',()=>{
 const x=run({esdeveniments:[{title:'Xerrada',data:null}]},
  'La xerrada serà dilluns 24 de novembre.');
 assert.equal(x.esdeveniments[0].data,null);
});
test('D3: un acte puntual el dimecres 2 manté data i no és recurrent',()=>{
 const x=run({esdeveniments:[{title:'Taller de química',data:'2026-12-02 18:00',estat:'recurrent'}]},
  'El taller de química serà el dimecres 2 de desembre a les 18:00.');
 assert.equal(x.esdeveniments[0].data,'2026-12-02 18:00');
 assert.notEqual(x.esdeveniments[0].estat,'recurrent');
});
test('D3: cada dimarts sense data absoluta sí que és recurrent',()=>{
 const x=run({esdeveniments:[{title:'Taller de música',data:'2026-11-17'}]},
  'Cada dimarts fem taller de música.');
 assert.equal(x.esdeveniments[0].estat,'recurrent');
 assert.equal(x.esdeveniments[0].data,null);
});
test('D4: fraccionament informatiu sense obligació no origina pagaments inventats',()=>{
 const x=run({recordatoris:[{text:'La quota de 420 € es pot fraccionar',data:'2026-12-16'}]},
  'La quota de 420 € es pot fraccionar en mensualitats, segons les preferències de cada família.');
 assert.equal(x.accions.length,0);
});
test('D4: si cal portar material literalment es conserva la tasca',()=>{
 const x=run({recordatoris:[{text:'Cal portar impermeable',data:'2026-11-21'}]},
  'Cal portar impermeable a la sortida del 21 de novembre.');
 assert.ok(x.accions.some(a=>a.accio.includes('impermeable')));
});
test('D5: una autorització signada obligatòria ha de ser alta',()=>{
 const x=run({accions:[{accio:'Lliurar autorització signada obligatòria',tipus:'tasca',prioritat:'baixa'}]},
  'Cal lliurar l’autorització signada obligatòria, però també hi ha un dossier opcional.');
 assert.equal(x.accions[0].prioritat,'alta');
});
test('D5: una activitat només opcional continua baixa',()=>{
 const x=run({accions:[{accio:'Si voleu inscriure-us a la trobada opcional',tipus:'tasca',prioritat:'alta'}]},
  'Si voleu, podeu inscriure-us a la trobada opcional.');
 assert.equal(x.accions[0].prioritat,'baixa');
});
test('D6: no heretar fragments de frase com a recinte',()=>{
 const x=run({esdeveniments:[{title:'Acte públic',data:'2026-11-24'}]},
  'L’acte serà a la Plaça Central el 24 de novembre amb tallers i berenar per a infants.');
 assert.equal(x.esdeveniments[0].lloc,'Plaça Central');
 assert.ok(x.esdeveniments[0].lloc.length<=60);
});
test('D6: ubicacions artificials llargues no contaminen el calendari',()=>{
 const x=run({esdeveniments:[{title:'Sessió',data:'2026-11-25',lloc:'Biblioteca Principal i posteriorment passeig pel barri amb pares i professorat'}]},
  'La sessió es farà a la Biblioteca Principal i posteriorment passeig pel barri amb pares i professorat.');
 assert.ok(!x.esdeveniments[0].lloc || x.esdeveniments[0].lloc.length<=60);
});
test('D7: una tasca amb lloc suggerit sense evidència no genera avís fals',()=>{
 const x=run({accions:[{accio:'Portar el material',tipus:'tasca',lloc:'Zona inventada',prioritat:'mitja'}]},
  'Cal portar el material a la secretaria.');
 assert.equal(x.accions[0].lloc,null);
 assert.doesNotMatch(x.avisDates||'',/ubicació/);
});
test('D8: rang paraigua amb dos dies de sessions és eliminat',()=>{
 const x=run({esdeveniments:[
  {title:'Campus de ciència',data:'2026-12-21 10:00',dataFi:'2026-12-23 18:00'},
  {title:'Campus de ciència dilluns',data:'2026-12-21 10:00'},
  {title:'Campus de ciència dimarts',data:'2026-12-22 10:00'}]},
  'Campus de ciència del 21 al 23 de desembre, amb una sessió dilluns 21 i una altra dimarts 22.');
 assert.equal(x.esdeveniments.length,2);
 assert.ok(x.esdeveniments.some(e=>e.data.startsWith('2026-12-22')));
});
test('D8: rang amb un sol dia representat no desapareix',()=>{
 const x=run({esdeveniments:[
  {title:'Campus verd',data:'2026-12-21 10:00',dataFi:'2026-12-23'},
  {title:'Campus verd dilluns',data:'2026-12-21 10:00'}]},
  'Campus verd de tres dies del 21 al 23 de desembre, amb activitat dilluns 21.');
 assert.equal(x.esdeveniments.length,2);
});
test('D9: una obligació i una opció separables esdevenen tasques independents',()=>{
 const x=run({accions:[{accio:'Lliurar formulari signat; si voleu portar fotografia opcional',tipus:'tasca',prioritat:'baixa'}]},
  'Cal lliurar formulari signat; si voleu podeu portar fotografia opcional.');
 assert.equal(x.accions.length,2);
 assert.equal(x.accions[0].prioritat,'alta');
 assert.equal(x.accions[1].prioritat,'baixa');
});
test('D9: avís sanitari explícit no queda en prioritat baixa',()=>{
 const x=run({accions:[{accio:'Revisar els cabells davant un avís de polls',tipus:'tasca',prioritat:'baixa'}]},
  'Avís de polls: revisar els cabells aquesta tarda.');
 assert.equal(x.accions[0].prioritat,'mitja');
});
