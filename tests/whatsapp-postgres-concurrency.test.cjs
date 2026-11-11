'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomBytes,createHmac}=require('node:crypto');
const {Pool}=require('pg');
const {createDurableInbox,INSERT_SQL}=require('../lib/whatsapp/durable-inbox');
const {makeConsentPolicy,REVOKE_LOCK_SQL}=require('../lib/whatsapp/consent-policy');

const url=process.env.WHATSAPP_TEST_DATABASE_URL;
const FAMILY_A='00000000-0000-4000-8000-000000000001';
const FAMILY_B='00000000-0000-4000-8000-000000000002';
const ACCOUNT='9999900000';
const NUMBER='8888800000';
const SENDER_A='34600000000';
const SENDER_B='34600000001';
const HMAC_KEY=randomBytes(32);
const CONTENT_KEY=randomBytes(32);
const senderDigest=sender=>createHmac('sha256',HMAC_KEY).update(sender).digest();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForBlockedLock(pool) {
  const deadline=Date.now()+6000;
  while(Date.now()<deadline) {
    const {rows}=await pool.query(
      "SELECT COUNT(*)::integer AS blocked FROM pg_stat_activity "+
      "WHERE datname=current_database() AND pid<>pg_backend_pid() "+
      "AND state='active' AND wait_event_type='Lock' "+
      "AND query LIKE '%nex_whatsapp_sender_authorizations%'"
    );
    if(rows[0].blocked>0)return;
    await sleep(40);
  }
  throw new Error('Concurrent statement never waited for the authorization lock');
}
async function authorize(pool,family,sender){
  await pool.query(
    "INSERT INTO nex_whatsapp_sender_authorizations "+
    "(business_account_id,phone_number_id,sender_digest,family_id,scope,consent_version,consent_at,consent_source) "+
    "VALUES ($1,$2,$3,$4,'incoming_text','test-v1',NOW(),'synthetic-ci')",
    [ACCOUNT,NUMBER,senderDigest(sender),family]
  );
}
function delivery(sender,id){
  return {
    provider:'whatsapp',businessAccountId:ACCOUNT,phoneNumberId:NUMBER,
    providerMessageId:id,senderWaId:sender,providerTimestamp:'1794150000',
    type:'text',text:'Missatge totalment fictici',contentPending:false
  };
}
test('PostgreSQL: both insert/revoke lock orders leave no message after opt-out',{
  skip:!url,timeout:40000
},async()=>{
  const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:6000,
    statement_timeout:15000});
  let holder;
  try {
    await pool.query(readFileSync(
      join(__dirname,'../db/migrations/20261108_whatsapp_durable_inbox.sql'),'utf8'));
    await authorize(pool,FAMILY_A,SENDER_A);
    await authorize(pool,FAMILY_B,SENDER_B);

    const inbox=createDurableInbox({db:pool,
      senderHmacKey:HMAC_KEY.toString('base64'),
      contentEncryptionKey:CONTENT_KEY.toString('base64')});
    const policy=makeConsentPolicy({db:pool,senderHmacKey:HMAC_KEY.toString('base64'),
      currentConsentVersion:'test-v1',
      resolveAuthenticatedFamily:async()=>FAMILY_A,
      verifyEnrollment:async()=>{throw Error('unused');},
      verifyExplicitConsent:async()=>{throw Error('unused');}});
    const revocation={session:{synthetic:true},businessAccountId:ACCOUNT,
      phoneNumberId:NUMBER,senderWaId:SENDER_A};

    // Insert wins the lock and remains uncommitted; revocation must WAIT,
    // then delete the newly committed message using a fresh snapshot.
    holder=await pool.connect();
    await holder.query('BEGIN');
    const first=await holder.query(INSERT_SQL,[
      ACCOUNT,NUMBER,senderDigest(SENDER_A),'wamid.synthetic-first',
      randomBytes(12),randomBytes(16),Buffer.from('ciphertext'),'1794150000'
    ]);
    assert.equal(first.rows[0].state,'stored');
    const revoking=policy.revoke(revocation);
    await waitForBlockedLock(pool);
    await holder.query('COMMIT');
    holder.release();holder=null;
    assert.deepEqual(await revoking,{state:'revoked',deletedMessages:1});
    const afterFirst=await pool.query('SELECT COUNT(*)::integer AS n FROM nex_whatsapp_inbound WHERE family_id=$1',[FAMILY_A]);
    assert.equal(afterFirst.rows[0].n,0);
    assert.deepEqual(await inbox.persistDelivery(delivery(SENDER_A,'wamid.synthetic-after-revocation')),
      {state:'unlinked'});

    // Reverse order: hold an UPDATE lock on an active consent for family B;
    // a new insert must wait and re-check revoked_at after the commit.
    holder=await pool.connect();
    await holder.query('BEGIN');
    const args=[ACCOUNT,NUMBER,senderDigest(SENDER_B),FAMILY_B];
    assert.equal((await holder.query(REVOKE_LOCK_SQL,args)).rowCount,1);
    const inserting=inbox.persistDelivery(delivery(SENDER_B,'wamid.synthetic-racing-insert'));
    await waitForBlockedLock(pool);
    await holder.query("UPDATE nex_whatsapp_sender_authorizations SET revoked_at=NOW() "+
      "WHERE business_account_id=$1 AND phone_number_id=$2 AND sender_digest=$3 AND family_id=$4",args);
    await holder.query('COMMIT');
    holder.release();holder=null;
    assert.deepEqual(await inserting,{state:'unlinked'});
    const afterSecond=await pool.query(
      "SELECT COUNT(*)::integer AS n FROM nex_whatsapp_inbound "+
      "WHERE business_account_id=$1 AND provider_message_id = ANY($2::text[])",
      [ACCOUNT,['wamid.synthetic-first','wamid.synthetic-racing-insert']]);
    assert.equal(afterSecond.rows[0].n,0);
  } finally {
    if(holder) {
      try {await holder.query('ROLLBACK');} finally {holder.release();}
    }
    await pool.end();
  }
});
