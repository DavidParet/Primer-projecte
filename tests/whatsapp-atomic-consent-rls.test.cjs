'use strict';
// CI-only security regression: prove default-deny RLS for the NEW evidence
// ledgers with a non-owner, non-BYPASSRLS PostgreSQL role. No Neon changes.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {Pool}=require('pg');
const dbUrl=process.env.WHATSAPP_TEST_DATABASE_URL;

test('PG16 restricted role cannot see or insert evidence despite table grants',{
 skip:!dbUrl,timeout:25000
},async()=>{
 const pool=new Pool({connectionString:dbUrl,max:3,connectionTimeoutMillis:5000,
  statement_timeout:10000});
 const family='a0000000-0000-4000-8000-000000000711';
 const business='9277711111',phone='8177711111';
 const digest=randomBytes(32),sender=randomBytes(32);
 const role='nex_ci_atomic_read_probe';
 let client,created=false;
 try{
  await pool.query(readFileSync(join(__dirname,
   '../db/migrations/20261110_whatsapp_atomic_pairing_evidence_staged.sql'),'utf8'));
  await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
   '(proof_digest,family_id,business_account_id,phone_number_id,'+
   'sender_digest,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'+
   "clock_timestamp(),clock_timestamp()+interval '10 minutes')",
   [digest,family,business,phone,sender]);
  await pool.query('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
  created=true;
  await pool.query('GRANT USAGE ON SCHEMA public TO '+role);
  await pool.query('GRANT SELECT,INSERT ON '+
   'public.nex_whatsapp_verified_phone_proofs,'+
   'public.nex_whatsapp_explicit_receipt_proofs TO '+role);
  client=await pool.connect();
  try{
   await client.query('SET ROLE '+role);
   for(const table of ['nex_whatsapp_verified_phone_proofs',
       'nex_whatsapp_explicit_receipt_proofs']){
    const r=await client.query('SELECT COUNT(*)::int AS n FROM public.'+table);
    assert.equal(r.rows[0].n,0,
      'RLS must hide all evidence rows from a nonprivileged role');
   }
   await assert.rejects(client.query(
    'INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
    '(proof_digest,family_id,business_account_id,phone_number_id,'+
    'sender_digest,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'+
    "clock_timestamp(),clock_timestamp()+interval '10 minutes')",
    [randomBytes(32),family,business,phone,randomBytes(32)]),
    e=>e.code==='42501');
   await assert.rejects(client.query(
    'SELECT COUNT(*) FROM public.nex_whatsapp_sender_authorizations'),
    e=>e.code==='42501');
  }finally{
   await client.query('RESET ROLE');client.release();client=null;
  }
 }finally{
  if(client){await client.query('RESET ROLE');client.release();}
  if(created){
   await pool.query('REVOKE ALL ON '+
     'public.nex_whatsapp_verified_phone_proofs,'+
     'public.nex_whatsapp_explicit_receipt_proofs FROM '+role);
   await pool.query('REVOKE USAGE ON SCHEMA public FROM '+role);
   await pool.query('DROP ROLE '+role);
  }
  await pool.query('DELETE FROM public.nex_whatsapp_verified_phone_proofs '+
    'WHERE business_account_id=$1',[business]);
  await pool.end();
 }
});
