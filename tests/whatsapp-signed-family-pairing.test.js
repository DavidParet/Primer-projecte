'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createPairingOperationSigner,permitPayload,
 SIGNED_PAIR_ISSUE_SQL,SIGNED_PAIR_CONFIRM_SQL}
  =require('../lib/whatsapp/signed-pairing-operations');
const {createSignedFamilyPairingIssuer,createSignedMetaPairingConfirmer}
  =require('../lib/whatsapp/signed-family-pairing');
const {CODE_PATTERN}=require('../lib/whatsapp/family-pairing-protocol');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const now=1800000000000;
const pairingHmacKey=randomBytes(32).toString('base64');
const senderHmacKey=randomBytes(32).toString('base64');
const issuerKey=randomBytes(32).toString('base64');
const confirmKey=randomBytes(32).toString('base64');
const metaSecret='fake-ci-meta-app-secret';
const biz='755551111',phone='855551111';
const session={authenticated:true,userId:'account-a',sessionId:'trusted-a',
 expiresAtMs:now+60000,revoked:false};
function keyResolver(){
 const calls=[];
 return {
  calls,
  getActiveSigningKey:async kind=>{
   calls.push(kind);
   return kind==='issue'?
    {purpose:'issue',state:'active',keyId:'issue-key-v1',keyBase64:issuerKey}:
    {purpose:'confirm',state:'active',keyId:'confirm-key-v1',keyBase64:confirmKey};
  }
 };
}
function fakeDb({issue={state:'created',expiresAt:'2027-01-01T00:00:00Z'},
 confirm={state:'paired'},error=null}={}){
 const queries=[];let released=0;
 return {
  queries,get released(){return released;},
  db:{async connect(){return {
   async query(sql,args){
    queries.push({sql,args});
    if(sql===error)throw new Error('internal synthetic DB error');
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
    if(sql===SIGNED_PAIR_ISSUE_SQL)return {rows:[{result:issue}]};
    if(sql===SIGNED_PAIR_CONFIRM_SQL)return {rows:[{result:confirm}]};
    throw new Error('Direct SQL forbidden by mock');
   },release(){released++;}
  };}}
 };
}
function issue(f,k,options={}){
 return createSignedFamilyPairingIssuer({
  db:f.db,pairingHmacKey,
  getActiveSigningKey:k.getActiveSigningKey,
  getAuthenticatedSession:options.getSession|| (async()=>session),
  getMembership:options.getMembership || (async({userId,familyId})=>
   userId==='account-a'&&familyId===A?
    {userId,familyId,active:true,revoked:false,role:'admin'}:null),
  now:()=>now
 });
}
function signedMeta(text='NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR'){
 const raw=Buffer.from(JSON.stringify({
  object:'whatsapp_business_account',entry:[{
   id:biz,changes:[{field:'messages',value:{
    metadata:{phone_number_id:phone},
    messages:[{id:'wamid.test-238',
     from:'34600000000',timestamp:'1794150000',
     type:'text',text:{body:text}}]
   }}]
  }]
 }));
 return {raw,signature:'sha256='+createHmac('sha256',metaSecret)
  .update(raw).digest('hex')};
}
function confirmer(f,k){
 return createSignedMetaPairingConfirmer({
  db:f.db,metaAppSecret:metaSecret,senderHmacKey,pairingHmacKey,
  getActiveSigningKey:k.getActiveSigningKey,now:()=>now
 });
}

test('separate issue and confirm signatures bind all parameters and purpose',async()=>{
 const k=keyResolver();
 const issueSign=createPairingOperationSigner({
  kind:'issue',getActiveSigningKey:k.getActiveSigningKey,now:()=>now
 });
 const digest=randomBytes(32);
 const signed=await issueSign({userId:'account-a',familyId:A,
  businessAccountId:biz,phoneNumberId:phone,codeDigest:digest});
 assert.equal(signed.expiresAt,Math.floor(now/1000)+60);
 const payload=permitPayload('issue',signed);
 assert.equal(signed.signature.length,32);
 assert.deepEqual(signed.signature,
  createHmac('sha256',Buffer.from(issuerKey,'base64'))
   .update(payload).digest());
 const again=await issueSign({userId:'account-a',familyId:A,
  businessAccountId:biz,phoneNumberId:phone,codeDigest:digest});
 assert.notEqual(signed.nonce,again.nonce);
 assert.equal(k.calls.length,2);
 assert.notEqual(permitPayload('issue',{...signed,familyId:B}),payload);
 assert.throws(()=>permitPayload('confirm',signed),/Meta delivery/);
});

