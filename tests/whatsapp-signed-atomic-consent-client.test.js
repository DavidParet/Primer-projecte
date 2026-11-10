'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createSignedAtomicConsentClient,ACTIVATE_SQL,
 PURPOSE,PERMIT_SECONDS,formatPermit}=
 require('../lib/whatsapp/signed-atomic-consent-client');

const familyId='a0000000-0000-4000-8000-000000000911';
const businessAccountId='9988771122';
const phoneNumberId='8877661122';
const challengeId='ci_phone_proof_12345';
const consentReceiptId='ci_web_receipt_12345';
const version='ci-signed-1';
const proofKey=randomBytes(32);
const receiptKey=randomBytes(32);
const activationKey=randomBytes(32);
const now=1794350400000;
const identity={userId:'canonical-admin-1',sessionId:'verified-session-1'};
const input={familyId,businessAccountId,phoneNumberId,
 challengeId,consentReceiptId};

function mockDatabase(state='enrolled'){
 const queries=[];let released=0;
 return {queries,get released(){return released;},
  db:{async connect(){return {
   async query(sql,params){
    queries.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
    if(sql===ACTIVATE_SQL)return {
     rowCount:1,rows:[{result:{state}}]
    };
    throw Error('No direct SQL allowed');
   },release(){released++;}
  };}}};
}
function fixture({state='enrolled',authCheck=async()=>true,
 principal=async()=>identity,signerKey=activationKey,
 keyState='active',signerPurpose=PURPOSE,
 dbObj}={}){
 const database=dbObj||mockDatabase(state);
 const binding=async()=>({
   authorizeFamily:async args=>{
    assert.deepEqual(args,{familyId,action:'enroll_whatsapp_sender'});
    return authCheck();
   },
   getVerifiedPrincipal:principal
 });
 let reads=0;
 const getActiveSigningKey=async purpose=>{
  reads++;
  assert.equal(purpose,PURPOSE);
  return {purpose:signerPurpose,state:keyState,keyId:'ci-atomic-key-1',
   keyBase64:signerKey.toString('base64')};
 };
 return {database,get reads(){return reads;},
  activate:createSignedAtomicConsentClient({
   db:database.db,proofHmacKey:proofKey.toString('base64'),
   receiptHmacKey:receiptKey.toString('base64'),consentVersion:version,
   bindVerifiedRequest:binding,getActiveSigningKey,now:()=>now
  })
 };
}

test('only verified family member signs one short-lived activation permit',async()=>{
 const f=fixture();
 assert.deepEqual(await f.activate(input),{state:'enrolled'});
 assert.equal(f.reads,1);
 assert.equal(f.database.released,1);
 assert.deepEqual(f.database.queries.map(c=>c.sql===ACTIVATE_SQL?
  'ACTIVATE':c.sql),['BEGIN','ACTIVATE','COMMIT']);
 const args=f.database.queries[1].params;
 assert.deepEqual(args.slice(0,3),[familyId,businessAccountId,phoneNumberId]);
 assert.equal(args[4].length,32);
 assert.equal(args[5],version);assert.equal(args[6],'ci-atomic-key-1');
 assert.equal(args[7],Math.floor(now/1000)+PERMIT_SECONDS);
 assert.equal(args[8].length,36);
 assert.equal(args[9].length,32);
 assert.ok(!args.includes(challengeId)&&!args.includes(consentReceiptId));
 assert.deepEqual(args[3],createHmac('sha256',proofKey)
  .update('nexlupa:phone-proof:v1:').update(challengeId).digest());
 assert.deepEqual(args[4],createHmac('sha256',receiptKey)
  .update('nexlupa:consent-receipt:v1:').update(consentReceiptId).digest());
 const expected=createHmac('sha256',activationKey)
  .update(formatPermit({keyId:args[6],familyId,
   businessAccountId,phoneNumberId,proofDigest:args[3],
   receiptDigest:args[4],consentVersion:version,
   expiresAt:args[7],nonce:args[8]})).digest();
 assert.deepEqual(args[9],expected);
});

test('role denial before signing opens no database transaction',async()=>{
 const f=fixture({authCheck:async()=>false});
 await assert.rejects(f.activate(input),/Current family administrator required/);
 assert.equal(f.reads,0);assert.equal(f.database.queries.length,0);
});

test('session changes after key retrieval are rejected without SQL',async()=>{
 let count=0;
 const f=fixture({principal:async()=>++count===1?identity:
  {...identity,sessionId:'session-swapped'}});
 await assert.rejects(f.activate(input),/session changed/);
 assert.equal(f.database.queries.length,0);
});
test('revoked family admin after asynchronous signature cannot execute SQL',async()=>{
 let count=0;
 const f=fixture({authCheck:async()=>++count===1});
 await assert.rejects(f.activate(input),/permission expired/);
 assert.equal(f.reads,1);assert.equal(f.database.queries.length,0);
});
test('receipt, proof and activation keys must be separate',async()=>{
 const f=fixture({signerKey:proofKey});
 await assert.rejects(f.activate(input),/must be independent/);
 assert.equal(f.database.queries.length,0);
 assert.throws(()=>createSignedAtomicConsentClient({
  db:mockDatabase().db,
  bindVerifiedRequest:async()=>({}),
  getActiveSigningKey:async()=>({}),
  proofHmacKey:proofKey.toString('base64'),
  receiptHmacKey:proofKey.toString('base64'),
  consentVersion:version
 }),/must be separate/);
});
test('wrong signing key purpose or revoked key fails closed',async()=>{
 for(const props of [{signerPurpose:'issue'},{keyState:'revoked'}]){
  const f=fixture(props);
  await assert.rejects(f.activate(input),/No active dedicated activation signing key/);
  assert.equal(f.database.queries.length,0);
 }
});
test('SQL rejection rolls back and cannot claim enrollment',async()=>{
 const f=fixture({state:'rejected'});
 assert.deepEqual(await f.activate(input),{state:'rejected'});
 assert.deepEqual(f.database.queries.map(x=>x.sql===ACTIVATE_SQL?'RPC':x.sql),
  ['BEGIN','RPC','ROLLBACK']);
});
test('DB failure rolls back and releases the dedicated restricted client',async()=>{
 const calls=[];let released=0;
 const f=fixture({dbObj:{
  queries:calls,get released(){return released;},
  db:{async connect(){return {async query(sql){
   calls.push(sql);
   if(sql===ACTIVATE_SQL)throw Error('synthetic DB outage');
   return {};
  },release(){released++;}};}}
 }});
 await assert.rejects(f.activate(input),/synthetic DB outage/);
 assert.deepEqual(calls,['BEGIN',ACTIVATE_SQL,'ROLLBACK']);
 assert.equal(f.database.released,1);
});
test('malformed browser family, tokens and server provider never write',async()=>{
 const f=fixture();
 for(const update of [{familyId:'false'}, {businessAccountId:'abc'},
    {challengeId:{toString:()=>challengeId}},
    {consentReceiptId:'short'},{phoneNumberId:'notdigits'}]){
  await assert.rejects(f.activate({...input,...update}),/Invalid signed activation identity/);
 }
 assert.equal(f.database.queries.length,0);
});
