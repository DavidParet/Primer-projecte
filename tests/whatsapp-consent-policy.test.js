'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {makeConsentPolicy}=require('../lib/whatsapp/consent-policy');
const FAMILY='00000000-0000-4000-8000-000000000001';
const OTHER='00000000-0000-4000-8000-000000000002';
const SENDER='34600000000';
const key=randomBytes(32);
const businessAccountId='9999900000', phoneNumberId='8888800000';
const challengeId='synthetic_one_time_code_123';
const consentVersion='pilot-v1';
const consentReceiptId='synthetic_receipt_token_123456';
function db(rowCount=1) {
  const calls=[];
  return {calls,async query(sql,values){calls.push({sql,values});return {rowCount};}};
}
function policy(database, overrides={}) {
  return makeConsentPolicy({
    db:database,senderHmacKey:key.toString('base64'),
    resolveAuthenticatedFamily:async()=>FAMILY,
    currentConsentVersion:consentVersion,
    verifyExplicitConsent:async()=>({
      verified:true,receiptId:consentReceiptId,challengeId,
      familyId:FAMILY,businessAccountId,phoneNumberId,senderWaId:SENDER,
      scope:'incoming_text',version:consentVersion,source:'account-web-consent',
      singleUseConsumed:true,acceptedAt:Date.now()-1000
    }),
    verifyEnrollment:async()=>({
      verified:true,familyId:FAMILY,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+60000
    }),
    ...overrides
  });
}
function enrollment(){
  return {session:{synthetic:true},businessAccountId,phoneNumberId,challengeId,consentReceiptId};
}
test('requires trusted external adapters and strong HMAC key',()=>{
  assert.throws(()=>makeConsentPolicy({db:db(),senderHmacKey:'x'}),/adapter/);
  assert.throws(()=>makeConsentPolicy({
    db:db(),senderHmacKey:'x',
    resolveAuthenticatedFamily:async()=>FAMILY,verifyEnrollment:async()=>({}),
    verifyExplicitConsent:async()=>({}),currentConsentVersion:consentVersion
  }),/32-byte/);
});
test('enrolls only a phone proved by trusted single-use verifier',async()=>{
  const database=db();
  assert.deepEqual(await policy(database).enroll(enrollment()),{state:'enrolled'});
  assert.equal(database.calls.length,1);
  const {sql,values}=database.calls[0];
  assert.match(sql,/ON CONFLICT DO NOTHING/);
  assert.equal(values[3],FAMILY);
  assert.equal(values[2].length,32);
  assert.deepEqual(values[2],createHmac('sha256',key).update(SENDER).digest());
  assert.equal(values.includes(SENDER),false);
  assert.equal(values[4],consentVersion);
  assert.ok(values[5] instanceof Date);
  assert.equal(values[6],'account-web-consent');
  assert.equal(values[7].length,32); // Receipt evidence is pseudonymized.
  assert.equal(values.includes(consentReceiptId),false);
  assert.equal(values[8],null); // Challenge expiration is not consent expiry.
});
test('fails closed on unauthenticated user',async()=>{
  const database=db();
  await assert.rejects(policy(database,{
    resolveAuthenticatedFamily:async()=>null
  }).enroll(enrollment()),/Unauthenticated/);
  assert.equal(database.calls.length,0);
});
test('fails closed on foreign family proof',async()=>{
  const database=db();
  await assert.rejects(policy(database,{
    verifyEnrollment:async()=>({verified:true,familyId:OTHER,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+60000})
  }).enroll(enrollment()),/not verified/);
  assert.equal(database.calls.length,0);
});
test('rejects unconsumed/expired/too long proof',async()=>{
  const database=db();
  for (const patch of [
    {singleUseConsumed:false},
    {expiresAt:Date.now()-1000},
    {expiresAt:Date.now()+3600000}
  ]) {
    const proof={verified:true,familyId:FAMILY,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+60000,...patch};
    await assert.rejects(policy(database,{
      verifyEnrollment:async()=>proof
    }).enroll(enrollment()),/not verified/);
  }
  assert.equal(database.calls.length,0);
});
test('duplicate active authorization is not silently duplicated',async()=>{
  assert.deepEqual(await policy(db(0)).enroll(enrollment()),{state:'already_active_or_receipt_used'});
});
test('revocation requires authenticated family and is scope-limited',async()=>{
  const database=db();
  assert.deepEqual(await policy(database).revoke({
    session:{synthetic:true},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),{state:'revoked'});
  const {sql,values}=database.calls[0];
  assert.match(sql,/family_id=\$4/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.equal(values[3],FAMILY);
  assert.equal(values.includes(SENDER),false);
});
test('no revocation result is not reported as success',async()=>{
  assert.deepEqual(await policy(db(0)).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),{state:'not_found'});
});
test('revocation rejects invalid caller and sender before SQL',async()=>{
  const database=db();
  await assert.rejects(policy(database,{
    resolveAuthenticatedFamily:async()=>null
  }).revoke({session:{},businessAccountId,phoneNumberId,senderWaId:SENDER}),/Unauthenticated/);
  await assert.rejects(policy(database).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:'not-a-number'
  }),/Invalid/);
  assert.equal(database.calls.length,0);
});

