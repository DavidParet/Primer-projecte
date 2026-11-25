'use strict';
// UI 2.9 · Correccions de les dues proves reals d'imatges (captura de la sortida i cartell de Nadal).
// La imatge es transcriu literalment i després es normalitza com un text: aquí es prova la normalització
// amb respostes del model que reprodueixen les pèrdues observades. Cap regla és específica d'aquests exemples.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeAnalysis, extractAddresses, extractTrip, deadlineKind } = require('../lib/nexlupa-result');

const ESCOLA = `Bon dia, famílies!

El dimecres 9 de desembre farem la sortida
al Museu Marítim de Barcelona.
Sortirem de l'escola a les 8:45 h i tornarem
cap a les 16:30 h.

El preu és de 14 €. Cal fer el pagament
abans del 3 de desembre.
Cal portar l'autorització signada abans del
4 de desembre.

Porteu esmorzar, dinar i aigua.
Gràcies!  — Laia, tutora de 3r B`;

const CARTELL = `FESTA DE NADAL
AMPA Escola Els Pins
Dissabte 19 de desembre
de 10:00 a 13:00 h
Pati de l'escola
C/ dels Pins, 12 · Sant Cugat
Xocolatada solidària: 2 €
Taller de fanalets per a infants
Inscripcions al taller fins al
15 de desembre a ampa@elspins.cat`;

const REF = '2026-11-25';
const run = (raw, src) => normalizeAnalysis(raw, src, REF, null, { origenImatge: true });

