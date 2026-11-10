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
function db(rowCount=1,deletedCount=3) {
  const calls=[];
  return {calls,async query(sql,values){
    calls.push({sql,values});
    if (sql.includes('WITH target AS') && sql.includes('), revoked AS (') && sql.includes('), deleted AS (')) return {rows:[{
      revoked_count:rowCount,deleted_count:rowCount?deletedCount:0
    }]};
    return {rowCount,rows:rowCount===1?[{authorization_id:'00000000-0000-4000-8000-000000000099'}]:[]};
  }};
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
      verified:true,familyId:FAMILY,challengeId,businessAccountId,phoneNumberId,senderWaId:SENDER,
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
    verifyEnrollment:async()=>({verified:true,familyId:OTHER,challengeId,businessAccountId,phoneNumberId,senderWaId:SENDER,
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
    const proof={verified:true,familyId:FAMILY,challengeId,businessAccountId,phoneNumberId,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+60000,...patch};
    await assert.rejects(policy(database,{
      verifyEnrollment:async()=>proof
    }).enroll(enrollment()),/not verified/);
  }
  assert.equal(database.calls.length,0);
});
test('phone proof is bound to the exact challenge and business number',async()=>{
  const database=db();
  const valid={verified:true,familyId:FAMILY,challengeId,businessAccountId,
    phoneNumberId,senderWaId:SENDER,singleUseConsumed:true,expiresAt:Date.now()+60000};
  for (const patch of [{challengeId:'other_challenge_123456'},
    {businessAccountId:'1111100000'},{phoneNumberId:'2222200000'},
    {challengeId:undefined},{businessAccountId:undefined},{phoneNumberId:undefined}]) {
    await assert.rejects(policy(database,{
      verifyEnrollment:async()=>({...valid,...patch})
    }).enroll(enrollment()),/Phone proof not verified/);
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
  }),{state:'revoked',deletedMessages:3});
  const {sql,values}=database.calls[0];
  assert.match(sql,/family_id=\$4/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/DELETE FROM nex_whatsapp_inbound/);
  assert.match(sql,/inbound.family_id=target.family_id/);
  assert.match(sql,/inbound.sender_digest=target.sender_digest/);
  assert.equal(values[3],FAMILY);
  assert.equal(values.includes(SENDER),false);
});
test('no revocation result is not reported as success',async()=>{
  assert.deepEqual(await policy(db(0)).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),{state:'not_found',deletedMessages:0});
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

test('revocation deletes retained messages for exact tenant and sender only',async()=>{
  const database=db(1,12);
  const result=await policy(database).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  });
  assert.deepEqual(result,{state:'revoked',deletedMessages:12});
  const {sql,values}=database.calls[0];
  assert.match(sql,/WITH target AS/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/DELETE FROM nex_whatsapp_inbound AS inbound/);
  for (const column of ['family_id','business_account_id','phone_number_id','sender_digest']) {
    assert.ok(sql.includes('inbound.'+column+'=target.'+column));
  }
  assert.equal(values[3],FAMILY);
  assert.equal(values.includes(SENDER),false);
});
test('revocation fails closed if DB cannot attest both operations',async()=>{
  for (const rows of [[],[{revoked_count:1}], [{revoked_count:2,deleted_count:0}],
    [{revoked_count:1,deleted_count:-1}],[{revoked_count:'1',deleted_count:0}]]) {
    await assert.rejects(policy({query:async()=>({rows})}).revoke({
      session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
    }),/Revocation result not verified/);
  }
});

test('repeat revocation still purges retained messages without reporting fresh consent change',async()=>{
  const database=db(0,0);
  database.query=async(sql,values)=>{
    database.calls.push({sql,values});
    return {rows:[{revoked_count:0,deleted_count:2}]};
  };
  const result=await policy(database).revoke({session:{},businessAccountId,phoneNumberId,senderWaId:SENDER});
  assert.deepEqual(result,{state:'not_found',deletedMessages:2});
  assert.match(database.calls[0].sql,/USING target/);
  assert.match(database.calls[0].sql,/scope='incoming_text'/);
});

