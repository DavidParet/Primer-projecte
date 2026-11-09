'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createPilotPairingIssuerFactory}=
  require('../lib/whatsapp/pilot-pairing-issuer');
const {PILOT_COOKIE,encodePilotSession}=
  require('../lib/whatsapp/pilot-auth-bff');
const {RESOLVE_CANONICAL_USER_SQL}=
  require('../lib/whatsapp/canonical-verified-session');
const {MEMBERSHIP_SQL}=
  require('../lib/whatsapp/membership-store');
const {SIGNED_PAIR_ISSUE_SQL}=
  require('../lib/whatsapp/signed-pairing-operations');
const {CODE_PATTERN}=require('../lib/whatsapp/family-pairing-protocol');

const NOW=1800000000000;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const ORIGIN='https://nexlupa-pilot-ci.vercel.app';
const AUTH='https://ep-ci.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
const business='755551111',phone='855551111';
const pairKey=randomBytes(32).toString('base64');
const signKey=randomBytes(32).toString('base64');
const tokenA='CI-REQUEST-BOUND-SESSION-TOKEN-A-000000000';
const tokenB='CI-REQUEST-BOUND-SESSION-TOKEN-B-111111111';
const env={
 VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
 NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN,NEXLUPA_AUTH_BASE_URL:AUTH,
 NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'external-a,external-b',
 WHATSAPP_WABA_ID:business,WHATSAPP_PHONE_NUMBER_ID:phone
};
function request(token=tokenA,overrides={}){
 return {
  method:overrides.method||'POST',
  headers:{
   host:'nexlupa-pilot-ci.vercel.app',
   'x-forwarded-proto':'https',
   origin:ORIGIN,'sec-fetch-site':'same-origin',
   cookie:PILOT_COOKIE+'='+encodePilotSession(
    'better-auth.session_token='+token),
   ...overrides.headers
  },
  body:{userId:'canonical-b',role:'owner',familyId:B}
 };
}
function fakeSession(user,revoked=false){
 if(revoked)return null;
 return {
  user:{id:user},
  session:{
   id:'verified-session-'+user,userId:user,
   createdAt:new Date(NOW-60000).toISOString(),
   expiresAt:new Date(NOW+60000).toISOString()
  }
 };
}
function fixture(){
 const idCalls=[],pairCalls=[],signedRequests=[];
 let revokeA=false,failDb=false;
 const ids=new Map([['external-a','canonical-a'],['external-b','canonical-b']]);
 const roles=new Map([['canonical-a|'+A,'owner'],
  ['canonical-b|'+B,'admin'],['canonical-b|'+A,'member']]);
 const identityDb={async query(sql,args){
  idCalls.push({sql,args});
  if(sql===RESOLVE_CANONICAL_USER_SQL){
   const user=ids.get(args[1]);
   return {rows:user?[{user_id:user}]:[]};
  }
  if(sql===MEMBERSHIP_SQL){
   const role=roles.get(args.join('|'));
   return {rows:role?[{user_id:args[0],family_id:args[1],
    role,active:true,revoked:false}]:[]};
  }
  throw Error('Direct protected identity SQL forbidden');
 }};
 const pairingDb={async connect(){return {
  async query(sql,args){
   pairCalls.push({sql,args});
   if(failDb && sql===SIGNED_PAIR_ISSUE_SQL)
    throw Error('Synthetic pairing DB offline');
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql!==SIGNED_PAIR_ISSUE_SQL)
    throw Error('Direct consent INSERT forbidden');
   return {rows:[{result:{
    state:'created',expiresAt:'2027-01-01T00:00:00+00:00'
   }}]};
  },release(){}
 };}};
 const fetchImpl=async(url,options)=>{
  signedRequests.push({url,options});
  const subject=options.headers.Cookie==='better-auth.session_token='+tokenA?
   'external-a':options.headers.Cookie==='better-auth.session_token='+tokenB?
   'external-b':null;
  const data=subject?fakeSession(subject,subject==='external-a'&&revokeA):null;
  return {
   status:data?200:401,
   headers:{get:x=>x==='content-type'?'application/json':null},
   text:async()=>JSON.stringify(data)
  };
 };
 const getActiveSigningKey=async kind=>({
  purpose:kind,state:'active',keyId:'issue-key-v1',keyBase64:signKey
 });
 const factory=createPilotPairingIssuerFactory({
  env,identityDb,pairingDb,pairingHmacKey:pairKey,
  getActiveSigningKey,fetchImpl,now:()=>NOW
 });
 return {factory,idCalls,pairCalls,signedRequests,roles,ids,
  revokeA(){revokeA=true;},failDb(){failDb=true;}};
}

test('real preview cookie identity -> canonical family -> signed pairing SQL',async()=>{
 const f=fixture();
 const issuer=f.factory(request());
 const result=await issuer({
  familyId:A,businessAccountId:business,phoneNumberId:phone,
  userId:'canonical-b',role:'owner',authenticated:true
 });
 assert.match(result.code,CODE_PATTERN);
 assert.equal(result.consentVersion,'whatsapp-incoming-text-v1');
 assert.deepEqual(f.pairCalls.map(x=>x.sql),
  ['BEGIN',SIGNED_PAIR_ISSUE_SQL,'COMMIT']);
 const args=f.pairCalls[1].args;
 assert.deepEqual(args.slice(0,4),['canonical-a',A,business,phone]);
 assert.equal(args[4].length,32);
 assert.equal(args[5],'issue-key-v1');
 assert.equal(args[8].length,32);
 assert.equal(args.includes(result.code),false);
 assert.equal(args.includes(tokenA),false);
 assert.equal(f.signedRequests.every(x=>
  x.url===AUTH+'/get-session?disableCookieCache=true'),true);
 assert.equal(f.signedRequests.every(x=>
  x.options.headers.Cookie==='better-auth.session_token='+tokenA),true);
 assert.equal(f.idCalls.some(x=>x.args.includes('canonical-b')),false);
});

