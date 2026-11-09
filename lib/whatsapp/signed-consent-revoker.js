'use strict';
/**
 * Experimental server-only revocation using a signed, one-use permit and
 * exactly ONE restricted DB function. Never connect to a public HTTP route
 * before the identity provider and key custody are reviewed.
 *
 * The database role has EXECUTE only: no direct consent UPDATE or DELETE.
 * The permit signer uses a separate secret from the DB login password and
 * the WhatsApp sender HMAC secret. A compromised DB credential alone cannot
 * create a fresh permit (subject to separate custody of both signer keys).
 */
const {createHmac}=require('node:crypto');
const {createRequestIdentityBinder}=require('./request-identity-binding');
const {requireIdentity}=require('./revoke-consent');
const {createRevocationPermitSigner,REVOKE_WITH_PERMIT_SQL}=
  require('./signed-revocation-permit');

function decodeCanonicalKey(value,label) {
  if(typeof value!=='string')throw new TypeError(label+' is required');
  const key=Buffer.from(value,'base64');
  if(key.length!==32||key.toString('base64')!==value)
    throw new TypeError(label+' must be canonical base64 for 32 bytes');
  return key;
}
function createSignedConsentRevoker({
  db, senderHmacKey, permitHmacKey, getAuthenticatedSession,
  getMembership, now=Date.now
}={}) {
  if(!db||typeof db.connect!=='function')
    throw new TypeError('PostgreSQL transaction pool required');
  const senderKey=decodeCanonicalKey(senderHmacKey,'Sender HMAC secret');
  const permitKey=decodeCanonicalKey(permitHmacKey,'Permit signing secret');
  if(senderKey.equals(permitKey))
    throw new TypeError('Sender and permit signing secrets must be separate');
  const signPermit=createRevocationPermitSigner({permitHmacKey,now});
  const bindRequest=createRequestIdentityBinder({
    getAuthenticatedSession,getMembership,now
  });
  return async function revokeConsentWithSignedPermit(input) {
    requireIdentity(input);
    const auth=await bindRequest();
    if(await auth.authorizeFamily({
      familyId:input.familyId,action:'revoke_whatsapp_consent'
    })!==true)throw new Error('Verified family administrator required');
    const digest=createHmac('sha256',senderKey).update(input.senderWaId,'utf8').digest();

    const client=await db.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new Error('Valid transactional database client required');
    let started=false;
    try{
      await client.query('BEGIN');started=true;
      // User ID is re-verified against the SAME pinned server session.
      // The DB function atomically checks current membership under row lock.
      const principal=await auth.getVerifiedPrincipal();
      if(!principal)throw new Error('Session changed or expired before consent operation');
      const permit=signPermit({
        userId:principal.userId,familyId:input.familyId,
        authorizationId:input.authorizationId,
        businessAccountId:input.businessAccountId,
        phoneNumberId:input.phoneNumberId,senderDigest:digest
      });
      const result=await client.query(REVOKE_WITH_PERMIT_SQL,[
        permit.userId,permit.familyId,permit.authorizationId,
        permit.businessAccountId,permit.phoneNumberId,permit.senderDigest,
        permit.expiresAtEpoch,permit.nonce,permit.signature
      ]);
      const row=result?.rows?.length===1?result.rows[0]:null;
      const outcome=row?.result;
      if(!outcome||typeof outcome!=='object'||Array.isArray(outcome)) {
        throw new Error('Invalid signed consent operation response');
      }
      if(outcome.state==='not_active') {
        await client.query('COMMIT');started=false;
        return {state:'not_active'};
      }
      if(outcome.state!=='revoked'||!Number.isSafeInteger(outcome.deletedMessages)||
          outcome.deletedMessages<0) {
        throw new Error('Signed consent operation rejected');
      }
      await client.query('COMMIT');started=false;
      return {state:'revoked',deletedMessages:outcome.deletedMessages};
    }catch(error){
      if(started){
        try{await client.query('ROLLBACK');}catch(rollbackError){error.cause=rollbackError;}
      }
      throw error;
    }finally{client.release();}
  };
}
module.exports={createSignedConsentRevoker};
