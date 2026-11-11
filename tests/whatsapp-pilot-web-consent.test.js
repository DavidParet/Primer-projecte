'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {createSignedWebConsentIssuer,createPilotWebConsentFactory,
 SIGNED_WEB_RECEIPT_SQL,formatWebConsentPermit,PURPOSE}=
 require('../lib/whatsapp/pilot-web-consent');
const {CONSENT_VERSION}=require('../lib/whatsapp/family-pairing-protocol');
const {RESOLVE_CANONICAL_USER_SQL}=
 require('../lib/whatsapp/canonical-verified-session');
const {MEMBERSHIP_SQL}=require('../lib/whatsapp/membership-store');
const {PILOT_COOKIE,encodePilotSession}=
 require('../lib/whatsapp/pilot-auth-bff');

const NOW=1800000000000;
const FAMILY='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const BIZ='755551111',PHONE='855551111',CODE='ABCD-EFGH-JKLM-NPQR';
const USER='canonical-a';
const proofKey=randomBytes(32),receiptKey=randomBytes(32),
 signKey=randomBytes(32);
function fixture({result='issued',allowed=true,afterRoleRevoked=false,
  sessionSwapped=false,signingKey=signKey}={}){
 const calls=[];let released=0,checked=0;
 const db={async connect(){return {
  async query(sql,args){calls.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql!==SIGNED_WEB_RECEIPT_SQL)throw Error('Direct DB writes forbidden');
   if(result==='throw')throw Error('CI DB unavailable');
   return {rowCount:1,rows:[{result:{state:result}}]};
  },release(){released++;}
 };}};
 const binding=async()=>({
  authorizeFamily:async({familyId,action})=>{
   assert.equal(familyId,FAMILY);
   assert.equal(action,'enroll_whatsapp_sender');
   checked++;return allowed&&!(afterRoleRevoked&&checked>1);
  },
  getVerifiedPrincipal:async()=>({
   userId:USER,sessionId:sessionSwapped&&checked>1?'swapped':'valid-session'
  })
 });
 const issue=createSignedWebConsentIssuer({
  db,bindVerifiedRequest:binding,
  proofHmacKey:proofKey.toString('base64'),
  receiptHmacKey:receiptKey.toString('base64'),
  getActiveSigningKey:async purpose=>({
   purpose,state:'active',keyId:'web-receipt-key-1',
   keyBase64:signingKey.toString('base64')
  }),
  businessAccountId:BIZ,phoneNumberId:PHONE,now:()=>NOW
 });
 return {issue,calls,get released(){return released;}};
}
const input={familyId:FAMILY,challengeId:CODE,
 accepted:true,versionAccepted:CONSENT_VERSION};
