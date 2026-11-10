'use strict';
// Disposable PostgreSQL 16 ONLY. Tests SECURITY DEFINER + no BYPASSRLS
// with unsigned, replayed, cross-family and rolled-back synthetic inputs.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {Pool}=require('pg');
const {createSignedAtomicConsentClient}=
 require('../lib/whatsapp/signed-atomic-consent-client');

const dbUrl=process.env.WHATSAPP_TEST_DATABASE_URL;
const ROLE='nex_ci_atomic_activation_runtime';
const FN='public.nex_ci_signed_activate_atomic_consent';
const KEY_ID='synthetic-activation-key';
const VERSION='ci-signed-1';
const USER='synthetic-admin';
const A='a0000000-0000-4000-8000-000000000911';
const B='b0000000-0000-4000-8000-000000000922';
const BIZ='9988771122',PHONE='8877661122';
const key=randomBytes(32);
const SQL=`SELECT ${FN}(
 $1,$2::uuid,$3,$4,$5::bytea,$6::bytea,$7,$8,$9::bigint,$10::uuid,$11::bytea
) AS result`;

function permit({user=USER,family=A,proof,receipt,
  business=BIZ,phone=PHONE,nonce=randomUUID(),
  expires=Math.floor(Date.now()/1000)+45,signature}){
 const payload=['NEXLUPA-ATOMIC-ACTIVATE-1',KEY_ID,user,family,
   business,phone,proof.toString('hex'),receipt.toString('hex'),
   VERSION,String(expires),nonce].join('|');
 const signed=signature||createHmac('sha256',key).update(payload).digest();
 return [user,family,business,phone,proof,receipt,VERSION,KEY_ID,expires,nonce,signed];
}
function makeIds(suffix){
 return {proof:randomBytes(32),receipt:randomBytes(32),
  sender:randomBytes(32),suffix};
}
async function seed(pool,ids,{family=A,sender=ids.sender}={}){
 await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
  '(proof_digest,family_id,business_account_id,phone_number_id,sender_digest,'+
  "verified_at,expires_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp(),"+
  "clock_timestamp()+interval '10 minutes')",
  [ids.proof,family,BIZ,PHONE,sender]);
 await pool.query('INSERT INTO public.nex_whatsapp_explicit_receipt_proofs '+
  '(receipt_digest,proof_digest,family_id,business_account_id,phone_number_id,'+
  'sender_digest,scope,consent_version,source,accepted_at,expires_at) '+
  "VALUES($1,$2,$3,$4,$5,$6,'incoming_text','ci-signed-1',"+
  "'account-web-consent',clock_timestamp(),clock_timestamp()+interval '10 minutes')",
  [ids.receipt,ids.proof,family,BIZ,PHONE,sender]);
}
async function rows(pool,ids){
 const c=await pool.query('SELECT COUNT(*)::int AS n FROM '+
  'public.nex_whatsapp_sender_authorizations WHERE business_account_id=$1 '+
  'AND consent_receipt_digest=$2',[BIZ,ids.receipt]);
 const p=await pool.query('SELECT consumed_at FROM '+
  'public.nex_whatsapp_verified_phone_proofs WHERE proof_digest=$1',[ids.proof]);
 const r=await pool.query('SELECT consumed_at FROM '+
  'public.nex_whatsapp_explicit_receipt_proofs WHERE receipt_digest=$1',[ids.receipt]);
 return {count:c.rows[0].n,proofUsed:!!p.rows[0]?.consumed_at,
  receiptUsed:!!r.rows[0]?.consumed_at};
}
test('signed limited-role activation: deny direct access, verify signatures, one-use and atomic rollback',{
 skip:!dbUrl,timeout:60000
},async()=>{
 const pool=new Pool({connectionString:dbUrl,max:8,
  connectionTimeoutMillis:6000,statement_timeout:10000});
 let runtime1,runtime2;
 try{
  for(const migration of [
   '20261108_whatsapp_durable_inbox.sql',
   '20261109_whatsapp_explicit_consent_receipt.sql',
   '20261110_whatsapp_atomic_pairing_evidence_staged.sql',
   '20261111_whatsapp_signed_atomic_activation_ci.sql'
  ])await pool.query(readFileSync(join(__dirname,'../db/migrations',migration),'utf8'));
  await pool.query('INSERT INTO public.nex_ci_atomic_activation_keys '+
   '(key_id,key_data,state) VALUES($1,$2,$3)',[KEY_ID,key,'active']);
  await pool.query('INSERT INTO public.nex_ci_atomic_membership_fixture '+
    '(user_id,family_id,role,active) VALUES($1,$2,$3,true)',[USER,A,'admin']);

  runtime1=await pool.connect();
  await runtime1.query('SET ROLE '+ROLE);
  assert.equal((await runtime1.query('SELECT CURRENT_USER AS role')).rows[0].role,ROLE);
  for(const table of [
   'nex_whatsapp_verified_phone_proofs',
   'nex_whatsapp_explicit_receipt_proofs',
   'nex_ci_atomic_activation_keys','nex_ci_atomic_membership_fixture',
   'nex_whatsapp_sender_authorizations',
   'nex_ci_atomic_activation_nonces']){
   await assert.rejects(runtime1.query('SELECT * FROM public.'+table+' LIMIT 1'),
    e=>e.code==='42501','runtime SELECT must be denied: '+table);
  }
  await assert.rejects(runtime1.query(
    'UPDATE public.nex_whatsapp_verified_phone_proofs '+
    'SET consumed_at=clock_timestamp()'),e=>e.code==='42501');

  const signed=makeIds('good');
  await seed(pool,signed);
  const forged=permit({...signed,signature:Buffer.alloc(32)});
  assert.deepEqual((await runtime1.query(SQL,forged)).rows[0].result,{state:'rejected'});
  assert.deepEqual(await rows(pool,signed),{count:0,proofUsed:false,receiptUsed:false});
  const foreign=permit({...signed,family:B});
  assert.deepEqual((await runtime1.query(SQL,foreign)).rows[0].result,{state:'rejected'});
  assert.deepEqual(await rows(pool,signed),{count:0,proofUsed:false,receiptUsed:false});

  const good=permit(signed);
  assert.deepEqual((await runtime1.query(SQL,good)).rows[0].result,{state:'enrolled'});
  assert.deepEqual(await rows(pool,signed),{count:1,proofUsed:true,receiptUsed:true});
  assert.deepEqual((await runtime1.query(SQL,good)).rows[0].result,{state:'rejected'});
  const nonces=await pool.query('SELECT COUNT(*)::int AS n FROM '+
   'public.nex_ci_atomic_activation_nonces WHERE nonce=$1',[good[9]]);
  assert.equal(nonces.rows[0].n,1);

  // Same sender, second fresh receipt: unique active sender guard rejects
  // without consuming the second pair of proofs.
  const duplicate=makeIds('dupe');
  await seed(pool,duplicate,{sender:signed.sender});
  assert.deepEqual((await runtime1.query(SQL,permit(duplicate))).rows[0].result,
   {state:'rejected'});
  assert.deepEqual(await rows(pool,duplicate),
   {count:0,proofUsed:false,receiptUsed:false});

  // Fault AFTER auth INSERT: a trigger rejects receipt consumption, and
  // PostgreSQL must automatically undo INSERT, nonce and proof update.
  const fail=makeIds('rollback');
  await seed(pool,fail);
  await pool.query(`
CREATE FUNCTION public.nex_ci_atomic_fail_on_receipt() RETURNS trigger
LANGUAGE plpgsql AS $f$BEGIN
 RAISE EXCEPTION 'CI receipt consumption error';
END;$f$;
CREATE TRIGGER nex_ci_atomic_force_failure BEFORE UPDATE OF consumed_at
ON public.nex_whatsapp_explicit_receipt_proofs FOR EACH ROW
EXECUTE FUNCTION public.nex_ci_atomic_fail_on_receipt();
`);
  const broken=permit(fail);
  await assert.rejects(runtime1.query(SQL,broken),/CI receipt consumption error/);
  assert.deepEqual(await rows(pool,fail),{count:0,proofUsed:false,receiptUsed:false});
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM '+
   'public.nex_ci_atomic_activation_nonces WHERE nonce=$1',[broken[9]])).rows[0].n,0);
  await pool.query('DROP TRIGGER nex_ci_atomic_force_failure ON '+
   'public.nex_whatsapp_explicit_receipt_proofs');
  await pool.query('DROP FUNCTION public.nex_ci_atomic_fail_on_receipt()');
  assert.deepEqual((await runtime1.query(SQL,broken)).rows[0].result,{state:'enrolled'});
  assert.deepEqual(await rows(pool,fail),{count:1,proofUsed:true,receiptUsed:true});

  // Two separate restricted SQL connections racing for one proof.
  const concurrent=makeIds('race');
  await seed(pool,concurrent);
  runtime2=await pool.connect();await runtime2.query('SET ROLE '+ROLE);
  const responses=await Promise.all([
   runtime1.query(SQL,permit(concurrent)),
   runtime2.query(SQL,permit(concurrent))
  ]);
  assert.deepEqual(responses.map(x=>x.rows[0].result.state).sort(),
   ['enrolled','rejected']);
  assert.deepEqual(await rows(pool,concurrent),{count:1,proofUsed:true,receiptUsed:true});

  // Complete JS -> restricted SQL integration on the same actual PG16 role.
  const challengeId='ci_verified_phone_proof_20261111';
  const receiptId='ci_explicit_web_receipt_20261111';
  const proofKey=randomBytes(32),receiptKey=randomBytes(32);
  const full={
   proof:createHmac('sha256',proofKey)
    .update('nexlupa:phone-proof:v1:').update(challengeId).digest(),
   receipt:createHmac('sha256',receiptKey)
    .update('nexlupa:consent-receipt:v1:').update(receiptId).digest(),
   sender:randomBytes(32)
  };
  await seed(pool,full);
  const signedClient=createSignedAtomicConsentClient({
   db:{connect:async()=>({query:(sql,args)=>runtime1.query(sql,args),
      release(){/* runtime1 remains dedicated to this synthetic suite */}})},
   proofHmacKey:proofKey.toString('base64'),
   receiptHmacKey:receiptKey.toString('base64'),
   consentVersion:VERSION,
   bindVerifiedRequest:async()=>({
    authorizeFamily:async({familyId,action})=>
      familyId===A&&action==='enroll_whatsapp_sender',
    getVerifiedPrincipal:async()=>({
      userId:USER,sessionId:'synthetic-verified-session'
    })
   }),
   getActiveSigningKey:async purpose=>({
    purpose,state:'active',keyId:KEY_ID,keyBase64:key.toString('base64')
   })
  });
  const fullRequest={familyId:A,businessAccountId:BIZ,phoneNumberId:PHONE,
    challengeId,consentReceiptId:receiptId};
  assert.deepEqual(await signedClient(fullRequest),{state:'enrolled'});
  assert.deepEqual(await rows(pool,full),
    {count:1,proofUsed:true,receiptUsed:true});
  assert.deepEqual(await signedClient(fullRequest),{state:'rejected'});

  // A still-valid signed permit never overrides a removed administrator.
  const member=makeIds('removed-membership');
  await seed(pool,member);
  await pool.query("UPDATE public.nex_ci_atomic_membership_fixture SET role='member' "+
   'WHERE user_id=$1 AND family_id=$2',[USER,A]);
  assert.deepEqual((await runtime1.query(SQL,permit(member))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,member),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query("UPDATE public.nex_ci_atomic_membership_fixture SET role='admin' "+
    'WHERE user_id=$1 AND family_id=$2',[USER,A]);

  // Disabling the sole signing key must reject even otherwise valid evidence.
  const revoked=makeIds('revoked');
  await seed(pool,revoked);
  await pool.query("UPDATE public.nex_ci_atomic_activation_keys SET state='revoked' "+
   'WHERE key_id=$1',[KEY_ID]);
  assert.deepEqual((await runtime1.query(SQL,permit(revoked))).rows[0].result,
   {state:'rejected'});
  assert.deepEqual(await rows(pool,revoked),
   {count:0,proofUsed:false,receiptUsed:false});
 }finally{
  if(runtime2){await runtime2.query('RESET ROLE');runtime2.release();}
  if(runtime1){await runtime1.query('RESET ROLE');runtime1.release();}
  await pool.end();
 }
});