test('enrollment fails closed when database response cannot prove insert or conflict',async()=>{
  for (const result of [null,{}, {rowCount:-1}, {rowCount:2},
    {rowCount:'1'}, {rowCount:NaN}, {rowCount:1},
    {rowCount:1,rows:[]}, {rowCount:1,rows:[{}]},
    {rowCount:1,rows:[{authorization_id:'not-a-uuid'}]},
    {rowCount:0,rows:[{authorization_id:'00000000-0000-4000-8000-000000000099'}]}]) {
    const database={query:async()=>result};
    await assert.rejects(policy(database).enroll(enrollment()),
      /Enrollment result not verified/);
  }
  assert.deepEqual(await policy({query:async()=>({rowCount:0,rows:[]})}).enroll(enrollment()),
    {state:'already_active_or_receipt_used'});
});


test('revocation rejects ambiguous or malformed aggregate result cardinality',async()=>{
  const valid={revoked_count:1,deleted_count:0};
  for (const response of [null,{}, {rows:[]}, {rows:[valid,valid]},
    {rowCount:0,rows:[valid]}, {rowCount:2,rows:[valid]},
    {rowCount:'1',rows:[valid]}, {rows:null}]) {
    await assert.rejects(policy({query:async()=>response}).revoke({
      session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
    }),/Revocation result not verified/);
  }
  assert.deepEqual(await policy({query:async()=>({rowCount:1,rows:[valid]})}).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),{state:'revoked',deletedMessages:0});
});

test('rejects fractional and unsafe timestamps before writing consent',async()=>{
  const database=db();
  for (const expiresAt of [Date.now()+60000.5, Number.MAX_SAFE_INTEGER+1, NaN]) {
    await assert.rejects(policy(database,{
      verifyEnrollment:async()=>({
        verified:true,familyId:FAMILY,challengeId,businessAccountId,phoneNumberId,senderWaId:SENDER,
        singleUseConsumed:true,expiresAt
      })
    }).enroll(enrollment()),/Phone proof not verified/);
  }
  for (const acceptedAt of [Date.now()-1000.5, Number.MAX_SAFE_INTEGER+1, NaN]) {
    await assert.rejects(policy(database,{
      verifyExplicitConsent:async()=>({
        verified:true,receiptId:consentReceiptId,challengeId,
        familyId:FAMILY,businessAccountId,phoneNumberId,senderWaId:SENDER,
        scope:'incoming_text',version:consentVersion,source:'account-web-consent',
        singleUseConsumed:true,acceptedAt
      })
    }).enroll(enrollment()),/Explicit consent not verified/);
  }
  assert.equal(database.calls.length,0);
});

test('rejects coercible objects in enrollment and revocation identifiers before SQL',async()=>{
  const database=db();
  const fakeId={toString:()=>businessAccountId};
  const fakeChallenge={toString:()=>challengeId};
  for (const patch of [
    {businessAccountId:fakeId},
    {phoneNumberId:{toString:()=>phoneNumberId}},
    {challengeId:fakeChallenge},
    {consentReceiptId:{toString:()=>consentReceiptId}}
  ]) {
    await assert.rejects(policy(database).enroll({...enrollment(),...patch}),/Invalid enrollment input/);
  }
  await assert.rejects(policy(database).revoke({
    session:{},businessAccountId:fakeId,phoneNumberId,senderWaId:SENDER
  }),/Invalid revocation input/);
  await assert.rejects(policy(database).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:{toString:()=>SENDER}
  }),/Invalid revocation input/);
  assert.equal(database.calls.length,0);
});
test('rejects coercible sender identifier from phone verifier',async()=>{
  const database=db();
  await assert.rejects(policy(database,{
    verifyEnrollment:async()=>({
      verified:true,familyId:FAMILY,challengeId,businessAccountId,phoneNumberId,
      senderWaId:{toString:()=>SENDER},singleUseConsumed:true,expiresAt:Date.now()+60000
    })
  }).enroll(enrollment()),/Phone proof not verified/);
  assert.equal(database.calls.length,0);
});

