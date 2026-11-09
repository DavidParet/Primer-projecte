'use strict';
// EXPERIMENTAL: signed, short-lived, one-use WhatsApp consent revocation permit.
// The signing key MUST be separate from database credentials and sender HMAC.
// A production integration must receive userId from a cryptographically
// verified IdP session; never from request JSON, headers or a decoded token.

const {createHmac, randomUUID} = require('node:crypto');
const {FAMILY_UUID} = require('./family-authorization');
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DIGITS = /^[0-9]{5,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMIT_PREFIX = 'NEXLUPA-WA-REVOKE-1';
const MAX_LIFETIME_SECONDS = 90;

function permitPayload({userId,familyId,authorizationId,businessAccountId,
  phoneNumberId,senderDigestHex,expiresAtEpoch,nonce}) {
  if (!USER_ID.test(userId||'') ||
      !FAMILY_UUID.test(familyId||'') ||
      !Number.isSafeInteger(authorizationId) || authorizationId<=0 ||
      !DIGITS.test(businessAccountId||'') || !DIGITS.test(phoneNumberId||'') ||
      !/^[0-9a-f]{64}$/.test(senderDigestHex||'') ||
      !Number.isSafeInteger(expiresAtEpoch) || expiresAtEpoch<=0 ||
      !UUID.test(nonce||'')) {
    throw new TypeError('Invalid signed revocation permit fields');
  }
  return [PERMIT_PREFIX,userId,familyId.toLowerCase(),String(authorizationId),
    businessAccountId,phoneNumberId,senderDigestHex,String(expiresAtEpoch),
    nonce.toLowerCase()].join('|');
}

function createRevocationPermitSigner({permitHmacKey,now=Date.now}={}) {
  if(typeof permitHmacKey!=='string' || typeof now!=='function') {
    throw new TypeError('Separate permit HMAC key and clock required');
  }
  const key=Buffer.from(permitHmacKey,'base64');
  if(key.length!==32 || key.toString('base64')!==permitHmacKey) {
    throw new TypeError('Canonical 32-byte permit signing key required');
  }
  return function signRevocation({userId,familyId,authorizationId,
    businessAccountId,phoneNumberId,senderDigest}) {
    if(!Buffer.isBuffer(senderDigest)||senderDigest.length!==32) {
      throw new TypeError('Verified 32-byte sender digest required');
    }
    const seconds=Math.floor(now()/1000);
    if(!Number.isSafeInteger(seconds)||seconds<=0)throw new Error('Invalid clock');
    const expiresAtEpoch=seconds+MAX_LIFETIME_SECONDS;
    const nonce=randomUUID();
    const senderDigestHex=senderDigest.toString('hex');
    const payload=permitPayload({userId,familyId,authorizationId,
      businessAccountId,phoneNumberId,senderDigestHex,expiresAtEpoch,nonce});
    const signature=createHmac('sha256',key).update(payload,'utf8').digest();
    return Object.freeze({
      userId,familyId:familyId.toLowerCase(),authorizationId,
      businessAccountId,phoneNumberId,senderDigest,
      expiresAtEpoch,nonce,signature
    });
  };
}

const REVOKE_WITH_PERMIT_SQL=`
SELECT public.nex_ci_revoke_whatsapp_with_permit(
 $1, $2::uuid, $3::bigint, $4, $5, $6::bytea,
 $7::bigint, $8::uuid, $9::bytea
) AS result
`;

module.exports={permitPayload,createRevocationPermitSigner,
  REVOKE_WITH_PERMIT_SQL,MAX_LIFETIME_SECONDS};
