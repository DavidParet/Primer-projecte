'use strict';
// Preview-only, all IdP/Neon data mocked. No live network or Meta.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createPilotAtomicConsentFactory}=
  require('../lib/whatsapp/pilot-atomic-consent');
const {ACTIVATE_SQL}=require('../lib/whatsapp/signed-atomic-consent-client');
const {RESOLVE_CANONICAL_USER_SQL}=
  require('../lib/whatsapp/canonical-verified-session');
const {MEMBERSHIP_SQL}=require('../lib/whatsapp/membership-store');
const {CONSENT_VERSION}=require('../lib/whatsapp/family-pairing-protocol');
const {PILOT_COOKIE,encodePilotSession}=
  require('../lib/whatsapp/pilot-auth-bff');

const NOW=1800000000000;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const ORIGIN='https://nexlupa-atomic-ci.vercel.app';
const AUTH='https://ep-ci.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
const business='755551111',phone='855551111';
const challengeId='ci_challenge_proof_00001';
const receiptId='ci_receipt_explicit_00001';
const tokenA='CI-ATOMIC-SESSION-ALLOWED-A-0000000000';
const tokenB='CI-ATOMIC-SESSION-ALLOWED-B-1111111111';
const proofKey=randomBytes(32).toString('base64');
const receiptKey=randomBytes(32).toString('base64');
const signKey=randomBytes(32).toString('base64');
const env={
 VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
 NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN,NEXLUPA_AUTH_BASE_URL:AUTH,
 NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'external-a,external-b',
 WHATSAPP_WABA_ID:business,WHATSAPP_PHONE_NUMBER_ID:phone
};
const input={familyId:A,challengeId,consentReceiptId:receiptId};
function request(token=tokenA,overrides={}){
 return {method:overrides.method||'POST',
  headers:{
   host:'nexlupa-atomic-ci.vercel.app',
   'x-forwarded-proto':'https',origin:ORIGIN,
   'sec-fetch-site':'same-origin',
   cookie:PILOT_COOKIE+'='+encodePilotSession(
    'better-auth.session_token='+token),
   ...overrides.headers
  },body:{userId:'canonical-b',role:'owner',familyId:B}};
}
function session(subject){
 return {user:{id:subject},
  session:{id:'verified-session-'+subject,userId:subject,
   createdAt:new Date(NOW-60000).toISOString(),
   expiresAt:new Date(NOW+60000).toISOString()}
 };
}
function fixture(){
 const dbCalls=[],idCalls=[],idpCalls=[];
 let revokeA=false,failDb=false,swapAfterSign=false;
 const role=new Map([['canonical-a|'+A,'owner'],
   ['canonical-b|'+B,'admin'],['canonical-b|'+A,'member']]);
 const identityDb={async query(sql,args){
  idCalls.push({sql,args});
  if(sql===RESOLVE_CANONICAL_USER_SQL){
   const user=args[1]==='external-a'?'canonical-a':
    args[1]==='external-b'?'canonical-b':null;
   return {rows:user?[{user_id:user}]:[]};
  }
  if(sql===MEMBERSHIP_SQL){
   const entry=role.get(args.join('|'));
   return {rows:entry?[{user_id:args[0],family_id:args[1],
    role:entry,active:true,revoked:false}]:[]};
  }
  throw Error('Direct protected identity SQL denied');
 }};
 const activationDb={async connect(){return {
  async query(sql,args){
   dbCalls.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql!==ACTIVATE_SQL)throw Error('Direct consent SQL denied');
   if(failDb)throw Error('Synthetic restricted PostgreSQL unavailable');
   return {rowCount:1,rows:[{result:{state:'enrolled'}}]};
  },release(){}
 };}};
 const fetchImpl=async(url,options)=>{
  idpCalls.push({url,options});
  const cookie=options?.headers?.Cookie;
  const subject=cookie==='better-auth.session_token='+tokenA?'external-a':
    cookie==='better-auth.session_token='+tokenB?'external-b':null;
  const valid=subject && !(subject==='external-a'&&revokeA);
  return {status:valid?200:401,
   headers:{get:x=>x==='content-type'?'application/json':null},
   text:async()=>JSON.stringify(valid?session(subject):null)};
 };
 const getActiveSigningKey=async kind=>{
  if(swapAfterSign)revokeA=true;
  return {purpose:kind,state:'active',keyId:'ci-atomic-key-1',
   keyBase64:signKey};
 };
 const factory=createPilotAtomicConsentFactory({
  env,identityDb,activationDb,proofHmacKey:proofKey,
  receiptHmacKey:receiptKey,getActiveSigningKey,fetchImpl,now:()=>NOW
 });
 return {factory,dbCalls,idCalls,idpCalls,role,
  setDbFailure(){failDb=true;},
  revokeA(){revokeA=true;},
  swapAfterSign(){swapAfterSign=true;}};
}

