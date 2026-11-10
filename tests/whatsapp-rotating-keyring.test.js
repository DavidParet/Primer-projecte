'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createRotatingPermitSigner,rotatingPermitPayload,
  REVOKE_WITH_ROTATING_PERMIT_SQL}=
  require('../lib/whatsapp/rotating-revocation-permit');
const {createRotatingSignedConsentRevoker}=
  require('../lib/whatsapp/rotating-signed-consent-revoker');
const NOW=1800000000000;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const senderHmacKey=randomBytes(32).toString('base64');
const oldKey=randomBytes(32).toString('base64');
const newKey=randomBytes(32).toString('base64');
const membership={userId:'admin-a',familyId:A,role:'admin',
  active:true,revoked:false};
const request={familyId:A,authorizationId:45,businessAccountId:'555551111',
 phoneNumberId:'666661111',senderWaId:'34611111111'};
const session={authenticated:true,userId:'admin-a',
 sessionId:'verified-session-a',expiresAtMs:NOW+60000,revoked:false};

function registry(){
 let active={keyId:'key-old',keyBase64:oldKey,state:'active'};
 let queried=0;
 return {
  async getActiveSigningKey(){queried++;return active;},
  activateNew(){active={keyId:'key-new',keyBase64:newKey,state:'active'};},
  retireAll(){active=null;},
  get queried(){return queried;}
 };
}
function fixture({reg=registry(),outcome={state:'revoked',deletedMessages:2},
 getSession=async()=>session,membershipRow=membership}={}){
 const queries=[];let released=0;
 const db={async connect(){return {
  async query(sql,args){
   queries.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql===REVOKE_WITH_ROTATING_PERMIT_SQL)return {rows:[{result:outcome}]};
   throw Error('Unwanted direct SQL');
  },release(){released++;}
 };}};
 const revoke=createRotatingSignedConsentRevoker({
   db,senderHmacKey,getActiveSigningKey:()=>reg.getActiveSigningKey(),
   getAuthenticatedSession:getSession,
   getMembership:async({userId,familyId})=>
     membershipRow && userId===membershipRow.userId &&
     familyId===membershipRow.familyId?membershipRow:null,
   now:()=>NOW
 });
 return {revoke,queries,reg,get released(){return released;}};
}

test('v2 signing includes authenticated family, key ID, expiry and nonce in HMAC',async()=>{
 const reg=registry();
 const sign=createRotatingPermitSigner({
  getActiveSigningKey:()=>reg.getActiveSigningKey(),now:()=>NOW
 });
 const input={userId:'admin-a',familyId:A,authorizationId:45,
 businessAccountId:'555551111',phoneNumberId:'666661111',
 senderDigest:randomBytes(32)};
 const old=await sign(input);
 assert.equal(old.keyId,'key-old');
 assert.equal(old.expiresAtEpoch,Math.floor(NOW/1000)+90);
 const payload=rotatingPermitPayload({...old,
  senderDigestHex:input.senderDigest.toString('hex')});
 const expected=createHmac('sha256',Buffer.from(oldKey,'base64'))
  .update(payload,'utf8').digest();
 assert.deepEqual(old.signature,expected);
 assert.equal(Object.hasOwn(old,'keyBase64'),false);
 reg.activateNew();
 const next=await sign(input);
 assert.equal(next.keyId,'key-new');
 assert.notDeepEqual(next.signature,old.signature);
 assert.equal(reg.queried,2,'signer must reload active key for every permit');
 assert.match(payload,/^NEXLUPA-WA-REVOKE-2\|key-old\|admin-a\|/);
});

test('key ID is signed; changing key ID changes expected signature',async()=>{
 const reg=registry();
 const signer=createRotatingPermitSigner({
  getActiveSigningKey:()=>reg.getActiveSigningKey(),now:()=>NOW
 });
 const signed=await signer({userId:'admin-a',familyId:A,
  authorizationId:45,businessAccountId:'555551111',
  phoneNumberId:'666661111',senderDigest:randomBytes(32)});
 const hex=signed.senderDigest.toString('hex');
 const original=rotatingPermitPayload({...signed,senderDigestHex:hex});
 const tampered=rotatingPermitPayload({...signed,keyId:'key-new',senderDigestHex:hex});
 assert.notEqual(original,tampered);
 assert.notDeepEqual(createHmac('sha256',Buffer.from(oldKey,'base64'))
  .update(tampered).digest(),signed.signature);
});

