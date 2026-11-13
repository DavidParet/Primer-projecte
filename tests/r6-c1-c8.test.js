'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');
const TODAY='2026-11-12';
const run=(raw,source)=>normalizeAnalysis({resum:'Avís familiar',decisio:'Cap acció necessària',accions:[],...raw},source,TODAY);

test('C1: dilluns 24 ambigu no es transforma en dilluns 23 ni és exportable',()=>{
  const d=run({esdeveniments:[{title:'Entrenament',data:'2026-11-23 18:00'}],
    accions:[{accio:'Portar bambes per a entrenament',tipus:'tasca',data:'2026-11-23',prioritat:'mitja'}],
    recordatoris:[{text:'Entrenament dilluns 24',data:'2026-11-23'}]},
    'Dilluns 24 de novembre entrenament a les 18h. Portar bambes.');
  assert.equal(d.esdeveniments[0].data,null);
  assert.equal(d.esdeveniments[0].dataDubtosa,true);
  assert.equal(d.accions[0].data,null);
  assert.equal(d.accions[0].dataDubtosa,true);
  assert.equal(d.recordatoris[0].data,null);
  assert.equal(d.revisioDates.requereixRevisio,true);
});
test('C1: el conflicte directe dimarts 26 erroni també deixa data buida',()=>{
  const d=run({esdeveniments:[{title:'Sortida de teatre',data:'2026-11-26'}]},'Dimarts 26 de novembre: sortida de teatre.');
  assert.equal(d.esdeveniments[0].data,null);
  assert.equal(d.revisioDates.requereixRevisio,true);
});
test('C2: una data pròpia no s\'hereta d\'un festiu mencionat a la mateixa circular',()=>{
  const d=run({esdeveniments:[{title:'Última sessió',data:'2026-12-22 13:00'}],
    recordatoris:[{text:'El dimarts 8 és festiu',data:'2026-12-08'}]},
    'Dimarts 8 és festiu. Última sessió dimarts 22 de desembre a les 13:00.');
  assert.equal(d.esdeveniments[0].data,'2026-12-22 13:00');
});
test('C3: una beca amb termini estricte és alta',()=>{
  const d=run({accions:[{accio:'Sol·licitar la beca de menjador abans del 30 de novembre',tipus:'tasca',prioritat:'baixa',dataFi:'2026-11-30'}]},
    'Sol·licituds de beca de menjador fins al 30 de novembre. Fora de termini no es tindran en compte.');
  assert.equal(d.accions[0].prioritat,'alta');
});
test('C4: lloc en una adreça amb contracció i parèntesis',()=>{
  const d=run({esdeveniments:[{title:'Partit de lliga',data:'2026-11-21 10:00',lloc:'Pavelló Nou (Carrer Major, 3)'}]},
    'El partit serà al Pavelló Nou (Carrer Major, 3) dissabte 21 de novembre.');
  assert.match(d.esdeveniments[0].lloc,/Pavelló Nou/);
  assert.doesNotMatch(d.avisDates||'',/ubicació/);
});
test('C4: un lloc inventat sense evidència es continua descartant',()=>{
  const d=run({esdeveniments:[{title:'Reunió',data:'2026-11-25',lloc:'Hotel Fictici'}]},
    'Reunió el 25 de novembre. Rebreu horaris.');
  assert.equal(d.esdeveniments[0].lloc,null);
  assert.match(d.avisDates,/ubicació/);
});
test('C4: heretar un únic recinte de la font sense lloc proposat',()=>{
  const d=run({esdeveniments:[{title:'Audició',data:'2026-12-12'}]},
    'Audició al Teatre del Centre Cívic el 12 de desembre.');
  assert.match(d.esdeveniments[0].lloc||'',/Teatre/);
});
test('C5: mateix acte amb data i amb hora es fusiona i manté hora',()=>{
  const d=run({esdeveniments:[
    {title:'Festa de Nadal',data:'2026-12-20'},
    {title:'Festa de Nadal',data:'2026-12-20 17:30',lloc:'Teatre Municipal'}]},
    'Festa de Nadal el 20 de desembre a les 17:30 al Teatre Municipal.');
  assert.equal(d.esdeveniments.length,1);
  assert.equal(d.esdeveniments[0].data,'2026-12-20 17:30');
});
test('C5: diferents hores reals al mateix dia no es fusionen',()=>{
  const d=run({esdeveniments:[
    {title:'Partit',data:'2026-11-21 10:00'},
    {title:'Partit',data:'2026-11-21 15:00'}]},
    'Partit a les 10:00 i un segon partit a les 15:00 el 21 de novembre.');
  assert.equal(d.esdeveniments.length,2);
});
test('C6: dues quotes domiciliades amb dates distintes originen tasques distintes',()=>{
  const d=run({recordatoris:[
    {text:'La quota domiciliada de 70 € es carregarà el 15 de novembre',data:'2026-11-15'},
    {text:'La quota domiciliada de 70 € es carregarà el 15 de gener',data:'2027-01-15'}]},
    'La quota de 70 € es carregarà per domiciliació el 15 de novembre i el 15 de gener.');
  assert.equal(d.accions.length,2);
  assert.equal(d.accions[0].prioritat,'mitja');
  assert.match(d.decisio,/tasques pendents/);
});
test('C6: cal portar material és una tasca, no sols recordatori',()=>{
  const d=run({recordatoris:[{text:'Cal portar esmorzar i una ampolla d’aigua',data:'2026-11-19'}]},
    'Per la sortida del 19 de novembre cal portar esmorzar i una ampolla d’aigua.');
  assert.equal(d.accions.length,1);
  assert.match(d.decisio,/esmorzar/);
});
test('C7: avís sanitari de polls no pot quedar amb prioritat baixa',()=>{
  const d=run({accions:[{accio:'Revisar el cap aquesta nit per possible contagi de polls',tipus:'tasca',prioritat:'baixa'}]},
    'S’han detectat polls; revisar el cap aquesta nit.');
  assert.equal(d.accions[0].prioritat,'mitja');
});
test('C7: una inscripció explícitament opcional continua baixa',()=>{
  const d=run({accions:[{accio:'Si voleu, sol·licitar plaça opcional abans del 27 de novembre',tipus:'tasca',prioritat:'alta'}]},
    'Si voleu podeu sol·licitar plaça opcional abans del 27 de novembre.');
  assert.equal(d.accions[0].prioritat,'baixa');
});
