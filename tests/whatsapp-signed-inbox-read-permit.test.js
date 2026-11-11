'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac,createHash}=require('node:crypto');
const {createInboxReadPermitSigner,inboxReadPayload,PURPOSE,TTL_SECONDS}=
 require('../lib/whatsapp/signed-inbox-read-permit');

const familyId='11111111-1111-4111-8111-111111111111';
const key=randomBytes(32),encryptionKey=randomBytes(32);
const keyBase64=key.toString('base64'),contentEncryptionKey=encryptionKey.toString('base64');
const now=()=>1800000000000;
const selected=()=>({purpose:PURPOSE,keyId:'ci-inbox-read-v1',state:'active',
 keyBase64});
const attrs=()=>({userId:'canonical-a',sessionId:'verified-synthetic-session',
 familyId,beforeInboundId:null,limit:10});
const build=(resolver=async()=>selected(),extra={})=>createInboxReadPermitSigner({
 getActiveSigningKey:resolver,now,contentEncryptionKey,...extra
});

test('permit binds exact canonical user, family, cursor, session digest, limit and TTL',async()=>{
 const signed=await build()(attrs());
 const expectedDigest=createHash('sha256')
  .update('nexlupa:inbox-session:v1:').update(attrs().sessionId).digest();
 assert.deepEqual(signed.sessionDigest,expectedDigest);
 assert.equal(signed.sessionDigest.length,32);
 assert.equal(signed.expiresAt,Math.floor(now()/1000)+TTL_SECONDS);
 assert.equal(signed.userId,'canonical-a');
 assert.equal(signed.familyId,familyId);
 assert.equal(signed.keyId,'ci-inbox-read-v1');
 assert.equal(signed.signature.length,32);
 assert.notEqual(JSON.stringify({
  userId:signed.userId,keyId:signed.keyId,nonce:signed.nonce
 }).includes(attrs().sessionId),true);
 assert.deepEqual(signed.signature,createHmac('sha256',key)
  .update(inboxReadPayload(signed),'utf8').digest());
 const page=await build()({...attrs(),beforeInboundId:99,limit:3});
 assert.equal(inboxReadPayload(page).split('|')[5],'99');
 assert.equal(inboxReadPayload(page).split('|')[6],'3');
 assert.notDeepEqual(page.signature,signed.signature);
 assert.notEqual(page.nonce,signed.nonce);
});

test('revoked, missing, forged or confused signing keys deny before SQL',async()=>{
 for(const item of [
  null,{...selected(),state:'revoked'},
  {...selected(),purpose:'web-consent-issue'},
  {...selected(),keyId:'not valid'},
  {...selected(),keyBase64:'abc'},
  {...selected(),keyBase64:contentEncryptionKey}
 ]){
  await assert.rejects(build(async()=>item)(attrs()),/key|isolated/i);
 }
 assert.throws(()=>createInboxReadPermitSigner({
  now,contentEncryptionKey
 }),/signing key resolver/);
 assert.throws(()=>createInboxReadPermitSigner({
  getActiveSigningKey:async()=>selected(),now,
  contentEncryptionKey:'uncanonical'
 }),/32-byte/);
});

test('unsigned or browser-forged fields cannot create a valid permit',async()=>{
 const sign=build();
 for(const input of [
  {...attrs(),userId:'admin;DROP TABLE'},
  {...attrs(),sessionId:''},
  {...attrs(),familyId:'other-family'},
  {...attrs(),limit:0},
  {...attrs(),limit:21},
  {...attrs(),beforeInboundId:'5'},
  {...attrs(),beforeInboundId:0}
 ])await assert.rejects(sign(input),/Verified canonical|Invalid signed inbox/i);
 const signed=await sign(attrs());
 for(const change of [
  {...signed,limit:11},
  {...signed,familyId:'not-a-uuid'},
  {...signed,sessionDigest:Buffer.alloc(5)},
  {...signed,nonce:'fake'},
  {...signed,beforeInboundId:-1}
 ]){
  if(change.familyId==='not-a-uuid'||change.nonce==='fake'||
     change.sessionDigest.length!==32||change.beforeInboundId===-1)
   assert.throws(()=>inboxReadPayload(change),TypeError);
  else assert.notDeepEqual(createHmac('sha256',key).update(
   inboxReadPayload(change)).digest(),signed.signature);
 }
});
