'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {permitPayload,createRevocationPermitSigner,REVOKE_WITH_PERMIT_SQL}=
  require('../lib/whatsapp/signed-revocation-permit');
const {createSignedConsentRevoker}=
  require('../lib/whatsapp/signed-consent-revoker');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const now=1800000000000;
const senderHmacKey=randomBytes(32).toString('base64');
const permitHmacKey=randomBytes(32).toString('base64');
const adminSession={authenticated:true,userId:'admin-a',sessionId:'server-session-a',
  expiresAtMs:now+60000,revoked:false};
const validInput={
  familyId:A,authorizationId:42,businessAccountId:'555551111',
  phoneNumberId:'666661111',senderWaId:'34611111111'
};
function fixture({
  role='admin',rows=[{result:{state:'revoked',deletedMessages:2}}],
  getAuthenticatedSession=async()=>adminSession
}={}){
  const queries=[];let releaseCount=0;
  const client={
    async query(sql,args){
      queries.push({sql,args});
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
      if(sql===REVOKE_WITH_PERMIT_SQL)return {rows};
      throw Error('Direct SQL operation not allowed');
    },
    release(){releaseCount++;}
  };
  const revoke=createSignedConsentRevoker({
    db:{connect:async()=>client},senderHmacKey,permitHmacKey,
    getAuthenticatedSession,
    getMembership:async({userId,familyId})=>
      userId==='admin-a'&&familyId===A?
      {userId,familyId,role,active:true,revoked:false}:null,
    now:()=>now
  });
  return {revoke,queries,get releaseCount(){return releaseCount;}};
}

test('signing permit uses separate HMAC secret, scopes fields and fresh nonce',()=>{
  const senderDigest=randomBytes(32);
  const sign=createRevocationPermitSigner({permitHmacKey,now:()=>now});
  const permit=sign({userId:'admin-a',familyId:A,authorizationId:42,
    businessAccountId:'555551111',phoneNumberId:'666661111',senderDigest});
  const permit2=sign({userId:'admin-a',familyId:A,authorizationId:42,
    businessAccountId:'555551111',phoneNumberId:'666661111',senderDigest});
  assert.notEqual(permit.nonce,permit2.nonce);
  assert.equal(permit.expiresAtEpoch,Math.floor(now/1000)+90);
  const payload=permitPayload({...permit,senderDigestHex:senderDigest.toString('hex')});
  assert.equal(payload,[
    'NEXLUPA-WA-REVOKE-1','admin-a',A,'42','555551111','666661111',
    senderDigest.toString('hex'),String(permit.expiresAtEpoch),permit.nonce
  ].join('|'));
  assert.deepEqual(permit.signature,
    createHmac('sha256',Buffer.from(permitHmacKey,'base64'))
      .update(payload,'utf8').digest());
  assert.equal(permit.signature.length,32);
});

test('invalid or ambiguous signing fields are denied before signature',()=>{
  const sign=createRevocationPermitSigner({permitHmacKey,now:()=>now});
  const fields={userId:'admin-a',familyId:A,authorizationId:42,
    businessAccountId:'555551111',phoneNumberId:'666661111',
    senderDigest:randomBytes(32)};
  for(const override of [
    {userId:'admin|a'},{familyId:'not-family'},
    {authorizationId:-1},{businessAccountId:'abc'},
    {senderDigest:Buffer.alloc(16)}
  ])assert.throws(()=>sign({...fields,...override}),/Invalid|Verified/);
  assert.throws(()=>createRevocationPermitSigner({
    permitHmacKey:'wrong',now:()=>now
  }),/Canonical/);
});

test('signed flow only calls one restricted function and commits',async()=>{
  const f=fixture();
  assert.deepEqual(await f.revoke({
    ...validInput,actor:{userId:'admin-b',role:'owner',authenticated:true},
    userId:'admin-b'
  }),{state:'revoked',deletedMessages:2});
  assert.deepEqual(f.queries.map(q=>q.sql),[
    'BEGIN',REVOKE_WITH_PERMIT_SQL,'COMMIT'
  ]);
  const args=f.queries[1].args;
  assert.equal(args[0],'admin-a');
  assert.equal(args[1],A);
  assert.equal(args[5].length,32);
  assert.equal(args[8].length,32);
  assert.equal(args.some(x=>x==='34611111111'),false);
  assert.equal(f.releaseCount,1);
});

test('wrong family and member role never open database transaction',async()=>{
  const foreign=fixture();
  await assert.rejects(foreign.revoke({...validInput,familyId:B,
    actor:{authenticated:true,role:'owner',familyId:B}}),/administrator/);
  assert.equal(foreign.queries.length,0);
  const member=fixture({role:'member'});
  await assert.rejects(member.revoke(validInput),/administrator/);
  assert.equal(member.queries.length,0);
});

test('session swap after early authorization rolls back before signing DB operation',async()=>{
  let reads=0;
  const f=fixture({getAuthenticatedSession:async()=>{
    reads++;
    return reads>=3?{...adminSession,sessionId:'other-session'}:adminSession;
  }});
  await assert.rejects(f.revoke(validInput),/Session changed/);
  assert.deepEqual(f.queries.map(q=>q.sql),['BEGIN','ROLLBACK']);
});

test('database rejection cannot be interpreted as success',async()=>{
  const f=fixture({rows:[{result:{state:'rejected'}}]});
  await assert.rejects(f.revoke(validInput),/rejected/);
  assert.deepEqual(f.queries.map(q=>q.sql),[
    'BEGIN',REVOKE_WITH_PERMIT_SQL,'ROLLBACK'
  ]);
});

test('not_active result is returned with consumed nonce transaction committed',async()=>{
  const f=fixture({rows:[{result:{state:'not_active'}}]});
  assert.deepEqual(await f.revoke(validInput),{state:'not_active'});
  assert.equal(f.queries.at(-1).sql,'COMMIT');
});

test('rejects using same HMAC secret for sender IDs and permits',()=>{
  assert.throws(()=>createSignedConsentRevoker({
    db:{connect:async()=>({})},
    senderHmacKey,permitHmacKey:senderHmacKey,
    getAuthenticatedSession:async()=>adminSession,
    getMembership:async()=>null,now:()=>now
  }),/separate/);
});
