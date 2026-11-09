'use strict';
/* Run with node tests/run-premium-mailgun-inbox.js; all inputs synthetic. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {initialInboxState}=require('../lib/premium-family-inbox');
const {processSignedForm}=require('../lib/premium-mailgun-inbox');
const key='synthetic-webhook-signing-key-at-least-twenty-chars';
const now=1794040000;
const registry={families:[
  {id:'A',inboundAddresses:['a7x@inbound.example.test'],
    verifiedForwarders:['parent-a@example.test'],
    activities:[{id:'a-ball',name:'Ball',keywords:['ball']}]},
  {id:'B',inboundAddresses:['b9z@inbound.example.test'],
    verifiedForwarders:['parent-b@example.test'],
    activities:[{id:'b-ball',name:'Ball',keywords:['ball']}]}
]};
function form(i,opts={}){
  const timestamp=String(now),token=String(i).padStart(50,'k');
  const signature=crypto.createHmac('sha256',key)
    .update(timestamp+token).digest('hex');
  return {timestamp,token,signature,
    recipient:'a7x@inbound.example.test',sender:'parent-a@example.test',
    from:'Parent A <parent-a@example.test>',
    subject:'Fwd: Festival de Ball',
    'body-plain':'El termini per pagar el ball és el 18 de novembre de 2026.',
    'attachment-count':'0',...opts};
}
function fakeAI(fail=false){
  const calls=[];
  return {calls,chat:{completions:{create:async()=>{
    calls.push('extract');
    if(fail)throw Error('SIMULATED_MODEL_UNAVAILABLE');
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      kind:'fact',relatedToActivity:true,summary:'Termini de Ball',
      requiresReview:false,reviewReason:null,
      facts:[{field:'paymentDeadline',value:'2026-11-18',
        evidence:'18 de novembre de 2026',eventId:'festival-001',
        certainty:'definite',requiresReview:false}]
    })}}]};
  }}}};
}
async function run({state,formValue,client,independentlyAuthenticatedSender=true,usedTokens=[]}){
  return processSignedForm({form:formValue,signingKey:key,nowSeconds:now,
    independentlyAuthenticatedSender,usedTokens,state,registry,client,
    todayLocal:'2026-11-07'});
}
async function main(){
  const initial=initialInboxState(registry,{
    A:{'a-ball':'existing-calendar-a'},B:{'b-ball':'existing-calendar-b'}
  });
  const ai=fakeAI();
  const first=await run({state:initial,formValue:form(1),client:ai});
  assert.equal(first.status,'processed');
  assert.equal(first.familyId,'A');
  assert.equal(first.activityId,'a-ball');
  assert.equal(first.processedCount,1);
  assert.equal(first.calendarProposals,1);
  assert.ok(first.tokenToCommit);
  assert.equal(first.externalWrites,0);
  assert.equal(ai.calls.length,1);
  assert.equal(first.state.families.A.cards['a-ball'].events['festival-001']
    .facts.paymentDeadline.value,'2026-11-18');
  assert.equal(first.state.families.A.cards['a-ball'].events['festival-001']
    .calendarEventId,'existing-calendar-a');
  assert.equal(first.state.families.B.cards['b-ball'].events['festival-001']
    .facts.paymentDeadline,undefined);
  assert.equal(first.state.families.A.cards['a-ball'].sources[0].channel,
    'email-forwarded');
  const second=await run({state:first.state,formValue:form(2),client:ai});
  assert.equal(second.status,'duplicate');
  assert.equal(second.processedCount,1);
  assert.equal(ai.calls.length,1,'Same content must not trigger second paid inference');
  const replay=await run({state:first.state,formValue:form(1),client:ai,
    usedTokens:[form(1).token]});
  assert.equal(replay.status,'rejected');
  assert.equal(replay.reason,'REPLAYED_TOKEN');
  assert.equal(replay.tokenToCommit,null);
  const unsigned=await run({state:initial,
    formValue:form(3,{signature:'0'.repeat(64)}),client:ai});
  assert.equal(unsigned.status,'rejected');
  assert.equal(unsigned.processedCount,0);
  const unverified=await run({state:initial,formValue:form(4),client:ai,
    independentlyAuthenticatedSender:false});
  assert.equal(unverified.status,'needs-review');
  assert.equal(unverified.reason,'SENDER_AUTHENTICATION_PENDING');
  assert.equal(unverified.tokenToCommit,null);
  assert.equal(ai.calls.length,1);
  const wrongFamily=await run({state:initial,formValue:form(5,{
    recipient:'b9z@inbound.example.test'
  }),client:ai});
  assert.equal(wrongFamily.status,'rejected');
  assert.equal(wrongFamily.tokenToCommit,null);
  const unavailable=await run({state:initial,formValue:form(6),client:fakeAI(true)});
  assert.equal(unavailable.status,'error');
  assert.equal(unavailable.reason,'UPSTREAM_PROCESSING_FAILED');
  assert.equal(unavailable.tokenToCommit,null);
  assert.equal(unavailable.state.families.A.cards['a-ball'].processedIds.length,0);
  console.log('PASS — signed Mailgun -> family alias -> Ball card -> Calendar proposal');
  console.log('PASS — second family isolated, duplicates do not re-call AI');
  console.log('PASS — replay and spoofed signature rejected');
  console.log('PASS — unauthenticated sender quarantined, cross-family routing rejected');
  console.log('PASS — model failure does not commit content or webhook token');
  console.log('LIMIT — no HTTP endpoint, provider account, durable store, real LLM or external writes');
}
main().catch(err=>{console.error(err);process.exitCode=1});