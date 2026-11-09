'use strict';
/** node tests/run-premium-resend-inbound.js — synthetic SDK, messages, LLM only. */
const assert=require('node:assert/strict');
const {pilot}=require('../lib/premium-agent-pilot');
const {
  verifiedResendEvent,processResendReceived,canonicalFrom,singleRecipient
}=require('../lib/premium-resend-inbound');
const emailId='56761188-7520-42d8-8898-ff6fc54ce618';
const to='ball-7x@team-test.resend.app';
const from='parent@example.test';
const body='El termini per pagar el festival de Ball és el 18 de novembre de 2026.';
const registry={families:[
  {id:'family-A',inboundAddresses:[to],verifiedForwarders:[from],
    activities:[{id:'ball-A',name:'Ball',keywords:['ball']}]},
  {id:'family-B',inboundAddresses:['other@team-test.resend.app'],
    verifiedForwarders:['other@example.test'],
    activities:[{id:'ball-B',name:'Ball',keywords:['ball']}]}
]};
const event={type:'email.received',created_at:'2026-11-07T09:00:00Z',
  data:{email_id:emailId,created_at:'2026-11-07T09:00:00Z',
    from:'Parent <'+from+'>',to:[to],subject:'Fwd: Festival de Ball',
    message_id:'<fake-message-id@example.test>',attachments:[]}};
const received={id:emailId,from:event.data.from,to:event.data.to,
  subject:event.data.subject,text:body,html:null,attachments:[]};
