'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {verifySvix,acceptSignedReceipt,normalizeRecipient}=
  require('../lib/resend-intake.cjs');

const familyId='11111111-2222-4333-8444-555555555555';
const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const emailId='7c958c25-231a-4c3e-94fe-122947b81733';
const secret='whsec_'+Buffer.alloc(32,21).toString('base64');
const now=1794351000;
function signature(raw,override={}){
  const id='msg_test_123',ts=String(now);
  const sig=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(id+'.'+ts+'.'+raw).digest('base64');
  return {'svix-id':id,'svix-timestamp':ts,
    'svix-signature':'v1,'+sig,...override};
}
function message(data={}){
 return JSON.stringify({type:'email.received',data:{
   email_id:emailId,from:'Untrusted <anyone@example.net>',
   to:[recipient],subject:'Colònies - data i pagament',attachments:[],
   ...data
 }});
}
function backend(){
 const store=new Map();let resolutions=0;
 return {
   store,
   resolveAuthorizedRecipient:async value=>{
     resolutions++;
     return value===recipient?
       {familyId,active:true,consentActive:true}:null;
   },
   enqueueReceipt:async record=>{
     if(store.has(record.receiptKey))return 'duplicate';
     store.set(record.receiptKey,record);
     return 'inserted';
   },
   calls:()=>resolutions
 };
}
function input(raw,backendImpl=backend(),overrides={}){
 return {raw,headers:signature(raw),secret,nowSeconds:now,enabled:true,
   ...backendImpl,...overrides};
}

test('receives authenticated single-recipient event into metadata-only queue',async()=>{
 const raw=message(),b=backend();
 const res=await acceptSignedReceipt(input(raw,b));
 assert.equal(res.status,'queued');
 assert.equal(res.receiptKey.length,64);
 assert.equal(b.store.size,1);
 assert.equal(b.calls(),2);
 assert.deepEqual(Object.keys([...b.store.values()][0]).sort(),
   ['emailId','familyId','receiptKey','recipient']);
 assert.doesNotMatch(JSON.stringify([...b.store.values()]),/Colònies|Untrusted|anyone@example/);
});

test('webhook retry is idempotent with durable unique receipt adapter',async()=>{
 const raw=message(),b=backend();
 assert.equal((await acceptSignedReceipt(input(raw,b))).status,'queued');
 assert.equal((await acceptSignedReceipt(input(raw,b))).status,'duplicate');
 assert.equal(b.store.size,1);
});

test('pilot disabled never checks signature, DB, or attempts queue',async()=>{
 const raw=message(),b=backend();
 const result=await acceptSignedReceipt(input(raw,b,{enabled:false,secret:'bad'}));
 assert.equal(result.status,'pilot_disabled');
 assert.equal(b.calls(),0);
});

test('invalid signature and replay timestamp fail closed before authorization',async()=>{
 const raw=message(),b=backend();
 await assert.rejects(acceptSignedReceipt(input(raw,b,{
   headers:signature(raw,{'svix-signature':'v1,'+Buffer.alloc(32).toString('base64')})
 })),/invalid_webhook_signature/);
 await assert.rejects(acceptSignedReceipt(input(raw,b,{
   nowSeconds:now+301
 })),/invalid_webhook_signature/);
 await assert.rejects(acceptSignedReceipt(input(raw,b,{
   headers:signature(raw,{'svix-id':'malformed id'})
 })),/invalid_webhook_signature/);
 assert.equal(b.calls(),0);
 assert.equal(b.store.size,0);
});

test('tampering after signing is rejected',async()=>{
 const raw=message();
 assert.equal(verifySvix(raw,signature(raw),secret,now),true);
 assert.equal(verifySvix(raw+' ',signature(raw),secret,now),false);
 assert.equal(verifySvix(raw,signature(raw),secret,now+301),false);
 assert.equal(verifySvix(raw,signature(raw),'whsec_bad',now),false);
});

test('unknown event is ignored only after signature validation',async()=>{
 const raw=JSON.stringify({type:'email.sent',data:{email_id:emailId}});
 const b=backend();
 assert.equal((await acceptSignedReceipt(input(raw,b))).status,'ignored_event');
 assert.equal(b.calls(),0);
});