test('preview cookie -> verified IdP -> canonical admin -> signed restricted SQL',async()=>{
 const f=fixture();
 const activate=f.factory(request());
 assert.deepEqual(await activate({...input,
  userId:'canonical-b',role:'owner',authenticated:true,
  consentVersion:'browser-forged-policy',source:'user-claimed'}),
  {state:'enrolled'});
 assert.deepEqual(f.dbCalls.map(x=>x.sql===ACTIVATE_SQL?'ACTIVATE':x.sql),
  ['BEGIN','ACTIVATE','COMMIT']);
 const args=f.dbCalls[1].args;
 assert.deepEqual(args.slice(0,4),['canonical-a',A,business,phone]);
 assert.equal(args[4].length,32);assert.equal(args[5].length,32);
 assert.equal(args[6],CONSENT_VERSION);
 assert.equal(args[7],'ci-atomic-key-1');
 assert.equal(args[10].length,32);
 assert.equal(args.some(x=>x==='canonical-b'),false);
 assert.equal(args.some(x=>x==='browser-forged-policy'),false);
 assert.equal(args.includes(challengeId)||args.includes(receiptId),false);
 assert.equal(f.idpCalls.length>2,true);
 assert.equal(f.idpCalls.every(x=>
  x.url===AUTH+'/get-session?disableCookieCache=true'),true);
 assert.equal(f.idpCalls.every(x=>
  x.options.headers.Cookie==='better-auth.session_token='+tokenA),true);
 assert.equal(f.idCalls.some(x=>x.args.includes('canonical-b')),false);
});

test('cannot activate another family even with forged body roles',async()=>{
 const f=fixture();
 await assert.rejects(f.factory(request(tokenA))({...input,familyId:B,
  role:'owner'}),/administrator/);
 await assert.rejects(f.factory(request(tokenB))({...input,
  role:'owner'}),/administrator/);
 assert.equal(f.dbCalls.length,0);
 const allowed=f.factory(request(tokenB));
 assert.deepEqual(await allowed({...input,familyId:B}),{state:'enrolled'});
 assert.equal(f.dbCalls[1].args[0],'canonical-b');
});

test('only configured Meta destination, same-origin POST and cookie allowed',async()=>{
 const f=fixture(),valid=f.factory(request());
 for(const overrides of [
  {businessAccountId:'999999999',phoneNumberId:phone},
  {phoneNumberId:'999999999',businessAccountId:business}
 ]){
  assert.throws(()=>valid({...input,...overrides}),/destination not authorized/);
 }
 for(const forged of [
  {method:'GET'}, {headers:{origin:'https://other.vercel.app'}},
  {headers:{host:'other.vercel.app'}},
  {headers:{'sec-fetch-site':'cross-site'}},
  {headers:{'x-forwarded-proto':'http'}},
  {headers:{cookie:'fake=not-a-session'}}
 ]){
  assert.throws(()=>f.factory(request(tokenA,forged)),/request origin|session/i);
 }
 assert.equal(f.dbCalls.length,0);assert.equal(f.idpCalls.length,0);
});

test('production, missing pilot allowlist or invalid configured Meta number denied',()=>{
 const cfg={identityDb:{query:async()=>({rows:[]})},
  activationDb:{connect:async()=>({})},
  proofHmacKey:proofKey,receiptHmacKey:receiptKey,
  getActiveSigningKey:async()=>null};
 for(const changed of [
  {...env,VERCEL_ENV:'production'},
  {...env,NEXLUPA_AUTH_PILOT:'disabled'},
  {...env,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:''},
  {...env,WHATSAPP_WABA_ID:'invalid'},
  {...env,WHATSAPP_PHONE_NUMBER_ID:undefined}
 ]){
  assert.throws(()=>createPilotAtomicConsentFactory({...cfg,env:changed}),
   /preview|pilot|destination|access|WhatsApp/i);
 }
});

test('role removal after signed request creation blocks SQL',async()=>{
 const f=fixture();
 const activate=f.factory(request());
 f.role.delete('canonical-a|'+A);
 await assert.rejects(activate(input),/administrator/);
 assert.equal(f.dbCalls.length,0);
});

test('remote Neon Auth session revoked while signing fails closed',async()=>{
 const f=fixture();
 f.swapAfterSign();
 await assert.rejects(f.factory(request())(input),
  /administrator|session|permission/i);
 assert.equal(f.dbCalls.length,0);
 assert.equal(f.idpCalls.length>=2,true);
});

test('restricted SQL failure rolls back without claiming enrollment',async()=>{
 const f=fixture();f.setDbFailure();
 await assert.rejects(f.factory(request())(input),
  /Synthetic restricted PostgreSQL unavailable/);
 assert.deepEqual(f.dbCalls.map(c=>c.sql===ACTIVATE_SQL?'RPC':c.sql),
  ['BEGIN','RPC','ROLLBACK']);
});
