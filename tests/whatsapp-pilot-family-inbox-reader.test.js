'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createCipheriv}=require('node:crypto');
const {
 createPilotFamilyInboxReader,READ_SQL,LIMIT_MAX
}=require('../lib/whatsapp/pilot-family-inbox-reader');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const NOW=1800000000000;
const key=randomBytes(32);
const secret=key.toString('base64');
const signingKey=randomBytes(32).toString('base64');
const getActiveSigningKey=async()=>({
 purpose:'whatsapp-inbox-read',state:'active',keyId:'ci-inbox-read-v1',
 keyBase64:signingKey
});

function row(id,familyId=A,text='Demà sortida a les 9:00'){
 const account='123456789',phone='987654321',messageId='wamid.synthetic-'+id;
 const sender=randomBytes(32),nonce=randomBytes(12);
 const aad=Buffer.from(JSON.stringify([account,phone,messageId,sender.toString('hex')]));
 const cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
 return {
  inbound_id:String(id),family_id:familyId,
  business_account_id:account,phone_number_id:phone,
  provider_message_id:messageId,sender_digest:sender,nonce,
  authentication_tag:cipher.getAuthTag(),ciphertext,
  received_at:new Date(NOW-10000),expires_at:new Date(NOW+60000)
 };
}
function fixture(rows=[]){
 const queries=[];let allowed=true,sessionId='verified-synthetic-session-a';
 const db={async query(sql,args){
  queries.push({sql,args});
  return {rows};
 }};
 let bindings=0,authChecks=0,principalChecks=0;
 const bindVerifiedRequest=async()=>{
  bindings++;
  return {
   authorizeFamily:async({familyId,action})=>{
    authChecks++;
    return allowed&&familyId===A&&action==='read_whatsapp_messages';
   },
   getVerifiedPrincipal:async()=>{
    principalChecks++;
    return allowed?{userId:'canonical-user-a',sessionId}:null;
   }
  };
 };
 const read=createPilotFamilyInboxReader({
  db,bindVerifiedRequest,contentEncryptionKey:secret,
  getActiveSigningKey,now:()=>NOW
 });
 return {
  read,queries,
  revoke:()=>{allowed=false;},
  swapSession:()=>{sessionId='different-provider-session';},
  bindings:()=>bindings,checks:()=>authChecks,principalChecks:()=>principalChecks
 };
}

test('verified family can decrypt only bounded encrypted SQL RPC results',async()=>{
 const f=fixture([row(17),row(13)]);
 const r=await f.read({familyId:A,limit:2});
 assert.deepEqual(r.messages.map(x=>x.id),[17,13]);
 assert.equal(r.messages[0].text,'Demà sortida a les 9:00');
 assert.equal(r.messages[0].receivedAt,new Date(NOW-10000).toISOString());
 assert.equal(r.nextBeforeInboundId,13);
 const [{sql,args}]=f.queries;
 assert.equal(sql,READ_SQL);
 assert.equal(args.length,9);
 assert.deepEqual(args.slice(0,2),['canonical-user-a',A]);
 assert.equal(args[2].length,32);
 assert.deepEqual(args.slice(3,7),[null,2,'ci-inbox-read-v1',Math.floor(NOW/1000)+30]);
 assert.match(args[7],/^[0-9a-f-]{36}$/);
 assert.equal(args[8].length,32);
 assert.equal(Object.hasOwn(r.messages[0],'senderWaId'),false);
 assert.equal(Object.hasOwn(r.messages[0],'groupId'),false);
 assert.equal(Object.hasOwn(r.messages[0],'ciphertext'),false);
 assert.equal(f.checks(),3);
 assert.equal(f.principalChecks(),3);
});

test('cross-family request and forged actor cannot reach any inbox SQL',async()=>{
 const f=fixture([row(8)]);
 await assert.rejects(f.read({
  familyId:B,actor:{authenticated:true,role:'owner',userId:'canonical-user-b'},
  userId:'canonical-user-b'
 }),/membership/);
 assert.equal(f.queries.length,0);
 assert.equal(f.bindings(),1);
});

test('invalid family, page limit and cursor are denied before session or SQL',async()=>{
 const f=fixture();
 for(const args of [
  {familyId:'wrong'}, {familyId:A,limit:0}, {familyId:A,limit:LIMIT_MAX+1},
  {familyId:A,limit:'10'}, {familyId:A,beforeInboundId:'12'},
  {familyId:A,beforeInboundId:0},
  {familyId:A,beforeInboundId:Number.MAX_SAFE_INTEGER+1}
 ])await assert.rejects(f.read(args),/Invalid family inbox query/);
 assert.equal(f.bindings(),0);
 assert.equal(f.queries.length,0);
});

test('database family leak is rejected even if a mocked RPC returns it',async()=>{
 const f=fixture([row(14,B)]);
 await assert.rejects(f.read({familyId:A}),/Inbox data unavailable/);
 const other=fixture([row(18),row(19)]);
 await assert.rejects(other.read({familyId:A}),/Inbox data unavailable/);
});

