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
function db(rowCount=1) {
  const calls=[];
  return {calls,async query(sql,values){calls.push({sql,values});return {rowCount};}};
}
function policy(database, overrides={}) {
  return makeConsentPolicy({
    db:database,senderHmacKey:key.toString('base64'),
    resolveAuthenticatedFamily:async()=>FAMILY,
    verifyEnrollment:async()=>({
      verified:true,familyId:FAMILY,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+60000
    }),
    ...overrides
  });
}
function enrollment(){
  return {session:{synthetic:true},businessAccountId,phoneNumberId,challengeId,consentVersion};
}
test('requires trusted external adapters and strong HMAC key',()=>{
  assert.throws(()=>makeConsentPolicy({db:db(),senderHmacKey:'x'}),/adapter/);
  assert.throws(()=>makeConsentPolicy({
    db:db(),senderHmacKey:'x',
    resolveAuthenticatedFamily:async()=>FAMILY,verifyEnrollment:async()=>({})
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
  assert.equal(values[6],null); // Challenge expiration is not consent expiry.
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
  assert.deepEqual(await policy(db(0)).enroll(enrollment()),{state:'already_active'});
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
