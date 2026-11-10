'use strict';
/**
 * Consent policy prototype, not a public HTTP endpoint.
 * The injected proof provider must validate a single-use phone challenge.
 */
const {createHmac}=require('node:crypto');

const ENROLL_SQL = `
INSERT INTO nex_whatsapp_sender_authorizations
 (business_account_id, phone_number_id, sender_digest, family_id,
  scope, consent_version, consent_at, consent_source, consent_receipt_digest, valid_until)
VALUES ($1,$2,$3,$4,'incoming_text',$5,$6,$7,$8,$9)
ON CONFLICT DO NOTHING
RETURNING authorization_id;
`;
const REVOKE_SQL = `
UPDATE nex_whatsapp_sender_authorizations AS auth
SET revoked_at=NOW()
WHERE auth.business_account_id=$1 AND auth.phone_number_id=$2
  AND auth.sender_digest=$3 AND auth.family_id=$4
  AND auth.scope='incoming_text' AND auth.revoked_at IS NULL
RETURNING auth.authorization_id;
`;
const REVOKE_LOCK_SQL = `
SELECT authorization_id
FROM nex_whatsapp_sender_authorizations
WHERE business_account_id=$1 AND phone_number_id=$2
  AND sender_digest=$3 AND family_id=$4 AND scope='incoming_text'
FOR UPDATE;
`;
const REVOKE_PURGE_SQL = `
DELETE FROM nex_whatsapp_inbound
WHERE business_account_id=$1 AND phone_number_id=$2
  AND sender_digest=$3 AND family_id=$4
RETURNING inbound_id;
`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^\d{5,30}$/;
const PHONE=/^\d{7,15}$/;

