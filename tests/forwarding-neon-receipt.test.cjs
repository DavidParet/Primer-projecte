'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createNeonReceiptAdapters,decryptReceiptEnvelope,INSERT_SQL}=
  require('../lib/forwarding/neon-receipt.cjs');
const {acceptSignedReceipt}=require('../lib/forwarding/resend-intake.cjs');
const {createHmac}=require('node:crypto');

const familyId='11111111-2222-4333-8444-555555555555';
const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const emailId='7c958c25-231a-4c3e-94fe-122947b81733';
const receiptKey='a'.repeat(64),key='32'.repeat(32);
function adapters({authorized=true,outcome='inserted'}={}){
 const calls=[];
 const query=async(sql,params)=>{
   calls.push({sql,params});
   if(sql.startsWith('SELECT'))return {rows:[{family_id:authorized?familyId:null}]};
   return {rows:[{outcome}]};
 };
 return {...createNeonReceiptAdapters({query,encryptionKeyHex:key}),calls};
}

test('Neon adapter validates role config and encryption key',()=>{
 for(const k of ['', 'abc', '0'.repeat(64)+'ff']){
   assert.throws(()=>createNeonReceiptAdapters({query:async()=>{},encryptionKeyHex:k}),
      /not_configured/);
 }
 assert.throws(()=>createNeonReceiptAdapters({query:null,encryptionKeyHex:key}),
   /not_configured/);
});

test('only the database-secured RPC can establish an authorized family',async()=>{
 const x=adapters();
 const authorized=await x.resolveAuthorizedRecipient(recipient);
 assert.deepEqual(authorized,{familyId,active:true,consentActive:true});
 assert.equal(x.calls.length,1);
 assert.match(x.calls[0].sql,/resolve_authorized_recipient\(\$1::text\)/);
 assert.deepEqual(x.calls[0].params,[recipient]);
 const unauthorized=adapters({authorized:false});
 assert.equal(await unauthorized.resolveAuthorizedRecipient(recipient),null);
 assert.equal(await x.resolveAuthorizedRecipient('unknown@example.net'),null);
 assert.equal(x.calls.length,1);
});

