'use strict';
const assert=require('node:assert/strict');
const {runPilot,ingest,answer}=require('../lib/premium-agent-pilot');
const fixture=require('./fixtures/premium-agent-ball.json');
const result=runPilot(fixture), s=result.state;
assert.equal(result.metrics.received,7);
assert.equal(result.metrics.accepted,5);
assert.equal(result.metrics.ignored,1);
assert.equal(result.metrics.duplicate,1);
assert.equal(result.metrics.factsCreated,5);
assert.equal(result.metrics.factsReconfirmed,2);
assert.equal(result.metrics.needsReview,1);
assert.equal(result.metrics.calendarProposals,1);
assert.equal(result.metrics.queriesTotal,7);
assert.equal(result.metrics.queriesAnswered,6);
assert.equal(Object.keys(s.events).length,1);
assert.equal(s.events['festival-001'].facts.start.value,'2026-11-21T17:00:00+01:00');
assert.equal(s.events['festival-001'].facts.arrival.value,'2026-11-21T16:15:00+01:00');
assert.equal(s.events['festival-001'].facts.start.sourceIds.length,2);
assert.equal(s.events['festival-001'].facts.paymentDeadline.sourceIds.length,2);
assert.equal(result.plans[0].operation,'update-proposal');
assert.equal(result.plans[0].calendarEventId,'DEMO-CALENDAR-ID');
assert.equal(result.plans[0].externalWritePerformed,false);
assert.equal(result.plans[0].needsUserApproval,true);
assert.ok(result.answers[1].pendingReview);
assert.equal(result.answers[4].known,true);
assert.equal(result.answers[5].known,false);
assert.ok(result.answers[5].text.includes('comprovant'));
assert.ok(result.answers[0].sources[0].channel==='gmail');
assert.ok(result.answers[3].sources[0].channel==='whatsapp');
// Missing permission, no access to another family's activity.
const rejected=ingest(s,{messageId:'outside',channel:'whatsapp',authorized:false,
 activityId:'ball-family-demo',facts:[]});
assert.equal(rejected.outcome,'ignored');
assert.equal(rejected.state.events['festival-001'].revision,s.events['festival-001'].revision);
// Cross-channel contradiction: review rather than silently replace.
const conflict=ingest(s,{messageId:'wa-004',channel:'whatsapp',authorized:true,
 activityId:'ball-family-demo',receivedAt:'2026-11-17T10:00:00+01:00',
 facts:[{eventId:'festival-001',field:'start',value:'2026-11-21T18:00:00+01:00',confidence:0.99}]});
assert.equal(conflict.state.events['festival-001'].facts.start.value,'2026-11-21T17:00:00+01:00');
assert.equal(conflict.state.metrics.needsReview,2);
assert.ok(answer(conflict.state,'A quina hora comença?').pendingReview);
console.log('✅ Pilot multicanal: PASS');
console.log(JSON.stringify(result.metrics,null,2));
console.log('Source-backed answers:',result.answers.map(a=>({
 q:a.question,answer:a.text,sources:a.sources.map(s=>s.id),review:a.pendingReview
})));
console.log('No real Gmail/WhatsApp/Calendar integration or writes.');
