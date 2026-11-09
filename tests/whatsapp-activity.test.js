'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listActivityCards, getActivityFact } = require('../lib/whatsapp/activity');

const base = { groupId:'extraescolar',topic:'sortida-parc',confidence:'explicit' };
const updates = [
  { ...base, familyId:'familia-a',field:'time',value:'09:00',at:'2026-11-08T10:00:00',sourceId:'a1',operation:'set' },
  { ...base, familyId:'familia-a',field:'time',value:'09:30',at:'2026-11-08T10:05:00',sourceId:'a2',operation:'correct' },
  { ...base, familyId:'familia-a',field:'materials',value:'aigua i carmanyola',at:'2026-11-08T10:06:00',sourceId:'a3' },
  { ...base, familyId:'familia-a',field:'payment_amount',value:'8€',at:'2026-11-08T10:07:00',sourceId:'a4' },
  { ...base, familyId:'familia-a',field:'payment_amount',value:'10€',at:'2026-11-08T10:08:00',sourceId:'a5' },
  { ...base, familyId:'familia-b',field:'time',value:'08:00',at:'2026-11-08T10:01:00',sourceId:'b1' },
  { ...base, familyId:'familia-a',groupId:'escola',field:'time',value:'11:00',at:'2026-11-08T10:02:00',sourceId:'a6' }
];

test('Fitxa viva: agrupa per família, grup i activitat; conserva correcció i evidències', () => {
  const cards = listActivityCards(updates, {familyId:'familia-a',groupId:'extraescolar'});
  assert.equal(cards.length,1);
  const [c] = cards;
  assert.equal(c.familyId,'familia-a');
  assert.equal(c.groupId,'extraescolar');
  assert.equal(c.fields.time.value,'09:30');
  assert.equal(c.fields.time.history.length,1);
  assert.deepEqual(c.fields.time.sourceIds,['a1','a2']);
  assert.equal(c.fields.materials.value,'aigua i carmanyola');
  assert.equal(c.fields.payment_amount.needsReview,true);
  assert.equal(c.requiresReview,true);
  assert.equal(JSON.stringify(c).includes('"b1"'),false);
  assert.equal(JSON.stringify(c).includes('"a6"'),false);
});

test('Consultes: confirmat, contradicció pendent i camp desconegut', () => {
  const s = {familyId:'familia-a',groupId:'extraescolar',topic:'sortida-parc'};
  assert.deepEqual(getActivityFact(updates,{...s,field:'time'}),{
    state:'confirmed',value:'09:30',sourceIds:['a1','a2']});
  assert.equal(getActivityFact(updates,{...s,field:'payment_amount'}).state,'needs_confirmation');
  assert.deepEqual(getActivityFact(updates,{...s,field:'location'}),{
    state:'unknown',value:null,sourceIds:[]});
});

test('Seguretat: no admet una consulta sense àmbit familiar complet', () => {
  assert.throws(() => listActivityCards(updates,{}), TypeError);
  assert.throws(() => getActivityFact(updates,{
    groupId:'extraescolar',topic:'sortida-parc',field:'time'}),TypeError);
  const result = getActivityFact(updates,{
    familyId:'familia-b',groupId:'extraescolar',topic:'sortida-parc',field:'time'});
  assert.equal(result.value,'08:00');
  assert.equal(listActivityCards(updates,{familyId:'familia-c'}).length,0);
});

test('Una anul·lació explícita no es tracta com a activitat confirmada', () => {
  const xs = [
    { ...base,familyId:'familia-a',field:'status',value:'confirmada',at:'2026-11-08T09:00:00',sourceId:'s1' },
    { ...base,familyId:'familia-a',field:'status',at:'2026-11-08T09:05:00',sourceId:'s2',operation:'cancel' }
  ];
  const result = getActivityFact(xs,{familyId:'familia-a',groupId:'extraescolar',topic:'sortida-parc',field:'status'});
  assert.equal(result.state,'cancelled');
  assert.equal(result.value,null);
});
