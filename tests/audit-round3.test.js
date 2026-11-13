'use strict';
// Regressions de la 3a ronda (avaluació de respostes reals). Tots els exemples són sintètics i genèrics.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis, humanizeIsoDates } = require('../lib/nexlupa-result');
const T = '2026-11-12';
const run = (raw, src) => normalizeAnalysis(Object.assign({resum:'x',accions:[]}, raw), src, T);

test('R3 · data inventada «avui» sense indici al missatge → es treu i es demana confirmar', () => {
  const d = run({esdeveniments:[{title:'Reunió de pares',data:'2026-11-12 18:00'}]},
    'Us convoquem a la reunió de pares a les 18:00 al menjador de l\'escola.');
  assert.equal(d.esdeveniments[0].data, null);
  assert.equal(d.esdeveniments[0].dataDubtosa, true);
});
test('R3 · «avui» explícit conserva la data', () => {
  const d = run({esdeveniments:[{title:'Reunió',data:'2026-11-12 18:00'}]},
    'Avui a les 18:00 hi ha reunió de pares.');
  assert.equal(d.esdeveniments[0].data, '2026-11-12 18:00');
});
test('R3 · «abans de dijous» sense número, amb acte posterior → dijous de la setmana de l\'acte', () => {
  const d = run({
    esdeveniments:[{title:'Sortida',data:'2026-12-16'}],
    accions:[{accio:'Entregar l\'autorització',tipus:'tasca',data:null,dataFi:'2026-11-12',prioritat:'alta'}]},
    'Sortida el 16 de desembre. Cal entregar l\'autorització abans de dijous.');
  assert.equal(d.accions[0].dataFi, '2026-12-10');
  assert.equal(d.accions[0].dataDubtosa, true);
});
test('R3 · «dijous» sense acte posterior no es toca', () => {
  const d = run({accions:[{accio:'Portar l\'autorització',tipus:'tasca',data:null,dataFi:'2026-11-19',prioritat:'alta'}]},
    'Cal portar l\'autorització abans de dijous.');
  assert.equal(d.accions[0].dataFi, '2026-11-19');
});
test('R3 · terme vençut amb dataFi marca vençut', () => {
  const d = run({accions:[{accio:'Pagar la quota',tipus:'tasca',data:null,dataFi:'2026-11-05',prioritat:'alta'}]},
    'Recordem que el termini per pagar la quota era el 5 de novembre de 2026.');
  assert.equal(d.accions[0]['vençut'], true);
});
test('R3 · dates ISO dins el text es converteixen', () => {
  assert.equal(humanizeIsoDates('Lliurar abans del 2026-12-11.', 2026), 'Lliurar abans del 11 de desembre.');
  assert.equal(humanizeIsoDates('Fins el 2027-01-08', 2026), 'Fins el 8 de gener de 2027');
  assert.equal(humanizeIsoDates('Inici 2026-10-05 18:00', 2026), 'Inici 2026-10-05 18:00');
});
test('R3 · resum i acció surten sense ISO', () => {
  const d = run({resum:'Entrega abans del 2026-12-11', accions:[{accio:'Entregar abans del 2026-12-11',tipus:'tasca',prioritat:'mitjana'}]},
    'Entrega abans del 11 de desembre.');
  assert.doesNotMatch(d.resum, /2026-12-11/);
  assert.doesNotMatch(d.accions[0].accio, /2026-12-11/);
});
test('R3 · «si es desitja» és opcional (no alta)', () => {
  const d = run({accions:[{accio:'Portar fruita',tipus:'tasca',prioritat:'alta'}]},
    'Si es desitja, podeu portar fruita per compartir.');
  assert.notEqual(d.accions[0].prioritat, 'alta');
});
test('R3 · «diumenge 15» que no coincideix amb cap data → es força la propera data real i es demana revisar', () => {
  const d = run({esdeveniments:[{title:'Torneig',data:'2026-11-15 10:00'}]},
    'Torneig diumenge 22 a les 10:00 al pavelló.');
  assert.equal(d.esdeveniments[0].data.slice(0,10), '2026-11-22');
  assert.equal(d.esdeveniments[0].dataDubtosa, true);
});
test('R3 · weekday+número coherent no es toca', () => {
  const d = run({esdeveniments:[{title:'Torneig',data:'2026-11-22 10:00'}]},
    'Torneig diumenge 22 a les 10:00 al pavelló.');
  assert.equal(d.esdeveniments[0].data, '2026-11-22 10:00');
  assert.ok(!d.esdeveniments[0].dataDubtosa);
});
