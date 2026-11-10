'use strict';
/**
 * STAGED, NO PUBLIC ROUTE.
 * A request-bound, server-verified family administrator signs a 45-second
 * atomic activation permit. The database credential may EXECUTE only the
 * limited-purpose PostgreSQL SECURITY DEFINER function (CI schema).
 * No raw DML permission and no browser-supplied principal/role is accepted.
 *
 * The real IdP and identity/membership DB are NOT configured here.
 * The SQL CI fixture still does not perform a canonical membership lock:
 * do not publish this adapter until the final DB function does so.
 */
const {createHmac,randomUUID}=require('node:crypto');
const {parseSecret}=require('./family-pairing-protocol');
const {FAMILY_UUID}=require('./family-authorization');

const DIGITS=/^[0-9]{5,30}$/;
const TOKEN=/^[A-Za-z0-9_-]{16,128}$/;
const VERSION=/^[A-Za-z0-9._-]{1,40}$/;
const KID=/^[a-z][a-z0-9_-]{2,39}$/;
const PURPOSE='atomic-activate';
const PERMIT_SECONDS=45;
const ACTIVATE_SQL=`
SELECT public.nex_ci_signed_activate_atomic_consent(
  $1::uuid,$2,$3,$4::bytea,$5::bytea,$6,$7,$8::bigint,$9::uuid,$10::bytea
) AS result`;

function getDigest(key,prefix,token) {
 return createHmac('sha256',key).update(prefix).update(token).digest();
}
function formatPermit({keyId,familyId,businessAccountId,phoneNumberId,
 proofDigest,receiptDigest,consentVersion,expiresAt,nonce}) {
 return ['NEXLUPA-ATOMIC-ACTIVATE-1',keyId,familyId.toLowerCase(),
  businessAccountId,phoneNumberId,proofDigest.toString('hex'),
  receiptDigest.toString('hex'),consentVersion,String(expiresAt),
  nonce.toLowerCase()].join('|');
}
function createSignedAtomicConsentClient({
 db,bindVerifiedRequest,getActiveSigningKey,
 proofHmacKey,receiptHmacKey,consentVersion,now=Date.now
}={}) {
 if(!db||typeof db.connect!=='function'||
    typeof bindVerifiedRequest!=='function'||
    typeof getActiveSigningKey!=='function'||typeof now!=='function')
  throw new TypeError('Trusted signed activation adapters required');
 if(typeof consentVersion!=='string'||!VERSION.test(consentVersion))
  throw new TypeError('Server consent policy version required');
 const proofKey=parseSecret(proofHmacKey,'Phone proof HMAC key');
 const receiptKey=parseSecret(receiptHmacKey,'Consent receipt HMAC key');
 if(proofKey.equals(receiptKey))
  throw new TypeError('Proof and receipt keys must be separate');

 return async function activate({familyId,businessAccountId,phoneNumberId,
  challengeId,consentReceiptId}={}) {
  if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
     typeof businessAccountId!=='string'||!DIGITS.test(businessAccountId)||
     typeof phoneNumberId!=='string'||!DIGITS.test(phoneNumberId)||
     typeof challengeId!=='string'||!TOKEN.test(challengeId)||
     typeof consentReceiptId!=='string'||!TOKEN.test(consentReceiptId))
   throw new TypeError('Invalid signed activation identity');

  const auth=await bindVerifiedRequest();
  if(!auth||typeof auth.authorizeFamily!=='function'||
     typeof auth.getVerifiedPrincipal!=='function')
   throw new Error('Trusted request-bound administrator missing');
  if(await auth.authorizeFamily({familyId,action:'enroll_whatsapp_sender'})!==true)
   throw new Error('Current family administrator required');
  const principal=await auth.getVerifiedPrincipal();
  if(!principal||typeof principal.userId!=='string'||
     typeof principal.sessionId!=='string')
   throw new Error('Verified request session required');

  const keySpec=await getActiveSigningKey(PURPOSE);
  if(!keySpec||keySpec.purpose!==PURPOSE||keySpec.state!=='active'||
     typeof keySpec.keyId!=='string'||!KID.test(keySpec.keyId))
   throw new Error('No active dedicated activation signing key');
  const signingKey=parseSecret(keySpec.keyBase64,'Activation signing key');
  if(signingKey.equals(proofKey)||signingKey.equals(receiptKey))
   throw new Error('Activation signing key must be independent');

  const timestamp=Math.floor(now()/1000);
  if(!Number.isSafeInteger(timestamp)||timestamp<=0)
   throw new Error('Trusted clock required');
  const proofDigest=getDigest(proofKey,'nexlupa:phone-proof:v1:',challengeId);
  const receiptDigest=getDigest(receiptKey,
   'nexlupa:consent-receipt:v1:',consentReceiptId);
  const permit={keyId:keySpec.keyId,familyId,businessAccountId,
   phoneNumberId,proofDigest,receiptDigest,consentVersion,
   expiresAt:timestamp+PERMIT_SECONDS,nonce:randomUUID()};
  const signature=createHmac('sha256',signingKey)
    .update(formatPermit(permit),'utf8').digest();

  // A signer's key lookup may block. Identity and role must still be fresh
  // immediately before this SQL operation, not only before signing.
  if(await auth.authorizeFamily({familyId,action:'enroll_whatsapp_sender'})!==true)
   throw new Error('Family administrator permission expired');
  const refreshed=await auth.getVerifiedPrincipal();
  if(!refreshed||refreshed.userId!==principal.userId||
     refreshed.sessionId!==principal.sessionId)
   throw new Error('Verified request session changed after signing');

  const client=await db.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
   throw new Error('Restricted signed activation DB client required');
  let started=false;
  try{
   await client.query('BEGIN');started=true;
   const response=await client.query(ACTIVATE_SQL,[
    familyId,businessAccountId,phoneNumberId,proofDigest,
    receiptDigest,consentVersion,permit.keyId,
    permit.expiresAt,permit.nonce,signature
   ]);
   const state=response?.rows?.length===1 && response.rowCount===1?
    response.rows[0]?.result?.state:null;
   if(state!=='enrolled' && state!=='rejected')
    throw new Error('Signed activation result not verified');
   if(state==='rejected'){
    await client.query('ROLLBACK');started=false;
    return {state:'rejected'};
   }
   await client.query('COMMIT');started=false;
   return {state:'enrolled'};
  }catch(error){
   if(started){
    try{await client.query('ROLLBACK');}
    catch(rollbackError){error.cause=rollbackError;}
   }
   throw error;
  }finally{client.release();}
 };
}
module.exports={createSignedAtomicConsentClient,ACTIVATE_SQL,formatPermit,
 PURPOSE,PERMIT_SECONDS};
