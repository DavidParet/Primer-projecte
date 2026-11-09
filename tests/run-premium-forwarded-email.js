'use strict';
/* Run with node tests/run-premium-forwarded-email.js. All data synthetic. */
const assert=require('node:assert/strict');
const {pilot}=require('../lib/premium-agent-pilot');
const {routeForwardedEmail,processForwardedEmail,cleanSubject,
  containsTerm,fingerprint}=require('../lib/premium-forwarded-email');
const registry={families:[
 {id:'family-A',inboundAddresses:['family-a-7x@inbound.example.test'],
  verifiedForwarders:['guardian-a@example.test','guardian-a2@example.test'],
  activities:[
   {id:'ball-A',name:'Ball',keywords:['dansa','festival de ball']},
   {id:'basket-A',name:'Bàsquet',keywords:['basket','bàsquet']}
  ]},
 {id:'family-B',inboundAddresses:['family-b-9k@inbound.example.test'],
  verifiedForwarders:['guardian-b@example.test'],
  activities:[{id:'ball-B',name:'Ball',keywords:['dansa']}]}
]};
const verified={providerAuthenticated:true,senderAuthenticated:true};
const message={
 envelopeRecipient:'family-a-7x@inbound.example.test',
 envelopeSender:'guardian-a@example.test',
 providerMessageId:'provider-0001',
 receivedAt:'2026-11-17T09:00:00+01:00',
 subject:'Fwd: Festival de Ball',
 textPlain:'Benvolgudes famílies: el termini per pagar el festival de ball és el 18 de novembre de 2026.',
 attachments:[]
};
const forwarded=(patch={},options={})=>routeForwardedEmail({
 delivery:{...message,...patch},registry,verification:{...verified,...(options.verification||{})},
 seenFingerprints:options.seenFingerprints||[]
});
function clientFor(response){
 const calls=[];
 return {calls,chat:{completions:{create:async options=>{
  calls.push(options);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]};
 }}}};
}
const extracted={
 kind:'fact',relatedToActivity:true,summary:'Termini de Ball',
 requiresReview:false,reviewReason:null,
 facts:[{field:'paymentDeadline',value:'2026-11-18',
  evidence:'18 de novembre de 2026',eventId:'festival-001',
  certainty:'definite',requiresReview:false}]
};
async function main(){
 assert.equal(cleanSubject('FWD: RV: Re: Festival de Ball'),'festival de ball');
 assert.equal(containsTerm('Al futbol', 'ball'),false,'Word boundary avoids football');
 assert.equal(containsTerm('Festival de Ball a la sala','festival de ball'),true);
 const first=forwarded();
 assert.equal(first.status,'accepted');
 assert.equal(first.familyId,'family-A');
 assert.equal(first.activityId,'ball-A');
 assert.equal(first.message.channel,'email-forwarded');
 assert.ok(first.fingerprint.length>=20);
 assert.equal(first.message.authorized,true);
 assert.equal(first.message.text,message.textPlain);
 assert.equal(forwarded({subject:'RV: Festival de Ball'}).fingerprint,first.fingerprint);
 assert.equal(forwarded({providerMessageId:'provider-0002',
  envelopeSender:'guardian-a2@example.test'}).fingerprint,first.fingerprint);
 assert.equal(forwarded({providerMessageId:'provider-0002'},
  {seenFingerprints:[first.fingerprint]}).status,'duplicate');
 assert.equal(forwarded({providerMessageId:'provider-0002'},
  {seenFingerprints:[first.fingerprint]}).fingerprint,first.fingerprint);

 assert.equal(forwarded({},{verification:{providerAuthenticated:false}}).reason,'UNVERIFIED_INBOUND');
 assert.equal(forwarded({},{verification:{senderAuthenticated:false}}).reason,'UNVERIFIED_INBOUND');
 assert.equal(forwarded({envelopeRecipient:'unknown@inbound.example.test'}).reason,'UNKNOWN_FAMILY_ALIAS');
 assert.equal(forwarded({envelopeSender:'stranger@example.test'}).reason,'UNREGISTERED_FORWARDER');
 assert.equal(forwarded({envelopeRecipient:'family-b-9k@inbound.example.test'}).reason,
  'UNREGISTERED_FORWARDER','No one may send content to other family alias');
 assert.equal(forwarded({subject:'Fwd: Circular general',
  textPlain:'Ball i bàsquet: activitats de novembre.'}).reason,'AMBIGUOUS_ACTIVITY');
 assert.equal(forwarded({subject:'Fwd: Circular general',
  textPlain:'Avui no hi ha novetats.'}).reason,'ACTIVITY_NOT_FOUND');
 assert.equal(forwarded({attachments:[{name:'circular.pdf'}]}).reason,'ATTACHMENTS_NOT_PROCESSED');
 assert.equal(forwarded({textPlain:'a'.repeat(8001)}).reason,'INVALID_MESSAGE');
 assert.equal(forwarded({attachments:{name:'untrusted.pdf'}}).reason,'INVALID_ATTACHMENT_METADATA');
 assert.equal(forwarded({receivedAt:'wrong date'}).reason,'INVALID_MESSAGE');
 assert.equal(forwarded({subject:'Fwd: Futbol',textPlain:'Partit de futbol.'}).reason,'ACTIVITY_NOT_FOUND');
 assert.equal(forwarded({envelopeSender:'GUARDIAN-A@EXAMPLE.TEST',
  envelopeRecipient:'FAMILY-A-7X@INBOUND.EXAMPLE.TEST'}).status,'accepted');

 const sameAtB=forwarded({
  envelopeRecipient:'family-b-9k@inbound.example.test',
  envelopeSender:'guardian-b@example.test'
 });
 assert.equal(sameAtB.status,'accepted');
 assert.equal(sameAtB.familyId,'family-B');
 assert.equal(sameAtB.activityId,'ball-B');
 assert.notEqual(sameAtB.fingerprint,first.fingerprint);
 assert.equal(forwarded({}, {seenFingerprints:[sameAtB.fingerprint]}).status,'accepted');
 const duplicatedRegistry=JSON.parse(JSON.stringify(registry));
 duplicatedRegistry.families[1].inboundAddresses=[message.envelopeRecipient];
 assert.equal(routeForwardedEmail({delivery:message,registry:duplicatedRegistry,
   verification:verified}).reason,'DUPLICATED_RECIPIENT_REGISTRATION');
 assert.equal(fingerprint({familyId:'family-A',subject:message.subject,textPlain:message.textPlain}),
  first.fingerprint);

 let state=pilot('ball-A','Ball','existing-test-calendar-id');
 state.familyId='family-A';
 const model=clientFor(extracted);
 const ingested=await processForwardedEmail({delivery:message,registry,verification:verified,
  state,client:model,todayLocal:'2026-11-17'});
 assert.equal(ingested.status,'processed');
 assert.equal(model.calls.length,1);
 assert.equal(ingested.state.events['festival-001'].facts.paymentDeadline.value,'2026-11-18');
 assert.equal(ingested.state.sources.length,1);
 assert.equal(ingested.state.sources[0].channel,'email-forwarded');
 assert.equal(ingested.calendarPlans.length,1);
 assert.equal(ingested.calendarPlans[0].operation,'update-proposal');
 assert.equal(ingested.calendarPlans[0].externalWritePerformed,false);
 assert.equal(ingested.calendarPlans[0].calendarEventId,'existing-test-calendar-id');
 assert.equal(ingested.externalWrites,0);

 const secondClient=clientFor(extracted);
 const repeated=await processForwardedEmail({delivery:{...message,providerMessageId:'provider-0003'},
  registry,verification:verified,state:ingested.state,client:secondClient,todayLocal:'2026-11-17'});
 assert.equal(repeated.status,'duplicate');
 assert.equal(secondClient.calls.length,0,'Must not bill AI on repeated forwarding');
 assert.equal(repeated.state.events['festival-001'].revision,
  ingested.state.events['festival-001'].revision);

 const wrongState=pilot('ball-B','Ball','another-calendar-id');
 wrongState.familyId='family-B';
 const blockedClient=clientFor(extracted);
 const wrong=await processForwardedEmail({delivery:message,registry,verification:verified,
  state:wrongState,client:blockedClient,todayLocal:'2026-11-17'});
 assert.equal(wrong.reason,'STATE_IDENTITY_MISMATCH');
 assert.equal(blockedClient.calls.length,0);

 const deferredClient=clientFor(extracted);
 const deferred=await processForwardedEmail({delivery:{...message,attachments:[{name:'dades.pdf'}]},
  registry,verification:verified,state,client:deferredClient,todayLocal:'2026-11-17'});
 assert.equal(deferred.status,'needs-review');
 assert.equal(deferredClient.calls.length,0);
 assert.equal(deferred.calendarPlans.length,0);

 console.log('PASS — forwarded Gmail/Outlook-style mail routed by unique family alias');
 console.log('PASS — verified forwarding identity and cross-family state isolation');
 console.log('PASS — unknown/ambiguous activity, attachments and suspicious mail deferred or blocked');
 console.log('PASS — stable per-family fingerprint prevents duplicate LLM calls');
 console.log('PASS — source type email-forwarded merged into activity card; Calendar dry-run only');
 console.log('LIMIT — verification flags mocked; no actual mailbox/webhook/Gmail/SMTP/Calendar configured');
}
main().catch(err=>{console.error(err);process.exitCode=1});
