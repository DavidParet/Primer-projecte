'use strict';
/**
 * Consent policy prototype, not a public HTTP endpoint.
 * The injected proof provider must validate a single-use phone challenge.
 */
const {createHmac}=require('node:crypto');

const ENROLL_SQL = `
INSERT INTO nex_whatsapp_sender_authorizations
 (business_account_id, phone_number_id, sender_digest, family_id,
  scope, consent_version, consent_at, consent_source, valid_until)
VALUES ($1,$2,$3,$4,'incoming_text',$5,NOW(),$6,$7)
ON CONFLICT DO NOTHING
RETURNING authorization_id;
`;
const REVOKE_SQL = `
UPDATE nex_whatsapp_sender_authorizations
SET revoked_at=NOW()
WHERE business_account_id=$1 AND phone_number_id=$2
  AND sender_digest=$3 AND family_id=$4
  AND scope='incoming_text' AND revoked_at IS NULL
RETURNING authorization_id;
`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^\d{5,30}$/;
const PHONE=/^\d{7,15}$/;

function makeConsentPolicy({db, senderHmacKey, verifyEnrollment, resolveAuthenticatedFamily}) {
  if (!db || typeof db.query!=='function' ||
    typeof verifyEnrollment!=='function' ||
    typeof resolveAuthenticatedFamily!=='function') throw new TypeError('Missing trusted server adapter');
  if (typeof senderHmacKey!=='string' || !/^[A-Za-z0-9+/]{43}=$/.test(senderHmacKey))
    throw new TypeError('Expected base64 32-byte HMAC key');
  const key=Buffer.from(senderHmacKey,'base64');
  if (key.length!==32 || key.toString('base64')!==senderHmacKey)
    throw new TypeError('Invalid HMAC key');
  const digest=phone=>createHmac('sha256',key).update(phone).digest();

  async function enroll({session,businessAccountId,phoneNumberId,challengeId,consentVersion}) {
    if (!ID.test(businessAccountId || '') || !ID.test(phoneNumberId || '') ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(challengeId || '') ||
        !/^[A-Za-z0-9._-]{1,40}$/.test(consentVersion || ''))
      throw new TypeError('Invalid enrollment input');
    // Both callbacks are trusted SERVER dependencies, not client input.
    const familyId=await resolveAuthenticatedFamily(session);
    if (!UUID.test(familyId || '')) throw new Error('Unauthenticated family');
    const proof=await verifyEnrollment({session,challengeId,businessAccountId,phoneNumberId,familyId});
    if (!proof || proof.verified!==true || proof.familyId!==familyId ||
        !PHONE.test(proof.senderWaId || '') ||
        !Number.isFinite(proof.expiresAt) ||
        proof.expiresAt<=Date.now() || proof.expiresAt>Date.now()+15*60*1000 ||
        proof.singleUseConsumed!==true) throw new Error('Phone proof not verified');
    const result=await db.query(ENROLL_SQL,[
      businessAccountId,phoneNumberId,digest(proof.senderWaId),
      familyId,consentVersion,'verified-phone-challenge',new Date(proof.expiresAt)
    ]);
    return {state:result.rowCount===1?'enrolled':'already_active'};
  }

  async function revoke({session,businessAccountId,phoneNumberId,senderWaId}) {
    if (!ID.test(businessAccountId || '') || !ID.test(phoneNumberId || '') ||
        !PHONE.test(senderWaId || '')) throw new TypeError('Invalid revocation input');
    const familyId=await resolveAuthenticatedFamily(session);
    if (!UUID.test(familyId || '')) throw new Error('Unauthenticated family');
    const result=await db.query(REVOKE_SQL,[
      businessAccountId,phoneNumberId,digest(senderWaId),familyId
    ]);
    return {state:result.rowCount>0?'revoked':'not_found'};
  }

  return {enroll,revoke};
}

module.exports={makeConsentPolicy,ENROLL_SQL,REVOKE_SQL};
