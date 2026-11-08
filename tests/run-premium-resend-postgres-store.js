'use strict';
/**
 * SQL adapter contract with fake query executor. Real PostgreSQL provider
 * intentionally NOT provisioned: this is offline, non-persistent testing.
 */
const assert=require('node:assert/strict');
const {createResendPostgresStore}=require('../lib/premium-resend-postgres-store');
const {enqueueVerifiedResendEvent,openEnvelope}=require('../lib/premium-resend-secure-queue');
const crypto=require('node:crypto');
const key=crypto.randomBytes(32).toString('base64');
const source={type:'email.received',data:{
  email_id:'c2b473b2-ff4c-4a6b-bab7-1983ac8303b5',
  to:['pilot@entrada.nexlupa.app'],from:'pretend@example.test',
  subject:'PRIVATE: should never reach database',attachments:[]}};
function dbMock(){
  const entries=new Map(),queries=[];
  return {entries,queries,async query(sql,params){
    queries.push({sql,params});
    assert.ok(sql.includes('nexlupa_pilot.resend_inbox_queue'));
    assert.ok(sql.includes('$1'),'Must use parameter placeholders');
    if(sql.includes('ON CONFLICT (queue_id) DO NOTHING')){
      assert.ok(sql.includes('RETURNING queue_id'));
      const [queueId,envelope]=params;
      assert.ok(!envelope.includes(source.data.subject));
      assert.ok(!envelope.includes(source.data.from));
      if(entries.has(queueId))return {rowCount:0,rows:[]};
      entries.set(queueId,{queue_id:queueId,encrypted_envelope:envelope,
        attempts:0,state:'received',lease_token:null});
      return {rowCount:1,rows:[{queue_id:queueId}]};
    }
    if(sql.includes('FOR UPDATE SKIP LOCKED')){
      assert.ok(sql.includes("state='processing'"));
      assert.ok(sql.includes('lease_token=$2::uuid'));
      const [maxAttempts,leaseToken]=params;
      const row=[...entries.values()].find(r=>
        ['received','retry'].includes(r.state)&&r.attempts<maxAttempts
      );
      if(!row)return {rowCount:0,rows:[]};
      row.state='processing';row.lease_token=leaseToken;row.attempts++;
      return {rowCount:1,rows:[{queue_id:row.queue_id,
        encrypted_envelope:row.encrypted_envelope,attempts:row.attempts}]};
    }
    if(sql.includes('available_at=now()+')){
      const [id,token,delay,maxAttempts]=params;
      assert.ok(delay>=10);
      const row=entries.get(id);
      if(!row||row.state!=='processing'||row.lease_token!==token)
        return {rowCount:0,rows:[]};
      row.state=row.attempts>=maxAttempts?'failed':'retry';
      row.lease_token=null;
      return {rowCount:1,rows:[{queue_id:id,state:row.state}]};
    }
    if(sql.includes('SET state=$3')){
      const [id,token,status]=params;
      const row=entries.get(id);
      if(!row||row.state!=='processing'||row.lease_token!==token)
        return {rowCount:0,rows:[]};
      row.state=status;row.lease_token=null;
      return {rowCount:1,rows:[{queue_id:id}]};
    }
    throw Error('UNKNOWN_SQL');
  }};
}
async function main(){
  const mock=dbMock(),store=createResendPostgresStore(mock);
  const input={verifiedEvent:source,svixId:'msg_synthetic_123',
    allowedRecipient:'pilot@entrada.nexlupa.app',keyBase64:key,store};
  const inserted=await enqueueVerifiedResendEvent(input);
  assert.equal(inserted.status,'stored');
  assert.equal(mock.entries.size,1);
  const value=mock.entries.get(inserted.queueId).encrypted_envelope;
  assert.ok(!value.includes(source.data.email_id));
  assert.ok(!value.includes(source.data.subject));
  const repeat=await enqueueVerifiedResendEvent(input);
  assert.equal(repeat.status,'duplicate');
  assert.equal(mock.entries.size,1);
  const claim=await store.claimOne({maxAttempts:2});
  assert.equal(claim.queueId,inserted.queueId);
  assert.equal(claim.attempts,1);
  assert.equal(openEnvelope(claim.envelope,key,claim.queueId).emailId,
    source.data.email_id);
  assert.equal(await store.complete({queueId:claim.queueId,
    leaseToken:crypto.randomUUID(),outcome:'done'}),false,
    'Old/unknown lease token must not modify a row');
  assert.equal((await store.fail({queueId:claim.queueId,
    leaseToken:claim.leaseToken,maxAttempts:2,backoffSeconds:30})).state,'retry');
  const second=await store.claimOne({maxAttempts:2});
  assert.equal(second.attempts,2);
  assert.notEqual(second.leaseToken,claim.leaseToken);
  assert.equal((await store.fail({queueId:second.queueId,
    leaseToken:second.leaseToken,maxAttempts:2})).state,'failed');
  assert.equal(await store.claimOne({maxAttempts:2}),null);
  assert.equal(mock.entries.get(inserted.queueId).state,'failed');
  assert.equal(mock.queries.filter(q=>q.sql.includes('FOR UPDATE SKIP LOCKED')).length,3);
  assert.ok(mock.queries.every(q=>q.params instanceof Array));
  await assert.rejects(()=>store.insertIfAbsent({id:'wrong',envelope:claim.envelope}),
    /INVALID_QUEUE_ID/);
  await assert.rejects(()=>store.claimOne({leaseSeconds:3}),/INVALID_LEASE_SECONDS/);
  await assert.rejects(()=>store.fail({queueId:claim.queueId,
    leaseToken:'bad'}),/INVALID_LEASE_TOKEN/);
  await assert.rejects(()=>store.complete({queueId:claim.queueId,
    leaseToken:claim.leaseToken,outcome:'ignore_security'}),/INVALID_COMPLETION_OUTCOME/);
  const outage=createResendPostgresStore({query:async()=>{throw Error('DB_UNAVAILABLE')}});
  await assert.rejects(()=>outage.insertIfAbsent({id:inserted.queueId,
    envelope:claim.envelope}),/DB_UNAVAILABLE/);
  const unconfirmed=createResendPostgresStore({query:async()=>({rowCount:1,rows:[]})});
  await assert.rejects(()=>unconfirmed.insertIfAbsent({id:inserted.queueId,
    envelope:claim.envelope}),/UNCONFIRMED_DATABASE_RESULT/);
  const wrong=createResendPostgresStore({query:async()=>({
    rowCount:1,rows:[{queue_id:'b'.repeat(64)}]
  })});
  await assert.rejects(()=>wrong.insertIfAbsent({id:inserted.queueId,
    envelope:claim.envelope}),/DATABASE_QUEUE_ID_MISMATCH/);
  console.log('PASS — parameterized, idempotent PostgreSQL INSERT; ciphertext only');
  console.log('PASS — SKIP LOCKED claim and UUID-fenced lease prevent stale-worker ACK');
  console.log('PASS — bounded retry and terminal failed state at maximum attempts');
  console.log('PASS — unavailable/inconsistent DB and unsafe inputs fail closed');
  console.log('LIMIT — SQL query behavior mocked; real Postgres migration pending');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
