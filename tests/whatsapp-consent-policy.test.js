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
  const query=async(sql,values)=>{
    calls.push({sql,values});
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {};
    if(sql.includes('FOR UPDATE'))
      return {rowCount:rowCount?1:0,rows:rowCount?[{authorization_id:'id'}]:[]};
    if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))
      return {rowCount,rows:rowCount?[{authorization_id:'id'}]:[]};
    if(sql.includes('DELETE FROM nex_whatsapp_inbound')) {
      const n=rowCount?deletedCount:0;
      return {rowCount:n,rows:Array.from({length:n},(_,i)=>({inbound_id:String(i)}))};
    }
    return {rowCount,rows:rowCount===1?[{authorization_id:'1'}]:[]};
  };
  return {calls,query,connect:async()=>({query,release(){}})};
}
function policy(database, overrides={}) {
  return makeConsentPolicy({
    db:database,senderHmacKey:key.toString('base64'),
    resolveAuthenticatedFamily:async()=>FAMILY,
    authorizeFamily:async()=>true,
    authorizeFamilyTransaction:async()=>true,
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
    verifyExplicitConsent:async()=>({}),authorizeFamily:async()=>true,
    authorizeFamilyTransaction:async()=>true,currentConsentVersion:consentVersion
  }),/32-byte/);
});
test('enrolls only a phone proved by trusted single-use verifier',async()=>{
  const database=db();
  assert.deepEqual(await policy(database).enroll(enrollment()),{state:'enrolled'});
  assert.deepEqual(database.calls.map(({sql})=>sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations')?'INSERT':sql),[
    'BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED','INSERT','COMMIT'
  ]);
  const {sql,values}=database.calls.find(c=>c.sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations'));
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
  const {sql,values}=database.calls.find(c=>c.sql.includes('UPDATE nex_whatsapp_sender_authorizations'));
  assert.match(sql,/family_id=\$4/);
  assert.match(sql,/revoked_at IS NULL/);
  const purgeSql=database.calls.find(c=>c.sql.includes('DELETE FROM nex_whatsapp_inbound')).sql;
  assert.match(purgeSql,/DELETE FROM nex_whatsapp_inbound/);
  assert.ok(purgeSql.includes('family_id=$4'));
  assert.ok(purgeSql.includes('sender_digest=$3'));
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
  assert.equal(database.calls.find(c=>c.sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations')).values[4],consentVersion);
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
  const {sql,values}=database.calls.find(c=>c.sql.includes('UPDATE nex_whatsapp_sender_authorizations'));
  assert.match(sql,/revoked_at IS NULL/);
  const purgeSql=database.calls.find(c=>c.sql.includes('DELETE FROM nex_whatsapp_inbound')).sql;
  for (const [column,parameter] of [['family_id',4],['business_account_id',1],['phone_number_id',2],['sender_digest',3]]) {
    assert.ok(purgeSql.includes(column+'=$'+parameter));
  }
  assert.equal(values[3],FAMILY);
  assert.equal(values.includes(SENDER),false);
});
test('revocation fails closed on invalid transaction responses',async()=>{
  for(const response of [null,{}, {rowCount:2,rows:[{}]}, {rowCount:1,rows:[]}]) {
    const database={query:async()=>({}),connect:async()=>({
      async query(sql){if(sql.includes('FOR UPDATE'))return response;return {};},
      release(){}
    })};
    await assert.rejects(policy(database).revoke({
      session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
    }),/Revocation lock result not verified/);
  }
});

test('repeat revocation still purges retained messages without reporting fresh consent change',async()=>{
  const database=db(0,0);
  database.connect=async()=>({query:async(sql,values)=>{
    database.calls.push({sql,values});
    if(sql.includes('DELETE FROM nex_whatsapp_inbound'))return {rowCount:2,rows:[{inbound_id:'1'},{inbound_id:'2'}]};
    if(sql.includes('FOR UPDATE'))return {rowCount:1,rows:[{authorization_id:'id'}]};
    if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))return {rowCount:0,rows:[]};
    return {};
  },release(){}});
  const result=await policy(database).revoke({session:{},businessAccountId,phoneNumberId,senderWaId:SENDER});
  assert.deepEqual(result,{state:'not_found',deletedMessages:2});
  assert.ok(database.calls.some(c=>c.sql.includes('DELETE FROM nex_whatsapp_inbound')));
  assert.ok(database.calls.some(c=>c.sql.includes("scope='incoming_text'")));
});

test('enrollment fails closed when database response cannot prove insert or conflict',async()=>{
  for (const result of [null,{}, {rowCount:-1}, {rowCount:2},
    {rowCount:'1'}, {rowCount:NaN}, {rowCount:1},
    {rowCount:1,rows:[]}, {rowCount:1,rows:[{}]},
    {rowCount:1,rows:[{authorization_id:'not-a-bigint'}]},
    {rowCount:1,rows:[{authorization_id:'00000000-0000-4000-8000-000000000099'}]},
    {rowCount:1,rows:[{authorization_id:1}]},
    {rowCount:1,rows:[{authorization_id:{toString:()=> '1'}}]},
    {rowCount:1,rows:[{authorization_id:'0'}]},
    {rowCount:1,rows:[{authorization_id:'9223372036854775808'}]},
    {rowCount:0,rows:[{authorization_id:'1'}]}]) {
    const database={query:async()=>{throw Error('Pool-level insert not permitted');},
      connect:async()=>({release(){},async query(sql){
        if(sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations'))return result;
        return {};
      }})};
    await assert.rejects(policy(database).enroll(enrollment()),
      /Enrollment result not verified/);
  }
  const conflictDb={query:async()=>{throw Error('Pool-level insert not permitted');},
    connect:async()=>({release(){},async query(sql){
      if(sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations'))
        return {rowCount:0,rows:[]};
      return {};
    }})};
  assert.deepEqual(await policy(conflictDb).enroll(enrollment()),
    {state:'already_active_or_receipt_used'});
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
  const database={query:async()=>({}),connect:async()=>({
    async query(sql,values){
      queries.push({sql,values});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='SET TRANSACTION ISOLATION LEVEL READ COMMITTED')return {};
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
  assert.deepEqual(queries.map(q=>q.sql==='BEGIN'?'BEGIN':q.sql==='COMMIT'?'COMMIT':q.sql.startsWith('SET TRANSACTION')?'ISOLATION':
    q.sql.includes('FOR UPDATE')?'LOCK':q.sql.includes('UPDATE nex_whatsapp')?'REVOKE':'PURGE'),
    ['BEGIN','ISOLATION','LOCK','REVOKE','PURGE','COMMIT']);
  assert.equal(released,true);
  for(const q of queries.filter(q=>q.values))assert.equal(q.values[3],FAMILY);
});

test('revocation rolls back when purge fails and releases the connection',async()=>{
  const queries=[];let released=false;
  const database={query:async()=>({}),connect:async()=>({
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
  await assert.rejects(policy({query:async()=>({})}).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/dedicated transactional/);
});


test('a valid family UUID without a current admin permission never enrolls or revokes',async()=>{
  const database=db();
  const denied=policy(database,{authorizeFamily:async()=>false});
  await assert.rejects(denied.enroll(enrollment()),/Current family administrator required/);
  await assert.rejects(denied.revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/Current family administrator required/);
  assert.equal(database.calls.length,0);
});

test('enrollment rechecks administrator after awaiting independent proof and consent',async()=>{
  const database=db();
  let checks=0;
  await assert.rejects(policy(database,{
    authorizeFamily:async({familyId,action})=>{
      assert.equal(familyId,FAMILY);
      assert.equal(action,'enroll_whatsapp_sender');
      return ++checks===1;
    }
  }).enroll(enrollment()),/permission expired before write/);
  assert.equal(checks,2);
  assert.equal(database.calls.length,0);
});

test('revocation must confirm administrator membership within the SQL transaction',async()=>{
  const database=db();
  let inTxn=0;
  await assert.rejects(policy(database,{
    authorizeFamily:async({familyId,action})=>{
      assert.equal(familyId,FAMILY);
      assert.equal(action,'revoke_whatsapp_consent');
      return true;
    },
    authorizeFamilyTransaction:async({client,familyId,action})=>{
      assert.equal(typeof client.query,'function');
      assert.equal(familyId,FAMILY);
      assert.equal(action,'revoke_whatsapp_consent');
      inTxn++;
      return false;
    }
  }).revoke({
    session:{},businessAccountId,phoneNumberId,senderWaId:SENDER
  }),/Current locked family administrator required/);
  assert.equal(inTxn,1);
  assert.deepEqual(database.calls.map(c=>c.sql),[
    'BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED','ROLLBACK'
  ]);
});

test('unconfigured administrator callbacks fail closed at construction',()=>{
  const common={
    db:db(),senderHmacKey:key.toString('base64'),
    currentConsentVersion:consentVersion,
    resolveAuthenticatedFamily:async()=>FAMILY,
    verifyEnrollment:async()=>({}),
    verifyExplicitConsent:async()=>({})
  };
  assert.throws(()=>makeConsentPolicy(common),/Missing trusted server adapter/);
  assert.throws(()=>makeConsentPolicy({...common,authorizeFamily:async()=>true}),
    /Missing trusted server adapter/);
  assert.throws(()=>makeConsentPolicy({...common,
    authorizeFamilyTransaction:async()=>true}),
    /Missing trusted server adapter/);
});


test('enrollment refuses admin removed in the same DB transaction, before INSERT',async()=>{
  const sqls=[];let released=0;
  const client={async query(sql){
    sqls.push(sql);
    if(sql.startsWith('INSERT INTO'))throw Error('Unauthorized INSERT');
    return {};
  },release(){released++;}};
  const database={query:async()=>{throw Error('Never use pool.query for enrollment');},
    connect:async()=>client};
  const trusted=policy(database,{
    authorizeFamily:async()=>true,
    authorizeFamilyTransaction:async({client:locked,familyId,action})=>{
      assert.equal(locked,client);
      assert.equal(familyId,FAMILY);
      assert.equal(action,'enroll_whatsapp_sender');
      return false;
    }
  });
  await assert.rejects(trusted.enroll(enrollment()),/Current locked family administrator required/);
  assert.deepEqual(sqls,['BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED','ROLLBACK']);
  assert.equal(released,1);
});

test('enrollment failure rolls back with no success claim and releases connection',async()=>{
  const sqls=[];let released=0;
  const database={query:async()=>{throw Error('Never use pool.query for enrollment');},
    connect:async()=>({async query(sql){
      sqls.push(sql);
      if(sql.startsWith('INSERT INTO nex_whatsapp_sender_authorizations'))
        throw Error('synthetic database outage');
      return {};
    },release(){released++;}})};
  await assert.rejects(policy(database).enroll(enrollment()),/synthetic database outage/);
  assert.deepEqual(sqls.slice(0,2),['BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED']);
  assert.equal(sqls.at(-1),'ROLLBACK');
  assert.equal(sqls.includes('COMMIT'),false);
  assert.equal(released,1);
});

test('enrollment cannot use a pool without a dedicated transaction connection',async()=>{
  const database={query:async()=>{throw Error('Never insert via pool.query');}};
  await assert.rejects(policy(database).enroll(enrollment()),/dedicated transactional PostgreSQL connection/);
});

test('enrollment refuses phone proof that expires while waiting for membership lock',async()=>{
  const sqls=[];
  const database={query:async()=>{throw Error('No direct writes');},
    connect:async()=>({async query(sql){
      sqls.push(sql);
      if(sql.startsWith('INSERT INTO'))throw Error('Expired proof inserted');
      return {};
    },release(){}})};
  await assert.rejects(policy(database,{
    verifyEnrollment:async()=>({
      verified:true,familyId:FAMILY,challengeId,businessAccountId,phoneNumberId,
      senderWaId:SENDER,singleUseConsumed:true,expiresAt:Date.now()+75
    }),
    authorizeFamilyTransaction:async()=>{
      await new Promise(resolve=>setTimeout(resolve,120));
      return true;
    }
  }).enroll(enrollment()),/Phone proof expired before locked write/);
  assert.equal(sqls.includes('COMMIT'),false);
  assert.equal(sqls.at(-1),'ROLLBACK');
});