test('new key is chosen after planned rotation and DB sees only one operation',async()=>{
 const f=fixture();
 const one=await f.revoke({...request,
   actor:{userId:'admin-b',role:'owner',authenticated:true}});
 assert.deepEqual(one,{state:'revoked',deletedMessages:2});
 assert.deepEqual(f.queries.map(x=>x.sql),
   ['BEGIN',REVOKE_WITH_ROTATING_PERMIT_SQL,'COMMIT']);
 assert.equal(f.queries[1].args[0],'key-old');
 assert.equal(f.queries[1].args[1],'admin-a');
 assert.equal(f.queries[1].args[6].length,32);
 assert.equal(f.queries[1].args[9].length,32);
 assert.equal(f.queries.flatMap(x=>x.args||[]).includes(request.senderWaId),false);
 assert.equal(f.released,1);

 f.reg.activateNew();
 f.queries.length=0;
 await f.revoke(request);
 assert.equal(f.queries[1].args[0],'key-new');
 assert.equal(f.reg.queried,2);
});

test('no active key fails closed and rolls back without direct DML',async()=>{
 const f=fixture();
 f.reg.retireAll();
 await assert.rejects(f.revoke(request),/No approved active signing key/);
 assert.deepEqual(f.queries.map(x=>x.sql),['BEGIN','ROLLBACK']);
});

test('retired or revoked key cannot be selected to issue new permits',async()=>{
 for(const state of ['revoked','verify_only']){
  const sign=createRotatingPermitSigner({
   getActiveSigningKey:async()=>({keyId:'key-old',state,keyBase64:oldKey}),
   now:()=>NOW
  });
  await assert.rejects(sign({userId:'admin-a',familyId:A,
    authorizationId:45,businessAccountId:'555551111',
    phoneNumberId:'666661111',senderDigest:randomBytes(32)}),
   /No approved active signing key/);
 }
});

test('wrong family and ordinary member fail before signer or DB',async()=>{
 for(const options of [
  {familyId:B,membershipRow:membership},
  {familyId:A,membershipRow:{...membership,role:'member'}}
 ]){
  const f=fixture({membershipRow:options.membershipRow});
  await assert.rejects(f.revoke({...request,familyId:options.familyId}),
   /Verified family administrator/);
  assert.equal(f.queries.length,0);
  assert.equal(f.reg.queried,0);
 }
});

test('stolen/changed session prevents fresh key issuance',async()=>{
 let reads=0;
 const f=fixture({getSession:async()=>{
  reads++;return reads>2?{...session,sessionId:'swapped'}:session;
 }});
 await assert.rejects(f.revoke(request),/Session changed/);
 assert.equal(f.reg.queried,0);
 assert.deepEqual(f.queries.map(x=>x.sql),['BEGIN','ROLLBACK']);
});

test('separate signing and sender keys are mandatory',async()=>{
 const reg={getActiveSigningKey:async()=>({
  keyId:'key-misconfigured',state:'active',keyBase64:senderHmacKey
 })};
 const f=fixture({reg});
 await assert.rejects(f.revoke(request),/must differ/);
 assert.deepEqual(f.queries.map(x=>x.sql),['BEGIN','ROLLBACK']);
});

test('database key revocation and invalid signatures always fail closed',async()=>{
 const f=fixture({outcome:{state:'rejected'}});
 await assert.rejects(f.revoke(request),/Rotating signed operation rejected/);
 assert.deepEqual(f.queries.map(x=>x.sql),
  ['BEGIN',REVOKE_WITH_ROTATING_PERMIT_SQL,'ROLLBACK']);
});

test('unknown selected key or invalid field does not produce signature',async()=>{
 const signer=createRotatingPermitSigner({
  getActiveSigningKey:async()=>({keyId:'invalid|id',state:'active',keyBase64:oldKey}),
  now:()=>NOW
 });
 await assert.rejects(signer({userId:'admin-a',familyId:A,
  authorizationId:45,businessAccountId:'555551111',
  phoneNumberId:'666661111',senderDigest:randomBytes(32)}),
 /No approved active signing key/);
 assert.throws(()=>rotatingPermitPayload({keyId:'key-old',userId:'bad|id',
  familyId:A,authorizationId:45,businessAccountId:'555551111',
  phoneNumberId:'666661111',senderDigestHex:'c'.repeat(64),
  expiresAtEpoch:1800000090,nonce:'11111111-1111-4111-8111-111111111111'}),
 /Invalid rotating permit fields/);
});