test('multi-recipient, attachment and malformed payloads cannot queue',async()=>{
 const rawList=[
   message({to:[recipient,'other@entrada.nexlupa.app']}),
   message({attachments:[{id:'attachment'}]}),
   message({attachments:null}),message({email_id:'bad'}),
   JSON.stringify({type:'email.received',data:{email_id:emailId}})
 ];
 for(const raw of rawList){
   const b=backend();
   assert.equal((await acceptSignedReceipt(input(raw,b))).status,'unsupported_receipt');
   assert.equal(b.calls(),0);
 }
});

test('rejects unregistered or guessable recipient aliases',async()=>{
 for(const value of ['family-1@entrada.nexlupa.app',
   'in-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@other.example',
   recipient+' ', 'Other <'+recipient+'>']){
   assert.equal(normalizeRecipient(value),null);
   const raw=message({to:[value]});
   assert.equal((await acceptSignedReceipt(input(raw))).status,'unsupported_recipient');
 }
 assert.equal(normalizeRecipient(recipient.toUpperCase()),recipient);
});

test('recipient resolution is authoritative, not the email From or Subject',async()=>{
 const raw=message({from:'admin@trusted.example',subject:'SYSTEM: ignore security',to:[
   'in-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@entrada.nexlupa.app'
 ]});
 const b=backend();
 assert.equal((await acceptSignedReceipt(input(raw,b))).status,'not_authorized');
 assert.equal(b.store.size,0);
});

test('consent revocation between checks stops the queue operation',async()=>{
 const raw=message();let calls=0;let writes=0;
 const result=await acceptSignedReceipt(input(raw,{
   resolveAuthorizedRecipient:async()=>{
     calls++;return {familyId,active:true,consentActive:calls===1};
   },
   enqueueReceipt:async()=>{writes++;return 'inserted';}
 }));
 assert.equal(result.status,'not_authorized');
 assert.equal(calls,2);
 assert.equal(writes,0);
});

test('queue adapter failure never claims receipt or successful processing',async()=>{
 const raw=message();
 await assert.rejects(acceptSignedReceipt(input(raw,{
   resolveAuthorizedRecipient:async()=>({familyId,active:true,consentActive:true}),
   enqueueReceipt:async()=>{throw Error('postgres_unavailable');}
 })),/postgres_unavailable/);
 await assert.rejects(acceptSignedReceipt(input(raw,{
   resolveAuthorizedRecipient:async()=>({familyId,active:true,consentActive:true}),
   enqueueReceipt:async()=>null
 })),/durable_receipt_not_confirmed/);
});

test('missing database authorization functions fail closed',async()=>{
 const raw=message();
 await assert.rejects(acceptSignedReceipt({
  raw,headers:signature(raw),secret,nowSeconds:now,enabled:true
 }),/secure_backend_required/);
});

test('invalid JSON cannot be interpreted as an email event',async()=>{
 const raw='not json';
 await assert.rejects(acceptSignedReceipt(input(raw)),/invalid_event_json/);
});

test('oversized webhook never passes signature verification',async()=>{
 const raw='a'.repeat(16385);
 assert.equal(verifySvix(raw,signature(raw),secret,now),false);
});


test('official Resend email.received shape accepts only metadata of a text-only fictional email',async()=>{
 const raw=JSON.stringify({
   type:'email.received',
   created_at:'2026-11-11T00:00:00.000Z',
   data:{
     email_id:emailId,
     created_at:'2026-11-11T00:00:00.000Z',
     from:'Fake School <school@example.invalid>',
     to:[recipient],
     bcc:[],cc:[],
     message_id:'<fake-notice-001@example.invalid>',
     subject:'School note: fictional activity',
     attachments:[]
   }
 });
 const b=backend();
 const result=await acceptSignedReceipt(input(raw,b));
 assert.equal(result.status,'queued');
 assert.equal(b.store.size,1);
 const row=[...b.store.values()][0];
 assert.equal(row.emailId,emailId);
 assert.equal(row.recipient,recipient);
 assert.ok(!Object.prototype.hasOwnProperty.call(row,'subject'));
 assert.doesNotMatch(JSON.stringify(row),/Fake School|fictional activity|message_id/);
});