const raw=JSON.stringify(event);
const headers={id:'msg-synthetic',timestamp:'1794042000',signature:'v1,simulated'};
const secret='whsec_SyntheticSecretForUnitTestsOnly';
function fakeResend({retrieved=received,invalidSignature=false,apiError=false}={}){
  const calls={verify:0,get:0};
  return {calls,webhooks:{verify({payload,headers:heads,secret:providedSecret}){
    calls.verify++;
    if(invalidSignature||payload!==raw||providedSecret!==secret||
      heads['svix-id']!==headers.id||
      heads['svix-timestamp']!==headers.timestamp||
      heads['svix-signature']!==headers.signature)
      throw Error('SIMULATED_SIGNATURE_FAILURE');
    return JSON.parse(payload);
  }},emails:{receiving:{get:async id=>{
    calls.get++;
    assert.equal(id,emailId);
    if(apiError)return {data:null,error:{message:'synthetic unavailable'}};
    return {data:retrieved,error:null};
  }}}};
}
function mockAI(){
  const calls=[];
  return {calls,chat:{completions:{create:async request=>{
    calls.push(request);
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      kind:'fact',relatedToActivity:true,summary:'Termini de pagament',
      requiresReview:false,reviewReason:null,
      facts:[{field:'paymentDeadline',value:'2026-11-18',
        evidence:'18 de novembre de 2026',eventId:'festival-001',
        certainty:'definite',requiresReview:false}]
    })}}]};
  }}}};
}
function initial(){
  const state=pilot('ball-A','Ball','calendar-test-existing');
  state.familyId='family-A';
  return state;
}
async function go(patch={}){
  const resend=patch.resend||fakeResend();
  const client=patch.client||mockAI();
  const args={resend,rawPayload:raw,headers,webhookSecret:secret,
    registry,state:initial(),client,todayLocal:'2026-11-07',
    authenticateForwarder:async()=>true,...patch};
  return {resend,client,result:await processResendReceived(args)};
}
async function main(){
  assert.equal(canonicalFrom('Parent <PARENT@EXAMPLE.TEST>'),'parent@example.test');
  assert.equal(canonicalFrom('parent@example.test'),'parent@example.test');
  assert.equal(canonicalFrom('not a mail'),null);
  assert.equal(singleRecipient([to]),to);
  assert.equal(singleRecipient([to,'other@team-test.resend.app']),null);
  assert.equal(singleRecipient(to),null);
  const verified=verifiedResendEvent({resend:fakeResend(),rawPayload:raw,headers,
    webhookSecret:secret});
  assert.equal(verified.status,'verified');
  assert.equal(verified.event.data.email_id,emailId);
  assert.equal(verifiedResendEvent({
    resend:fakeResend({invalidSignature:true}),rawPayload:raw,headers,
    webhookSecret:secret
  }).reason,'INVALID_WEBHOOK_SIGNATURE');
  assert.equal(verifiedResendEvent({
    resend:fakeResend(),rawPayload:raw,headers:{...headers,signature:123},
    webhookSecret:secret
  }).reason,'INVALID_VERIFICATION_INPUT');
  assert.equal(verifiedResendEvent({resend:fakeResend(),rawPayload:raw,
    headers,webhookSecret:'wrong'}).reason,'INVALID_VERIFICATION_INPUT');
  const unrelated=JSON.stringify({...event,type:'email.delivered'});
  const anyEvent={...fakeResend(),webhooks:{verify:()=>JSON.parse(unrelated)}};
  assert.equal(verifiedResendEvent({
    resend:anyEvent,rawPayload:raw,headers,webhookSecret:secret
  }).status,'ignored');
  const hasAttachments={...event,data:{...event.data,
    attachments:[{id:'fake-id',filename:'circular.pdf'}]}};
  assert.equal(verifiedResendEvent({
    resend:{webhooks:{verify:()=>hasAttachments}},
    rawPayload:raw,headers,webhookSecret:secret
  }).reason,'ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING');
  const successful=await go();
  assert.equal(successful.result.status,'processed');
  assert.equal(successful.resend.calls.verify,1);
  assert.equal(successful.resend.calls.get,1);
  assert.equal(successful.client.calls.length,1);
  assert.equal(successful.result.state.familyId,'family-A');
  assert.equal(successful.result.state.sources[0].channel,'email-forwarded');
  assert.equal(successful.result.state.events['festival-001']
    .facts.paymentDeadline.value,'2026-11-18');
  assert.equal(successful.result.calendarPlans.length,1);
  assert.equal(successful.result.calendarPlans[0].operation,'update-proposal');
  assert.equal(successful.result.calendarPlans[0].externalWritePerformed,false);
  assert.equal(successful.result.externalWrites,0);
  const unverifiedResend=fakeResend({invalidSignature:true});
  const reject=await go({resend:unverifiedResend});
  assert.equal(reject.result.status,'rejected');
  assert.equal(unverifiedResend.calls.get,0,'Never fetch email before signature');
  assert.equal(reject.client.calls.length,0,'Never call AI for invalid signature');
  const noSender=await go({authenticateForwarder:undefined});
  assert.equal(noSender.result.status,'needs-review');
  assert.equal(noSender.result.reason,'SENDER_AUTHENTICATION_PENDING');
  assert.equal(noSender.resend.calls.get,0,'Never fetch before sender verification');
  const senderFails=await go({authenticateForwarder:async()=>{throw Error('test')}});
  assert.equal(senderFails.result.status,'needs-review');
  const otherFamilyState=pilot('ball-B','Ball',null);
  otherFamilyState.familyId='family-B';
  const blocked=await go({state:otherFamilyState});
  assert.equal(blocked.result.reason,'STATE_IDENTITY_MISMATCH');
  assert.equal(blocked.resend.calls.get,0);
  const apiDown=await go({resend:fakeResend({apiError:true})});
  assert.equal(apiDown.result.status,'retry');
  assert.equal(apiDown.client.calls.length,0);
  const idMismatch=await go({resend:fakeResend({retrieved:{...received,
    id:'another-resend-id'}})});
  assert.equal(idMismatch.result.reason,'RETRIEVED_METADATA_MISMATCH');
  const subjectMismatch=await go({resend:fakeResend({retrieved:{...received,
    subject:'Fake different subject'}})});
  assert.equal(subjectMismatch.result.reason,'RETRIEVED_METADATA_MISMATCH');
  const htmlOnly=await go({resend:fakeResend({retrieved:{...received,text:null}})});
  assert.equal(htmlOnly.result.reason,'UNSUPPORTED_OR_OVERSIZED_CONTENT');
  const attachmentOnly=await go({resend:fakeResend({retrieved:{...received,
    attachments:[{filename:'record.pdf'}]}})});
  assert.equal(attachmentOnly.result.reason,'ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING');
  const second=await go({state:successful.result.state,seenFingerprints:[
    successful.result.forwardedEmail.fingerprint
  ]});
  assert.equal(second.result.status,'duplicate');
  assert.equal(second.client.calls.length,0);
  console.log('PASS — verified Resend email.received metadata then receiving.get email body');
  console.log('PASS — existing NEXLUPA family/ball pipeline, source, deadline and Calendar proposal');
  console.log('PASS — invalid signatures, missing sender proof and cross-family mismatches blocked');
  console.log('PASS — API failures retry, metadata conflicts and attachments quarantined');
  console.log('PASS — second identical forward skipped without additional AI inference');
  console.log('LIMIT — Resend SDK, API and sender verification simulated; no account/API key/URL activated');
}
main().catch(err=>{console.error(err);process.exitCode=1});
