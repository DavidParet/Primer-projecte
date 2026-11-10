'use strict';

/**
 * TTP233 prototype: revokes through a rotating, signed, one-use DB operation.
 * Not connected to actual IdP, secret storage, Neon, or live WhatsApp routes.
 */
const {createHmac}=require('node:crypto');
const {createRequestIdentityBinder}=require('./request-identity-binding');
const {requireIdentity}=require('./revoke-consent');
const {createRotatingPermitSigner,REVOKE_WITH_ROTATING_PERMIT_SQL}=
  require('./rotating-revocation-permit');

function keyFromBase64(value,label) {
  if(typeof value!=='string')throw new TypeError(label+' required');
  const b=Buffer.from(value,'base64');
  if(b.length!==32||b.toString('base64')!==value)
    throw new TypeError(label+' must be canonical 32-byte base64');
  return b;
}

function createRotatingSignedConsentRevoker({
  db,senderHmacKey,getActiveSigningKey,getAuthenticatedSession,
  getMembership,now=Date.now
}={}) {
  if(!db||typeof db.connect!=='function')
    throw new TypeError('PostgreSQL transaction pool required');
  const senderKey=keyFromBase64(senderHmacKey,'Sender HMAC key');
  if(typeof getActiveSigningKey!=='function')
    throw new TypeError('Trusted active signing key resolver required');
  const signer=createRotatingPermitSigner({
    getActiveSigningKey:async()=>{
      const selected=await getActiveSigningKey();
      if(selected && typeof selected.keyBase64==='string') {
        const signingKey=keyFromBase64(selected.keyBase64,'Permit HMAC key');
        if(signingKey.equals(senderKey))throw new Error('Sender and permit HMAC keys must differ');
      }
      return selected;
    },now
  });
  const bindRequest=createRequestIdentityBinder({
    getAuthenticatedSession,getMembership,now
  });

  return async function revokeWithRotatingPermit(input) {
    requireIdentity(input);
    const authorization=await bindRequest();
    if(await authorization.authorizeFamily({
      familyId:input.familyId,action:'revoke_whatsapp_consent'
    })!==true)throw new Error('Verified family administrator required');
    const senderDigest=createHmac('sha256',senderKey)
      .update(input.senderWaId,'utf8').digest();
    const client=await db.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new Error('Valid transaction client required');
    let started=false;
    try {
      await client.query('BEGIN');started=true;
      const principal=await authorization.getVerifiedPrincipal();
      if(!principal)throw new Error('Session changed or expired');
      const permit=await signer({
        userId:principal.userId,familyId:input.familyId,
        authorizationId:input.authorizationId,
        businessAccountId:input.businessAccountId,
        phoneNumberId:input.phoneNumberId,senderDigest
      });
      const result=await client.query(REVOKE_WITH_ROTATING_PERMIT_SQL,[
        permit.keyId,permit.userId,permit.familyId,permit.authorizationId,
        permit.businessAccountId,permit.phoneNumberId,permit.senderDigest,
        permit.expiresAtEpoch,permit.nonce,permit.signature
      ]);
      const output=result?.rows?.length===1?result.rows[0].result:null;
      if(!output||typeof output!=='object'||Array.isArray(output))
        throw new Error('Invalid revocation response');
      if(output.state==='not_active'){
        await client.query('COMMIT');started=false;
        return {state:'not_active'};
      }
      if(output.state!=='revoked'||!Number.isSafeInteger(output.deletedMessages)||
         output.deletedMessages<0)throw new Error('Rotating signed operation rejected');
      await client.query('COMMIT');started=false;
      return {state:'revoked',deletedMessages:output.deletedMessages};
    } catch(error) {
      if(started) {
        try{await client.query('ROLLBACK');}
        catch(rollbackError){error.cause=rollbackError;}
      }
      throw error;
    } finally {client.release();}
  };
}

module.exports={createRotatingSignedConsentRevoker};
