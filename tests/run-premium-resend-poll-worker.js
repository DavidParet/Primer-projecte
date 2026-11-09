'use strict';
/** Offline tests only: Resend API and AI responses are MOCKED. */
const assert=require('node:assert/strict');
const {pilot}=require('../lib/premium-agent-pilot');
const {pollResendPilot}=require('../lib/premium-resend-poll-worker');
const id='56761188-7520-42d8-8898-ff6fc54ce618';
const to='pilot-ball@resend-unit.example.test';
const from='guardian@example.test';
const text='Prova fictícia de Ball. El termini per pagar Ball és el 18 de novembre de 2026.';
const item={id,from:'Guardian <'+from+'>',to:[to],
  subject:'Fwd: Festival de Ball',created_at:'2026-11-07T14:55:24.671Z'};
const full={...item,text,html:null,attachments:[]};
const registry={families:[{id:'family-test',inboundAddresses:[to],
  verifiedForwarders:[from],activities:[{id:'ball-test',name:'Ball'}]}]};
function state(){
 const x=pilot('ball-test','Ball','calendar-test-only');
 x.familyId='family-test';
 return x;
}
function fakeResend({list=[item],get=full,listError=false,getError=false}={}){
 const calls={list:0,get:0};
 return {calls,emails:{receiving:{
  list:async options=>{calls.list++;assert.ok(options.limit<=20);
    return listError?{data:null,error:{message:'offline error'}}:
      {data:{object:'list',data:list,has_more:false},error:null};},
  get:async requested=>{calls.get++;assert.equal(requested,id);
    return getError?{data:null,error:{message:'offline get error'}}:
      {data:get,error:null};}
 }}};
}
function fakeModel(){
 const calls=[];
 return {calls,chat:{completions:{create:async req=>{
  calls.push(req);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   kind:'fact',relatedToActivity:true,summary:'Termini de Ball',
   requiresReview:false,reviewReason:null,
   facts:[{field:'paymentDeadline',value:'2026-11-18',
    evidence:'18 de novembre de 2026',eventId:'festival-001',
    certainty:'definite',requiresReview:false}]
  })}}]};
 }}}};
}
async function run(overrides={}){
 const resend=overrides.resend||fakeResend(),client=overrides.client||fakeModel();
 const result=await pollResendPilot({
  resend,client,registry,state:state(),todayLocal:'2026-11-07',
  attestSender:async()=>true,...overrides
 });
 return {resend,client,result};
}
async function main(){
 const success=await run();
 assert.equal(success.result.results[0].status,'processed');
 assert.equal(success.result.results[0].id,id);
 assert.equal(success.resend.calls.list,1);
 assert.equal(success.resend.calls.get,1);
 assert.equal(success.client.calls.length,1);
 assert.equal(success.result.state.events['festival-001'].facts.paymentDeadline.value,
  '2026-11-18');
 assert.equal(success.result.state.sources[0].channel,'email-forwarded');
 assert.equal(success.result.results[0].calendarPlans[0].externalWritePerformed,false);
 assert.equal(success.result.externalWrites,0);
 assert.deepEqual(success.result.seenResendIds,[id]);
 assert.equal(success.result.seenFingerprints.length,1);

 const repeated=await run({state:success.result.state,
  seenResendIds:success.result.seenResendIds,
  seenFingerprints:success.result.seenFingerprints});
 assert.equal(repeated.result.results[0].status,'duplicate');
 assert.equal(repeated.resend.calls.get,0);
 assert.equal(repeated.client.calls.length,0);

 const unverified=await run({attestSender:undefined});
 assert.equal(unverified.result.results[0].reason,'SENDER_AUTHENTICATION_PENDING');
 assert.equal(unverified.resend.calls.get,0);
 assert.equal(unverified.client.calls.length,0);
 const badSender=await run({resend:fakeResend({list:[{
  ...item,from:'Intruder <intruder@example.test>'}]})});
 assert.equal(badSender.result.results[0].reason,'UNREGISTERED_FORWARDER');
 assert.equal(badSender.resend.calls.get,0);
 const wrongRecipient=await run({resend:fakeResend({list:[{
  ...item,to:['other@resend-unit.example.test']}]})});
 assert.equal(wrongRecipient.result.results[0].reason,'UNKNOWN_FAMILY_ALIAS');
 assert.equal(wrongRecipient.resend.calls.get,0);
 const mismatch=await run({resend:fakeResend({get:{...full,
  subject:'another subject'}})});
 assert.equal(mismatch.result.results[0].reason,'RETRIEVED_METADATA_MISMATCH');
 assert.equal(mismatch.client.calls.length,0);
 const attached=await run({resend:fakeResend({get:{...full,
  attachments:[{filename:'private.pdf'}]}})});
 assert.equal(attached.result.results[0].reason,'ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING');
 assert.equal(attached.client.calls.length,0);
 const listFail=await run({resend:fakeResend({listError:true})});
 assert.equal(listFail.result.results[0].status,'retry');
 assert.equal(listFail.resend.calls.get,0);
 const getFail=await run({resend:fakeResend({getError:true})});
 assert.equal(getFail.result.results[0].status,'retry');
 assert.equal(getFail.client.calls.length,0);
 const other=state();other.familyId='another-family';
 const isolated=await run({state:other});
 assert.equal(isolated.result.results[0].reason,'STATE_IDENTITY_MISMATCH');
 assert.equal(isolated.resend.calls.get,0);
 const malformed=await run({resend:fakeResend({list:[{
  ...item,to:[to,'other@example.test']}]})});
 assert.equal(malformed.result.results[0].reason,'INVALID_INBOUND_METADATA');
 assert.equal(malformed.resend.calls.get,0);
 console.log('PASS — authenticated Resend list/get → isolated family activity → Calendar proposal');
 console.log('PASS — idempotent poll: no additional retrieval or model call for seen IDs');
 console.log('PASS — sender proof fail-closed, unknown recipients and cross-family state rejected');
 console.log('PASS — metadata mismatch, attachments and API errors quarantined or retryable');
 console.log('LIMIT — mocked SDK and AI; no deployed worker, real API credentials or Calendar writes');
}
main().catch(e=>{console.error(e);process.exitCode=1});