test('explicit consent is recorded through signed SQL with nonleaking receipt token',async()=>{
 const f=fixture();
 const out=await f.issue(input);
 assert.equal(out.state,'issued');
 assert.equal(out.consentVersion,CONSENT_VERSION);
 assert.match(out.receiptId,/^[A-Za-z0-9_-]{32}$/);
 assert.deepEqual(f.calls.map(x=>x.sql===SIGNED_WEB_RECEIPT_SQL?'RPC':x.sql),
  ['BEGIN','RPC','COMMIT']);
 const args=f.calls[1].args;
 assert.deepEqual(args.slice(0,4),[USER,FAMILY,BIZ,PHONE]);
 assert.deepEqual(args[4],createHmac('sha256',proofKey)
  .update('nexlupa:phone-proof:v1:').update(CODE).digest());
 assert.deepEqual(args[5],createHmac('sha256',receiptKey)
  .update('nexlupa:consent-receipt:v1:').update(out.receiptId).digest());
 assert.equal(args[6],CONSENT_VERSION);
 assert.equal(args[7],'web-receipt-key-1');
 assert.equal(args[8],Math.floor(NOW/1000)+45);
 assert.deepEqual(args[10],createHmac('sha256',signKey)
  .update(formatWebConsentPermit({keyId:args[7],userId:USER,
    familyId:FAMILY,businessAccountId:BIZ,phoneNumberId:PHONE,
    proofDigest:args[4],receiptDigest:args[5],
    consentVersion:CONSENT_VERSION,expiresAt:args[8],
    nonce:args[9]})).digest());
 assert.ok(!args.includes(CODE)&&!args.includes(out.receiptId));
 assert.equal(f.released,1);
});
test('without deliberate acceptance and exact policy, no receipt is minted',async()=>{
 const f=fixture();
 for(const changed of [{accepted:false},{accepted:'true'},
   {accepted:undefined},{versionAccepted:'outdated-policy'},
   {versionAccepted:null}]){
  await assert.rejects(f.issue({...input,...changed}),/Explicit current-version/);
 }
 assert.equal(f.calls.length,0);
});
test('changing family, official Meta recipient, role or session fails closed',async()=>{
 const f=fixture();
 for(const changed of [{familyId:OTHER},{businessAccountId:'999999999'},
  {phoneNumberId:'999999999'},{challengeId:'short'}]){
  await assert.rejects(f.issue({...input,...changed}),
    /Invalid web consent family or phone proof|administrator/);
 }
 assert.equal(f.calls.length,0);
 for(const options of [{allowed:false},{afterRoleRevoked:true},
   {sessionSwapped:true},{signingKey:proofKey}]){
  const issuer=fixture(options);
  await assert.rejects(issuer.issue(input),
    /administrator|permission expired|session changed|not isolated/i);
  assert.equal(issuer.calls.length,0);
 }
});
test('DB rejection rolls back without returning bearer receipt',async()=>{
 const rejected=fixture({result:'rejected'});
 assert.deepEqual(await rejected.issue(input),{state:'rejected'});
 assert.deepEqual(rejected.calls.map(c=>c.sql===SIGNED_WEB_RECEIPT_SQL?'RPC':c.sql),
  ['BEGIN','RPC','ROLLBACK']);
 const down=fixture({result:'throw'});
 await assert.rejects(down.issue(input),/CI DB unavailable/);
 assert.deepEqual(down.calls.map(c=>c.sql===SIGNED_WEB_RECEIPT_SQL?'RPC':c.sql),
  ['BEGIN','RPC','ROLLBACK']);
 assert.equal(down.released,1);
});
test('preview factory uses server-verified canonical identity, not browser role',async()=>{
 const ORIGIN='https://ci-nexlupa-web-receipt.vercel.app';
 const AUTH='https://ep-ci.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
 const TOKEN='CI-SYNTHETIC-WEB-SESSION-TOKEN-1234567890';
 const requests=[];
 const env={VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
  NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN,NEXLUPA_AUTH_BASE_URL:AUTH,
  NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'external-a',
  WHATSAPP_WABA_ID:BIZ,WHATSAPP_PHONE_NUMBER_ID:PHONE};
 const identityDb={async query(sql,args){
  if(sql===RESOLVE_CANONICAL_USER_SQL)
   return {rows:[{user_id:USER}]};
  if(sql===MEMBERSHIP_SQL&&args[0]===USER&&args[1]===FAMILY)
   return {rows:[{user_id:USER,family_id:FAMILY,
    role:'admin',active:true,revoked:false}]};
  return {rows:[]};
 }};
 const receiptDb={async connect(){return {
  async query(sql,args){
   requests.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql!==SIGNED_WEB_RECEIPT_SQL)throw Error('Direct receipt SQL forbidden');
   return {rowCount:1,rows:[{result:{state:'issued'}}]};
  },release(){}
 };}};
 const fetchImpl=async(url,opts)=>{
  assert.equal(url,AUTH+'/get-session?disableCookieCache=true');
  assert.equal(opts.headers.Cookie,'better-auth.session_token='+TOKEN);
  return {status:200,headers:{get:x=>x==='content-type'?'application/json':null},
   text:async()=>JSON.stringify({
    user:{id:'external-a'},session:{id:'ci-web-session',userId:'external-a',
     createdAt:new Date(NOW-10000).toISOString(),
     expiresAt:new Date(NOW+60000).toISOString()}
   })
  };
 };
 const factory=createPilotWebConsentFactory({
  env,identityDb,receiptDb,
  proofHmacKey:proofKey.toString('base64'),
  receiptHmacKey:receiptKey.toString('base64'),
  fetchImpl,now:()=>NOW,
  getActiveSigningKey:async purpose=>({
   purpose,state:'active',keyId:'web-receipt-key-1',
   keyBase64:signKey.toString('base64')
  })
 });
 const request={method:'POST',headers:{
   host:'ci-nexlupa-web-receipt.vercel.app',
   origin:ORIGIN,'x-forwarded-proto':'https','sec-fetch-site':'same-origin',
   cookie:PILOT_COOKIE+'='+encodePilotSession(
    'better-auth.session_token='+TOKEN)
 },body:{role:'owner',userId:'forged-admin'}};
 const issuer=factory(request);
 const output=await issuer({...input,userId:'forged-admin',role:'owner'});
 assert.equal(output.state,'issued');
 assert.equal(requests[1].args[0],USER);
 assert.throws(()=>factory({...request,method:'GET'}),/origin/);
 assert.throws(()=>factory({...request,headers:{...request.headers,
    origin:'https://attacker.example'}}),/origin/);
 assert.throws(()=>createPilotWebConsentFactory({
   env:{...env,VERCEL_ENV:'production'},identityDb,receiptDb
 }),/pilot|preview/i);
});
