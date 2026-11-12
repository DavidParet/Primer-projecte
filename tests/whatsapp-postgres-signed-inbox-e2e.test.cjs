'use strict';

/**
 * Fully synthetic Meta-HMAC -> PostgreSQL encrypted inbox -> signed
 * restricted family SELECT -> AES-GCM plaintext read integration.
 * Disposable GitHub Actions Postgres 17 ONLY. NEVER connects to Neon.
 * Admin seeds only synthetic consent and signer keys; both actual ingest
 * and read run with separate restricted NOLOGIN roles via SET ROLE.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHmac,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {createDurableInbox}=require('../lib/whatsapp/durable-inbox');
const {createSignedInboundIngestAdapter,SIGNED_INSERT_SQL}=
 require('../lib/whatsapp/signed-inbound-ingest-adapter');
const {createMetaDurablePostBridge}=require('../lib/whatsapp/meta-durable-post-bridge');
const {createPilotFamilyInboxReader,READ_SQL}=
 require('../lib/whatsapp/pilot-family-inbox-reader');

const url=process.env.WHATSAPP_TEST_DATABASE_URL;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const BUSINESS='123456789',PHONE='987654321';
const SENDER='34677711111',OUTSIDER='34677722222',SECOND='34677733333';
const MESSAGE='wamid.node-sql-reader-ci-01';
const TEXT='CI fictici: excursió el dijous a les 09:00';
const APP_SECRET='CI-only-fictitious-Meta-app-secret';

function envelope(from,id,text){
 return Buffer.from(JSON.stringify({
  object:'whatsapp_business_account',
  entry:[{id:BUSINESS,changes:[{field:'messages',value:{
   metadata:{phone_number_id:PHONE},
   messages:[{id,from,timestamp:String(Math.floor(Date.now()/1000)),
    type:'text',text:{body:text}}]
  }}]}]
 }), 'utf8');
}
async function deliver(bridge,raw,{forgedSignature=false}={}){
 const req=Readable.from([raw]);
 req.method='POST';
 req.headers={
  'content-type':'application/json',
  'x-hub-signature-256':'sha256'+ '=' +(forgedSignature?
   '0'.repeat(64):createHmac('sha256',APP_SECRET).update(raw).digest('hex'))
 };
 const res={
  statusCode:200,headers:{},body:null,
  setHeader(name,value){this.headers[name.toLowerCase()]=value;},
  status(code){this.statusCode=code;return this;},
  json(body){this.body=body;return this;}
 };
 await bridge(req,res);
 return res;
}

test('signed Meta webhook -> encrypted PostgreSQL -> one-use authorized read -> AES-GCM', {
 skip:!url,timeout:40000
},async()=>{
 const pool=new Pool({connectionString:url,max:5,
  connectionTimeoutMillis:6000,statement_timeout:15000});
 let readerClient,ingestClient;
 try{
  const senderKey=randomBytes(32),encryptionKey=randomBytes(32);
  const signingKey=randomBytes(32),signingKeyId='ci-inbox-node-e2e';
  const ingestSigningKey=randomBytes(32),ingestKeyId='ci-ingest-node-e2e';
  const senderDigest=createHmac('sha256',senderKey).update(SENDER).digest();
  // Test-only seeding, never a real person, Meta account or credential.
  await pool.query(
   'INSERT INTO public.nex_whatsapp_sender_authorizations '+
   '(business_account_id,phone_number_id,sender_digest,family_id,scope,'+
   'consent_version,consent_at,consent_source,valid_until) '+
   "VALUES ($1,$2,$3,$4,'incoming_text','ci-e2e',clock_timestamp(),"+
   "'synthetic-ci',clock_timestamp()+interval '30 minutes')",
   [BUSINESS,PHONE,senderDigest,A]
  );
  await pool.query(
   'INSERT INTO public.nex_ci_inbox_read_keys(key_id,key_data,state) '+
   "VALUES ($1,$2,'active')",[signingKeyId,signingKey]);
  await pool.query(
   'INSERT INTO public.nex_ci_inbound_ingest_keys(key_id,key_data,state) '+
   "VALUES ($1,$2,'active')",[ingestKeyId,ingestSigningKey]);

  // Ingest is NOT run with the PostgreSQL admin: this connection can only
  // execute the signed security-definer function. It cannot read consents,
  // encrypted messages, keys or grant itself new permissions.
  ingestClient=await pool.connect();
  await ingestClient.query('SET ROLE nex_ci_inbound_ingest_runtime');
  const ingestPrivilege=await ingestClient.query(
   "SELECT has_table_privilege(current_user,'public.nex_whatsapp_inbound','INSERT') AS insert_direct,"+
   "has_table_privilege(current_user,'public.nex_whatsapp_sender_authorizations',"+
   "'SELECT') AS consent_direct,has_table_privilege(current_user,"+
   "'public.nex_ci_inbound_ingest_keys','SELECT') AS signing_key_direct"
  );
  assert.deepEqual(ingestPrivilege.rows[0],{
   insert_direct:false,consent_direct:false,signing_key_direct:false
  });
  const ingestCalls=[];
  const signedDb=createSignedInboundIngestAdapter({
   db:{async query(sql,values){
    ingestCalls.push({sql,values});
    return ingestClient.query(sql,values);
   }},
   getActiveSigningKey:async purpose=>{
    assert.equal(purpose,'whatsapp-inbound-ingest');
    return {purpose,state:'active',keyId:ingestKeyId,
     keyBase64:ingestSigningKey.toString('base64')};
   },
   senderHmacKey:senderKey.toString('base64'),
   contentEncryptionKey:encryptionKey.toString('base64')
  });
  const inbox=createDurableInbox({
   db:signedDb,senderHmacKey:senderKey.toString('base64'),
   contentEncryptionKey:encryptionKey.toString('base64')
  });
  const bridge=createMetaDurablePostBridge({
   enabled:true,appSecret:APP_SECRET,inbox
  });
  const raw=envelope(SENDER,MESSAGE,TEXT);
  assert.equal((await deliver(bridge,raw,{forgedSignature:true})).statusCode,403);
  assert.equal((await deliver(bridge,raw)).statusCode,200);
  assert.equal((await deliver(bridge,raw)).statusCode,200,'replay ACKs valid duplicate');
  assert.equal(ingestCalls.length,2);
  assert.equal(ingestCalls[0].sql,SIGNED_INSERT_SQL);
  // Replaying the exact signed SQL request must fail even with a privileged
  // signature that was valid for the first delivery.
  assert.equal((await ingestClient.query(
   SIGNED_INSERT_SQL,ingestCalls[0].values)).rows[0].state,'unlinked');

  // Bare DB role cannot forge a message merely by knowing a sender digest.
  const falseInsert=await ingestClient.query(SIGNED_INSERT_SQL,[
   BUSINESS,PHONE,senderDigest,'wamid.forbidden-unsigned',
   randomBytes(12),randomBytes(16),Buffer.from('ci-cipher'),
   String(Math.floor(Date.now()/1000)),ingestKeyId,
   Math.floor(Date.now()/1000)+25,
   'f0b16666-aaaa-4aaa-8aaa-777777777777',Buffer.alloc(32)
  ]);
  assert.equal(falseInsert.rows[0].state,'unlinked');

  const rows=await pool.query(
   'SELECT family_id,sender_digest,ciphertext FROM public.nex_whatsapp_inbound '+
   'WHERE business_account_id=$1 AND provider_message_id=$2',
   [BUSINESS,MESSAGE]
  );
  assert.equal(rows.rowCount,1);
  assert.equal(rows.rows[0].family_id,A);
  assert.deepEqual(rows.rows[0].sender_digest,senderDigest);
  assert.notEqual(rows.rows[0].ciphertext.toString('utf8'),TEXT);
  assert.equal(rows.rows[0].ciphertext.includes(Buffer.from(TEXT)),false);

  const outsider=await deliver(bridge,
   envelope(OUTSIDER,'wamid.node-sql-reader-unlinked','CI fictional outsider'));
  assert.equal(outsider.statusCode,503);
  assert.equal(outsider.body.status,'not_durably_processed');
  assert.equal((await pool.query(
   "SELECT COUNT(*)::integer AS n FROM public.nex_whatsapp_inbound "+
   "WHERE provider_message_id='wamid.node-sql-reader-unlinked'"
  )).rows[0].n,0);
  // Another VALID family consent is still not a valid duplicate: a Meta
  // message ID collision cannot overwrite/acknowledge family A's record.
  await pool.query(
   'INSERT INTO public.nex_whatsapp_sender_authorizations '+
   '(business_account_id,phone_number_id,sender_digest,family_id,scope,'+
   'consent_version,consent_at,consent_source,valid_until) '+
   "VALUES ($1,$2,$3,$4,'incoming_text','ci-e2e',clock_timestamp(),"+
   "'synthetic-ci',clock_timestamp()+interval '30 minutes')",
   [BUSINESS,PHONE,createHmac('sha256',senderKey).update(SECOND).digest(),B]
  );
  const collision=await deliver(bridge,envelope(SECOND,MESSAGE,'CI another family'));
  assert.equal(collision.statusCode,503);
  assert.equal((await pool.query(
   'SELECT family_id FROM public.nex_whatsapp_inbound WHERE provider_message_id=$1',
   [MESSAGE])).rows[0].family_id,A);

  // This separate connection executes ONLY with the restricted inbox role.
  readerClient=await pool.connect();
  await readerClient.query('SET ROLE nex_ci_inbox_reader_runtime');
  const privileges=await readerClient.query(
   "SELECT has_table_privilege(current_user,'public.nex_whatsapp_inbound','SELECT') "+
   "AS direct_read,has_table_privilege(current_user,'public.nex_ci_inbox_read_keys',"+
   "'SELECT') AS direct_key_read"
  );
  assert.deepEqual(privileges.rows[0],{
   direct_read:false,direct_key_read:false
  });

  const calls=[];
  let authorized=true;
  const identity=async()=>({
   authorizeFamily:async({familyId,action})=>
    authorized&&familyId===A&&action==='read_whatsapp_messages',
   getVerifiedPrincipal:async()=>authorized?
    {userId:'canonical-a',sessionId:'verified-ci-session-01'}:null
  });
  const inboxReader=createPilotFamilyInboxReader({
   db:{async query(sql,values){
    calls.push({sql,values});
    return readerClient.query(sql,values);
   }},
   bindVerifiedRequest:identity,
   contentEncryptionKey:encryptionKey.toString('base64'),
   getActiveSigningKey:async purpose=>{
    assert.equal(purpose,'whatsapp-inbox-read');
    return {purpose,state:'active',keyId:signingKeyId,
     keyBase64:signingKey.toString('base64')};
   }
  });
  const read=await inboxReader({familyId:A,limit:1});
  assert.equal(read.messages.length,1);
  assert.equal(read.messages[0].text,TEXT);
  assert.equal(Object.hasOwn(read.messages[0],'senderWaId'),false);
  assert.equal(Object.hasOwn(read.messages[0],'familyId'),false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].sql,READ_SQL);
  assert.equal(calls[0].values.length,9);
  assert.equal(calls[0].values.includes('verified-ci-session-01'),false);
  assert.equal(calls[0].values.includes(SENDER),false);

  // Direct replay reusing the exact signature, nonce and session digest
  // cannot retrieve a second copy of the ciphertext from PostgreSQL.
  const replay=await readerClient.query(READ_SQL,calls[0].values);
  assert.equal(replay.rowCount,0);
  const swapped=[...calls[0].values];
  swapped[1]=B;
  assert.equal((await readerClient.query(READ_SQL,swapped)).rowCount,0);

  // Even if the in-process signer has not noticed key rotation, PostgreSQL
  // must immediately reject a newly signed message under a revoked key.
  await pool.query(
   "UPDATE public.nex_ci_inbound_ingest_keys SET state='revoked' WHERE key_id=$1",
   [ingestKeyId]
  );
  const denied=await deliver(bridge,
   envelope(SENDER,'wamid.node-sql-reader-revoked','CI revoked signing key'));
  assert.equal(denied.statusCode,503);
  assert.equal((await pool.query(
   "SELECT COUNT(*)::integer AS n FROM public.nex_whatsapp_inbound "+
   "WHERE provider_message_id='wamid.node-sql-reader-revoked'"
  )).rows[0].n,0);

  authorized=false;
  await assert.rejects(inboxReader({familyId:A}),/membership/);
  assert.equal(calls.length,1,'revoked web family did not reach SQL');
 }finally{
  if(ingestClient){
   try{await ingestClient.query('RESET ROLE');}
   finally{ingestClient.release();}
  }
  if(readerClient){
   try{await readerClient.query('RESET ROLE');}
   finally{readerClient.release();}
  }
  await pool.end();
 }
});
