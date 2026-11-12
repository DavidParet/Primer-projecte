'use strict';

/**
 * E2E maintenance with a real restricted PostgreSQL LOGIN on ephemeral
 * GitHub Actions Postgres 17. It NEVER contacts Neon or real message data.
 * Runs only after the CI-only RLS nonce policy is installed.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Client,Pool}=require('pg');
const {runSignedInboxNonceRetention}=
 require('../lib/whatsapp/signed-inbox-nonce-retention');

const url=process.env.WHATSAPP_TEST_DATABASE_URL;
const ing='public.nex_ci_inbound_ingest_nonces';
const read='public.nex_ci_inbox_read_nonces';
const old=['cccc0000-cccc-4ccc-8ccc-000000000001',
 'cccc0000-cccc-4ccc-8ccc-000000000002'];
const recent=['cccc0000-cccc-4ccc-8ccc-000000000003',
 'cccc0000-cccc-4ccc-8ccc-000000000004'];
const oldRead=['dddd0000-dddd-4ddd-8ddd-000000000001',
 'dddd0000-dddd-4ddd-8ddd-000000000002'];
const recentRead=['dddd0000-dddd-4ddd-8ddd-000000000003',
 'dddd0000-dddd-4ddd-8ddd-000000000004'];

test('real low-privilege maintenance login deletes only aged nonce rows',{
 skip:!url,timeout:35000
},async()=>{
 const admin=new Pool({connectionString:url,connectionTimeoutMillis:5000});
 const role='nex_ci_nonce_maintenance_e2e_login';
 const pass=randomBytes(24).toString('hex');
 let cleaner;
 try{
  await admin.query(
   'CREATE ROLE '+role+' LOGIN INHERIT NOSUPERUSER NOBYPASSRLS '+
   "NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+pass+"'"
  );
  await admin.query('GRANT nex_ci_inbox_nonce_maintenance TO '+role+
   ' WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
  // No usernames, family identifiers, phone numbers or actual ciphertext.
  for(const [table,expired,fresh] of [
   [ing,old,recent],[read,oldRead,recentRead]
  ]){
   for(let i=0;i<2;i++)
    await admin.query('INSERT INTO '+table+
     '(nonce,expires_at) VALUES ($1,clock_timestamp()-interval \u002715 minutes\u0027)',
     [expired[i]]);
   await admin.query('INSERT INTO '+table+
    '(nonce,expires_at) VALUES ($1,clock_timestamp()-interval \u00271 minute\u0027)',
    [fresh[0]]);
   await admin.query('INSERT INTO '+table+
    '(nonce,expires_at) VALUES ($1,clock_timestamp()+interval \u00271 minute\u0027)',
    [fresh[1]]);
  }
  const u=new URL(url);
  const auth={
   host:u.hostname,port:Number(u.port||5432),user:role,password:pass,
   database:decodeURIComponent(u.pathname.slice(1)),
   connectionTimeoutMillis:5000
  };
  cleaner=new Client(auth);
  await cleaner.connect();
  const who=await cleaner.query('SELECT current_user,session_user');
  assert.deepEqual(who.rows[0],{current_user:role,session_user:role});
  await assert.rejects(cleaner.query('SET ROLE postgres'),e=>e.code==='42501');
  await assert.rejects(cleaner.query(
   'SELECT 1 FROM public.nex_ci_inbound_ingest_keys LIMIT 1'
  ),e=>e.code==='42501');
  await assert.rejects(cleaner.query(
   'SELECT 1 FROM public.nex_whatsapp_inbound LIMIT 1'
  ),e=>e.code==='42501');

  // A dedicated pool returns the already logged-in client. The trusted
  // worker is disabled by default and explicitly enabled only in this test.
  // Do not call client.end until the maintenance transaction finishes.
  const reports=[];
  const result=await runSignedInboxNonceRetention({
   enabled:true,batchSize:100,maxBatches:2,
   createDatabase:async()=>({
    connect:async()=>({
     query:(sql,params)=>cleaner.query(sql,params),
     release(){}
    }),
    end:async()=>{}
   }),
   report:async x=>reports.push(x)
  });
  assert.equal(result.status,'completed');
  assert.equal(result.mayHaveMore,false);
  assert.ok(result.ingestDeleted>=2);
  assert.ok(result.inboxDeleted>=2);
  assert.deepEqual(reports,[result]);

  for(const [table,expired,fresh] of [
   [ing,old,recent],[read,oldRead,recentRead]
  ]){
   const a=await admin.query(
    'SELECT count(*)::integer AS n FROM '+table+
    ' WHERE nonce=ANY($1::uuid[])',[expired]);
   const b=await admin.query(
    'SELECT count(*)::integer AS n FROM '+table+
    ' WHERE nonce=ANY($1::uuid[])',[fresh]);
   assert.equal(a.rows[0].n,0,'expired nonce remains');
   assert.equal(b.rows[0].n,2,'fresh or grace nonce was lost');
  }
 }finally{
  if(cleaner)await cleaner.end();
  await admin.end();
 }
});
