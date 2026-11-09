'use strict';
/* node tests/run-premium-mailgun-queue-worker.js — all records synthetic */
const assert=require('node:assert/strict');
const {initialInboxState}=require('../lib/premium-family-inbox');
const {drainSyntheticInbox}=require('../lib/premium-mailgun-queue-worker');
const {assembleAnswer}=require('../lib/premium-ai-answerer');
const registry={families:[
  {id:'A',activities:[{id:'a-ball',name:'Ball'}]},
  {id:'B',activities:[{id:'b-ball',name:'Ball'}]}
]};
function queued({token,familyId,activityId,day,hash='a',text,messageId}){
  const t=text||'El termini per pagar el festival de Ball és el '+day+' de novembre de 2026.';
  return {token,status:'queued',fingerprint:hash.repeat(64),
    payload:{familyId,activityId,message:{
      authorized:true,channel:'email-forwarded',messageId:messageId||token,
      activityId,text:t,receivedAt:'2026-11-17T09:00:00+01:00'
    }}};
}
const a=queued({token:'one',familyId:'A',activityId:'a-ball',day:18});
const b=queued({token:'two',familyId:'B',activityId:'b-ball',day:19,hash:'b'});
const missing=queued({token:'bad',familyId:'A',activityId:'b-ball',day:20,hash:'c'});
const failure=queued({token:'fail',familyId:'A',activityId:'a-ball',
  day:21,hash:'d',text:'SIMULATED_MODEL_FAILURE'});
function simulatedAI(){
  const calls=[];
  return {calls,chat:{completions:{create:async input=>{
    calls.push(input);
    const raw=input.messages[1].content;
    if(raw.includes('SIMULATED_MODEL_FAILURE'))throw Error('SYNTHETIC_PROVIDER_ERROR');
    const day=raw.includes('19 de novembre')?19:18;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      kind:'fact',relatedToActivity:true,summary:'Termini del festival de Ball',
      requiresReview:false,reviewReason:null,
      facts:[{field:'paymentDeadline',value:'2026-11-'+day,
        evidence:day+' de novembre de 2026',eventId:'festival-001',
        certainty:'definite',requiresReview:false}]
    })}}]};
  }}}};
}
async function main(){
  const state=initialInboxState(registry,{
    A:{'a-ball':'CAL-A'},B:{'b-ball':'CAL-B'}
  });
  const ai=simulatedAI();
  const result=await drainSyntheticInbox({
    records:[a,b,missing,
      {...a,token:'same-token',status:'needs-review'},
      {...a,token:'one'},failure],
    state,client:ai,todayLocal:'2026-11-17'
  });
  assert.equal(result.externalWrites,0);
  assert.equal(result.totalProcessed,2);
  assert.equal(result.totalRetried,1);
  assert.equal(ai.calls.length,3);
  assert.equal(result.state.families.A.cards['a-ball'].events['festival-001']
    .facts.paymentDeadline.value,'2026-11-18');
  assert.equal(result.state.families.B.cards['b-ball'].events['festival-001']
    .facts.paymentDeadline.value,'2026-11-19');
  assert.equal(result.state.families.A.cards['a-ball'].events['festival-001']
    .calendarEventId,'CAL-A');
  assert.equal(result.state.families.B.cards['b-ball'].events['festival-001']
    .calendarEventId,'CAL-B');
  assert.equal(result.state.families.A.cards['a-ball'].processedIds.length,1);
  assert.equal(result.state.families.B.cards['b-ball'].processedIds.length,1);
  assert.deepEqual(result.outcomes.map(x=>x.status),
    ['processed','processed','rejected','duplicate','retry']);
  const answerA=assembleAnswer(result.state.families.A.cards['a-ball'],
    {field:'paymentDeadline',eventId:'festival-001',needsClarification:false});
  assert.equal(answerA.known,true);
  assert.ok(answerA.text.includes('18 de novembre'));
  assert.equal(answerA.sources[0].channel,'email-forwarded');
  const answerB=assembleAnswer(result.state.families.B.cards['b-ball'],
    {field:'paymentDeadline',eventId:'festival-001',needsClarification:false});
  assert.ok(answerB.text.includes('19 de novembre'));
  assert.equal(answerB.sources[0].id,'two');
  const second=await drainSyntheticInbox({
    records:[a,b,failure],state:result.state,client:ai,todayLocal:'2026-11-17'
  });
  assert.deepEqual(second.outcomes.map(x=>x.status),
    ['duplicate','duplicate','retry']);
  assert.equal(ai.calls.length,4,'Only the failed record may retry');

  const wrong={...a,payload:{...a.payload,
    message:{...a.payload.message,activityId:'b-ball'}}};
  const bad=await drainSyntheticInbox({
    records:[wrong],state,client:ai,todayLocal:'2026-11-17'
  });
  assert.equal(bad.outcomes[0].reason,'INVALID_QUEUE_RECORD');
  assert.equal(ai.calls.length,4);
  assert.equal(state.families.A.cards['a-ball'].processedIds.length,0,
    'Input state remains immutable');
  console.log('PASS — synthetic queued mail -> isolated family cards -> cited answers');
  console.log('PASS — independent payment deadlines for two separate families');
  console.log('PASS — duplicate and unreviewed messages never invoke the model');
  console.log('PASS — failures stay retriable, cross-family/mismatched activity rejected');
  console.log('PASS — Calendar identifiers preserved; zero external actions');
  console.log('LIMIT — state in memory, mail/AI mocked: NOT a production-safe queue worker');
}
main().catch(err=>{console.error(err);process.exitCode=1});