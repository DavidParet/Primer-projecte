'use strict';
/**
 * node tests/run-premium-mailgun-route.js
 * Synthetic fixtures only. No DNS, webhooks, email delivery or external writes.
 */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {
  verifyMailgunSignature,adaptMailgunRoute,mailgunFormToDelivery
}=require('../lib/premium-mailgun-inbound-adapter');
const {routeForwardedEmail,processForwardedEmail}=require('../lib/premium-forwarded-email');
const {pilot}=require('../lib/premium-agent-pilot');
const SIGNING_KEY='synthetic-mailgun-webhook-signing-key-not-real';
const NOW=1794040000;
const TOKEN='ab'.repeat(25);
function makeForm(patch={}){
  const timestamp=String(NOW),token=TOKEN;
  const signature=crypto.createHmac('sha256',SIGNING_KEY)
    .update(timestamp+token).digest('hex');
  return {
    timestamp,token,signature,
    recipient:'family-a-7x@inbound.example.test',
    sender:'guardian-a@example.test',
    from:'Guardian A <guardian-a@example.test>',
    subject:'Fwd: Festival de Ball',
    'body-plain':'El termini per pagar el Festival de Ball és el 18 de novembre de 2026.',
    'attachment-count':'0',...patch
  };
}
const registry={families:[
  {id:'family-A',inboundAddresses:['family-a-7x@inbound.example.test'],
    verifiedForwarders:['guardian-a@example.test'],
    activities:[{id:'ball-A',name:'Ball',keywords:['festival de ball']}]},
  {id:'family-B',inboundAddresses:['family-b-9k@inbound.example.test'],
    verifiedForwarders:['guardian-b@example.test'],
    activities:[{id:'ball-B',name:'Ball',keywords:['festival de ball']}]}
]};
function approved(form,props={}){
  return adaptMailgunRoute({form,signingKey:SIGNING_KEY,nowSeconds:NOW,
    usedTokens:[],independentlyAuthenticatedSender:true,...props});
}
function clientFor(response){
  const calls=[];
  return {calls,chat:{completions:{create:async params=>{
    calls.push(params);
    return {choices:[{finish_reason:'stop',message:{
      content:JSON.stringify(response)}}]};
  }}}};
}
async function main(){
  const f=makeForm();
  const sig=verifyMailgunSignature({form:f,signingKey:SIGNING_KEY,nowSeconds:NOW});
  assert.equal(sig.verified,true);
  assert.equal(sig.token,TOKEN);
  assert.equal(verifyMailgunSignature({
    form:{...f,signature:'0'.repeat(64)},
    signingKey:SIGNING_KEY,nowSeconds:NOW
  }).reason,'INVALID_HMAC');
  assert.equal(verifyMailgunSignature({
    form:{...f,signature:[]},signingKey:SIGNING_KEY,nowSeconds:NOW
  }).reason,'INVALID_SIGNATURE_FIELDS');
  assert.equal(verifyMailgunSignature({
    form:{...f,timestamp:String(NOW-3601)},
    signingKey:SIGNING_KEY,nowSeconds:NOW
  }).reason,'EXPIRED_OR_FUTURE_SIGNATURE');
  assert.equal(verifyMailgunSignature({
    form:{...f,timestamp:String(NOW+3601)},
    signingKey:SIGNING_KEY,nowSeconds:NOW
  }).reason,'EXPIRED_OR_FUTURE_SIGNATURE');
  assert.equal(verifyMailgunSignature({
    form:f,signingKey:SIGNING_KEY,nowSeconds:NOW,usedTokens:[TOKEN]
  }).reason,'REPLAYED_TOKEN');
  assert.equal(verifyMailgunSignature({
    form:f,signingKey:'',nowSeconds:NOW
  }).reason,'MISSING_VERIFICATION_INPUT');
  assert.equal(verifyMailgunSignature({
    form:f,signingKey:SIGNING_KEY,nowSeconds:NOW,usedTokens:'not-a-cache'
  }).reason,'INVALID_REPLAY_CACHE');

  const withoutSenderProof=adaptMailgunRoute({
    form:f,signingKey:SIGNING_KEY,nowSeconds:NOW
  });
  assert.equal(withoutSenderProof.status,'needs-review');
  assert.equal(withoutSenderProof.reason,'SENDER_AUTHENTICATION_PENDING');
  assert.equal(approved(f).status,'mapped');
  assert.equal(approved(f).delivery.envelopeRecipient,
    'family-a-7x@inbound.example.test');
  assert.equal(approved(f).delivery.envelopeSender,'guardian-a@example.test');
  assert.equal(approved(f).verification.providerAuthenticated,true);
  assert.equal(approved(f).verification.senderAuthenticated,true);
  assert.equal(approved(f).usedWebhookToken,TOKEN);
  assert.equal(approved(f).externalWrites,0);
  assert.equal(mailgunFormToDelivery({form:f,signatureResult:{verified:false}}).status,
    'rejected');

  assert.equal(approved(makeForm({from:'Impostor <someone-else@example.test>'})).reason,
    'ENVELOPE_FROM_MISMATCH');
  assert.equal(approved(makeForm({sender:'another@example.test'})).reason,
    'ENVELOPE_FROM_MISMATCH');
  assert.equal(approved(makeForm({recipient:'not-an-email'})).reason,
    'ENVELOPE_FROM_MISMATCH');
  assert.equal(approved(makeForm({'body-plain':''.padEnd(8001,'z')})).reason,
    'UNSUPPORTED_OR_OVERSIZED_CONTENT');
  assert.equal(approved(makeForm({'body-plain':''})).reason,
    'UNSUPPORTED_OR_OVERSIZED_CONTENT');
  assert.equal(approved(makeForm({subject:'x'.repeat(501)})).reason,
    'UNSUPPORTED_OR_OVERSIZED_CONTENT');
  assert.equal(approved(makeForm({'attachment-count':'200'})).reason,
    'INVALID_ATTACHMENT_COUNT');
  assert.equal(approved(makeForm({'attachment-count':'nan'})).reason,
    'INVALID_ATTACHMENT_COUNT');
  assert.equal(approved(makeForm({'attachment-count':'1'})).delivery.attachments.length,1);

  const mapped=approved(f);
  const routed=routeForwardedEmail({
    delivery:mapped.delivery,registry,verification:mapped.verification
  });
  assert.equal(routed.status,'accepted');
  assert.equal(routed.familyId,'family-A');
  assert.equal(routed.activityId,'ball-A');
  assert.equal(routed.message.channel,'email-forwarded');
  assert.equal(routed.message.authorized,true);
  assert.equal(routeForwardedEmail({
    delivery:{...mapped.delivery,envelopeRecipient:
      'family-b-9k@inbound.example.test'},
    registry,verification:mapped.verification
  }).reason,'UNREGISTERED_FORWARDER');
  assert.equal(routeForwardedEmail({
    delivery:approved(makeForm({'attachment-count':'1'})).delivery,
    registry,verification:mapped.verification
  }).reason,'ATTACHMENTS_NOT_PROCESSED');

  const state=pilot('ball-A','Ball','existing-calendar-id');
  state.familyId='family-A';
  const mock=clientFor({
    kind:'fact',relatedToActivity:true,summary:'Termini per pagar Ball',
    requiresReview:false,reviewReason:null,
    facts:[{field:'paymentDeadline',value:'2026-11-18',
      evidence:'18 de novembre de 2026',eventId:'festival-001',
      certainty:'definite',requiresReview:false}]
  });
  const result=await processForwardedEmail({
    delivery:mapped.delivery,verification:mapped.verification,
    registry,state,client:mock,todayLocal:'2026-11-07'
  });
  assert.equal(result.status,'processed');
  assert.equal(mock.calls.length,1);
  assert.equal(result.state.sources[0].channel,'email-forwarded');
  assert.equal(result.state.events['festival-001'].facts.paymentDeadline.value,
    '2026-11-18');
  assert.equal(result.calendarPlans.length,1);
  assert.equal(result.calendarPlans[0].externalWritePerformed,false);
  assert.equal(result.calendarPlans[0].needsUserApproval,true);
  assert.equal(result.externalWrites,0);
  const wrongState=pilot('ball-B','Ball',null);
  wrongState.familyId='family-B';
  const denied=await processForwardedEmail({
    delivery:mapped.delivery,verification:mapped.verification,
    registry,state:wrongState,client:mock,todayLocal:'2026-11-07'
  });
  assert.equal(denied.reason,'STATE_IDENTITY_MISMATCH');
  assert.equal(mock.calls.length,1,'No model calls for cross-family access');
  console.log('PASS — Mailgun Routes HMAC and constant-time comparison');
  console.log('PASS — timestamps, replay cache, malformed and forged signatures blocked');
  console.log('PASS — signed webhook without independent sender proof held for review');
  console.log('PASS — envelope/From mismatch and unsupported attachments deferred');
  console.log('PASS — signed forwarding maps to isolated family activity and Calendar dry run');
  console.log('NOTE — synthetic provider payload, signing key and simulated LLM; no live webhook or API');
}
main().catch(e=>{console.error(e);process.exitCode=1});
