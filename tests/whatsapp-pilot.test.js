'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseWhatsAppExport, reconcileFacts } = require('../lib/whatsapp/pilot');

const chat = [
  '08/11/2026, 18:01 - Els missatges d’aquest xat estan xifrats',
  '08/11/2026, 18:02 - Coordinació: Dimecres 11 sortim a les 9:00.',
  '08/11/2026, 18:03 - Família: Cal portar una carmanyola?',
  '08/11/2026, 18:04 - Coordinació: Sí, carmanyola i aigua.',
  '08/11/2026, 18:05 - Coordinació: Correcció: sortim a les 9:30.',
  '08/11/2026, 18:06 - Coordinació: El termini per pagar 8 € és dimarts.',
  '08/11/2026, 18:07 - Família: Moltes gràcies!',
  '08/11/2026, 18:08 - Coordinació: El termini per pagar 8 € és dimarts.',
  '08/11/2026, 18:09 - Coordinació: <Media omitted>'
].join('\n');

test('Android: reconeix el fil, missatges i multilinea, i pseudonimitza remitents', () => {
  const output = parseWhatsAppExport(chat);
  assert.equal(output.messages.length, 8);
  assert.equal(output.meta.senderCount, 2);
  assert.equal(output.meta.skippedSystem, 1);
  assert.equal(output.messages[0].sender, 'P1');
  assert.equal(output.messages[1].sender, 'P2');
  assert.equal(output.messages[7].mediaPending, true);
  assert.equal(output.messages[7].text, '');
  assert.equal(JSON.stringify(output).includes('Coordinació'), false);
  const multiline = parseWhatsAppExport('08/11/2026, 18:02 - Escola: Avís\n- Porteu aigua\n- Porteu gorra');
  assert.equal(multiline.messages[0].text, 'Avís\n- Porteu aigua\n- Porteu gorra');
});

test('iOS: suporta capçaleres amb segons i detecta export repetit', () => {
  const text = '[08/11/2026, 18:02:34] Escola: Hola\n[08/11/2026, 18:02:34] Escola: Hola';
  const output = parseWhatsAppExport(text);
  assert.equal(output.messages.length, 1);
  assert.equal(output.messages[0].at, '2026-11-08T18:02:34');
});

test('Límits i capçaleres invàlides', () => {
  assert.throws(() => parseWhatsAppExport(''), TypeError);
  assert.throws(() => parseWhatsAppExport('a'.repeat(100001)), RangeError);
  assert.equal(parseWhatsAppExport(chat,{maxMessages:2}).messages.length,2);
  assert.equal(parseWhatsAppExport(chat,{maxMessages:2}).meta.truncated, true);
  assert.equal(parseWhatsAppExport('31/02/2026, 18:01 - Escola: no és una data').messages.length,0);
});

test('Correccions substitueixen; contradiccions sense correcció demanen revisió; duplicats no es dupliquen', () => {
  const base = { groupId:'extraescolar', topic:'sortida',field:'time', confidence:'explicit' };
  const data = [
    { ...base, value:'09:00', at:'2026-11-08T18:02:00',sourceId:'m1', operation:'set' },
    { ...base, value:'09:00', at:'2026-11-08T18:02:00',sourceId:'m1', operation:'set' },
    { ...base, value:'09:15', at:'2026-11-08T18:03:00',sourceId:'m2', operation:'set' },
    { ...base, value:'09:30', at:'2026-11-08T18:05:00',sourceId:'m3', operation:'correct' }
  ];
  const [result] = reconcileFacts(data);
  assert.equal(result.value,'09:30');
  assert.equal(result.needsReview,false);
  assert.equal(result.sourceIds.length,3);
  assert.equal(result.history.length,2);
});

test('Manté separats dos grups i no dona per cert un fet incert', () => {
  const result = reconcileFacts([
    { groupId:'escola', topic:'sortida',field:'date',value:'2026-11-11',at:'2026-11-08T10:00:00',sourceId:'a',confidence:'explicit' },
    { groupId:'bàsquet',topic:'sortida',field:'date',value:'2026-11-12',at:'2026-11-08T10:01:00',sourceId:'b',confidence:'explicit' },
    { groupId:'escola', topic:'sortida',field:'date',value:'2026-11-13',at:'2026-11-08T10:02:00',sourceId:'c',confidence:'uncertain' }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].value,'2026-11-11');
});
