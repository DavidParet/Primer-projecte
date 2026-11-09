'use strict';

/**
 * TTP 233: EXPERIMENTAL server-only v2 revocation permit signer.
 * The active key resolver must read from a reviewed secret store and return a
 * freshly selected signing key per operation. Never accept a key from request
 * JSON, client headers, or a decoded/unsigned token.
 *
 * PostgreSQL's corresponding v2 verifier accepts ACTIVE and VERIFY_ONLY keys,
 * and immediately rejects REVOKED keys. DB runtime has EXECUTE permission only.
 */
const {createHmac,randomUUID} = require('node:crypto');
const {FAMILY_UUID} = require('./family-authorization');
const {MAX_LIFETIME_SECONDS} = require('./signed-revocation-permit');

const PREFIX='NEXLUPA-WA-REVOKE-2';
const KEY_ID=/^[a-z][a-z0-9_-]{2,39}$/;
const USER_ID=/^[A-Za-z0-9_-]{1,128}$/;
const DIGITS=/^[0-9]{5,30}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rotatingPermitPayload({keyId,userId,familyId,authorizationId,
  businessAccountId,phoneNumberId,senderDigestHex,expiresAtEpoch,nonce}) {
  if (!KEY_ID.test(keyId||'') || !USER_ID.test(userId||'') ||
      typeof familyId!=='string' || !FAMILY_UUID.test(familyId) ||
      !Number.isSafeInteger(authorizationId) || authorizationId<=0 ||
      !DIGITS.test(businessAccountId||'') || !DIGITS.test(phoneNumberId||'') ||
      !/^[0-9a-f]{64}$/.test(senderDigestHex||'') ||
      !Number.isSafeInteger(expiresAtEpoch) || expiresAtEpoch<=0 ||
      !UUID.test(nonce||'')) {
    throw new TypeError('Invalid rotating permit fields');
  }
  return [PREFIX,keyId,userId,familyId.toLowerCase(),String(authorizationId),
    businessAccountId,phoneNumberId,senderDigestHex,String(expiresAtEpoch),
    nonce.toLowerCase()].join('|');
}

function decodeSigningKey(keyBase64) {
  if(typeof keyBase64!=='string')throw new TypeError('Signing secret required');
  const key=Buffer.from(keyBase64,'base64');
  if(key.length!==32 || key.toString('base64')!==keyBase64)
    throw new TypeError('Canonical 32-byte signing secret required');
  return key;
}

function createRotatingPermitSigner({getActiveSigningKey,now=Date.now}={}) {
  if(typeof getActiveSigningKey!=='function'||typeof now!=='function')
    throw new TypeError('Trusted active signing key resolver and clock required');

  return async function signRotatingPermit({userId,familyId,authorizationId,
    businessAccountId,phoneNumberId,senderDigest}) {
    if(!Buffer.isBuffer(senderDigest)||senderDigest.length!==32)
      throw new TypeError('Verified 32-byte sender digest required');

    // Do not cache key across requests; retiring/compromising a key should
    // prevent new permits being minted with it by a correctly configured signer.
    const selection=await getActiveSigningKey();
    if(!selection || selection.state!=='active' || !KEY_ID.test(selection.keyId||''))
      throw new Error('No approved active signing key');
    const key=decodeSigningKey(selection.keyBase64);
    const seconds=Math.floor(now()/1000);
    if(!Number.isSafeInteger(seconds)||seconds<=0)
      throw new Error('Invalid clock');
    const expiresAtEpoch=seconds+MAX_LIFETIME_SECONDS;
    const nonce=randomUUID();
    const keyId=selection.keyId;
    const senderDigestHex=senderDigest.toString('hex');
    const payload=rotatingPermitPayload({keyId,userId,familyId,authorizationId,
      businessAccountId,phoneNumberId,senderDigestHex,expiresAtEpoch,nonce});
    const signature=createHmac('sha256',key).update(payload,'utf8').digest();
    // Never expose base64 signing key in returned permit or DB parameters.
    return Object.freeze({
      keyId,userId,familyId:familyId.toLowerCase(),authorizationId,
      businessAccountId,phoneNumberId,senderDigest,expiresAtEpoch,nonce,signature
    });
  };
}

const REVOKE_WITH_ROTATING_PERMIT_SQL=`
SELECT public.nex_ci_revoke_whatsapp_with_rotating_permit(
 $1, $2, $3::uuid, $4::bigint, $5, $6, $7::bytea,
 $8::bigint, $9::uuid, $10::bytea
) AS result
`;

module.exports={createRotatingPermitSigner,rotatingPermitPayload,
  REVOKE_WITH_ROTATING_PERMIT_SQL,KEY_ID,PREFIX};
