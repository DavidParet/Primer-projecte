'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceivingClient,API_ORIGIN}=
  require('../lib/forwarding/resend-receiving-client.cjs');
const {prepareHumanReview}=require('../lib/forwarding/review-gate.cjs');
const {createNeonReceiptAdapters}=require('../lib/forwarding/neon-receipt.cjs');

const apiKey='re_0123456789abcdef0123456789abcdef';
const emailId='7c958c25-231a-4c3e-94fe-122947b81733';
const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const familyId='11111111-2222-4333-8444-555555555555';
const receiptKey='a'.repeat(64);
const encryptionKeyHex='32'.repeat(32);

const email=()=>({
  id:emailId,
  from:'Teacher <school@example.invalid>',
  to:[recipient],
  subject:'Dummy school meeting',
  text:'The fictional meeting is next Wednesday.',
  html:'<script>NOT SAFE</script>',
  headers:{'X-Private-Untrusted':'never return'},
  attachments:[]
});
function res(json,status=200,headers={'content-type':'application/json'}){
  return new Response(JSON.stringify(json),{status,headers});
}
async function encryptedFixture(){
  let encryptedEnvelope;
  const adapter=createNeonReceiptAdapters({
    encryptionKeyHex,
    query:async(_sql,params)=>{
      encryptedEnvelope=params[1];
      return {rows:[{outcome:'inserted'}]};
    }
  });
  await adapter.enqueueReceipt({receiptKey,familyId,emailId,recipient});
  return encryptedEnvelope;
}

test('provider client calls only official HTTPS GET path and minimizes returned data',async()=>{
 let called=0;
 const client=createReceivingClient({apiKey,fetchImpl:async(url,opts)=>{
   called++;
   assert.equal(url,API_ORIGIN+'/emails/receiving/'+emailId);
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.cache,'no-store');
   assert.equal(opts.credentials,'omit');
   assert.equal(opts.headers.Accept,'application/json');
   assert.equal(opts.headers.Authorization,'Bearer '+apiKey);
   assert.ok(opts.signal);
   return res(email());
 }});
 const x=await client.fetchReceivedEmail(emailId);
 assert.equal(called,1);
 assert.deepEqual(x,{data:{
   id:emailId,from:'Teacher <school@example.invalid>',to:[recipient],
   subject:'Dummy school meeting',
   text:'The fictional meeting is next Wednesday.',
   attachments:[]
 }});
 assert.doesNotMatch(JSON.stringify(x),/NOT SAFE|Private-Untrusted|<script>/);
});

test('invalid IDs, path injection and missing keys cannot initiate provider requests',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;throw Error('not expected');};
 const client=createReceivingClient({apiKey,fetchImpl});
 for(const id of [
   '',undefined,'../emails','/etc/passwd',
   '7c958c25-231a-4c3e-94fe-122947b81733?x=1',
   'http://evil.invalid',
   emailId+'%2fattachments'
 ]){
   assert.deepEqual(await client.fetchReceivedEmail(id),{error:{code:'invalid_email_id'}});
 }
 assert.equal(calls,0);
 for(const key of ['', 'sk_test', 're_short','re_good\nmalicious']){
   assert.throws(()=>createReceivingClient({apiKey:key,fetchImpl}),
     /receiving_client_not_configured/);
 }
});

test('non-200 and redirects never expose provider error bodies or follow location',async()=>{
 let calls=0;
 const client=createReceivingClient({apiKey,fetchImpl:async(_url,opts)=>{
   calls++;
   assert.equal(opts.redirect,'error');
   return new Response(JSON.stringify({error:'private-user-details'}),{
     status:429,headers:{'content-type':'application/json'}
   });
 }});
 assert.deepEqual(await client.fetchReceivedEmail(emailId),
   {error:{code:'provider_unavailable'}});
 assert.equal(calls,1);
 const redirectClient=createReceivingClient({apiKey,fetchImpl:async()=>new Response('',{
   status:302,headers:{location:'https://attacker.invalid/steal'}
 })});
 assert.deepEqual(await redirectClient.fetchReceivedEmail(emailId),
   {error:{code:'provider_unavailable'}});
});