test('one atomic SQL statement checks consent again and persists encrypted receipt',async()=>{
 const x=adapters();
 assert.equal(await x.enqueueReceipt({receiptKey,familyId,emailId,recipient}),'inserted');
 assert.equal(x.calls.length,1);
 const {sql,params}=x.calls[0];
 assert.match(sql,/resolve_authorized_recipient\(\$3::text\)/);
 assert.match(sql,/ON CONFLICT \(queue_id\) DO NOTHING/);
 assert.match(sql,/INSERT INTO nexlupa_pilot\.resend_inbox_queue/);
 assert.deepEqual([params[0],params[2],params[3]],[receiptKey,recipient,familyId]);
 assert.match(params[1],/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
 assert.doesNotMatch(params[1],new RegExp(emailId));
 assert.doesNotMatch(params[1],new RegExp(familyId));
 assert.doesNotMatch(params[1],/Colònies|Subject|From/);
 assert.equal(params[1].length<4096,true);
});

test('database duplicate is acknowledged and does not imply two rows',async()=>{
 const x=adapters({outcome:'duplicate'});
 assert.equal(await x.enqueueReceipt({receiptKey,familyId,emailId,recipient}),
   'duplicate');
 assert.equal(x.calls.length,1);
});

test('consent revocation at the atomic SQL boundary fails closed',async()=>{
 const x=adapters({outcome:'revoked'});
 assert.equal(await x.enqueueReceipt({receiptKey,familyId,emailId,recipient}),
   'revoked');
 assert.match(INSERT_SQL,/WHEN EXISTS \(SELECT 1 FROM permitted/);
});

test('unrecognized DB outcome or invalid receipt never reports success',async()=>{
 const x=adapters({outcome:'unexpected'});
 await assert.rejects(x.enqueueReceipt({receiptKey,familyId,emailId,recipient}),
   /not_confirmed/);
 assert.equal(x.calls.length,1);
 await assert.rejects(x.enqueueReceipt({receiptKey:'bad',familyId,emailId,recipient}),
   /invalid_receipt_metadata/);
 assert.equal(x.calls.length,1);
});

test('end-to-end signed fixture uses two family RPC checks + one atomic queue statement',async()=>{
 const x=adapters();
 const now=1794351000,secret='whsec_'+Buffer.alloc(32,21).toString('base64');
 const raw=JSON.stringify({type:'email.received',data:{
   email_id:emailId,to:[recipient],attachments:[],subject:'Dummy',from:'synthetic@invalid'
 }});
 const id='msg_fixture_123',stamp=String(now);
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
   .update(id+'.'+stamp+'.'+raw).digest('base64');
 const result=await acceptSignedReceipt({
  raw,headers:{'svix-id':id,'svix-timestamp':stamp,
    'svix-signature':'v1,'+signature},
  secret,nowSeconds:now,enabled:true,
  resolveAuthorizedRecipient:x.resolveAuthorizedRecipient,
  enqueueReceipt:x.enqueueReceipt
 });
 assert.equal(result.status,'queued');
 assert.equal(x.calls.length,3);
 assert.equal(x.calls[0].sql.startsWith('SELECT'),true);
 assert.equal(x.calls[1].sql.startsWith('SELECT'),true);
 assert.equal(x.calls[2].sql.trimStart().startsWith('WITH permitted'),true);
 assert.equal(result.receiptKey.length,64);
});

test('end-to-end database revocation never creates accepted receipt',async()=>{
 const x=adapters({outcome:'revoked'});
 const now=1794351000,secret='whsec_'+Buffer.alloc(32,21).toString('base64');
 const raw=JSON.stringify({type:'email.received',data:{
   email_id:emailId,to:[recipient],attachments:[],subject:'Synthetic'
 }});
 const id='msg_fixture_124',stamp=String(now);
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
   .update(id+'.'+stamp+'.'+raw).digest('base64');
 const result=await acceptSignedReceipt({
  raw,headers:{'svix-id':id,'svix-timestamp':stamp,
    'svix-signature':'v1,'+signature},
  secret,nowSeconds:now,enabled:true,
  resolveAuthorizedRecipient:x.resolveAuthorizedRecipient,
  enqueueReceipt:x.enqueueReceipt
 });
 assert.deepEqual(result,{status:'not_authorized'});
});
 
test('encrypted receipt round-trips only with matching key and queue identity',async()=>{
 const adapter=adapters();
 await adapter.enqueueReceipt({receiptKey,familyId,emailId,recipient});
 const envelope=adapter.calls[0].params[1];
 const decoded=decryptReceiptEnvelope({
   receiptKey,encryptedEnvelope:envelope,encryptionKeyHex:key
 });
 assert.deepEqual(decoded,{
   v:1,kind:'resend_metadata_receipt',
   receiptKey,emailId,recipient,familyId
 });
 // AES-GCM additional authenticated data binds the envelope to its row.
 assert.throws(()=>decryptReceiptEnvelope({
   receiptKey:'b'.repeat(64),encryptedEnvelope:envelope,encryptionKeyHex:key
 }),/invalid_receipt_envelope/);
 assert.throws(()=>decryptReceiptEnvelope({
   receiptKey,encryptedEnvelope:envelope,encryptionKeyHex:'ff'.repeat(32)
 }),/invalid_receipt_envelope/);
 const tampered=envelope.slice(0,-1)+(envelope.endsWith('A')?'B':'A');
 assert.throws(()=>decryptReceiptEnvelope({
   receiptKey,encryptedEnvelope:tampered,encryptionKeyHex:key
 }),/invalid_receipt_envelope/);
 assert.throws(()=>decryptReceiptEnvelope({
   receiptKey,encryptedEnvelope:'v2'+envelope.slice(2),encryptionKeyHex:key
 }),/invalid_receipt_envelope/);
});
