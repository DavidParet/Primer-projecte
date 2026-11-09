'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {
 createRestrictedPairingIssuer,createRestrictedPairingConfirmer,
 ISSUE_RESTRICTED_SQL,CONFIRM_RESTRICTED_SQL
}=require('../lib/whatsapp/restricted-family-pairing');
const {CODE_PATTERN}=require('../lib/whatsapp/family-pairing-protocol');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const now=1800000000000;
const senderKey=randomBytes(32).toString('base64');
const pairingKey=randomBytes(32).toString('base64');
const metaAppSecret='ci-synthetic-meta-secret';
const businessId='744441234',phoneId='844441234',waId='34611111111';
const session={
 authenticated:true,userId:'account-a',sessionId:'trusted-session-a',
 expiresAtMs:now+60000,revoked:false
};

function makeDb({issue={state:'created',expiresAt:'2027-01-01T00:00:00Z'},
 confirm={state:'paired'},error=null}={}){
 const calls=[];let releaseCount=0;
 const db={async connect(){return {
  async query(sql,params){
   calls.push({sql,params});
   if(sql===error)throw Error('private synthetic database failure');
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql===ISSUE_RESTRICTED_SQL)return {rows:[{result:issue}]};
   if(sql===CONFIRM_RESTRICTED_SQL)return {rows:[{result:confirm}]};
   throw Error('Direct table queries forbidden');
  },
  release(){releaseCount++;}
 };}};
 return {db,calls,get releases(){return releaseCount;}};
}
function issuer(f,options={}){
 return createRestrictedPairingIssuer({
  db:f.db,pairingHmacKey:pairingKey,now:()=>now,
  getAuthenticatedSession:options.getSession|| (async()=>session),
  getMembership:options.getMembership || (async({userId,familyId})=>
   userId==='account-a'&&familyId===A?
   {userId,familyId,active:true,revoked:false,role:'admin'}:null)
 });
}
function body(text='NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR'){
 const raw=Buffer.from(JSON.stringify({
  object:'whatsapp_business_account',entry:[{
   id:businessId,changes:[{field:'messages',value:{
    metadata:{phone_number_id:phoneId},
    messages:[{id:'wamid.test-restricted-pair',
     timestamp:'1794150000',from:waId,
     type:'text',text:{body:text}}]
   }}]
  }]
 }));
 const signature='sha256='+createHmac('sha256',metaAppSecret)
  .update(raw).digest('hex');
 return {raw,signature};
}
function confirmer(f){
 return createRestrictedPairingConfirmer({
  db:f.db,metaAppSecret,senderHmacKey:senderKey,pairingHmacKey:pairingKey
 });
}

test('verified issuer calls one approved function, never direct membership INSERT',async()=>{
 const f=makeDb();
 const result=await issuer(f)({
  familyId:A,businessAccountId:businessId,phoneNumberId:phoneId
 });
 assert.match(result.code,CODE_PATTERN);
 assert.equal(result.consentVersion,'whatsapp-incoming-text-v1');
 assert.deepEqual(f.calls.map(x=>x.sql),['BEGIN',ISSUE_RESTRICTED_SQL,'COMMIT']);
 assert.deepEqual(f.calls[1].params.slice(0,4),
  ['account-a',A,businessId,phoneId]);
 assert.equal(f.calls[1].params[4].length,32);
 assert.equal(f.calls[1].params.includes(result.code),false);
 assert.equal(f.calls[1].params.includes(waId),false);
 assert.equal(f.releases,1);
});

test('forged family ID and ordinary member fail before opening SQL',async()=>{
 const f=makeDb();
 await assert.rejects(issuer(f)({
  familyId:B,businessAccountId:businessId,phoneNumberId:phoneId,
  actor:{userId:'account-b-admin',role:'owner'}
 }),/Verified family administrator/);
 assert.equal(f.calls.length,0);
 const ordinary=makeDb();
 await assert.rejects(issuer(ordinary,{
  getMembership:async({userId,familyId})=>({
   userId,familyId,role:'member',active:true,revoked:false
  })
 })({familyId:A,businessAccountId:businessId,phoneNumberId:phoneId}),
 /Verified family administrator/);
 assert.equal(ordinary.calls.length,0);
});

