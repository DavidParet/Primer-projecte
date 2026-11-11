'use strict';
/**
 * PostgreSQL 16 disposable end-to-end tests for the EXACT standalone gateway
 * modules that will be bundled by Vercel. No real Neon, Resend, Gmail or user
 * emails; all credentials and subjects are synthetic.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {createServer}=require('node:http');
const {once}=require('node:events');
const {Pool}=require('pg');
const {makeHttpHandler,ALLOWED_BRANCH}=require('../lib/http-handler.cjs');
const {createNeonReceiptAdapters,decryptReceiptEnvelope}=
  require('../lib/neon-receipt.cjs');

const pgUrl=process.env.GATEWAY_CI_PG_URL;
if(!pgUrl)throw Error('disposable_postgres_service_required');

const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const familyId='11111111-2222-4333-8444-555555555555';
const key='ab'.repeat(32);
const secret='whsec_'+Buffer.alloc(32,29).toString('base64');

async function setup(admin){
 await admin.query(`
 CREATE SCHEMA nexlupa_worker_rpc;
 CREATE SCHEMA nexlupa_pilot;
 CREATE ROLE gateway_ingest_ci LOGIN PASSWORD 'not-a-real-password';
 CREATE TABLE nexlupa_worker_rpc.synthetic_aliases(
   recipient text PRIMARY KEY,family_id uuid NOT NULL,
   authorized boolean NOT NULL DEFAULT true
 );
 CREATE TABLE nexlupa_pilot.resend_inbox_queue(
   queue_id char(64) PRIMARY KEY,
   encrypted_envelope text NOT NULL,
   state text NOT NULL CHECK(state='received'),
   attempts int NOT NULL DEFAULT 0
 );
 CREATE FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(alias text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,nexlupa_worker_rpc AS $fn$
  SELECT family_id FROM nexlupa_worker_rpc.synthetic_aliases
  WHERE recipient=alias AND authorized=true LIMIT 1
 $fn$;
 REVOKE ALL ON SCHEMA nexlupa_worker_rpc FROM PUBLIC;
 REVOKE ALL ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)
   FROM PUBLIC;
 REVOKE ALL ON SCHEMA nexlupa_pilot FROM PUBLIC;
 GRANT USAGE ON SCHEMA nexlupa_worker_rpc TO gateway_ingest_ci;
 GRANT EXECUTE ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)
   TO gateway_ingest_ci;
 GRANT USAGE ON SCHEMA nexlupa_pilot TO gateway_ingest_ci;
 GRANT INSERT,SELECT ON nexlupa_pilot.resend_inbox_queue TO gateway_ingest_ci;
 `);
 await admin.query(
  'INSERT INTO nexlupa_worker_rpc.synthetic_aliases(recipient,family_id,authorized) VALUES($1,$2,true)',
  [recipient,familyId]
 );
}
function payload(emailId){
 const raw=JSON.stringify({
  type:'email.received',
  data:{
   email_id:emailId,from:'Fictional Teacher <sender@example.invalid>',
   to:[recipient],subject:'Synthetic field trip notice',attachments:[]
  }
 });
 const timestamp=String(Math.floor(Date.now()/1000)),id='msg_synthetic_'+emailId.replaceAll('-','');
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
  .update(id+'.'+timestamp+'.'+raw).digest('base64');
 return {raw,headers:{
  'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature,
  'content-type':'application/json'
 }};
}
async function serve(handler,callback){
 const server=createServer((req,res)=>{
  Promise.resolve(handler(req,res)).catch(()=>{
    res.statusCode=503;res.end();
  });
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 try{return await callback('http://127.0.0.1:'+server.address().port);}
 finally{
  await new Promise((resolve,reject)=>
   server.close(err=>err?reject(err):resolve())
  );
 }
}

test('standalone gateway: signed HTTP, concurrent dedup, revocation and no family table access',async t=>{
 const admin=new Pool({connectionString:pgUrl,max:2});
 const roleUrl=new URL(pgUrl);
 roleUrl.username='gateway_ingest_ci';
 roleUrl.password='not-a-real-password';
 const restricted=new Pool({connectionString:roleUrl.toString(),max:14,
  connectionTimeoutMillis:5000});
 try{
  await setup(admin);
  assert.equal((await restricted.query('SELECT current_user AS who')).rows[0].who,
    'gateway_ingest_ci');
  await assert.rejects(
   restricted.query('SELECT * FROM nexlupa_worker_rpc.synthetic_aliases'),
   /permission denied/
  );
  const adapters=createNeonReceiptAdapters({
   query:(sql,values)=>restricted.query(sql,values),
   encryptionKeyHex:key
  });
  const handler=makeHttpHandler({
   config:{
    vercelEnv:'preview',gitRef:ALLOWED_BRANCH,
    enabled:'true',configured:true,webhookSecret:secret
   },
   createAdapters:async()=>adapters
  });
  await serve(handler,async base=>{
   const endpoint=base+'/api/webhook';
   const first=payload('a21b31b7-d82b-48af-8a5f-749ec74262c3');
   const post=(message)=>fetch(endpoint,{
    method:'POST',headers:message.headers,body:message.raw
   });
   await t.test('12 concurrent signed HTTP deliveries persist one encrypted receipt',async()=>{
    const responses=await Promise.all(Array.from({length:12},()=>post(first)));
    assert.equal(responses.length,12);
    assert.ok(responses.every(r=>r.status===204));
    const rows=(await restricted.query(
      'SELECT queue_id,encrypted_envelope FROM nexlupa_pilot.resend_inbox_queue'
    )).rows;
    assert.equal(rows.length,1);
    const id=rows[0].queue_id.trim();
    assert.equal(id.length,64);
    const decoded=decryptReceiptEnvelope({
      receiptKey:id,encryptedEnvelope:rows[0].encrypted_envelope,encryptionKeyHex:key
    });
    assert.equal(decoded.familyId,familyId);
    assert.equal(decoded.emailId,'a21b31b7-d82b-48af-8a5f-749ec74262c3');
    assert.equal(decoded.recipient,recipient);
    assert.equal(decoded.kind,'resend_metadata_receipt');
    assert.doesNotMatch(rows[0].encrypted_envelope,/Fictional|field trip|Teacher/);
   });
   await t.test('forged signature returns 400 without a database insertion',async()=>{
    const forged={...first,headers:{...first.headers,
      'svix-signature':'v1,'+Buffer.alloc(32).toString('base64')}};
    const result=await post(forged);
    assert.equal(result.status,400);
    assert.deepEqual(await result.json(),{error:'invalid_webhook'});
    assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
    )).rows[0].n,1);
   });
   await t.test('revoked consent blocks subsequent signed delivery',async()=>{
    await admin.query(
      'UPDATE nexlupa_worker_rpc.synthetic_aliases SET authorized=false WHERE recipient=$1',
      [recipient]
    );
    const result=await post(payload('b21b31b7-d82b-48af-8a5f-749ec74262c3'));
    assert.equal(result.status,204);
    assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
    )).rows[0].n,1);
   });
   await t.test('unknown recipient produces no family access or receipt',async()=>{
    const unknown=payload('c21b31b7-d82b-48af-8a5f-749ec74262c3');
    const changed=JSON.parse(unknown.raw);
    changed.data.to=['in-ffffffffffffffffffffffffffffffff@entrada.nexlupa.app'];
    const raw=JSON.stringify(changed);
    const tstamp=unknown.headers['svix-timestamp'];
    const id=unknown.headers['svix-id'];
    const sig=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
     .update(id+'.'+tstamp+'.'+raw).digest('base64');
    const response=await post({raw,headers:{
     ...unknown.headers,'svix-signature':'v1,'+sig
    }});
    assert.equal(response.status,204);
    assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
    )).rows[0].n,1);
   });
  });
 }finally{
  await Promise.allSettled([restricted.end(),admin.end()]);
 }
});
