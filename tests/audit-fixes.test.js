'use strict';
// Regressions de l'auditoria independent del PR #20 (Claude). Cada test reprodueix un error confirmat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis, extractUseful, extractSourceWeekdays, ibanValid } = require('../lib/nexlupa-result');
const { rebaseVerifiedTime, resolveWeekdayNumber } = require('../lib/date-evidence');
const T = '2026-11-12';
const run = (raw, src, opts) => normalizeAnalysis(Object.assign({resum:'x',accions:[]}, raw), src, T, undefined, opts);

test('G1 · partit suspès no entra al calendari amb una data inventada', () => {
  const d = run({esdeveniments:[{title:'Partit suspès (pavelló tancat)',data:null}]},
    'Aquest dissabte el partit queda suspès. Ja us avisarem de la nova data.');
  assert.equal(d.esdeveniments[0].data, null);
  assert.equal(d.esdeveniments[0].estat, 'suspes');
});
test('G1 · suspès amb data de la IA: es guarda com a dataOriginal, no al calendari', () => {
  const d = run({esdeveniments:[{title:'Partit suspès',data:'2026-11-14'}]}, 'Aquest dissabte el partit queda suspès.');
  assert.equal(d.esdeveniments[0].data, null);
  assert.equal(d.esdeveniments[0].dataOriginal, '2026-11-14');
});
test('G1 · recuperació d\'una activitat NO es tracta com a suspesa', () => {
  const d = run({esdeveniments:[{title:'Recuperació de robòtica',data:'2026-11-19 17:00'}]},
    'Avui no hi ha robòtica. La recuperem dijous que ve a les 17:00.');
  assert.equal(d.esdeveniments[0].data, '2026-11-19 17:00');
});
test('G1 · activitat recurrent no rep una sola data per override', () => {
  const d = run({esdeveniments:[{title:'Ball',data:null}]}, 'Recordeu que tots els dimarts tenim ball a les 17h');
  assert.equal(d.esdeveniments[0].data, null);
});
test('G2 · canvi d\'hora: es conserva la NOVA', () => {
  assert.equal(rebaseVerifiedTime('2026-11-14 16:00','2026-11-14',"CANVI D'HORA! El partit de dissabte passa de les 16h a les 18:30."), '2026-11-14 18:30');
  assert.equal(rebaseVerifiedTime('2026-11-14 16:00','2026-11-14','No a les 16:00; ara a les 18:30'), '2026-11-14 18:30');
});
test('G2 · 18h30, 18.30 i "les sis de la tarda" no perden l\'hora', () => {
  assert.equal(rebaseVerifiedTime('2026-11-17 18:30','2026-11-17','Assaig dimarts a les 18h30'), '2026-11-17 18:30');
  assert.equal(rebaseVerifiedTime('2026-11-17 18:30','2026-11-17','Assaig dimarts a les 18.30h'), '2026-11-17 18:30');
  assert.equal(rebaseVerifiedTime('2026-11-16 18:00','2026-11-16',"dilluns comença el curs a les sis de la tarda"), '2026-11-16 18:00');
});
test('G2 · rang «de 9:00 a 14:30» no es confon amb un canvi d\'hora', () => {
  assert.equal(rebaseVerifiedTime('2026-11-19 09:00','2026-11-19','Sortim de les 9:00 a les 14:30'), '2026-11-19 09:00');
});
test('G2 · hora inventada per la IA es descarta', () => {
  assert.equal(rebaseVerifiedTime('2026-11-19 20:00','2026-11-19','Dijous que ve'), '2026-11-19');
});
test('G3 · imports amb milers, euros i símbol davant', () => {
  const u = extractUseful('Quota 1.250,50 €, 30 euros i € 12. Matrícula 5 €', {});
  assert.deepEqual(u.imports.sort(), ['1.250,50 €','30 euros','5 €','€ 12'].sort());
});
test('G3 · telèfons amb diferents separadors i sense confondre\'ls amb IBAN', () => {
  const u = extractUseful('IBAN ES91 2100 0418 4502 0005 1332. Truqueu al 931234567 o al 93 123 45 67', {});
  assert.deepEqual(u.telefons.sort(), ['93 123 45 67','931234567'].sort());
  assert.equal(u.iban.length, 1);
});
test('G4 · IBAN inventat per la IA a partir d\'una imatge es descarta (mòdul 97)', () => {
  const u = extractUseful('', {iban:['ES00 0000 0000 0000 0000 0000','ES91 2100 0418 4502 0005 1332']}, {fromImage:true});
  assert.deepEqual(u.iban, ['ES91 2100 0418 4502 0005 1332']);
  assert.equal(u.origenImatge, true);
  assert.ok(u.avisos.some(a => /no vàlid/.test(a)));
});
test('G4 · imatge: l\'enllaç llegit no es perd', () => {
  const d = run({accions:[{accio:'Inscriure\'s',tipus:'tasca',enllac:'https://exemple.cat/form'}]}, '', {fromImage:true});
  assert.equal(d.accions[0].enllac, 'https://exemple.cat/form');
});
test('G4 · text: l\'enllaç inventat per la IA es descarta', () => {
  const d = run({accions:[{accio:'Inscriure\'s',tipus:'tasca',enllac:'https://inventat.cat'}]}, 'Inscripció a la secretaria');
  assert.equal(d.accions[0].enllac, null);
});
test('ibanValid · exemple conegut', () => {
  assert.equal(ibanValid('ES91 2100 0418 4502 0005 1332'), true);
  assert.equal(ibanValid('ES92 2100 0418 4502 0005 1332'), false);
});
test('M1 · mesos en castellà es reconeixen', () => {
  const r = extractSourceWeekdays('el sábado 21 de noviembre y el viernes 18 de diciembre, martes 5 de mayo, sábado 4 de julio');
  assert.deepEqual(r.map(x => x.month), [11, 12, 5, 7]);
});
test('M1 · cas 36: dissabte 21 de novembre vàlid no genera conflicte', () => {
  const d = run({esdeveniments:[{title:'Fiesta',data:'2026-11-21'}]}, 'Fiesta el sábado 21 de noviembre');
  assert.equal(d.esdeveniments[0].data, '2026-11-21');
  assert.equal(d.avisDates, null);
});
test('M2 · «diumenge 13» sense mes es resol al 13/12/2026 amb avís', () => {
  assert.equal(resolveWeekdayNumber('diumenge', 13, T, 3), '2026-12-13');
  const d = run({esdeveniments:[{title:'Assaig',data:'2026-11-13'}]}, 'Assaig diumenge 13 a les 10h');
  assert.equal(d.esdeveniments[0].data, '2026-12-13');
  assert.match(d.avisDates, /13\/12\/2026/);
});
test('M2 · «dimecres 25» ja correcte no s\'altera', () => {
  const d = run({esdeveniments:[{title:'Reunió',data:'2026-11-25 17:00'}]}, 'Reunió dimecres 25 a les 17:00');
  assert.equal(d.esdeveniments[0].data, '2026-11-25 17:00');
});
test('M2 · «dilluns 24» (és dimarts) no es corregeix en silenci ni salta mesos', () => {
  const d = run({esdeveniments:[{title:'Entrenament',data:'2026-11-24'}]}, 'Ens veiem dilluns 24.');
  assert.equal(d.esdeveniments[0].data, '2026-11-24');
  assert.equal(d.esdeveniments[0].dataDubtosa, true);
  assert.match(d.avisDates, /dimarts/);
});
test('M2 · «divendres 26 de novembre» (és dijous) continua sent null + avís', () => {
  const d = run({esdeveniments:[{title:'Festa',data:'2026-11-26'}]}, 'Festa divendres 26 de novembre');
  assert.equal(d.esdeveniments[0].data, '2026-11-26');
  assert.equal(d.esdeveniments[0].dataDubtosa, true);
  assert.match(d.avisDates, /dijous/);
});
test('M4 · data passada sense any al text es marca per confirmar', () => {
  const d = run({esdeveniments:[{title:'Excursió',data:'2026-05-04'}]}, 'Excursió el 4 de maig');
  assert.equal(d.esdeveniments[0].passada, true);
  assert.match(d.avisDates, /ja ha passat/);
});
test('M4 · terminis vençuts amb any explícit no es toquen', () => {
  const d = run({accions:[{accio:'Pagar abans del termini',tipus:'tasca',data:'2026-11-11',prioritat:'alta'}]},
    'El termini va acabar l\'11/11/2026.');
  assert.equal(d.accions[0].data, '2026-11-11');
  assert.equal(d.accions[0].vençut, true);
});
