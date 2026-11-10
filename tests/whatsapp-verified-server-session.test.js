'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerifiedServerSessionResolver } =
  require('../lib/whatsapp/verified-server-session');
const { createRequestBoundConsentRevoker } =
  require('../lib/whatsapp/request-bound-consent-revoker');
const { randomBytes } = require('node:crypto');
const { LOCK_MEMBERSHIP_SQL } =
  require('../lib/whatsapp/transactional-family-authorization');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const current=1800000000000;
const valid={
  verified:true,issuer:'https://identity.example.test',audience:'nexlupa-backend',
  subject:'idp-user-a',sessionId:'verified-session-a',
  issuedAtMs:current-30000,expiresAtMs:current+30000,revoked:false
};
const opaqueRequest=Object.freeze({requestId:'server-request-42'});
function env(overrides={}) {
  let identity={...valid,...overrides};
  const visited=[];
  const getAuthenticatedSession=createVerifiedServerSessionResolver({
    verifyRequestSession:async request=>{
      visited.push(request);
      return identity;
    },
    requestContext:opaqueRequest,issuer:valid.issuer,audience:valid.audience,
    now:()=>current
  });
  return {getAuthenticatedSession,visited,setIdentity:x=>{identity=x;}};
}
test('produces pinned-compatible session after independently verified request identity',async()=>{
  const e=env();
  const result=await e.getAuthenticatedSession();
  assert.deepEqual(result,{
    authenticated:true,userId:'idp-user-a',
    sessionId:'verified-session-a',expiresAtMs:current+30000,revoked:false
  });
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(e.visited,[opaqueRequest]);
});
test('rejects unverified, expired, revoked, wrong issuer or audience identity',async()=>{
  const bad=[
    {verified:false}, {verified:'true'}, {issuer:'attacker'},
    {audience:'other-product'}, {revoked:true}, {disabled:true},
    {subject:''}, {sessionId:''}, {issuedAtMs:current+1000},
    {expiresAtMs:current}, {issuedAtMs:current+30000}, {expiresAtMs:0}
  ];
  for(const override of bad) {
    const e=env(override);
    assert.equal(await e.getAuthenticatedSession(),null,
      'Should deny override '+Object.keys(override).join(','));
  }
});
test('newly revoked identity invalidates a subsequent session read',async()=>{
  const e=env();
  assert.equal((await e.getAuthenticatedSession()).userId,'idp-user-a');
  e.setIdentity({...valid,revoked:true});
  assert.equal(await e.getAuthenticatedSession(),null);
  assert.equal(e.visited.length,2);
});
test('a user-supplied body is never passed to the identity verifier',async()=>{
  const e=env();
  await e.getAuthenticatedSession({userId:'attacker',role:'owner',familyId:B});
  assert.deepEqual(e.visited,[opaqueRequest]);
});
test('rejects missing server verifier or policy configuration',()=>{
  assert.throws(()=>createVerifiedServerSessionResolver({}),/IdP verifier/);
  assert.throws(()=>createVerifiedServerSessionResolver({
    verifyRequestSession:async()=>valid,requestContext:opaqueRequest,
    issuer:valid.issuer
  }),/IdP verifier/);
});
test('verifier service errors are never converted to authorization success',async()=>{
  const session=createVerifiedServerSessionResolver({
    verifyRequestSession:async()=>{throw Error('IdP unavailable');},
    requestContext:opaqueRequest,issuer:valid.issuer,
    audience:valid.audience,now:()=>current
  });
  await assert.rejects(session(),/IdP unavailable/);
});
test('end-to-end trusted request revocation refuses forged family and user',async()=>{
  const e=env();
  const calls=[],senderHmacKey=randomBytes(32).toString('base64');
  const db={async connect(){return {
    async query(sql,args){
      calls.push({sql,args});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {};
      if(sql===LOCK_MEMBERSHIP_SQL) {
        return {rows:[{allowed:args[0]==='idp-user-a'&&args[1]===A}]};
      }
      if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))return {rowCount:1};
      if(sql.includes('DELETE FROM nex_whatsapp_inbound'))return {rowCount:1};
      throw Error('Unexpected SQL');
    },release(){}
  };}};
  const revoke=createRequestBoundConsentRevoker({
    db,senderHmacKey,getAuthenticatedSession:e.getAuthenticatedSession,
    getMembership:async({userId,familyId})=>
      userId==='idp-user-a'&&familyId===A?
      {userId,familyId,active:true,revoked:false,role:'admin'}:null,
    now:()=>current
  });
  const request={familyId:A,authorizationId:1,businessAccountId:'444444444',
    phoneNumberId:'333333333',senderWaId:'34600000000',
    userId:'forged-user',actor:{role:'owner',authenticated:true}};
  assert.deepEqual(await revoke(request),{state:'revoked',deletedMessages:1});
  assert.equal(calls.find(q=>q.sql===LOCK_MEMBERSHIP_SQL).args[0],'idp-user-a');
  assert.equal(e.visited.length,3);
  calls.length=0;
  await assert.rejects(revoke({...request,familyId:B,
    actor:{userId:'idp-user-b',role:'owner',authenticated:true}}),
    /verified family administrator/);
  assert.equal(calls.length,0);
});
