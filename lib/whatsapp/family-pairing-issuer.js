'use strict';

/**
 * TTP236 server-only pairing invitation, not an HTTP endpoint.
 * Requires a trusted verified family-admin session. No WhatsApp sender
 * is enrolled until the phone holder independently accepts from WhatsApp.
 *
 * The CI table name is deliberately not part of a Neon migration.
 */
const {FAMILY_UUID}=require('./family-authorization');
const {createRequestIdentityBinder}=require('./request-identity-binding');
const {
  newPairingCode,pairingDigest,parseSecret,WHATSAPP_ID,
  CONSENT_VERSION,PAIRING_VALID_MINUTES
}=require('./family-pairing-protocol');

const CREATE_PAIRING_SQL=`
INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
 family_id,business_account_id,phone_number_id,code_digest,requested_by,
 consent_version,expires_at
)
VALUES ($1::uuid,$2,$3,$4::bytea,$5,$6,
        clock_timestamp()+interval '10 minutes')
RETURNING challenge_id,expires_at
`;

function createFamilyPairingIssuer({
  db,pairingHmacKey,getAuthenticatedSession,getMembership,now=Date.now
}={}){
  if(!db||typeof db.connect!=='function')
    throw new TypeError('Trusted pairing transaction pool required');
  const pairingKey=parseSecret(pairingHmacKey,'Pairing HMAC key');
  const bindRequest=createRequestIdentityBinder({
    getAuthenticatedSession,getMembership,now
  });
  return async function issuePairingCode({
    familyId,businessAccountId,phoneNumberId
  }={}){
    if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
       !WHATSAPP_ID.test(businessAccountId||'')||
       !WHATSAPP_ID.test(phoneNumberId||'')) {
      throw new TypeError('Invalid family and WhatsApp business identity');
    }
    const auth=await bindRequest();
    if(await auth.authorizeFamily({
      familyId,action:'enroll_whatsapp_sender'
    })!==true)throw new Error('Verified family administrator required');
    const client=await db.connect();
    if(!client||typeof client.query!=='function'||
       typeof client.release!=='function')
      throw new TypeError('Dedicated pairing database client required');
    let began=false;
    try{
      await client.query('BEGIN');began=true;
      const allowed=await auth.authorizeFamilyTransaction({
        client,familyId,action:'enroll_whatsapp_sender'
      });
      if(allowed!==true)throw new Error('Family enrollment permission expired');
      const principal=await auth.getVerifiedPrincipal();
      if(!principal)throw new Error('Verified session changed');
      const code=newPairingCode();
      const digest=pairingDigest({
        code,businessAccountId,phoneNumberId,pairingKey
      });
      const saved=await client.query(CREATE_PAIRING_SQL,[
        familyId,businessAccountId,phoneNumberId,digest,principal.userId,
        CONSENT_VERSION
      ]);
      if(saved?.rows?.length!==1||!Number.isSafeInteger(Number(saved.rows[0].challenge_id)))
        throw new Error('Pairing challenge not persisted');
      await client.query('COMMIT');began=false;
      return Object.freeze({
        code,expiresAt:saved.rows[0].expires_at,
        instruction:'Envia NEXLUPA ACCEPTA '+code+
          ' des del teu propi WhatsApp al número oficial de NexLupa',
        consentVersion:CONSENT_VERSION
      });
    } catch(err){
      if(began){
        try{await client.query('ROLLBACK');}
        catch(rollbackError){err.cause=rollbackError;}
      }
      throw err;
    }finally{client.release();}
  };
}
module.exports={createFamilyPairingIssuer,CREATE_PAIRING_SQL,PAIRING_VALID_MINUTES};