test('does not write when phone proof expires during async consent verification',async()=>{
  const database=db();
  await assert.rejects(policy(database,{
    verifyEnrollment:async()=>({verified:true,familyId:FAMILY,challengeId,
      businessAccountId,phoneNumberId,senderWaId:SENDER,
      singleUseConsumed:true,expiresAt:Date.now()+40}),
    verifyExplicitConsent:async()=>{
      await new Promise(resolve=>setTimeout(resolve,80));
      return {verified:true,receiptId:consentReceiptId,challengeId,familyId:FAMILY,
        businessAccountId,phoneNumberId,senderWaId:SENDER,scope:'incoming_text',
        version:consentVersion,source:'account-web-consent',
        singleUseConsumed:true,acceptedAt:Date.now()-1000};
    }
  }).enroll(enrollment()),/Phone proof expired before write/);
  assert.equal(database.calls.length,0);
});


test('rejects coercible family identities in both enrollment and revocation',async()=>{
  const database=db();
  const forgedFamily={toString:()=>FAMILY};
  const instance=policy(database,{
    resolveAuthenticatedFamily:async()=>forgedFamily
  });
  await assert.rejects(instance.enroll(enrollment()),/Unauthenticated family/);
  await assert.rejects(instance.revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/Unauthenticated family/);
  assert.equal(database.calls.length,0);
});

test('revocation locks authorization, revokes and purges in separate statements on one connection',async()=>{
  const queries=[];
  let released=false;
  const database={connect:async()=>({
    async query(sql,values){
      queries.push({sql,values});
      if(sql==='BEGIN'||sql==='COMMIT')return {};
      if(sql.includes('FOR UPDATE'))return {rowCount:1,rows:[{authorization_id:'id'}]};
      if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))
        return {rowCount:1,rows:[{authorization_id:'id'}]};
      if(sql.includes('DELETE FROM nex_whatsapp_inbound'))
        return {rowCount:2,rows:[{inbound_id:'1'},{inbound_id:'2'}]};
      throw Error('unexpected SQL');
    },release(){released=true;}
  })};
  const result=await policy(database).revoke({session:{},businessAccountId,phoneNumberId,senderWaId:SENDER});
  assert.deepEqual(result,{state:'revoked',deletedMessages:2});
  assert.deepEqual(queries.map(q=>q.sql==='BEGIN'?'BEGIN':q.sql==='COMMIT'?'COMMIT':
    q.sql.includes('FOR UPDATE')?'LOCK':q.sql.includes('UPDATE nex_whatsapp')?'REVOKE':'PURGE'),
    ['BEGIN','LOCK','REVOKE','PURGE','COMMIT']);
  assert.equal(released,true);
  for(const q of queries.filter(q=>q.values))assert.equal(q.values[3],FAMILY);
});

test('revocation rolls back when purge fails and releases the connection',async()=>{
  const queries=[];let released=false;
  const database={connect:async()=>({
    async query(sql){
      queries.push(sql);
      if(sql.includes('FOR UPDATE'))return {rowCount:1,rows:[{authorization_id:'id'}]};
      if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))
        return {rowCount:1,rows:[{authorization_id:'id'}]};
      if(sql.includes('DELETE FROM nex_whatsapp_inbound'))throw Error('synthetic purge failure');
      return {};
    },release(){released=true;}
  })};
  await assert.rejects(policy(database).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/synthetic purge failure/);
  assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(released,true);
});

test('revocation fails closed if no dedicated transaction connection is available',async()=>{
  await assert.rejects(policy(db()).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/dedicated transactional/);
});
