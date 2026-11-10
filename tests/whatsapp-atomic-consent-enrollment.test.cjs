'use strict';
// Integration tests against EPHEMERAL PostgreSQL 16, with synthetic evidence.
// Never seed real Meta, family or contact data. No live IdP is simulated here.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {Pool}=require('pg');
const {
 createAtomicConsentEnrollment,CONSUME_RECEIPT_SQL
}=require('../lib/whatsapp/atomic-consent-enrollment');

const connectionString=process.env.WHATSAPP_TEST_DATABASE_URL;
const BUSINESS='9277700011', PHONE='8177700011';
const FAMILY_A='a0000000-0000-4000-8000-000000000311';
const FAMILY_B='b0000000-0000-4000-8000-000000000322';
const VERSION='ci-explicit-v1';
const pairKey=randomBytes(32);
const receiptKey=randomBytes(32);
const keyA=pairKey.toString('base64');
const keyB=receiptKey.toString('base64');

function hash(key,domain,id) {
 return createHmac('sha256',key).update(domain).update(id).digest();
}
function proofDigest(id){return hash(pairKey,'nexlupa:phone-proof:v1:',id);}
function receiptDigest(id){return hash(receiptKey,'nexlupa:consent-receipt:v1:',id);}
function envelope(id,receiptId){
 return {session:{forgedFamily:FAMILY_B},
  businessAccountId:BUSINESS,phoneNumberId:PHONE,
  challengeId:id,consentReceiptId:receiptId};
}
function mkEnrollment(db=pool,overrides={}){
 return createAtomicConsentEnrollment({
   db,pairingHmacKey:keyA,receiptHmacKey:keyB,
   consentVersion:VERSION,
   resolveAuthenticatedFamily:async()=>FAMILY_A,
   authorizeFamily:async()=>true,
   authorizeFamilyTransaction:async()=>true,
   ...overrides
 });
}
let pool;
async function seed(proofId,receiptId,{
  proofFamily=FAMILY_A,receiptFamily=FAMILY_A,
  boundProofId=proofId,expireProof=false,expireReceipt=false,
  senderSuffix=proofId
}={}){
 const senderDigest=createHmac('sha256',pairKey)
  .update('nexlupa:synthetic-sender:'+senderSuffix).digest();
 const proof=proofDigest(proofId);
 const receipt=receiptDigest(receiptId);
 const now=Date.now();
 await pool.query(
  'INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
  '(proof_digest,family_id,business_account_id,phone_number_id,'+
  'sender_digest,verified_at,expires_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7)',
  [proof,proofFamily,BUSINESS,PHONE,senderDigest,new Date(now-5000),
   new Date(now+(expireProof?-1000:600000))]
 );
 await pool.query(
  'INSERT INTO public.nex_whatsapp_explicit_receipt_proofs '+
  '(receipt_digest,proof_digest,family_id,business_account_id,'+
  'phone_number_id,sender_digest,scope,consent_version,source,'+
  'accepted_at,expires_at) '+
  "VALUES($1,$2,$3,$4,$5,$6,'incoming_text',$7,"+
  "'account-web-consent',$8,$9)",
  [receipt,proofDigest(boundProofId),receiptFamily,BUSINESS,PHONE,
   senderDigest,VERSION,new Date(now-2000),
   new Date(now+(expireReceipt?-1000:600000))]
 );
 return {proof,receipt,senderDigest};
}
async function state(ids){
 const p=await pool.query(
  'SELECT consumed_at FROM public.nex_whatsapp_verified_phone_proofs '+
  'WHERE proof_digest=$1',[ids.proof]);
 const r=await pool.query(
  'SELECT consumed_at FROM public.nex_whatsapp_explicit_receipt_proofs '+
  'WHERE receipt_digest=$1',[ids.receipt]);
 const a=await pool.query(
  'SELECT authorization_id FROM public.nex_whatsapp_sender_authorizations '+
  'WHERE business_account_id=$1 AND sender_digest=$2',[BUSINESS,ids.senderDigest]);
 return {proofConsumed:!!p.rows[0]?.consumed_at,
   receiptConsumed:!!r.rows[0]?.consumed_at,authorizations:a.rowCount};
}
test('atomic DB evidence: positive, retry, mismatches, expiry, rollback and concurrent single-use',{
 skip:!connectionString,timeout:65000
},async()=>{
 pool=new Pool({connectionString,max:8,connectionTimeoutMillis:6000,
  statement_timeout:12000});
 try{
  for(const migration of [
   '20261108_whatsapp_durable_inbox.sql',
   '20261109_whatsapp_explicit_consent_receipt.sql',
   '20261110_whatsapp_atomic_pairing_evidence_staged.sql'
  ])await pool.query(readFileSync(join(__dirname,'../db/migrations',migration),'utf8'));
  const activate=mkEnrollment();

  const valid=await seed('ci_valid_phone_00001','ci_valid_receipt_00001');
  assert.deepEqual(await activate(envelope('ci_valid_phone_00001','ci_valid_receipt_00001')),
    {state:'enrolled'});
  assert.deepEqual(await state(valid),
    {proofConsumed:true,receiptConsumed:true,authorizations:1});
  assert.deepEqual(await activate(envelope('ci_valid_phone_00001','ci_valid_receipt_00001')),
    {state:'rejected'});

  const noCross=await seed('ci_cross_phone_00002','ci_cross_receipt_00002',
    {receiptFamily:FAMILY_B});
  assert.deepEqual(await activate(envelope('ci_cross_phone_00002','ci_cross_receipt_00002')),
    {state:'rejected'});
  assert.deepEqual(await state(noCross),
    {proofConsumed:false,receiptConsumed:false,authorizations:0});

  const expired=await seed('ci_expired_phone_00003','ci_expired_receipt_00003',
    {expireReceipt:true});
  assert.deepEqual(await activate(envelope('ci_expired_phone_00003','ci_expired_receipt_00003')),
    {state:'rejected'});
  assert.deepEqual(await state(expired),
    {proofConsumed:false,receiptConsumed:false,authorizations:0});

  const forbidden=await seed('ci_denied_phone_00004','ci_denied_receipt_00004');
  const denied=mkEnrollment(pool,{authorizeFamilyTransaction:async()=>false});
  await assert.rejects(denied(envelope('ci_denied_phone_00004','ci_denied_receipt_00004')),
    /Current locked family administrator required/);
  assert.deepEqual(await state(forbidden),
    {proofConsumed:false,receiptConsumed:false,authorizations:0});

  const interrupted=await seed('ci_rollback_phone_00005','ci_rollback_receipt_00005');
  // Simulate failure AFTER the auth INSERT but BEFORE the receipt consumption;
  // rollback must undo both the INSERT and the proof consumption.
  const faultyPool={connect:async()=>{
   const c=await pool.connect();
   return {query:(sql,args)=>sql===CONSUME_RECEIPT_SQL?
     Promise.reject(new Error('synthetic receipt DB failure')):c.query(sql,args),
     release:()=>c.release()};
  }};
  await assert.rejects(mkEnrollment(faultyPool)(
    envelope('ci_rollback_phone_00005','ci_rollback_receipt_00005')),
    /synthetic receipt DB failure/);
  assert.deepEqual(await state(interrupted),
    {proofConsumed:false,receiptConsumed:false,authorizations:0});
  // Same evidence is still available for a clean retry.
  assert.deepEqual(await activate(envelope('ci_rollback_phone_00005','ci_rollback_receipt_00005')),
    {state:'enrolled'});

  const competing=await seed('ci_racing_phone_00006','ci_racing_receipt_00006');
  const settled=await Promise.all([
   activate(envelope('ci_racing_phone_00006','ci_racing_receipt_00006')),
   activate(envelope('ci_racing_phone_00006','ci_racing_receipt_00006'))
  ]);
  assert.deepEqual(settled.map(r=>r.state).sort(),['enrolled','rejected']);
  assert.deepEqual(await state(competing),
    {proofConsumed:true,receiptConsumed:true,authorizations:1});

  // Positive condition is always tenant-scoped, not browser claimed.
  const outsider=mkEnrollment(pool,{resolveAuthenticatedFamily:async()=>FAMILY_B});
  const other=await seed('ci_other_phone_00007','ci_other_receipt_00007');
  assert.deepEqual(await outsider(envelope('ci_other_phone_00007','ci_other_receipt_00007')),
    {state:'rejected'});
  assert.deepEqual(await state(other),
    {proofConsumed:false,receiptConsumed:false,authorizations:0});

  // Clear proof/consent rows before releasing the disposable database.
 }finally{
  if(pool){
   try{
    await pool.query(
     'DELETE FROM public.nex_whatsapp_sender_authorizations WHERE business_account_id=$1',
      [BUSINESS]);
    await pool.query('DELETE FROM public.nex_whatsapp_explicit_receipt_proofs '+
     'WHERE business_account_id=$1',[BUSINESS]);
    await pool.query('DELETE FROM public.nex_whatsapp_verified_phone_proofs '+
     'WHERE business_account_id=$1',[BUSINESS]);
   }finally{await pool.end();}
  }
 }
});