test('never enrolls on phone proof alone without a separate consent verifier',async()=>{
  const database=db();
  assert.throws(()=>makeConsentPolicy({
    db:database,senderHmacKey:key.toString('base64'),
    currentConsentVersion:consentVersion,
    resolveAuthenticatedFamily:async()=>FAMILY,verifyEnrollment:async()=>({})
  }),/Missing trusted server adapter/);
  await assert.rejects(policy(database,{
    verifyExplicitConsent:async()=>null
  }).enroll(enrollment()),/Explicit consent not verified/);
  assert.equal(database.calls.length,0);
});
test('rejects forged, mismatched, expired, stale and non-consumed consent',async()=>{
  const database=db();
  const valid={
    verified:true,receiptId:consentReceiptId,challengeId,
    familyId:FAMILY,businessAccountId,phoneNumberId,senderWaId:SENDER,
    scope:'incoming_text',version:consentVersion,source:'account-web-consent',
    singleUseConsumed:true,acceptedAt:Date.now()-1000
  };
  for (const patch of [
    {verified:false},{receiptId:'other_receipt_123456789'},{challengeId:'different_challenge_123'},
    {familyId:OTHER},{businessAccountId:'1234567890'},{phoneNumberId:'1234567890'},
    {senderWaId:'34699999999'},{scope:'all_messages'},{version:'old-version'},
    {source:'phone-challenge'},{singleUseConsumed:false},
    {acceptedAt:Date.now()-20*60*1000},{acceptedAt:Date.now()+60*1000}
  ]) {
    await assert.rejects(policy(database,{
      verifyExplicitConsent:async()=>({...valid,...patch})
    }).enroll(enrollment()),/Explicit consent not verified/);
  }
  assert.equal(database.calls.length,0);
});
test('server policy version is mandatory and independent of client input',async()=>{
  const database=db();
  assert.throws(()=>policy(database,{currentConsentVersion:null}),/consent version/);
  const input={...enrollment(),consentVersion:'forged-client-v3'};
  assert.deepEqual(await policy(database).enroll(input),{state:'enrolled'});
  assert.equal(database.calls[0].values[4],consentVersion);
});
test('trusted receipt verifier receives constrained context and scope',async()=>{
  const database=db();
  let received;
  await policy(database,{
    verifyExplicitConsent:async ctx=>{
      received=ctx;
      return {
        verified:true,receiptId:consentReceiptId,challengeId,familyId:FAMILY,
        businessAccountId,phoneNumberId,senderWaId:SENDER,scope:'incoming_text',
        version:consentVersion,source:'account-web-consent',
        singleUseConsumed:true,acceptedAt:Date.now()-1000
      };
    }
  }).enroll(enrollment());
  assert.deepEqual(Object.fromEntries(Object.entries(received).filter(([k])=>k!=='session')),
    {receiptId:consentReceiptId,challengeId,familyId:FAMILY,businessAccountId,
      phoneNumberId,scope:'incoming_text',version:consentVersion});
});