test('signed issuer takes user from trusted session and submits only bound SQL',async()=>{
 const f=fakeDb(),k=keyResolver();
 const result=await issue(f,k)({
  familyId:A,businessAccountId:biz,phoneNumberId:phone,
  actor:{userId:'forged-user',role:'owner'},userId:'forged-user'
 });
 assert.match(result.code,CODE_PATTERN);
 assert.deepEqual(f.queries.map(x=>x.sql),
  ['BEGIN',SIGNED_PAIR_ISSUE_SQL,'COMMIT']);
 const params=f.queries[1].args;
 assert.equal(params[0],'account-a');
 assert.deepEqual(params.slice(1,4),[A,biz,phone]);
 assert.equal(params[4].length,32);
 assert.equal(params[5],'issue-key-v1');
 assert.equal(params[8].length,32);
 assert.equal(params.includes(result.code),false);
 assert.equal(f.released,1);
});

test('wrong family or ordinary member cannot sign or connect to database',async()=>{
 const k=keyResolver(),f=fakeDb();
 await assert.rejects(issue(f,k)({
  familyId:B,businessAccountId:biz,phoneNumberId:phone
 }),/administrator/);
 assert.equal(f.queries.length,0);assert.equal(k.calls.length,0);
 const member=fakeDb();
 await assert.rejects(issue(member,k,{
  getMembership:async({userId,familyId})=>({
   userId,familyId,active:true,revoked:false,role:'member'
  })
 })({familyId:A,businessAccountId:biz,phoneNumberId:phone}),/administrator/);
 assert.equal(member.queries.length,0);
});

test('changed verified session denies a new permit',async()=>{
 const f=fakeDb(),k=keyResolver();let read=0;
 await assert.rejects(issue(f,k,{getSession:async()=>{
  read++;return read>=3?{...session,sessionId:'changed'}:session;
 }})({familyId:A,businessAccountId:biz,phoneNumberId:phone}),
 /Verified request session changed/);
 assert.equal(k.calls.length,0);
 assert.equal(f.queries.length,0);
});

test('signer delay cannot authorize a session revoked after key lookup',async()=>{
 const f=fakeDb();
 let revoked=false;
 const issuer=createSignedFamilyPairingIssuer({
  db:f.db,pairingHmacKey,now:()=>now,
  getAuthenticatedSession:async()=>revoked?
    {...session,revoked:true}:session,
  getMembership:async({userId,familyId})=>({
   userId,familyId,role:'admin',active:true,revoked:false
  }),
  getActiveSigningKey:async purpose=>{
   assert.equal(purpose,'issue');
   revoked=true;
   return {purpose:'issue',state:'active',
    keyId:'issue-key-v1',keyBase64:issuerKey};
  }
 });
 await assert.rejects(issuer({
  familyId:A,businessAccountId:biz,phoneNumberId:phone
 }),/Verified request session changed after signing/);
 assert.equal(f.queries.length,0);
});

test('switching user after async signing cannot create family pairing',async()=>{
 const f=fakeDb();
 let swapped=false;
 const issuer=createSignedFamilyPairingIssuer({
  db:f.db,pairingHmacKey,now:()=>now,
  getAuthenticatedSession:async()=>swapped?
   {...session,userId:'account-b',sessionId:'trusted-b'}:session,
  getMembership:async({userId,familyId})=>({
   userId,familyId,role:'admin',active:true,revoked:false
  }),
  getActiveSigningKey:async purpose=>{
   swapped=true;
   return {purpose:'issue',state:'active',
    keyId:'issue-key-v1',keyBase64:issuerKey};
  }
 });
 await assert.rejects(issuer({
  familyId:A,businessAccountId:biz,phoneNumberId:phone
 }),/Verified request session changed after signing/);
 assert.equal(f.queries.length,0);
});

