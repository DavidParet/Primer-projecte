'use strict';

/**
 * Disposable CI PostgreSQL 17 only. Never connect to Neon.
 *
 * Tests signed RPCs under REAL simultaneous Postgres transactions rather than
 * sequential revoked-state mocks. Dedicated SQL runtime role on the reading
 * connection; only the synthetic test administrator changes membership.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHash,createHmac,randomUUID}=require('node:crypto');
const {Client,Pool}=require('pg');
const {createInboxReadPermitSigner}=require('../lib/whatsapp/signed-inbox-read-permit');
const {ingestPermitPayload,SIGNED_INSERT_SQL}=require('../lib/whatsapp/signed-inbound-ingest-adapter');
const {READ_SQL}=require('../lib/whatsapp/pilot-family-inbox-reader');

const url=process.env.WHATSAPP_TEST_DATABASE_URL;
const A='11111111-1111-4111-8111-111111111111';
const USER='canonical-a';
const now=()=>Date.now();

async function connectAsRuntime(connectionUrl,role){
 const u=new URL(connectionUrl);
 const client=new Client({
  host:u.hostname,port:Number(u.port||5432),user:u.username,
  password:decodeURIComponent(u.password),
  database:decodeURIComponent(u.pathname.slice(1)),
  connectionTimeoutMillis:5000,statement_timeout:12000
 });
 await client.connect();
 await client.query('SET ROLE '+role);
 return client;
}
async function denyConcurrentMutation(pool,sql,params){
 const admin=await pool.connect();
 try{
  await admin.query('BEGIN');
  await admin.query("SET LOCAL lock_timeout='350ms'");
  await assert.rejects(admin.query(sql,params),e=>e.code==='55P03');
  await admin.query('ROLLBACK');
 }finally{admin.release();}
}

test('signed family reader locks canonical membership until read transaction commits',{
 skip:!url,timeout:35000
},async()=>{
 const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
 let reader,holding=false;
 const kid='ci-concurrent-reader',key=randomBytes(32);
 const family=A;
 try{
  await pool.query(
   "UPDATE public.nex_family_memberships "+
   "SET status='active',revoked_at=NULL WHERE user_id=$1 AND family_id=$2",
   [USER,family]
  );
  await pool.query(
   "INSERT INTO public.nex_ci_inbox_read_keys(key_id,key_data,state) "+
   "VALUES ($1,$2,'active')",[kid,key]
  );
  const sign=createInboxReadPermitSigner({
   now,
   contentEncryptionKey:randomBytes(32).toString('base64'),
   getActiveSigningKey:async()=>({
    purpose:'whatsapp-inbox-read',keyId:kid,state:'active',
    keyBase64:key.toString('base64')
   })
  });
  async function args(){
   const permit=await sign({
    userId:USER,sessionId:'synthetic-test-server-verified-session',
    familyId:family,limit:1
   });
   return [
    permit.userId,permit.familyId,permit.sessionDigest,permit.beforeInboundId,
    permit.limit,permit.keyId,permit.expiresAt,permit.nonce,permit.signature
   ];
  }
  reader=await connectAsRuntime(url,'nex_ci_inbox_reader_runtime');
  await reader.query('BEGIN');holding=true;
  const first=await reader.query(READ_SQL,await args());
  assert.equal(first.rowCount,1,'synthetic inbox fixture must be available');
  // A revocation must WAIT for SQL's canonical membership row lock.
  await denyConcurrentMutation(pool,
   'UPDATE public.nex_family_memberships SET status=\'suspended\','+
   'updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2',
   [USER,family]);
  await reader.query('COMMIT');holding=false;
  await pool.query(
   "UPDATE public.nex_family_memberships SET status='suspended',"+
   "updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2",
   [USER,family]
  );
  const denied=await reader.query(READ_SQL,await args());
  assert.equal(denied.rowCount,0,
   'fresh valid signature must not bypass a completed family revocation');
 }finally{
  if(reader){
   if(holding)await reader.query('ROLLBACK').catch(()=>{});
   await reader.end();
  }
  // Only the synthetic CI fixture is changed and must be restored.
  await pool.query(
   "UPDATE public.nex_family_memberships SET status='active',"+
   "revoked_at=NULL WHERE user_id=$1 AND family_id=$2",[USER,family]
  ).catch(()=>{});
  await pool.end();
 }
});

test('signed ingest locks sender consent, then rejects post-revocation messages',{
 skip:!url,timeout:35000
},async()=>{
 const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
 let writer,holding=false;
 const kid='ci-concurrent-ingest',key=randomBytes(32);
 const business='644440009',phone='744440009';
 const digest=randomBytes(32);
 const consentVersion='ci-concurrency-test';
 const message='wamid.ci-concurrent-first',later='wamid.ci-concurrent-revoked';
 let authId;
 try{
  const authorization=await pool.query(
   "INSERT INTO public.nex_whatsapp_sender_authorizations("+
   "business_account_id,phone_number_id,sender_digest,family_id,scope,"+
   "consent_version,consent_at,consent_source,valid_until) "+
   "VALUES ($1,$2,$3,$4,'incoming_text',$5,clock_timestamp(),"+
   "'synthetic-ci',clock_timestamp()+interval '1 hour') "+
   "RETURNING authorization_id",
   [business,phone,digest,A,consentVersion]
  );
  authId=authorization.rows[0].authorization_id;
  await pool.query(
   "INSERT INTO public.nex_ci_inbound_ingest_keys(key_id,key_data,state) "+
   "VALUES($1,$2,'active')",[kid,key]
  );
  const timestamp=String(Math.floor(now()/1000));
  function args(messageId){
   const iv=randomBytes(12),tag=randomBytes(16),
    ciphertext=randomBytes(48),expiresAt=Math.floor(now()/1000)+30;
   const permit={
    keyId:kid,business,phone,senderDigest:digest,messageId,
    iv,tag,ciphertext,providerTimestamp:timestamp,
    expiresAt,nonce:randomUUID()
   };
   const signature=createHmac('sha256',key)
    .update(ingestPermitPayload(permit),'utf8').digest();
   return [business,phone,digest,messageId,iv,tag,ciphertext,timestamp,
    kid,expiresAt,permit.nonce,signature];
  }
  writer=await connectAsRuntime(url,'nex_ci_inbound_ingest_runtime');
  await writer.query('BEGIN');holding=true;
  const saved=await writer.query(SIGNED_INSERT_SQL,args(message));
  assert.equal(saved.rows[0].state,'stored');
  // The sender cannot be revoked between SQL's lock and its encrypted INSERT.
  await denyConcurrentMutation(pool,
   'UPDATE public.nex_whatsapp_sender_authorizations '+
   'SET revoked_at=clock_timestamp() WHERE authorization_id=$1',[authId]);
  await writer.query('COMMIT');holding=false;
  await pool.query(
   'UPDATE public.nex_whatsapp_sender_authorizations '+
   'SET revoked_at=clock_timestamp() WHERE authorization_id=$1',[authId]
  );
  const denied=await writer.query(SIGNED_INSERT_SQL,args(later));
  assert.equal(denied.rows[0].state,'unlinked',
   'post-revocation signed receipt cannot persist another message');
  const db=await pool.query(
   'SELECT provider_message_id FROM public.nex_whatsapp_inbound '+
   'WHERE provider_message_id=ANY($1::text[])',[ [message,later] ]
  );
  assert.deepEqual(db.rows.map(r=>r.provider_message_id),[message]);
 }finally{
  if(writer){
   if(holding)await writer.query('ROLLBACK').catch(()=>{});
   await writer.end();
  }
  await pool.end();
 }
});
