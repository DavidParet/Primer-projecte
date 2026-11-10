'use strict';
/**
 * TTP 238: short-lived single-use pairing operation permits.
 * Keys must be obtained from independently managed, trusted server secrets.
 * This function does NOT validate an IdP or Meta session by itself.
 */
const {createHmac,randomUUID}=require('node:crypto');
const {FAMILY_UUID}=require('./family-authorization');

const MAX_AGE_SECONDS=60;
const KID=/^[a-z][a-z0-9_-]{2,39}$/;
const USER=/^[A-Za-z0-9_-]{1,128}$/;
const DIGITS=/^[0-9]{5,30}$/;
const MESSAGE=/^wamid[.][A-Za-z0-9._=-]{1,256}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingKey(keyBase64){
 if(typeof keyBase64!=='string')throw new TypeError('Signing secret required');
 const b=Buffer.from(keyBase64,'base64');
 if(b.length!==32||b.toString('base64')!==keyBase64)
  throw new TypeError('Canonical 32-byte signing secret required');
 return b;
}
function permitPayload(kind,{keyId,userId,familyId,businessAccountId,
 phoneNumberId,codeDigest,senderDigest,providerMessageId,expiresAt,nonce}={}){
 if(kind!=='issue'&&kind!=='confirm')throw new TypeError('Unknown signing purpose');
 if(!KID.test(keyId||'')||!DIGITS.test(businessAccountId||'')||
    !DIGITS.test(phoneNumberId||'')||
    !Buffer.isBuffer(codeDigest)||codeDigest.length!==32||
    !Number.isSafeInteger(expiresAt)||expiresAt<=0||
    !UUID.test(nonce||''))throw new TypeError('Invalid pairing permit fields');
 if(kind==='issue'){
  if(!USER.test(userId||'')||typeof familyId!=='string'||
     !FAMILY_UUID.test(familyId))throw new TypeError('Invalid issuer identity');
  return ['NEXLUPA-PAIR-ISSUE-1',keyId,userId,familyId.toLowerCase(),
    businessAccountId,phoneNumberId,codeDigest.toString('hex'),
    String(expiresAt),nonce.toLowerCase()].join('|');
 }
 if(!Buffer.isBuffer(senderDigest)||senderDigest.length!==32||
    !MESSAGE.test(providerMessageId||''))
  throw new TypeError('Invalid Meta delivery identity');
 return ['NEXLUPA-PAIR-CONFIRM-1',keyId,businessAccountId,phoneNumberId,
   codeDigest.toString('hex'),senderDigest.toString('hex'),
   providerMessageId,String(expiresAt),nonce.toLowerCase()].join('|');
}

function createPairingOperationSigner({kind,getActiveSigningKey,now=Date.now}={}){
 if(!['issue','confirm'].includes(kind)||
    typeof getActiveSigningKey!=='function'||typeof now!=='function')
  throw new TypeError('Trusted purpose-specific signer and clock required');
 return async function signPairingOperation(details){
  // Key lookup must happen afresh for every operation (not a module cache).
  const selected=await getActiveSigningKey(kind);
  if(!selected||selected.purpose!==kind||selected.state!=='active'||
     !KID.test(selected.keyId||''))
    throw new Error('No authorized active pairing signing key');
  const key=signingKey(selected.keyBase64);
  const epoch=Math.floor(now()/1000);
  if(!Number.isSafeInteger(epoch)||epoch<=0)throw new Error('Invalid clock');
  const fields={...details,keyId:selected.keyId,
    expiresAt:epoch+MAX_AGE_SECONDS,nonce:randomUUID()};
  const payload=permitPayload(kind,fields);
  const signature=createHmac('sha256',key).update(payload,'utf8').digest();
  return Object.freeze({...fields,signature});
 };
}

const SIGNED_PAIR_ISSUE_SQL=`
SELECT public.nex_ci_signed_issue_whatsapp_pairing(
 $1,$2::uuid,$3,$4,$5::bytea,$6,$7::bigint,$8::uuid,$9::bytea
) AS result
`;
const SIGNED_PAIR_CONFIRM_SQL=`
SELECT public.nex_ci_signed_confirm_whatsapp_pairing(
 $1,$2,$3::bytea,$4::bytea,$5,$6,$7::bigint,$8::uuid,$9::bytea
) AS result
`;

module.exports={
 MAX_AGE_SECONDS,permitPayload,signingKey,createPairingOperationSigner,
 SIGNED_PAIR_ISSUE_SQL,SIGNED_PAIR_CONFIRM_SQL
};