test('Meta signature must be verified before confirmation permit is signed',async()=>{
 const f=fakeDb(),k=keyResolver(),confirm=confirmer(f,k);
 const {raw,signature}=signedMeta();
 assert.deepEqual(await confirm(raw,'sha256='+('0'.repeat(64))),
  {state:'rejected'});
 const mundane=signedMeta('Recordatori escola demà');
 assert.deepEqual(await confirm(mundane.raw,mundane.signature),
  {state:'ignored'});
 assert.equal(k.calls.length,0);assert.equal(f.queries.length,0);
 assert.deepEqual(await confirm(raw,signature),{state:'paired'});
 assert.deepEqual(f.queries.map(x=>x.sql),
  ['BEGIN',SIGNED_PAIR_CONFIRM_SQL,'COMMIT']);
 const params=f.queries[1].args;
 assert.equal(params[0],biz);assert.equal(params[1],phone);
 assert.equal(params[2].length,32);assert.equal(params[3].length,32);
 assert.equal(params[4],'wamid.test-238');
 assert.equal(params[5],'confirm-key-v1');
 assert.equal(params[8].length,32);
 assert.equal(params.includes('34600000000'),false);
 assert.equal(params.includes('ABCD-EFGH-JKLM-NPQR'),false);
 assert.deepEqual(k.calls,['confirm']);
});

test('rejected operation and DB exceptions roll back, not claim enrollment',async()=>{
 const k=keyResolver();
 const rejected=fakeDb({confirm:{state:'rejected'}});
 const msg=signedMeta();
 assert.deepEqual(await confirmer(rejected,k)(msg.raw,msg.signature),
  {state:'rejected'});
 assert.deepEqual(rejected.queries.map(x=>x.sql),
  ['BEGIN',SIGNED_PAIR_CONFIRM_SQL,'ROLLBACK']);
 const outage=fakeDb({error:SIGNED_PAIR_CONFIRM_SQL});
 await assert.rejects(confirmer(outage,k)(msg.raw,msg.signature),
  /internal synthetic DB error/);
 assert.equal(outage.queries.at(-1).sql,'ROLLBACK');
});

test('wrong signing key purpose cannot mint a permit',async()=>{
 const badResolver=async()=>({
  purpose:'issue',keyId:'issue-key-v1',
  keyBase64:issuerKey,state:'active'
 });
 const f=fakeDb();
 const confirm=createSignedMetaPairingConfirmer({
  db:f.db,metaAppSecret:metaSecret,senderHmacKey,pairingHmacKey,
  getActiveSigningKey:badResolver,now:()=>now
 });
 const msg=signedMeta();
 await assert.rejects(confirm(msg.raw,msg.signature),
  /No authorized active pairing signing key/);
 assert.equal(f.queries.length,0);
});

test('pairing digest, sender digest and operation signing keys cannot be reused',async()=>{
 const k=keyResolver(),f=fakeDb();
 const issueWithSame=createSignedFamilyPairingIssuer({
  db:f.db,pairingHmacKey,
  getActiveSigningKey:async()=>({
   purpose:'issue',keyId:'same-key',state:'active',
   keyBase64:pairingHmacKey
  }),
  getAuthenticatedSession:async()=>session,
  getMembership:async({userId,familyId})=>({
   userId,familyId,role:'admin',active:true,revoked:false
  }),now:()=>now
 });
 await assert.rejects(issueWithSame({familyId:A,businessAccountId:biz,
  phoneNumberId:phone}),/independent secrets/);
 assert.equal(f.queries.length,0);
 assert.throws(()=>createSignedMetaPairingConfirmer({
  db:f.db,metaAppSecret:metaSecret,senderHmacKey,
  pairingHmacKey:senderHmacKey,
  getActiveSigningKey:k.getActiveSigningKey,now:()=>now
 }),/independent/);
});
