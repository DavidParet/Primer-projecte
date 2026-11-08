'use strict';
/**
 * Integration regression across the signed Resend transport and NEXLUPA
 * family activity engine. Fully synthetic. Never calls accounts or models.
 */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifySvix}=require('../pilot/resend-webhook/lib/verify-svix');
const {processResendReceived}=require('../lib/premium-resend-inbound');
const {pilot}=require('../lib/premium-agent-pilot');

const familyAddress='case-001@inbound.example.test';
const parent='parent@example.test';
const emailId='4de57e9f-c2a7-4652-9e68-b2863c0979b1';
const ts='1794135600';
const secret='whsec_'+Buffer.from('isolated-synthetic-key-material-only').toString('base64');
const event={type:'email.received',created_at:'2026-11-08T12:00:00Z',data:{
  email_id:emailId,from:'Fictitious Parent <'+parent+'>',
  to:[familyAddress],subject:'Fwd: Circular de Ball',attachments:[]}};
const body='Escola fictícia. El termini per pagar el Festival de Ball és el 18 de novembre de 2026.';
const full={id:emailId,from:event.data.from,to:event.data.to,
  subject:event.data.subject,text:body,attachments:[]};
const registry={families:[
  {id:'case-001',inboundAddresses:[familyAddress],verifiedForwarders:[parent],
    activities:[{id:'ball-001',name:'Ball',keywords:['festival']}]},
  {id:'case-002',inboundAddresses:['case-002@inbound.example.test'],
    verifiedForwarders:['other@example.test'],
    activities:[{id:'ball-002',name:'Ball'}]}
]};
const modelPayload={kind:'fact',relatedToActivity:true,summary:'Termini de pagament',
  requiresReview:false,reviewReason:null,facts:[{
    field:'paymentDeadline',value:'2026-11-18',evidence:'18 de novembre de 2026',
    eventId:'festival-001',certainty:'definite',requiresReview:false
  }]};
function initial(){
  const state=pilot('ball-001','Ball',null);
  state.familyId='case-001';
  return state;
}
function signed(value,override={}){
  const rawPayload=JSON.stringify(value);
  const id='msg_fictitious_1234';
  const digest=crypto.createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(id+'.'+ts+'.'+rawPayload).digest('base64');
  return {rawPayload,headers:{id,timestamp:ts,signature:'v1,'+digest,...override}};
}
const valid=signed(event);
function mockProvider(){
  const calls={verify:0,get:0};
  return {calls,webhooks:{verify({payload,headers,webhookSecret}){
    calls.verify++;
    const h={'svix-id':headers.id,'svix-timestamp':headers.timestamp,
      'svix-signature':headers.signature};
    if(webhookSecret!==secret || !verifySvix(payload,h,webhookSecret,Number(ts)))
      throw Error('SIGNATURE_REJECTED');
    return JSON.parse(payload);
  }},emails:{receiving:{get:async requested=>{
    calls.get++;
    assert.equal(requested,emailId);
    return {data:full,error:null};
  }}}};
}
function mockModel(){
  const calls=[];
  return {calls,chat:{completions:{create:async args=>{
    calls.push(args);
    return {choices:[{finish_reason:'stop',
      message:{content:JSON.stringify(modelPayload)}}]};
  }}}};
}
async function run(input={}){
  const provider=mockProvider(),client=mockModel();
  const {resultState=initial(),registryOverride=registry,
    authenticateForwarder=async()=>true,seenFingerprints=[],
    signedMessage=valid}=input;
  const result=await processResendReceived({
    resend:provider,rawPayload:signedMessage.rawPayload,
    headers:signedMessage.headers,webhookSecret:secret,
    registry:registryOverride,state:resultState,client,
    todayLocal:'2026-11-08',authenticateForwarder,seenFingerprints
  });
  return {result,provider,client};
}
async function main(){
  const first=await run();
  assert.equal(first.result.status,'processed');
  assert.equal(first.provider.calls.get,1);
  assert.equal(first.client.calls.length,1);
  assert.equal(first.result.state.sources.length,1);
  assert.equal(first.result.state.events['festival-001'].facts.paymentDeadline.value,'2026-11-18');
  assert.equal(first.result.calendarPlans.length,1);
  assert.equal(first.result.calendarPlans[0].operation,'create-proposal');
  assert.equal(first.result.calendarPlans[0].externalWritePerformed,false);
  assert.equal(first.result.externalWrites,0);

  const tampered=await run({signedMessage:{...valid,
    rawPayload:valid.rawPayload.replace('Circular','Circular FALSA')}});
  assert.equal(tampered.result.reason,'INVALID_WEBHOOK_SIGNATURE');
  assert.equal(tampered.provider.calls.get,0);
  assert.equal(tampered.client.calls.length,0);

  const blockedSender=await run({authenticateForwarder:async()=>false});
  assert.equal(blockedSender.result.reason,'SENDER_AUTHENTICATION_PENDING');
  assert.equal(blockedSender.provider.calls.get,0);
  assert.equal(blockedSender.client.calls.length,0);
  const wrongState=initial();
  wrongState.familyId='case-002';
  const crossed=await run({resultState:wrongState});
  assert.equal(crossed.result.reason,'STATE_IDENTITY_MISMATCH');
  assert.equal(crossed.provider.calls.get,0);

  const repeated=await run({resultState:first.result.state,
    seenFingerprints:[first.result.forwardedEmail.fingerprint]});
  assert.equal(repeated.result.status,'duplicate');
  assert.equal(repeated.client.calls.length,0);
  assert.equal(repeated.result.externalWrites,0);

  const unregistered={families:[{...registry.families[0],
    verifiedForwarders:['different@example.test']},registry.families[1]]};
  const unknown=await run({registryOverride:unregistered});
  assert.equal(unknown.result.reason,'UNREGISTERED_FORWARDER');
  assert.equal(unknown.provider.calls.get,0);

  console.log('PASS — synthetic signed webhook → verified email fetch → isolated family Ball → fact');
  console.log('PASS — only Calendar proposal, zero external writes');
  console.log('PASS — tampering, unverified senders and cross-family mismatch blocked before body fetch');
  console.log('PASS — duplicate email does not trigger AI again');
  console.log('LIMIT — no real provider SDK, API key, storage, family data, or live AI');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
