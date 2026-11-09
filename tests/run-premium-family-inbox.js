'use strict';
const assert=require('node:assert/strict');
const {initialInboxState,processInboxBatch}=require('../lib/premium-family-inbox');
const registry={families:[
 {id:'A',inboundAddresses:['a-7x@inbound.example.test'],
  verifiedForwarders:['a-parent@example.test'],
  activities:[{id:'A-ball',name:'Ball',keywords:['dansa']},
              {id:'A-basket',name:'Bàsquet',keywords:['basquet','basket']}]},
 {id:'B',inboundAddresses:['b-8z@inbound.example.test'],
  verifiedForwarders:['b-parent@example.test'],
  activities:[{id:'B-ball',name:'Ball',keywords:['dansa']}]}
]};
const verification={providerAuthenticated:true,senderAuthenticated:true};
function delivery(id,to,from,subject,text){
 return {verification,delivery:{providerMessageId:id,envelopeRecipient:to,envelopeSender:from,
  receivedAt:'2026-11-17T10:00:00+01:00',subject,textPlain:text,attachments:[]}};
}
const ballText='El termini per pagar el festival de Ball acaba el 18 de novembre de 2026.';
const basketText='El termini per pagar el Bàsquet acaba el 19 de novembre de 2026.';
const items=[
 delivery('g1','a-7x@inbound.example.test','a-parent@example.test',
  'Fwd: Circular de Ball',ballText),
 delivery('g2','a-7x@inbound.example.test','a-parent@example.test',
  'Fwd: Circular de Bàsquet',basketText),
 delivery('g3','b-8z@inbound.example.test','b-parent@example.test',
  'Fwd: Circular de Ball',ballText),
 delivery('g4','a-7x@inbound.example.test','a-parent@example.test',
  'Fwd: Circular de Ball i Bàsquet','Ball i Bàsquet tenen activitats noves.'),
 delivery('g5','a-7x@inbound.example.test','a-parent@example.test',
  'RV: Circular de Ball',ballText),
 delivery('g6','b-8z@inbound.example.test','a-parent@example.test',
  'Fwd: Circular de Ball',ballText)
];
function client(){
 const calls=[];
 return {calls,chat:{completions:{create:async opts=>{
  calls.push(opts);
  const msg=JSON.parse(opts.messages[1].content).untrustedMessageText;
  const basket=msg.includes('Bàsquet'),date=basket?'2026-11-19':'2026-11-18';
  const evidence=basket?'19 de novembre de 2026':'18 de novembre de 2026';
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   kind:'fact',relatedToActivity:true,summary:'Termini de quota',
   requiresReview:false,reviewReason:null,
   facts:[{field:'paymentDeadline',value:date,evidence,eventId:'festival-001',
     certainty:'definite',requiresReview:false}]
  })}}]};
 }}}};
}
async function main(){
 let state=initialInboxState(registry,{
   A:{'A-ball':'CAL-A-BALL','A-basket':'CAL-A-BASKET'},
   B:{'B-ball':'CAL-B-BALL'}
 });
 assert.deepEqual(Object.keys(state.families).sort(),['A','B']);
 assert.equal(Object.keys(state.families.A.cards).length,2);
 assert.equal(Object.keys(state.families.B.cards).length,1);
 const ai=client();
 const r=await processInboxBatch({state,deliveries:items,registry,client:ai,
  todayLocal:'2026-11-17'});
 assert.deepEqual(r.results.map(x=>x.status),
   ['processed','processed','processed','needs-review','duplicate','rejected']);
 assert.equal(ai.calls.length,3);
 assert.equal(r.externalWrites,0);
 assert.equal(r.state.families.A.cards['A-ball'].events['festival-001'].facts.paymentDeadline.value,
  '2026-11-18');
 assert.equal(r.state.families.A.cards['A-basket'].events['festival-001'].facts.paymentDeadline.value,
  '2026-11-19');
 assert.equal(r.state.families.B.cards['B-ball'].events['festival-001'].facts.paymentDeadline.value,
  '2026-11-18');
 assert.equal(r.state.families.A.cards['A-ball'].events['festival-001'].calendarEventId,'CAL-A-BALL');
 assert.equal(r.state.families.A.cards['A-basket'].events['festival-001'].calendarEventId,'CAL-A-BASKET');
 assert.equal(r.state.families.B.cards['B-ball'].events['festival-001'].calendarEventId,'CAL-B-BALL');
 assert.equal(r.state.families.A.seenFingerprints.length,2);
 assert.equal(r.state.families.B.seenFingerprints.length,1);
 assert.equal(r.state.families.A.reviewQueue.length,1);
 assert.equal(r.state.families.A.reviewQueue[0].reason,'AMBIGUOUS_ACTIVITY');
 assert.equal(r.state.families.B.reviewQueue.length,0);
 assert.equal(r.state.families.B.cards['B-ball'].sources.length,1);
 assert.equal(r.state.families.A.cards['A-ball'].sources.length,1);

 // Exactly the same email is not sent back to the model on a later batch.
 const again=client();
 const repeated=await processInboxBatch({state:r.state,deliveries:items.slice(0,3),
  registry,client:again,todayLocal:'2026-11-17'});
 assert.deepEqual(repeated.results.map(x=>x.status),['duplicate','duplicate','duplicate']);
 assert.equal(again.calls.length,0);
 assert.equal(repeated.state.families.A.cards['A-ball'].sources.length,1);

 // A model failure does not mark a message as received or affect other cards.
 const failed=client();
 failed.chat.completions.create=async()=>{throw Error('SIMULATED_UPSTREAM_FAILURE')};
 const newMail=delivery('new','a-7x@inbound.example.test','a-parent@example.test',
  'Fwd: Nova circular de Ball','La data del festival de Ball encara no està confirmada.');
 const snapshot=JSON.stringify(r.state);
 const errors=await processInboxBatch({state:r.state,deliveries:[newMail],
  registry,client:failed,todayLocal:'2026-11-17'});
 assert.equal(errors.results[0].status,'error');
 assert.equal(errors.results[0].reason,'UPSTREAM_PROCESSING_FAILED');
 assert.equal(JSON.stringify(r.state),snapshot);
 assert.equal(errors.state.families.A.seenFingerprints.length,2);
 console.log('PASS — two families, three activity cards and 3 verified forwarded emails');
 console.log('PASS — each family and activity isolated; Calendar identifiers unchanged');
 console.log('PASS — ambiguous activity deferred, suspicious sender rejected, duplicate suppressed');
 console.log('PASS — no repeat model charges for duplicate and no state changes on model failure');
 console.log('LIMIT — synthetic fixture, fake LLM, in-memory state; no live Gmail/SMTP/Calendar');
}
main().catch(error=>{console.error(error);process.exitCode=1});
