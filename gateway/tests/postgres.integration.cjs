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
const familyId2='22222222-3333-4444-8555-666666666666';
const recipient2='in-11111111111111111111111111111111@entrada.nexlupa.app';
const key='ab'.repeat(32);
const secret='whsec_'+Buffer.alloc(32,29).toString('base64');

async function setup(admin){
 // Mirror the real Neon RPC contract using synthetic data on disposable PG16.
 // No live family, consent record, alias or Resend message is created here.
 await admin.query(`
 CREATE SCHEMA nexlupa_worker_rpc;
 CREATE SCHEMA nexlupa_worker_test;
 CREATE SCHEMA nexlupa_pilot;
 CREATE ROLE gateway_ingest_ci LOGIN PASSWORD 'not-a-real-password';
 CREATE TABLE nexlupa_worker_test.families(
   family_id uuid PRIMARY KEY, alias text NOT NULL, status text NOT NULL
 );
 CREATE TABLE nexlupa_worker_test.inbound_aliases(
   alias_digest char(64) PRIMARY KEY, family_id uuid NOT NULL,
   status text NOT NULL DEFAULT 'active'
 );
 CREATE TABLE nexlupa_worker_test.source_consents(
   consent_id bigserial PRIMARY KEY, family_id uuid NOT NULL,
   source_kind text NOT NULL, permission_scope text NOT NULL,
   approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
   revoked_at timestamptz, version text NOT NULL
 );
 CREATE TABLE nexlupa_pilot.resend_inbox_queue(
   queue_id char(64) PRIMARY KEY,
   encrypted_envelope text NOT NULL,
   state text NOT NULL CHECK(state='received'),
   attempts int NOT NULL DEFAULT 0
 );
 CREATE FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(p_recipient text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO pg_catalog,nexlupa_worker_test AS $fn$
 SELECT a.family_id FROM nexlupa_worker_test.inbound_aliases a
 JOIN nexlupa_worker_test.families f ON f.family_id=a.family_id
 WHERE p_recipient IS NOT NULL
  AND length(p_recipient) BETWEEN 25 AND 110
  AND lower(btrim(p_recipient)) ~ '^[a-z0-9][a-z0-9._+-]{10,60}@entrada[.]nexlupa[.]app$'
  AND a.alias_digest=encode(sha256(convert_to(lower(btrim(p_recipient)),'UTF8')),'hex')
  AND a.status='active' AND f.status IN ('pilot','active')
  AND EXISTS (
    SELECT 1 FROM nexlupa_worker_test.source_consents c
    WHERE c.family_id=a.family_id
      AND c.source_kind='resend_forward'
      AND c.permission_scope='read_school_mail'
      AND c.approved_at <= now() AND c.expires_at > now()
      AND c.revoked_at IS NULL
  )
 LIMIT 1
 $fn$;
 REVOKE ALL ON SCHEMA nexlupa_worker_rpc FROM PUBLIC;
 REVOKE ALL ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)
   FROM PUBLIC;
 REVOKE ALL ON SCHEMA nexlupa_worker_test FROM PUBLIC;
 REVOKE ALL ON SCHEMA nexlupa_pilot FROM PUBLIC;
 GRANT USAGE ON SCHEMA nexlupa_worker_rpc TO gateway_ingest_ci;
 GRANT EXECUTE ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)
   TO gateway_ingest_ci;
 GRANT USAGE ON SCHEMA nexlupa_pilot TO gateway_ingest_ci;
 GRANT INSERT,SELECT ON nexlupa_pilot.resend_inbox_queue TO gateway_ingest_ci;
 `);
 await admin.query(
  'INSERT INTO nexlupa_worker_test.families(family_id,alias,status) VALUES($1,$2,$3)',
  [familyId,'entirely-synthetic-test-family','pilot']
 );
 await admin.query(
  'INSERT INTO nexlupa_worker_test.families(family_id,alias,status) VALUES($1,$2,$3)',
  [familyId2,'entirely-synthetic-other-family','pilot']
 );
 await admin.query(
  `INSERT INTO nexlupa_worker_test.inbound_aliases(alias_digest,family_id,status)
   VALUES(encode(sha256(convert_to(lower($1),'UTF8')),'hex'),$2,'active')`,
  [recipient,familyId]
 );
 await admin.query(
  `INSERT INTO nexlupa_worker_test.inbound_aliases(alias_digest,family_id,status)
   VALUES(encode(sha256(convert_to(lower($1),'UTF8')),'hex'),$2,'active')`,
  [recipient2,familyId2]
 );
 await admin.query(
  `INSERT INTO nexlupa_worker_test.source_consents
   (family_id,source_kind,permission_scope,approved_at,expires_at,version)
   VALUES($1,'resend_forward','read_school_mail',now()-interval '1 day',
   now()+interval '1 day','synthetic-test-only')`,
  [familyId]
 );
 await admin.query(
  `INSERT INTO nexlupa_worker_test.source_consents
   (family_id,source_kind,permission_scope,approved_at,expires_at,version)
   VALUES($1,'resend_forward','read_school_mail',now()-interval '1 day',
   now()+interval '1 day','synthetic-test-only')`,
  [familyId2]
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
   restricted.query('SELECT * FROM nexlupa_worker_test.families'),
   /permission denied/
  );
  await assert.rejects(
   restricted.query('SELECT * FROM nexlupa_worker_test.source_consents'),
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
   await t.test('real-shaped consent fixtures reject wrong scope, expiry, family and alias status',async()=>{
    // Each case is a signed HTTP delivery but must not create a receipt.
    const cases=[
      {
       off:"UPDATE nexlupa_worker_test.source_consents SET permission_scope='read_calendar' WHERE family_id=$1",
       on:"UPDATE nexlupa_worker_test.source_consents SET permission_scope='read_school_mail' WHERE family_id=$1",
       id:'e21b31b7-d82b-48af-8a5f-749ec74262c3'
      },
      {
       off:"UPDATE nexlupa_worker_test.source_consents SET expires_at=now()-interval '1 minute' WHERE family_id=$1",
       on:"UPDATE nexlupa_worker_test.source_consents SET expires_at=now()+interval '1 day' WHERE family_id=$1",
       id:'f21b31b7-d82b-48af-8a5f-749ec74262c3'
      },
      {
       off:"UPDATE nexlupa_worker_test.families SET status='suspended' WHERE family_id=$1",
       on:"UPDATE nexlupa_worker_test.families SET status='pilot' WHERE family_id=$1",
       id:'a31b31b7-d82b-48af-8a5f-749ec74262c3'
      },
      {
       off:"UPDATE nexlupa_worker_test.inbound_aliases SET status='revoked' WHERE family_id=$1",
       on:"UPDATE nexlupa_worker_test.inbound_aliases SET status='active' WHERE family_id=$1",
       id:'b31b31b7-d82b-48af-8a5f-749ec74262c3'
      }
    ];
    for(const scenario of cases){
      await admin.query(scenario.off,[familyId]);
      try{
        const result=await post(payload(scenario.id));
        assert.equal(result.status,204);
        assert.equal((await restricted.query(
          'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
        )).rows[0].n,1);
      }finally{
        await admin.query(scenario.on,[familyId]);
      }
    }
   });
   await t.test('in-flight signed delivery fails closed when consent is revoked before the durable insert',async()=>{
    // The first two lookups may approve a delivery just before the family
    // revokes access. The actual INSERT must check current consent again.
    let reachedInsert,releaseInsert;
    const paused=new Promise(resolve=>{reachedInsert=resolve;});
    const resume=new Promise(resolve=>{releaseInsert=resolve;});
    const gatedHandler=makeHttpHandler({
     config:{vercelEnv:'preview',gitRef:ALLOWED_BRANCH,
      enabled:'true',configured:true,webhookSecret:secret},
     createAdapters:async()=>({
      resolveAuthorizedRecipient:adapters.resolveAuthorizedRecipient,
      enqueueReceipt:async receipt=>{
       reachedInsert();
       await resume;
       return adapters.enqueueReceipt(receipt);
      }
     })
    });
    await serve(gatedHandler,async base=>{
     const item=payload('d21b31b7-d82b-48af-8a5f-749ec74262c3');
     const pending=fetch(base+'/api/webhook',{
      method:'POST',headers:item.headers,body:item.raw
     });
     try{
      await paused; // Both authorization checks passed, no INSERT yet.
      await admin.query(
       'UPDATE nexlupa_worker_test.source_consents SET revoked_at=now() WHERE family_id=$1',
       [familyId]
      ); // Revocation is COMMITTED before permitting the INSERT.
     }finally{
      releaseInsert();
     }
     const result=await pending;
     assert.equal(result.status,204);
     assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
     )).rows[0].n,1); // Only the original, pre-revocation receipt.
    });
   });
   await t.test('revoked consent blocks subsequent signed delivery',async()=>{
    await admin.query(
      'UPDATE nexlupa_worker_test.source_consents SET revoked_at=now() WHERE family_id=$1',
      [familyId]
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
   await t.test('two synthetic families remain isolated even with the same provider email ID',async()=>{
    // Family A's consent was revoked in the preceding tests. Family B is
    // independently approved and must not inherit A's authorization outcome.
    assert.equal(await adapters.resolveAuthorizedRecipient(recipient),null);
    const other=await adapters.resolveAuthorizedRecipient(recipient2);
    assert.equal(other?.familyId,familyId2);
    const baseEvent=payload('a21b31b7-d82b-48af-8a5f-749ec74262c3');
    const changed=JSON.parse(baseEvent.raw);
    changed.data.to=[recipient2];
    const raw=JSON.stringify(changed);
    const stamp=baseEvent.headers['svix-timestamp'];
    const id=baseEvent.headers['svix-id'];
    const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
      .update(id+'.'+stamp+'.'+raw).digest('base64');
    const delivery={raw,headers:{
      ...baseEvent.headers,'svix-signature':'v1,'+signature
    }};
    const first=await post(delivery);
    assert.equal(first.status,204);
    const rows=(await restricted.query(
      'SELECT queue_id,encrypted_envelope FROM nexlupa_pilot.resend_inbox_queue'
    )).rows;
    assert.equal(rows.length,2);
    const decoded=rows.map(row=>decryptReceiptEnvelope({
      receiptKey:row.queue_id.trim(),
      encryptedEnvelope:row.encrypted_envelope,encryptionKeyHex:key
    }));
    assert.equal(decoded.filter(row=>row.familyId===familyId).length,1);
    assert.equal(decoded.filter(row=>row.familyId===familyId2).length,1);
    const a=decoded.find(row=>row.familyId===familyId);
    const b=decoded.find(row=>row.familyId===familyId2);
    assert.notEqual(a.receiptKey,b.receiptKey);
    assert.equal(a.emailId,b.emailId); // Same ID, different tenant and alias.
    assert.equal(a.recipient,recipient);
    assert.equal(b.recipient,recipient2);
    assert.equal((await post(delivery)).status,204);
    assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
    )).rows[0].n,2); // Idempotent per recipient and provider ID.
    await admin.query(
      'UPDATE nexlupa_worker_test.source_consents SET revoked_at=now() WHERE family_id=$1',
      [familyId2]
    );
    const newEvent=payload('c41b31b7-d82b-48af-8a5f-749ec74262c3');
    const second=JSON.parse(newEvent.raw);
    second.data.to=[recipient2];
    const secondRaw=JSON.stringify(second);
    const secondSig=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
      .update(newEvent.headers['svix-id']+'.'+newEvent.headers['svix-timestamp']+'.'+secondRaw)
      .digest('base64');
    const blocked=await post({raw:secondRaw,headers:{
      ...newEvent.headers,'svix-signature':'v1,'+secondSig
    }});
    assert.equal(blocked.status,204);
    assert.equal((await restricted.query(
      'SELECT count(*)::int AS n FROM nexlupa_pilot.resend_inbox_queue'
    )).rows[0].n,2);
   });
  });
 }finally{
  await Promise.allSettled([restricted.end(),admin.end()]);
 }
});