function makeConsentPolicy({db, senderHmacKey, verifyEnrollment, verifyExplicitConsent,
  resolveAuthenticatedFamily, currentConsentVersion}) {
  if (!db || typeof db.query!=='function' ||
    typeof verifyEnrollment!=='function' ||
    typeof resolveAuthenticatedFamily!=='function' ||
    typeof verifyExplicitConsent!=='function') throw new TypeError('Missing trusted server adapter');
  if (typeof currentConsentVersion!=='string' ||
      !/^[A-Za-z0-9._-]{1,40}$/.test(currentConsentVersion))
    throw new TypeError('Missing trusted server consent version');
  if (typeof senderHmacKey!=='string' || !/^[A-Za-z0-9+/]{43}=$/.test(senderHmacKey))
    throw new TypeError('Expected base64 32-byte HMAC key');
  const key=Buffer.from(senderHmacKey,'base64');
  if (key.length!==32 || key.toString('base64')!==senderHmacKey)
    throw new TypeError('Invalid HMAC key');
  const digest=phone=>createHmac('sha256',key).update(phone).digest();

  async function enroll({session,businessAccountId,phoneNumberId,challengeId,consentReceiptId}) {
    if ([businessAccountId,phoneNumberId,challengeId,consentReceiptId].some(v=>typeof v!=='string') ||
        !ID.test(businessAccountId) || !ID.test(phoneNumberId) ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(challengeId) ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(consentReceiptId))
      throw new TypeError('Invalid enrollment input');
    const familyId=await resolveAuthenticatedFamily(session);
    if (typeof familyId!=='string' || !UUID.test(familyId)) throw new Error('Unauthenticated family');

    // Phone verification proves control only; it is NOT consent.
    const proof=await verifyEnrollment({session,challengeId,businessAccountId,phoneNumberId,familyId});
    const now=Date.now();
    if (!proof || proof.verified!==true || proof.familyId!==familyId ||
        proof.challengeId!==challengeId ||
        proof.businessAccountId!==businessAccountId ||
        proof.phoneNumberId!==phoneNumberId ||
        typeof proof.senderWaId!=='string' || !PHONE.test(proof.senderWaId) ||
        !Number.isSafeInteger(proof.expiresAt) ||
        proof.expiresAt<=now || proof.expiresAt>now+15*60*1000 ||
        proof.singleUseConsumed!==true) throw new Error('Phone proof not verified');

    // Separate, trusted server receipt binds the explicit acceptance to this
    // exact family, business number, challenge, scope and current policy version.
    // A browser-supplied boolean or consentVersion is never sufficient.
    const receipt=await verifyExplicitConsent({
      session,receiptId:consentReceiptId,challengeId,familyId,
      businessAccountId,phoneNumberId,scope:'incoming_text',
      version:currentConsentVersion
    });
    if (!receipt || receipt.verified!==true ||
        receipt.receiptId!==consentReceiptId ||
        receipt.challengeId!==challengeId ||
        receipt.familyId!==familyId ||
        receipt.businessAccountId!==businessAccountId ||
        receipt.phoneNumberId!==phoneNumberId ||
        receipt.senderWaId!==proof.senderWaId ||
        receipt.scope!=='incoming_text' ||
        receipt.version!==currentConsentVersion ||
        receipt.source!=='account-web-consent' ||
        receipt.singleUseConsumed!==true ||
        !Number.isSafeInteger(receipt.acceptedAt) ||
        receipt.acceptedAt>now || receipt.acceptedAt<now-15*60*1000)
      throw new Error('Explicit consent not verified');

    // The consent verifier may be slow: recheck both deadlines immediately
    // before attempting the database write, not only before the await.
    const writeTime=Date.now();
    if (proof.expiresAt<=writeTime) throw new Error('Phone proof expired before write');
    if (receipt.acceptedAt>writeTime || receipt.acceptedAt<writeTime-15*60*1000)
      throw new Error('Explicit consent expired before write');

    // Store an HMAC of the receipt identifier, never the raw receipt or phone.
    // Unique DB index prevents one receipt from authorizing multiple enrollments.
    const receiptDigest=createHmac('sha256',key)
      .update('nexlupa:consent-receipt:v1:').update(consentReceiptId).digest();
    const result=await db.query(ENROLL_SQL,[
      businessAccountId,phoneNumberId,digest(proof.senderWaId),
      familyId,currentConsentVersion,new Date(receipt.acceptedAt),
      receipt.source,receiptDigest,null
    ]);
    if (!result || !Number.isSafeInteger(result.rowCount) ||
        result.rowCount<0 || result.rowCount>1 ||
        !Array.isArray(result.rows) || result.rows.length!==result.rowCount ||
        (result.rowCount===1 && !UUID.test(result.rows[0]?.authorization_id || '')))
      throw new Error('Enrollment result not verified');
    return {state:result.rowCount===1?'enrolled':'already_active_or_receipt_used'};
  }

  async function revoke({session,businessAccountId,phoneNumberId,senderWaId}) {
    if ([businessAccountId,phoneNumberId,senderWaId].some(v=>typeof v!=='string') ||
        !ID.test(businessAccountId) || !ID.test(phoneNumberId) ||
        !PHONE.test(senderWaId)) throw new TypeError('Invalid revocation input');
    const familyId=await resolveAuthenticatedFamily(session);
    if (typeof familyId!=='string' || !UUID.test(familyId)) throw new Error('Unauthenticated family');
    // The inbox INSERT uses FOR SHARE on the authorization row. Acquiring
    // FOR UPDATE here waits for any in-flight insert transaction to finish.
    // The purge MUST be a later SQL statement (fresh READ COMMITTED snapshot),
    // otherwise a concurrent insert committed while waiting could be missed.
    if (typeof db.connect !== 'function')
      throw new Error('Revocation requires a dedicated transactional PostgreSQL connection');
    const client=await db.connect();
    if (!client || typeof client.query!=='function' || typeof client.release!=='function')
      throw new Error('Invalid revocation transaction adapter');
    const args=[businessAccountId,phoneNumberId,digest(senderWaId),familyId];
    let began=false;
    try {
      await client.query('BEGIN');
      began=true;
      const locked=await client.query(REVOKE_LOCK_SQL,args);
      if (!locked || !Array.isArray(locked.rows) ||
          !Number.isSafeInteger(locked.rowCount) ||
          locked.rowCount!==locked.rows.length)
        throw new Error('Revocation lock result not verified');
      const revoked=await client.query(REVOKE_SQL,args);
      if (!revoked || !Array.isArray(revoked.rows) ||
          !Number.isSafeInteger(revoked.rowCount) ||
          revoked.rowCount!==revoked.rows.length ||
          revoked.rowCount>1)
        throw new Error('Revocation result not verified');
      const deleted=await client.query(REVOKE_PURGE_SQL,args);
      if (!deleted || !Array.isArray(deleted.rows) ||
          !Number.isSafeInteger(deleted.rowCount) ||
          deleted.rowCount!==deleted.rows.length)
        throw new Error('Revocation result not verified');
      await client.query('COMMIT');
      return {state:revoked.rowCount===1?'revoked':'not_found',
        deletedMessages:deleted.rowCount};
    } catch(error) {
      if(began) {
        try { await client.query('ROLLBACK'); }
        catch(rollbackError) { error.cause=rollbackError; }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {enroll,revoke};
}

module.exports={makeConsentPolicy,ENROLL_SQL,REVOKE_SQL,REVOKE_LOCK_SQL,REVOKE_PURGE_SQL};