test('reject response larger than bound even when server lies about size',async()=>{
 const oversized=createReceivingClient({apiKey,fetchImpl:async()=>{
   const payload={...email(),html:'x'.repeat(132000)};
   return res(payload);
 }});
 assert.deepEqual(await oversized.fetchReceivedEmail(emailId),
   {error:{code:'provider_unavailable'}});
 const oversizedHeader=createReceivingClient({apiKey,fetchImpl:async()=>{
   return res(email(),200,{
     'content-type':'application/json',
     'content-length':'200000'
   });
 }});
 assert.deepEqual(await oversizedHeader.fetchReceivedEmail(emailId),
   {error:{code:'provider_unavailable'}});
});

test('invalid JSON and mismatched received message identity fail closed',async()=>{
 const malformed=createReceivingClient({apiKey,fetchImpl:async()=>new Response('not json',{
   status:200,headers:{'content-type':'application/json'}
 })});
 assert.deepEqual(await malformed.fetchReceivedEmail(emailId),
   {error:{code:'provider_unavailable'}});
 const wrongId=createReceivingClient({apiKey,fetchImpl:async()=>res({
   ...email(),id:'f'.repeat(8)+'-1111-4111-8111-222222222222'
 })});
 assert.deepEqual(await wrongId.fetchReceivedEmail(emailId),
   {error:{code:'invalid_provider_payload'}});
});

test('only an active consent can lead through provider adapter to review-only text',async()=>{
 const envelope=await encryptedFixture();
 let fetchCount=0,checkCount=0;
 const client=createReceivingClient({apiKey,fetchImpl:async()=>{fetchCount++;return res(email());}});
 const result=await prepareHumanReview({
   receiptKey,encryptedEnvelope:envelope,encryptionKeyHex,
   resolveAuthorizedRecipient:async()=>{
     checkCount++;
     return {familyId,active:true,consentActive:true};
   },
   fetchReceivedEmail:client.fetchReceivedEmail,
   approvedSenders:['school@example.invalid']
 });
 assert.equal(result.status,'pending_human_review');
 assert.equal(result.requiresHumanApproval,true);
 assert.equal(result.approvedForAutoActions,false);
 assert.equal(result.untrustedContent,true);
 assert.equal(result.sender,'school@example.invalid');
 assert.equal(fetchCount,1);
 assert.equal(checkCount,2);
 assert.doesNotMatch(JSON.stringify(result),/script|X-Private/);
});

test('revocation before retrieval guarantees no requests to provider',async()=>{
 const envelope=await encryptedFixture();
 let calls=0;
 const client=createReceivingClient({apiKey,fetchImpl:async()=>{calls++;return res(email());}});
 const result=await prepareHumanReview({
   receiptKey,encryptedEnvelope:envelope,encryptionKeyHex,
   resolveAuthorizedRecipient:async()=>null,
   fetchReceivedEmail:client.fetchReceivedEmail,
   approvedSenders:['school@example.invalid']
 });
 assert.deepEqual(result,{status:'consent_missing',bodyFetched:false});
 assert.equal(calls,0);
});

test('wrong receiving alias is rejected even when provider ID and sender look trusted',async()=>{
 const envelope=await encryptedFixture();
 const wrong={...email(),to:['in-ffffffffffffffffffffffffffffffff@entrada.nexlupa.app']};
 const client=createReceivingClient({apiKey,fetchImpl:async()=>res(wrong)});
 const result=await prepareHumanReview({
   receiptKey,encryptedEnvelope:envelope,encryptionKeyHex,
   resolveAuthorizedRecipient:async()=>({familyId,active:true,consentActive:true}),
   fetchReceivedEmail:client.fetchReceivedEmail,
   approvedSenders:['school@example.invalid']
 });
 assert.deepEqual(result,{status:'source_not_approved',bodyFetched:true});
});

test('no network can be requested if fetch runtime or timeout is invalid',()=>{
 for(const delay of [0,100,20000,-1,1.5]){
   assert.throws(()=>createReceivingClient({apiKey,fetchImpl:async()=>res(email()),timeoutMs:delay}),
     /receiving_client_not_configured/);
 }
 assert.throws(()=>createReceivingClient({apiKey,fetchImpl:null}),
     /receiving_client_not_configured/);
});