test('swapped session cannot create a challenge',async()=>{
 const f=makeDb();let reads=0;
 const issue=issuer(f,{getSession:async()=>{
  reads++;
  return reads===3?{...session,sessionId:'swapped'}:session;
 }});
 await assert.rejects(issue({familyId:A,businessAccountId:businessId,
  phoneNumberId:phoneId}),/Verified server session changed/);
 assert.equal(f.calls.length,0);
});

test('DB denies unauthorized family creation and rolls back',async()=>{
 const f=makeDb({issue:{state:'rejected'}});
 await assert.rejects(issuer(f)({familyId:A,businessAccountId:businessId,
  phoneNumberId:phoneId}),/Pairing creation refused/);
 assert.deepEqual(f.calls.map(c=>c.sql),
  ['BEGIN',ISSUE_RESTRICTED_SQL,'ROLLBACK']);
});

test('signed Meta acceptance reaches only one protected confirmation function',async()=>{
 const f=makeDb(),confirm=confirmer(f),{raw,signature}=body();
 assert.deepEqual(await confirm(raw,signature),{state:'paired'});
 assert.deepEqual(f.calls.map(c=>c.sql),
  ['BEGIN',CONFIRM_RESTRICTED_SQL,'COMMIT']);
 const args=f.calls[1].params;
 assert.deepEqual(args.slice(0,2),[businessId,phoneId]);
 assert.equal(args[2].length,32);
 assert.equal(args[3].length,32);
 assert.equal(args[4],'wamid.test-restricted-pair');
 assert.equal(args.includes('ABCD-EFGH-JKLM-NPQR'),false);
 assert.equal(args.includes(waId),false);
});

test('invalid Meta signature, ordinary text and malformed webhook never connect',async()=>{
 const f=makeDb(),confirm=confirmer(f);
 const {raw,signature}=body();
 assert.deepEqual(await confirm(raw,'sha256='+('0'.repeat(64))),
  {state:'rejected'});
 const news=body('Excursió escolar demà a les 9');
 assert.deepEqual(await confirm(news.raw,news.signature),
  {state:'ignored'});
 assert.deepEqual(await confirm(Buffer.from('broken JSON'),signature),
  {state:'rejected'});
 assert.equal(f.calls.length,0);
});

test('duplicate provider event does not change consent again',async()=>{
 const f=makeDb({confirm:{state:'already_processed'}});
 const {raw,signature}=body();
 assert.deepEqual(await confirmer(f)(raw,signature),
  {state:'already_processed'});
 assert.equal(f.calls.at(-1).sql,'COMMIT');
});

test('database outage fails closed with rollback and no false opt-in',async()=>{
 const f=makeDb({error:CONFIRM_RESTRICTED_SQL});
 const {raw,signature}=body();
 await assert.rejects(confirmer(f)(raw,signature),
  /private synthetic database failure/);
 assert.deepEqual(f.calls.map(c=>c.sql),
  ['BEGIN',CONFIRM_RESTRICTED_SQL,'ROLLBACK']);
 assert.equal(f.releases,1);
});

test('malformed restricted operation response is rejected and rolled back',async()=>{
 const f=makeDb({confirm:{state:'not_executable'}});
 const {raw,signature}=body();
 await assert.rejects(confirmer(f)(raw,signature),
  /Invalid restricted pairing operation response/);
 assert.deepEqual(f.calls.map(c=>c.sql),
  ['BEGIN',CONFIRM_RESTRICTED_SQL,'ROLLBACK']);
});

test('cannot reuse sender HMAC key as pairing key',()=>{
 const f=makeDb();
 assert.throws(()=>createRestrictedPairingConfirmer({
  db:f.db,metaAppSecret,senderHmacKey:senderKey,
  pairingHmacKey:senderKey
 }),/Separate/);
});
