'use strict';

/**
 * STAGED preview-only bridge: Neon Auth verified HttpOnly pilot session
 * -> canonical user + family role -> signed atomic consent PostgreSQL RPC.
 * NOT AN HTTP ENDPOINT and NOT CONNECTED TO LIVE NEON/META.
 *
 * The authenticated principal is never accepted from browser JSON.
 * No fallback to the legacy non-atomic consent-policy route.
 */
const {createPilotFamilyBinderFactory}=
  require('./pilot-family-session');
const {createSignedAtomicConsentClient}=
  require('./signed-atomic-consent-client');
const {WHATSAPP_ID,CONSENT_VERSION}=
  require('./family-pairing-protocol');

function createPilotAtomicConsentFactory({
  env,identityDb,activationDb,proofHmacKey,receiptHmacKey,
  getActiveSigningKey,fetchImpl=fetch,now=Date.now
}={}){
  if(!identityDb||typeof identityDb.query!=='function')
    throw new TypeError('Restricted canonical identity lookup required');
  if(!activationDb||typeof activationDb.connect!=='function')
    throw new TypeError('Restricted atomic activation connection required');
  const bindPilotRequest=createPilotFamilyBinderFactory({
    env,db:identityDb,fetchImpl,now
  });
  const businessAccountId=env?.WHATSAPP_WABA_ID;
  const phoneNumberId=env?.WHATSAPP_PHONE_NUMBER_ID;
  if(!WHATSAPP_ID.test(businessAccountId||'')||
     !WHATSAPP_ID.test(phoneNumberId||''))
    throw new Error('Trusted pilot WhatsApp destination required');

  return function bindAtomicActivationRequest(request){
    // This checks the configured preview origin, POST, same-origin fetch
    // metadata, and app-scoped HttpOnly cookie before the signer can run.
    const bindVerifiedRequest=bindPilotRequest(request,{mutation:true});
    const activate=createSignedAtomicConsentClient({
      db:activationDb,bindVerifiedRequest,getActiveSigningKey,
      proofHmacKey,receiptHmacKey,consentVersion:CONSENT_VERSION,now
    });
    return function activateForFamily({
      familyId,challengeId,consentReceiptId,
      businessAccountId:requestedBusiness,
      phoneNumberId:requestedPhone
    }={}){
      if((requestedBusiness!==undefined &&
          requestedBusiness!==businessAccountId)||
         (requestedPhone!==undefined &&
          requestedPhone!==phoneNumberId))
        throw new Error('WhatsApp destination not authorized');
      // Never forward actor, role, request/session objects, browser
      // consent flags or caller-selected consent policy version.
      return activate({
        familyId,businessAccountId,phoneNumberId,
        challengeId,consentReceiptId
      });
    };
  };
}
module.exports={createPilotAtomicConsentFactory};
