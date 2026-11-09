'use strict';
const assert = require('node:assert/strict');
const { processMessage } = require('../lib/activity-sync');

/**
 * Contract test: synthetic messages supplied to a future authorized intake.
 * No WhatsApp/Gmail/OpenAI/Google API calls are made.
 */
const start = {
  id: 'basket-001', enabled: true, name: 'Bàsquet',
  timezone: 'Europe/Madrid', calendarConnected: true,
  events: [{
    id: 'evt-001', calendarEventId: 'gcal-unchanged-123',
    title: 'Entrenament', start: '2026-11-12T18:00:00+01:00',
    end: '2026-11-12T19:00:00+01:00', place: 'Pavelló Municipal',
    revision: 0, sourceMessageIds: []
  }],
  materials: [], tasks: [], processedMessageIds: [], pendingReviews: []
};
let state = start, ops = [], changes = [], reviews = [];
const policy = {autoCalendar: true, autoUpdateConfirmedEvents: true};
const messages = [
  {id:'m01', text:'Entrenament dijous a les 18 h.', actions:[]},
  {id:'m02', text:'Gràcies!', actions:[]},
  {id:'m03', text:'Canvi: entrenament divendres 13 a les 18 h.', actions:[
    {kind:'event-update', eventId:'evt-001', start:'2026-11-13T18:00:00+01:00', confidence:0.99}
  ]},
  {id:'m04', text:'Recordeu que entrenem divendres 13 a les 18 h.', actions:[
    {kind:'event-update', eventId:'evt-001', start:'2026-11-13T18:00:00+01:00', confidence:0.99}
  ]},
  {id:'m05', text:'Porteu samarreta blanca i aigua.', actions:[
    {kind:'material-add', material:'Samarreta blanca',confidence:0.98},
    {kind:'material-add', material:'Ampolla d’aigua',confidence:0.98}
  ]},
  {id:'m06', text:'Dissabte trobada, encara no sabem on.', actions:[
    {kind:'event-create', title:'Trobada dissabte',confidence:0.45}
  ]},
  {id:'m07', text:'Cancel·lem entrenament divendres.', actions:[
    {kind:'event-cancel',eventId:'evt-001',confidence:0.99}
  ]},
  {id:'m08', activityId:'theater-002',text:'Un missatge d’un grup no autoritzat.',actions:[
    {kind:'event-create',title:'Actuació',confidence:0.99}
  ]}
];
for (const m of messages) {
  const envelope = {
    authorized: true, messageId: m.id,
    activityId: m.activityId || 'basket-001'
  };
  const result = processMessage(state, envelope, {
    activityId: m.activityId || 'basket-001', actions: m.actions
  }, policy);
  state = result.state;
  ops.push(...result.calendarOperations);
  changes.push(...result.changes);
  reviews.push(...result.pending);
  if (m.id === 'm08') assert.equal(result.ignored, 'different-or-disabled-activity');
}
assert.equal(state.events.length, 1, 'Event must not be duplicated');
assert.equal(state.events[0].calendarEventId, 'gcal-unchanged-123',
  'The existing Calendar event ID must be preserved');
assert.equal(state.events[0].start, '2026-11-13T18:00:00+01:00');
assert.equal(state.events[0].revision, 1);
assert.equal(ops.length, 1, 'One Calendar update operation, never one per message');
assert.equal(ops[0].operation, 'update');
assert.equal(ops[0].calendarEventId, 'gcal-unchanged-123');
assert.equal(changes.filter(x => x.kind === 'event-updated').length, 1);
assert.equal(state.materials.length, 2);
assert.equal(reviews.length, 2, 'Ambiguous event and cancellation require review');
assert.equal(state.processedMessageIds.length, 7);
assert.ok(!state.processedMessageIds.includes('m08'));
const replay = processMessage(state, {
  authorized:true, messageId:'m03', activityId:'basket-001'
}, {activityId:'basket-001', actions: messages[2].actions}, policy);
assert.equal(replay.ignored, 'duplicate-message-id');
assert.equal(replay.calendarOperations.length, 0);

console.log('✅ Pilot contract passed: 8 synthetic messages');
console.log('   Calendar operation plans: ' + ops.length);
console.log('   Materials added: ' + state.materials.length);
console.log('   Human reviews: ' + reviews.length);
console.log('   Real external writes: 0');