test('tampering with AES-GCM and expired records fails closed',async()=>{
 const altered=row(10);altered.ciphertext[0]^=0xff;
 await assert.rejects(fixture([altered]).read({familyId:A}),/Inbox data unavailable/);
 const expired=row(11);expired.expires_at=new Date(NOW-1);
 await assert.rejects(fixture([expired]).read({familyId:A}),/Inbox data unavailable/);
 const badTag=row(12);badTag.authentication_tag=Buffer.alloc(16);
 await assert.rejects(fixture([badTag]).read({familyId:A}),/Inbox data unavailable/);
});

test('authenticated ciphertext with invalid UTF-8 fails closed',async()=>{
 const record=row(21);
 const aad=Buffer.from(JSON.stringify([
  record.business_account_id,record.phone_number_id,
  record.provider_message_id,record.sender_digest.toString('hex')
 ]));
 const cipher=createCipheriv('aes-256-gcm',key,record.nonce);
 cipher.setAAD(aad);
 record.ciphertext=Buffer.concat([cipher.update(Buffer.from([0xc3,0x28])),cipher.final()]);
 record.authentication_tag=cipher.getAuthTag();
 await assert.rejects(fixture([record]).read({familyId:A}),/Inbox data unavailable/);
});

test('revoked family membership after RPC denies returning any decrypted data',async()=>{
 let allowed=true;
 const reader=createPilotFamilyInboxReader({
  db:{async query(){allowed=false;return {rows:[row(9)]};}},
  bindVerifiedRequest:async()=>({
   authorizeFamily:async()=>allowed,
   getVerifiedPrincipal:async()=>({userId:'canonical-user-a',
    sessionId:'verified-synthetic-session-a'})
  }),
  contentEncryptionKey:secret,getActiveSigningKey,now:()=>NOW
 });
 await assert.rejects(reader({familyId:A}),/access expired/);
});

test('session swap during SQL denies returning messages',async()=>{
 let id='session-1';
 const reader=createPilotFamilyInboxReader({
  db:{async query(){id='session-2';return {rows:[row(6)]};}},
  bindVerifiedRequest:async()=>({
   authorizeFamily:async()=>true,
   getVerifiedPrincipal:async()=>({userId:'canonical-user-a',sessionId:id})
  }),contentEncryptionKey:secret,getActiveSigningKey,now:()=>NOW
 });
 await assert.rejects(reader({familyId:A}),/session changed/);
});

test('revocation during asynchronous signing blocks database access',async()=>{
 let allowed=true,queries=0;
 const reader=createPilotFamilyInboxReader({
  db:{async query(){queries++;return {rows:[row(6)]};}},
  bindVerifiedRequest:async()=>({
   authorizeFamily:async()=>allowed,
   getVerifiedPrincipal:async()=>({userId:'canonical-user-a',sessionId:'session-verified'})
  }),
  contentEncryptionKey:secret,now:()=>NOW,
  getActiveSigningKey:async purpose=>{
   assert.equal(purpose,'whatsapp-inbox-read');
   allowed=false;
   return getActiveSigningKey();
  }
 });
 await assert.rejects(reader({familyId:A}),/access expired before inbox query/);
 assert.equal(queries,0);
});

test('session replacement during asynchronous signing blocks database access',async()=>{
 let sessionId='session-a',queries=0;
 const reader=createPilotFamilyInboxReader({
  db:{async query(){queries++;return {rows:[row(5)]};}},
  bindVerifiedRequest:async()=>({
   authorizeFamily:async()=>true,
   getVerifiedPrincipal:async()=>({userId:'canonical-user-a',sessionId})
  }),
  contentEncryptionKey:secret,now:()=>NOW,
  getActiveSigningKey:async()=>{
   sessionId='session-b';
   return getActiveSigningKey();
  }
 });
 await assert.rejects(reader({familyId:A}),/session changed before inbox query/);
 assert.equal(queries,0);
});

test('invalid DB result, missing key or auth dependency never opens inbox',async()=>{
 assert.throws(()=>createPilotFamilyInboxReader({
  db:{query:async()=>({rows:[]})},bindVerifiedRequest:async()=>null,
  contentEncryptionKey:secret
 }),/signing key resolver/);
 const f=fixture();
 assert.throws(()=>createPilotFamilyInboxReader({
  db:{query:async()=>({rows:[]})},bindVerifiedRequest:async()=>null,
  contentEncryptionKey:'invalid'
 }),/32-byte/);
 assert.throws(()=>createPilotFamilyInboxReader({}),/reader required/);
 const reader=createPilotFamilyInboxReader({
  db:{async query(){return {rows:'a dangerous fake row'};}},
  bindVerifiedRequest:async()=>({
   authorizeFamily:async()=>true,
   getVerifiedPrincipal:async()=>({userId:'canonical-user-a',sessionId:'s1'})
  }),contentEncryptionKey:secret,getActiveSigningKey
 });
 await assert.rejects(reader({familyId:A}),/Inbox data unavailable/);
 assert.equal(f.queries.length,0);
});