test('Sortida: 8:45 és la sortida de l’escola, no l’inici de la visita; tornada aproximada i destinació separades', () => {
  const d = run({
    resum: 'Sortida al Museu Marítim de Barcelona el 9 de desembre. La visita començarà a les 8:45 i acabarà a les 16:30.',
    decisio: 'Pagar i portar l’autorització.',
    esdeveniments: [{ title: 'Visita al Museu Marítim de Barcelona', data: '2026-12-09 08:45', lloc: 'Museu Marítim de Barcelona' }],
    accions: [
      { accio: 'Fer el pagament de 14 € abans del 3 de desembre', tipus: 'tasca', data: '2026-12-03', prioritat: 'alta' },
      { accio: 'Portar l’autorització signada abans del 4 de desembre', tipus: 'tasca', data: '2026-12-04', prioritat: 'alta' },
      { accio: 'Portar esmorzar, dinar i aigua', tipus: 'tasca', data: '2026-12-09', prioritat: 'mitja' }
    ],
    recordatoris: [], dadesUtils: { imports: ['14 €'] }
  }, ESCOLA);
  const ev = d.esdeveniments[0];
  assert.deepStrictEqual(ev.desplacament.sortida, { hora: '08:45', lloc: "l'escola" });
  assert.deepStrictEqual(ev.desplacament.tornada, { hora: '16:30', aprox: true });
  assert.strictEqual(ev.desti, 'Museu Marítim de Barcelona');
  assert.strictEqual(ev.dataFi, '2026-12-09 16:30');
  assert.ok(!/visita començarà a les 8:45/.test(d.resum), d.resum);
  assert.ok(/Sortirem de l'escola a les 8:45 h/.test(d.resum));
  assert.ok(!ev.adreca, 'cap adreça inventada per a l’escola');
  assert.strictEqual(d.accions.find(a => /pagament/.test(a.accio)).tipusTermini, 'abans');
  assert.strictEqual(d.accions.find(a => /autorització/.test(a.accio)).tipusTermini, 'abans');
  assert.ok(d.dadesUtils.importsDetall.some(x => x.import === '14 €'));
  assert.ok(/esmorzar, dinar i aigua/.test(d.accions[2].accio));
  assert.strictEqual(d.origenImatge, true);
  assert.ok(!('origenImatge' in d.dadesUtils), 'l’avís d’imatge no és una dada útil');
});

test('Cartell: lloc i adreça literals per a Maps, 2 € lligats a la xocolatada, «fins al» conservat', () => {
  const d = run({
    resum: 'Festa de Nadal de l’AMPA el 19 de desembre de 10:00 a 13:00. L’entrada costa 2 €. Hi ha un taller de fanalets.',
    decisio: 'Inscriure’s al taller.',
    esdeveniments: [{ title: 'Festa de Nadal', data: '2026-12-19 10:00', dataFi: '2026-12-19 13:00', lloc: 'C/ dels Pins, 12' }],
    accions: [{ accio: 'Inscriure els infants al taller de fanalets abans del 15 de desembre (ampa@elspins.cat)', tipus: 'tasca', data: '2026-12-15', prioritat: 'alta' }],
    recordatoris: [], dadesUtils: { imports: ['2 €'] }
  }, CARTELL);
  const ev = d.esdeveniments[0];
  assert.strictEqual(ev.lloc, "Pati de l'escola");
  assert.strictEqual(ev.adreca, 'C/ dels Pins, 12, Sant Cugat');
  assert.strictEqual(ev.data, '2026-12-19 10:00'); assert.strictEqual(ev.dataFi, '2026-12-19 13:00');
  assert.ok(!/entrada costa 2/.test(d.resum)); assert.ok(/Xocolatada solidària: 2 €/.test(d.resum));
  assert.deepStrictEqual(d.dadesUtils.importsDetall, [{ import: '2 €', concepte: 'Xocolatada solidària: 2 €' }]);
  const a = d.accions[0];
  assert.ok(/fins al 15 de desembre/.test(a.accio) && !/abans del 15/.test(a.accio), a.accio);
  assert.strictEqual(a.tipusTermini, 'fins');
  assert.ok(d.dadesUtils.altres.includes('ampa@elspins.cat'));
});

test('Regles generals: adreces només literals i amb número; sortida/tornada; tipus de termini', () => {
  assert.deepStrictEqual(extractAddresses('Reunió a l’escola a les 17 h.'), []);
  assert.deepStrictEqual(extractAddresses('L’acte serà a la Plaça Central el 24 de novembre.'), []);
  assert.strictEqual(extractAddresses('Concert a l’Auditori Municipal (Carrer Major, 5) a les 18 h')[0].recinte, 'Auditori Municipal');
  assert.deepStrictEqual(extractTrip('Sortirem a les 9 h i tornarem a les 17:15 h.'), { sortida: { hora: '09:00', lloc: null }, tornada: { hora: '17:15', aprox: false } });
  assert.strictEqual(extractTrip('Reunió a les 18 h.'), null);
  assert.strictEqual(deadlineKind('Inscripcions fins al 15 de desembre', '2026-12-15'), 'fins');
  assert.strictEqual(deadlineKind('Pagament abans del 3 de desembre', '2026-12-03'), 'abans');
  assert.strictEqual(deadlineKind('El 3 de desembre hi ha reunió', '2026-12-03'), null);
});

// Resposta REAL del model a la preview (25/11/2026, captura de l'escola): «abans del 3/4» guardats com a dataFi 2 i 3.
test('Motor real: el termini mostrat és el del missatge, no la data interna (abans del 3 → dataFi 2)', () => {
  const d = run({
    resum: 'Sortida al Museu Marítim de Barcelona el 9 de desembre amb sortida a les 8:45 h i tornada a les 16:30 h.',
    decisio: "Fer el pagament de 14 € abans del 3 de desembre i portar l'autorització signada abans del 4 de desembre.",
    mainEvent: { title: 'Sortida al Museu Marítim de Barcelona', data: '2026-12-09 08:45', dataFi: null, lloc: 'Museu Marítim de Barcelona' },
    esdeveniments: [{ title: 'Sortida al Museu Marítim de Barcelona', data: '2026-12-09 08:45', dataFi: null, lloc: 'Museu Marítim de Barcelona' }],
    accions: [
      { accio: 'Fer el pagament de 14 € abans del 3 de desembre', tipus: 'tasca', data: null, dataFi: '2026-12-02', prioritat: 'alta' },
      { accio: "Portar l'autorització signada abans del 4 de desembre", tipus: 'tasca', data: null, dataFi: '2026-12-03', prioritat: 'alta' },
      { accio: 'Portar esmorzar, dinar i aigua el dia de la sortida', tipus: 'tasca', data: '2026-12-09', dataFi: null, prioritat: 'mitja' }],
    recordatoris: [], dadesUtils: { imports: ['14 €'] }
  }, ESCOLA);
  assert.deepStrictEqual(d.accions[0].termini, { tipus: 'abans', data: '2026-12-03' });
  assert.deepStrictEqual(d.accions[1].termini, { tipus: 'abans', data: '2026-12-04' });
  assert.strictEqual(d.accions[2].termini, undefined);
});

test('Motor real: la tornada aproximada es conserva al resum («cap a les 16:30»)', () => {
  const d = run({ resum: 'Sortida al Museu Marítim de Barcelona el 9 de desembre amb sortida a les 8:45 h i tornada a les 16:30 h.', decisio: 'x',
    esdeveniments: [{ title: 'Sortida al Museu Marítim de Barcelona', data: '2026-12-09 08:45', lloc: 'Museu Marítim de Barcelona' }],
    accions: [], recordatoris: [{ text: 'Sortida amb tornada a les 16:30 h.', data: '2026-12-09' }] }, ESCOLA);
  assert.ok(/tornada cap a les 16:30 h/.test(d.resum), d.resum);
  assert.ok(/tornada cap a les 16:30 h/.test(d.recordatoris[0].text));
  assert.ok(/sortida a les 8:45 h/.test(d.resum));
});
