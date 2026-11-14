'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis } = require('../lib/nexlupa-result');

const analyze = (source, input) => normalizeAnalysis(input, source, '2026-11-14');

test('an annulled session keeps its replacement active', () => {
  const result = analyze('La sessió del 18/11 queda cancel·lada. La farem el 25/11 a les 17 al Teatre Monumental de Mataró.', {
    esdeveniments: [
      { title: 'Sessió cancel·lada', data: '2026-11-18' },
      { title: 'Sessió', data: '2026-11-25 17:00' }
    ]
  });
  assert.equal(result.esdeveniments[0].estat, 'suspes');
  assert.equal(result.esdeveniments[1].data, '2026-11-25 17:00');
  assert.equal(result.esdeveniments[1].lloc, 'Teatre Monumental de Mataró');
});

test('a previously postponed match already played does not cancel the next one', () => {
  const result = analyze('Avui hem jugat el partit ajornat. El partit següent és diumenge 22 de novembre a les 10.', {
    mainEvent: { title: 'Partit de diumenge', data: '2026-11-22 10:00' }
  });
  assert.equal(result.mainEvent.data, '2026-11-22 10:00');
});

test('alternative rates without a repeated discount keyword form one optional task', () => {
  const result = analyze('Pagament avançat fins al 17/11 amb un 10% de descompte, o fins al 22/11 amb un 3%. Només se n’ha de triar una.', {
    accions: [
      { accio: 'Fer el pagament avançat amb un 10%', dataFi: '2026-11-17', prioritat: 'alta' },
      { accio: 'Fer el pagament avançat amb un 3%', dataFi: '2026-11-22', prioritat: 'alta' }
    ]
  });
  assert.equal(result.accions.length, 1);
  assert.equal(result.accions[0].prioritat, 'baixa');
  assert.match(result.accions[0].accio, /10%.*3%/);
});

test('a narrative fragment is replaced with the explicitly named venue', () => {
  const result = analyze('La data del casal de tarda és el 22/11/2026 a les 15:45 a la Biblioteca Mercè Rodoreda de Sant Joan Despí.', {
    mainEvent: { title: 'Casal de tarda', data: '2026-11-22 15:45', lloc: 'casal de tarda és' }
  });
  assert.equal(result.mainEvent.lloc, 'Biblioteca Mercè Rodoreda de Sant Joan Despí');
});

test('an ordinary entrance is not a venue and a material task is not an event', () => {
  const result = analyze('La foto serà el 30/11 a les 9. Entrada per la porta habitual. Demà porteu material de recanvi.', {
    mainEvent: { title: 'Foto', data: '2026-11-30 09:00', lloc: 'Porta habitual' },
    esdeveniments: [{ title: 'Portar material de recanvi', data: '2026-11-15' }],
    accions: [{ accio: 'Portar material de recanvi', data: '2026-11-15' }]
  });
  assert.equal(result.mainEvent.lloc, null);
  assert.equal(result.esdeveniments.length, 1);
  assert.equal(result.accions.length, 1);
});

test('an event date appended to a venue is removed from its map query', () => {
  const result = analyze('La trobada a la Biblioteca Mercè Rodoreda de Sant Joan Despí del 22/11 és a les 10.', {
    mainEvent: { title: 'Trobada', data: '2026-11-22 10:00', lloc: 'Biblioteca Mercè Rodoreda de Sant Joan Despí del 22/11' }
  });
  assert.equal(result.mainEvent.lloc, 'Biblioteca Mercè Rodoreda de Sant Joan Despí');
});

test('both source rates survive a missing model option and a swapped date', () => {
  const result = analyze('Pagament avançat fins al 20/11 amb un 10% de descompte, o fins al 25/11 amb un 3%.', {
    accions: [{ accio: 'Realitzar el pagament avançat amb un 10%', dataFi: '2026-11-25', prioritat: 'alta' }]
  });
  assert.equal(result.accions.length, 1);
  assert.equal(result.accions[0].prioritat, 'baixa');
  assert.equal(result.accions[0].dataFi, '2026-11-20');
  assert.match(result.accions[0].accio, /10%.*20.*3%.*25/);
});

test('a separate explicit optional participation survives model omission', () => {
  const result = analyze('Cal lliurar el full abans del 18/11. Podeu venir disfressats si us ve de gust.', {
    accions: [{ accio: 'Lliurar el full', dataFi: '2026-11-18', prioritat: 'alta' }]
  });
  assert.equal(result.accions.length, 2);
  assert.equal(result.accions[0].prioritat, 'alta');
  assert.equal(result.accions[1].prioritat, 'baixa');
  assert.match(result.accions[1].accio, /disfressats/);
});

test('explicit optional materials and activities are retained independently', () => {
  const result = analyze('Cal portar una carpeta. Podeu dur una càmera. La fotografia de grup és opcional.', {
    accions: [
      { accio: 'Portar una carpeta', prioritat: 'mitja' },
      { accio: 'Portar una càmera', prioritat: 'mitja' }
    ]
  });
  assert.deepEqual(result.accions.map(a => a.prioritat).sort(), ['baixa', 'baixa', 'mitja']);
  assert.equal(result.accions.filter(a => /càmera/.test(a.accio)).length, 1);
  assert.ok(result.accions.some(a => /fotografia/i.test(a.accio)));
});

test('an optional participation already extracted as a verb is not duplicated', () => {
  const result = analyze('La participació en el sorteig és opcional.', {
    accions: [{ accio: 'Participar en el sorteig', prioritat: 'baixa' }]
  });
  assert.equal(result.accions.length, 1);
  assert.equal(result.accions[0].prioritat, 'baixa');
});
