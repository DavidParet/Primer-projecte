'use strict';
/**
 * STAGED/INTERNAL ONLY: phone proof + explicit web consent receipt must be
 * independently verified and recorded by TRUSTED server components. This
 * module never issues/verifies Meta challenges or user sessions by itself.
 * It consumes both pseudonymous DB evidence rows, and inserts one consent
 * authorization in the SAME PostgreSQL transaction, or consumes neither.
 *
 * Do NOT connect to HTTP or Neon until an audited restricted DB function and
 * canonical IdP/membership adapter replace these CI-only dependencies.
 */
const {createHmac, timingSafeEqual} = require('node:crypto');
const {parseSecret} = require('./family-pairing-protocol');

const FAMILY=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS=/^[0-9]{5,30}$/;
const TOKEN=/^[A-Za-z0-9_-]{16,128}$/;
const VERSION=/^[A-Za-z0-9._-]{1,40}$/;
const MAX_PG_BIGINT=9223372036854775807n;
const PROOF_SQL=`
SELECT family_id,business_account_id,phone_number_id,sender_digest,
       verified_at,expires_at,consumed_at
FROM public.nex_whatsapp_verified_phone_proofs
WHERE proof_digest=$1::bytea
  AND consumed_at IS NULL AND expires_at>clock_timestamp()
  AND verified_at<=clock_timestamp()
  AND verified_at>=clock_timestamp()-interval '15 minutes'
FOR UPDATE`;
const RECEIPT_SQL=`
SELECT proof_digest,family_id,business_account_id,phone_number_id,
       sender_digest,scope,consent_version,source,accepted_at,
       expires_at,consumed_at
FROM public.nex_whatsapp_explicit_receipt_proofs
WHERE receipt_digest=$1::bytea
  AND consumed_at IS NULL AND expires_at>clock_timestamp()
  AND accepted_at<=clock_timestamp()
  AND accepted_at>=clock_timestamp()-interval '15 minutes'
FOR UPDATE`;
const INSERT_SQL=`
INSERT INTO public.nex_whatsapp_sender_authorizations(
 business_account_id,phone_number_id,sender_digest,family_id,
 scope,consent_version,consent_at,consent_source,
 consent_receipt_digest,valid_until)
VALUES($1,$2,$3::bytea,$4::uuid,'incoming_text',$5,$6::timestamptz,
       'account-web-consent',$7::bytea,clock_timestamp()+interval '30 days')
ON CONFLICT DO NOTHING
RETURNING authorization_id`;
const CONSUME_PROOF_SQL=`
UPDATE public.nex_whatsapp_verified_phone_proofs
SET consumed_at=clock_timestamp()
WHERE proof_digest=$1::bytea AND consumed_at IS NULL
RETURNING proof_digest`;
const CONSUME_RECEIPT_SQL=`
UPDATE public.nex_whatsapp_explicit_receipt_proofs
SET consumed_at=clock_timestamp()
WHERE receipt_digest=$1::bytea AND consumed_at IS NULL
RETURNING receipt_digest`;

