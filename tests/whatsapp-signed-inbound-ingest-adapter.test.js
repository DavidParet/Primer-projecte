'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {INSERT_SQL,PURGE_SQL}=require('../lib/whatsapp/durable-inbox');
const {
 createSignedInboundIngestAdapter,SIGNED_INSERT_SQL,ingestPermitPayload,
 PURPOSE,TTL_SECONDS
}=require('../lib/whatsapp/signed-inbound-ingest-adapter');

const senderKey=randomBytes(32).toString('base64');
const contentKey=randomBytes(32).toString('base64');
const signingKey=randomBytes(32);
const NOW=1800000000000;
const selected=()=>({purpose:PURPOSE,keyId:'ci-inbound-v1',state:'active',
 keyBase64:signingKey.toString('base64')});
const input=()=>['123456789','987654321',randomBytes(32),
 'wamid.synthetic-verified',randomBytes(12),randomBytes(16),
 randomBytes(80),'1794000000'];

function fixture(options={}){
 const calls=[];
 const client={async query(sql,values){
  calls.push({sql,values});
  return {rows:[{state:'stored'}],rowCount:1};
 }};
 const db=options.db||client;
 const adapter=createSignedInboundIngestAdapter({
  db,getActiveSigningKey:async(purpose)=>{
   assert.equal(purpose,PURPOSE);
   return selected();
  },
  now:()=>NOW,senderHmacKey:senderKey,contentEncryptionKey:contentKey
 });
 return {adapter,calls};
}
test('signs exact encrypted values, never raw phone or plaintext',async()=>{
 const x=fixture(),fields=input();
 const result=await x.adapter.query(INSERT_SQL,fields);
 assert.equal(result.rows[0].state,'stored');
 assert.equal(x.calls.length,1);
 const {sql,values}=x.calls[0];
 assert.equal(sql,SIGNED_INSERT_SQL);
 assert.deepEqual(values.slice(0,8),fields);
 assert.equal(values[8],'ci-inbound-v1');
 assert.equal(values[9],Math.floor(NOW/1000)+TTL_SECONDS);
 assert.match(values[10],/^[0-9a-f-]{36}$/);
 assert.equal(values[11].length,32);
 const permit={
  business:fields[0],phone:fields[1],senderDigest:fields[2],
  messageId:fields[3],iv:fields[4],tag:fields[5],
  ciphertext:fields[6],providerTimestamp:fields[7],
  keyId:values[8],expiresAt:values[9],nonce:values[10]
 };
 assert.deepEqual(values[11],createHmac('sha256',signingKey)
  .update(ingestPermitPayload(permit),'utf8').digest());
 assert.equal(Object.hasOwn(result.rows[0],'senderWaId'),false);
 const second=await x.adapter.query(INSERT_SQL,fields);
 assert.notEqual(x.calls[0].values[10],x.calls[1].values[10]);
 assert.notDeepEqual(values[11],x.calls[1].values[11]);
 assert.equal(second.rows[0].state,'stored');
});

test('unknown SQL, missing authorization or selected wrong key fails closed',async()=>{
 const x=fixture();
 for(const bad of [PURGE_SQL,'SELECT * FROM nex_whatsapp_inbound','BEGIN; DROP TABLE x']){
  await assert.rejects(x.adapter.query(bad),/Only signed inbound insertion/);
 }
 assert.equal(x.calls.length,0);
 for(const selection of [
  null,{...selected(),state:'revoked'},
  {...selected(),purpose:'whatsapp-inbox-read'},
  {...selected(),keyId:'in valid'},
  {...selected(),keyBase64:'bogus'},
  {...selected(),keyBase64:senderKey},
  {...selected(),keyBase64:contentKey}
 ]){
  const adapter=createSignedInboundIngestAdapter({
   db:{async query(){throw new Error('SQL MUST NOT BE CALLED');}},
   senderHmacKey:senderKey,contentEncryptionKey:contentKey,
   getActiveSigningKey:async()=>selection,now:()=>NOW
  });
  await assert.rejects(adapter.query(INSERT_SQL,input()),/key|isolated|32-byte/i);
 }
});

test('transaction adapter signs and pins exact same SQL client',async()=>{
 const calls=[];let released=0;
 const db={
  async query(){throw new Error('pool query must not bypass transaction');},
  async connect(){return {
   async query(sql,args){calls.push({sql,args});return {rows:[{state:'stored'}]};},
   release(){released++;}
  }}
 };
 const adapter=createSignedInboundIngestAdapter({
  db,getActiveSigningKey:async()=>selected(),now:()=>NOW,
  senderHmacKey:senderKey,contentEncryptionKey:contentKey
 });
 const client=await adapter.connect();
 await client.query('BEGIN');
 await client.query(INSERT_SQL,input());
 await client.query('COMMIT');
 client.release();
 assert.deepEqual(calls.map(x=>x.sql),['BEGIN',SIGNED_INSERT_SQL,'COMMIT']);
 assert.equal(released,1);
});

test('invalid keys and malformed encrypted delivery never reach SQL',async()=>{
 assert.throws(()=>createSignedInboundIngestAdapter({}),/Restricted SQL client/);
 assert.throws(()=>createSignedInboundIngestAdapter({
  db:{query:async()=>{}},getActiveSigningKey:async()=>selected(),
  senderHmacKey:'bad',contentEncryptionKey:contentKey
 }),/32-byte/);
 assert.throws(()=>createSignedInboundIngestAdapter({
  db:{query:async()=>{}},getActiveSigningKey:async()=>selected(),
  senderHmacKey:senderKey,contentEncryptionKey:senderKey
 }),/must differ/);
 const f=fixture();
 for(const invalid of [
  ['bad',...input().slice(1)], // untrusted business destination
  input().map((x,i)=>i===2?Buffer.alloc(5):x),
  input().map((x,i)=>i===3?'not-wamid':x),
  input().map((x,i)=>i===6?Buffer.alloc(0):x)
 ]){
  await assert.rejects(f.adapter.query(INSERT_SQL,invalid),/Invalid verified/);
 }
 assert.equal(f.calls.length,0);
});
