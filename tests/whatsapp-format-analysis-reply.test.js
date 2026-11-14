'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {formatAnalysisReply} = require('../lib/whatsapp/format-analysis-reply');

test('formats a forwarded notice from the current engine result for the WhatsApp chat', () => {
  const event = {title: 'Gran Recapte', data: '2026-11-20', dataFi: '2026-11-21', lloc: 'Supermercat'};
  const reply = formatAnalysisReply({
    resum: 'Recollida d’aliments de llarga durada.',
    decisio: 'Porta aliments al punt de recollida.',
    esdeveniments: [event],
    mainEvent: event,
    accions: [{accio: 'Portar aliments'}]
  });
  assert.equal(reply, [
    '🔍 NexLupa',
    'Què cal fer\nPorta aliments al punt de recollida.',
    'Recollida d’aliments de llarga durada.',
    'Esdeveniments\n• Gran Recapte · 2026-11-20 – 2026-11-21 · Supermercat',
    'Accions\n• Portar aliments'
  ].join('\n\n'));
});

test('keeps the warning visible and avoids presenting an uncertain date as confirmed', () => {
  const reply = formatAnalysisReply({
    resum: 'Avís de sortida.',
    avisDates: 'El dia i la data no coincideixen.',
    mainEvent: {title: 'Sortida', data: '2026-11-20', dataDubtosa: true},
    accions: [null, {accio: 'Portar la fitxa', data: '2026-11-21', vençut: true}]
  });
  assert.ok(reply.indexOf('Revisa les dades') < reply.indexOf('Avís de sortida.'));
  assert.match(reply, /Sortida \(revisa la data\)/);
  assert.match(reply, /Portar la fitxa \(termini vençut\)/);
  assert.doesNotMatch(reply, /2026-11/);
});

test('handles a notice with no actions and rejects an invalid engine result', () => {
  assert.equal(formatAnalysisReply({resum: 'Avís informatiu.', accions: []}),
    '🔍 NexLupa\n\nAvís informatiu.');
  assert.throws(() => formatAnalysisReply({resum: 'Avís incomplet'}), TypeError);
});

test('bounds long replies without leaving a partial emoji', () => {
  const reply = formatAnalysisReply({resum: '🙂'.repeat(4096), accions: []});
  assert.ok(reply.length <= 4096);
  assert.match(reply, /s’ha escurçat\.$/);
  assert.equal(Buffer.from(reply, 'utf8').toString('utf8'), reply);
});