function validAuthId(v) {
  return typeof v==='string' && /^[1-9][0-9]{0,18}$/.test(v) &&
    BigInt(v)<=MAX_PG_BIGINT;
}
function eqlDigest(a,b) {
  return Buffer.isBuffer(a)&&Buffer.isBuffer(b)&&a.length===32&&b.length===32 &&
    timingSafeEqual(a,b);
}
function oneRow(result) {
  return result && result.rowCount===1 && Array.isArray(result.rows) &&
    result.rows.length===1 ? result.rows[0]:null;
}
function digest(key,domain,value) {
  return createHmac('sha256',key).update(domain,'utf8').update(value,'utf8').digest();
}
function createAtomicConsentEnrollment({
  db, pairingHmacKey, receiptHmacKey,
  resolveAuthenticatedFamily, authorizeFamily,
  authorizeFamilyTransaction, consentVersion
}={}) {
  if(!db||typeof db.connect!=='function'||
     typeof resolveAuthenticatedFamily!=='function'||
     typeof authorizeFamily!=='function'||
     typeof authorizeFamilyTransaction!=='function')
    throw new TypeError('Trusted family adapters and transactional DB pool required');
  if(typeof consentVersion!=='string'||!VERSION.test(consentVersion))
    throw new TypeError('Server consent version required');
  const pairKey=parseSecret(pairingHmacKey,'Pairing proof HMAC key');
  const receiptKey=parseSecret(receiptHmacKey,'Receipt HMAC key');
  if(pairKey.equals(receiptKey))
    throw new TypeError('Separate pairing and receipt signing keys required');

  return async function enroll({session,businessAccountId,phoneNumberId,
    challengeId,consentReceiptId}={}) {
    if(!BUSINESS.test(businessAccountId||'')||
       !BUSINESS.test(phoneNumberId||'')||
       typeof challengeId!=='string'||!TOKEN.test(challengeId)||
       typeof consentReceiptId!=='string'||!TOKEN.test(consentReceiptId))
      throw new TypeError('Invalid consent enrollment input');
    const familyId=await resolveAuthenticatedFamily(session);
    if(typeof familyId!=='string'||!FAMILY.test(familyId))
      throw new Error('Unauthenticated family');
    if(await authorizeFamily({session,familyId,action:'enroll_whatsapp_sender'})!==true)
      throw new Error('Current family administrator required');

    // Sender identity is sourced ONLY from verified DB evidence, never from
    // browser input, and both evidence identifiers remain pseudonymous.
    const proofDigest=digest(pairKey,'nexlupa:phone-proof:v1:',challengeId);
    const receiptDigest=digest(receiptKey,'nexlupa:consent-receipt:v1:',consentReceiptId);
    const client=await db.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new Error('Invalid transactional enrollment adapter');
    let began=false;
    try {
      await client.query('BEGIN');began=true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      // Trust boundary: this callback MUST lock current canonical membership
      // on THIS connection (not another db pool / claimed browser role).
      if(await authorizeFamilyTransaction({client,session,familyId,
        action:'enroll_whatsapp_sender'})!==true)
        throw new Error('Current locked family administrator required');
      const proof=oneRow(await client.query(PROOF_SQL,[proofDigest]));
      if(!proof||proof.family_id!==familyId||
         proof.business_account_id!==businessAccountId||
         proof.phone_number_id!==phoneNumberId||
         !Buffer.isBuffer(proof.sender_digest)||proof.sender_digest.length!==32) {
        await client.query('ROLLBACK');began=false;
        return {state:'rejected'};
      }
      const receipt=oneRow(await client.query(RECEIPT_SQL,[receiptDigest]));
      if(!receipt||receipt.family_id!==familyId||
         receipt.business_account_id!==businessAccountId||
         receipt.phone_number_id!==phoneNumberId||
         receipt.scope!=='incoming_text'||
         receipt.source!=='account-web-consent'||
         receipt.consent_version!==consentVersion||
         !eqlDigest(receipt.proof_digest,proofDigest)||
         !eqlDigest(receipt.sender_digest,proof.sender_digest)||
         !(receipt.accepted_at instanceof Date)||
         Number.isNaN(receipt.accepted_at.getTime())) {
        await client.query('ROLLBACK');began=false;
        return {state:'rejected'};
      }
      // Both rows are locked and independently verified. The unique active
      // sender index and unique receipt digest prevent duplicate grants.
      const inserted=await client.query(INSERT_SQL,[
        businessAccountId,phoneNumberId,proof.sender_digest,
        familyId,consentVersion,receipt.accepted_at,receiptDigest
      ]);
      if(inserted?.rowCount===0 && Array.isArray(inserted.rows) &&
         inserted.rows.length===0) {
        await client.query('ROLLBACK');began=false;
        return {state:'rejected'};
      }
      const insertedRow=oneRow(inserted);
      if(!insertedRow||!validAuthId(insertedRow.authorization_id))
        throw new Error('Atomic authorization insert not verified');
      const consumedProof=await client.query(CONSUME_PROOF_SQL,[proofDigest]);
      const consumedReceipt=await client.query(CONSUME_RECEIPT_SQL,[receiptDigest]);
      if(!eqlDigest(oneRow(consumedProof)?.proof_digest,proofDigest) ||
         !eqlDigest(oneRow(consumedReceipt)?.receipt_digest,receiptDigest))
        throw new Error('Atomic evidence consumption not verified');
      await client.query('COMMIT');began=false;
      return {state:'enrolled'};
    } catch(error) {
      if(began) {
        try {await client.query('ROLLBACK');}
        catch(rollbackError){error.cause=rollbackError;}
      }
      throw error;
    } finally {
      client.release();
    }
  };
}
module.exports={createAtomicConsentEnrollment,PROOF_SQL,RECEIPT_SQL,INSERT_SQL,
  CONSUME_PROOF_SQL,CONSUME_RECEIPT_SQL};
