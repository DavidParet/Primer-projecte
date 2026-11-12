'use strict';
// Errors de SIGNIFICAT trobats en la 2a auditoria independent (Claude) sobre fix/qa96-deterministic-dates-20261112.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { normalizeAnalysis, extractUseful } = require('../lib/nexlupa-result');
const T = '2026-11-12';
const run = (raw, src) => normalizeAnalysis(Object.assign({resum:'x',accions:[]}, raw), src, T);

test('S1 · «cancel·lar la inscripció» (infinitiu) NO suspèn l\'acte', () => {
  const d = run({esdeveniments:[{title:'Colònies',data:'2027-01-13'}]},
    'Colònies el 13 de gener 2027. Qui vulgui cancel·lar la inscripció ho ha de dir abans del 30/11/2026.');
  assert.equal(d.esdeveniments[0].data, '2027-01-13');
  assert.equal(d.esdeveniments[0].estat, undefined);
});
test('S1 · «han suspès el transport» no suspèn el partit', () => {
  const d = run({esdeveniments:[{title:'Partit a Manresa',data:'2026-11-14 16:30'}]},
    'El partit de dissabte a Manresa és a les 16:30. Ens han suspès el transport en autocar, aniu en cotxe.');
  assert.equal(d.esdeveniments[0].data, '2026-11-14 16:30');
});
test('S1 · suspensió d\'un dia no suspèn l\'altre dia', () => {
  const d = run({esdeveniments:[{title:'Entrenament de dijous',data:'2026-11-19 18:00'}]},
    'Dimarts s\'ha suspès l\'entrenament per pluja. Dijous entrenem amb normalitat a les 18:00.');
  assert.equal(d.esdeveniments[0].data, '2026-11-19 18:00');
  assert.equal(d.esdeveniments[0].estat, undefined);
});
test('S1 · la suspensió real continua funcionant', () => {
  const d = run({esdeveniments:[{title:'Partit',data:'2026-11-14'}]},
    'Aquest dissabte el partit queda suspès perquè el pavelló està tancat. Ja us avisarem.');
  assert.equal(d.esdeveniments[0].data, null);
  assert.equal(d.esdeveniments[0].estat, 'suspes');
});
test('S2 · acte puntual amb data absoluta no es converteix en «recurrent»', () => {
  const d = run({esdeveniments:[{title:'Assaig especial de Nadal',data:'2026-12-18 18:00'}]},
    'Recordeu que els dimarts tenim ball de 17 a 18h. Divendres 18 de desembre a les 18:00 assaig especial de Nadal.');
  assert.equal(d.esdeveniments[0].data, '2026-12-18 18:00');
  assert.equal(d.esdeveniments[0].estat, undefined);
});
test('S2 · la recurrència real continua funcionant', () => {
  const d = run({esdeveniments:[{title:'Ball',data:'2026-11-17'}]}, 'Recordeu que tots els dimarts tenim ball a les 17h');
  assert.equal(d.esdeveniments[0].estat, 'recurrent');
});
test('S3 · prioritat: pagament i autorització mai per sota d\'alta; opcional sempre baixa', () => {
  const d = run({accions:[
    {accio:'Pagar 30 € de la quota',tipus:'tasca',data:'2026-11-20',prioritat:'baixa'},
    {accio:'Si voleu, porteu una pilota',tipus:'tasca',prioritat:'alta'},
    {accio:'Signar l\'autorització',tipus:'tasca',prioritat:'mitja'},
    {accio:'Portar esmorzar',tipus:'tasca',prioritat:'mitja'}]},
    'Cal pagar 30 € abans del 20/11/2026 i signar l\'autorització. Si voleu, porteu una pilota. Porteu esmorzar.');
  const p = Object.fromEntries(d.accions.map(a => [a.accio.split(' ')[0], a.prioritat]));
  assert.equal(p.Pagar, 'alta'); assert.equal(p.Si, 'baixa'); assert.equal(p.Signar, 'alta'); assert.equal(p.Portar, 'mitja');
});
test('S4 · tasca amb data passada i any explícit és «vençut» encara que no tingui paraula clau', () => {
  const d = run({accions:[{accio:'Portar la fitxa mèdica',tipus:'tasca',data:'2026-11-10',prioritat:'alta'}]},
    'La fitxa s\'havia de portar el 10/11/2026.');
  assert.equal(d.accions[0].vençut, true);
});
test('S5 · enllaços sense esquema i correus no es perden', () => {
  const u = extractUseful('Inscripció a forms.gle/AbC123 o www.escola.cat/inscripcio. Dubtes: secretaria@escola.cat. Fotos: bit.ly/xx', {});
  assert.ok(u.enllacos.includes('https://forms.gle/AbC123'));
  assert.ok(u.enllacos.includes('https://www.escola.cat/inscripcio'));
  assert.ok(u.enllacos.includes('https://bit.ly/xx'));
  assert.ok(u.altres.includes('secretaria@escola.cat'));
});
test('S6 · l\'historial desa esdeveniments, dades útils i avisos (frontend real)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/script.js'), 'utf8');
  const fn = src.match(/^function saveToHistorial\([^]*?^\}/m)[0];
  const store = {};
  const ctx = { _allTasques: [], _historial: [], localStorage: { setItem: (k, v) => { store[k] = v; } },
    updateBadges() {}, renderHistory() {}, _accionText: a => (a && a.accio) || '', Date, Math, JSON };
  vm.createContext(ctx); vm.runInContext(fn, ctx);
  ctx.saveToHistorial({resum:'r',accions:[{accio:'Pagar',prioritat:'alta'}],esdeveniments:[{title:'Partit',data:'2026-11-14'}],
    dadesUtils:{iban:['ES91 2100 0418 4502 0005 1332']},avisDates:'Confirma la data',recordatoris:[{text:'x'}]});
  const e = ctx._historial[0];
  assert.equal(e.esdeveniments.length, 1);
  assert.deepEqual(e.dadesUtils.iban, ['ES91 2100 0418 4502 0005 1332']);
  assert.equal(e.avisDates, 'Confirma la data');
  assert.equal(e.recordatoris.length, 1);
});