test('two independently authenticated users cannot cross family privilege boundary',async()=>{
 const f=fixture();
 const first=f.factory(request(tokenA));
 const second=f.factory(request(tokenB));
 await assert.rejects(first({
  familyId:B,businessAccountId:business,phoneNumberId:phone
 }),/administrator/);
 await assert.rejects(second({
  familyId:A,businessAccountId:business,phoneNumberId:phone
 }),/administrator/);
 const ok=await second({
  familyId:B,businessAccountId:business,phoneNumberId:phone
 });
 assert.match(ok.code,CODE_PATTERN);
 assert.equal(f.pairCalls.filter(x=>x.sql===SIGNED_PAIR_ISSUE_SQL).length,1);
 assert.equal(f.pairCalls.find(x=>x.sql===SIGNED_PAIR_ISSUE_SQL).args[0],
  'canonical-b');
});

test('configured official business IDs reject browser-selected Meta destinations',async()=>{
 const f=fixture(),issuer=f.factory(request());
 assert.throws(()=>issuer({
  familyId:A,businessAccountId:'999998888',phoneNumberId:phone
 }),/destination not authorized/);
 assert.throws(()=>issuer({
  familyId:A,businessAccountId:business,phoneNumberId:'999998888'
 }),/destination not authorized/);
 assert.equal(f.pairCalls.length,0);
 assert.equal(f.idCalls.length,0);
 const legitimate=await issuer({familyId:A});
 assert.match(legitimate.code,CODE_PATTERN);
 assert.deepEqual(f.pairCalls[1].args.slice(2,4),[business,phone]);
});

test('missing configured official WhatsApp IDs prevent pairing factory setup',()=>{
 const f=fixture();
 for(const bad of [
  {...env,WHATSAPP_WABA_ID:undefined},
  {...env,WHATSAPP_PHONE_NUMBER_ID:''},
  {...env,WHATSAPP_WABA_ID:'not-numeric'}
 ]){
  assert.throws(()=>createPilotPairingIssuerFactory({
   env:bad,identityDb:{query:async()=>({rows:[]})},
   pairingDb:{connect:async()=>({})},
   pairingHmacKey:pairKey,getActiveSigningKey:async()=>null
  }),/Trusted pilot WhatsApp business identity required/);
 }
});

test('forged browser role, missing session and wrong origin never issue',async()=>{
 const f=fixture();
 for(const invalid of [
  request(tokenA,{headers:{origin:'https://attacker.invalid'}}),
  request(tokenA,{headers:{host:'app.nexlupa.app'}}),
  request(tokenA,{headers:{'sec-fetch-site':'cross-site'}}),
  request(tokenA,{method:'GET'})
 ]){
  assert.throws(()=>f.factory(invalid),/Untrusted pilot request origin/);
 }
 assert.throws(()=>f.factory(request(tokenA,{
  headers:{cookie:'fake_identity=canonical-a'}})),/session/);
 assert.equal(f.pairCalls.length,0);
 assert.equal(f.signedRequests.length,0);
});

test('revoked provider session and unlinked canonical account fail before signing',async()=>{
 const f=fixture(),issuer=f.factory(request());
 f.revokeA();
 await assert.rejects(issuer({
  familyId:A,businessAccountId:business,phoneNumberId:phone
 }),/Verified active server session/);
 assert.equal(f.pairCalls.length,0);
 const g=fixture(),other=g.factory(request());
 g.ids.delete('external-a');
 await assert.rejects(other({
  familyId:A,businessAccountId:business,phoneNumberId:phone
 }),/Verified active server session/);
 assert.equal(g.pairCalls.length,0);
});

test('DB outage rolls back and never claims an opt-in',async()=>{
 const f=fixture();f.failDb();
 await assert.rejects(f.factory(request())({
  familyId:A,businessAccountId:business,phoneNumberId:phone
 }),/Synthetic pairing DB offline/);
 assert.deepEqual(f.pairCalls.map(x=>x.sql),
  ['BEGIN',SIGNED_PAIR_ISSUE_SQL,'ROLLBACK']);
});

test('preview is disabled without explicit deployment approval',()=>{
 const stub={query:async()=>({rows:[]})},pool={connect:async()=>({})};
 for(const invalid of [{}, {...env,VERCEL_ENV:'production'},
   {...env,NEXLUPA_AUTH_PILOT:'disabled'}]){
  assert.throws(()=>createPilotPairingIssuerFactory({
   env:invalid,identityDb:stub,pairingDb:pool,
   pairingHmacKey:pairKey,getActiveSigningKey:async()=>null
  }),/disabled/);
 }
});

test('a server cannot mix an injected signed binder with a second identity provider',()=>{
 const {createSignedFamilyPairingIssuer}=
  require('../lib/whatsapp/signed-family-pairing');
 assert.throws(()=>createSignedFamilyPairingIssuer({
  db:{connect:async()=>({})},pairingHmacKey:pairKey,
  getActiveSigningKey:async()=>null,
  getAuthenticatedSession:async()=>({}),
  bindVerifiedRequest:async()=>({})
 }),/one trusted authorization binding source/);
});
