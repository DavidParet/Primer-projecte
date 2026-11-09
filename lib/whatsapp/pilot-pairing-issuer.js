'use strict';

/**
 * TTP245: preview-only authenticated family -> signed WhatsApp pairing.
 *
 * This is an INTERNAL factory, not a public Vercel endpoint. A real pilot
 * requires approved server sessions, canonical memberships and SQL roles.
 * Do not call this from a route that accepts unrestricted browser identity.
 */
const {createPilotFamilyBinderFactory}=
  require('./pilot-family-session');
const {createSignedFamilyPairingIssuer}=
  require('./signed-family-pairing');
const {WHATSAPP_ID}=require('./family-pairing-protocol');

function createPilotPairingIssuerFactory({
  env,identityDb,pairingDb,pairingHmacKey,getActiveSigningKey,
  fetchImpl=fetch,now=Date.now
}={}){
  if(!identityDb||typeof identityDb.query!=='function')
    throw new TypeError('Read-only canonical identity DB client required');
  if(!pairingDb||typeof pairingDb.connect!=='function')
    throw new TypeError('Restricted signed pairing DB pool required');
  const bindPilotRequest=createPilotFamilyBinderFactory({
    env,db:identityDb,fetchImpl,now
  });
  // Route identity is deployment configuration, not a browser input.
  const businessAccountId=env?.WHATSAPP_WABA_ID;
  const phoneNumberId=env?.WHATSAPP_PHONE_NUMBER_ID;
  if(!WHATSAPP_ID.test(businessAccountId||'')||
     !WHATSAPP_ID.test(phoneNumberId||''))
    throw new Error('Trusted pilot WhatsApp business identity required');
  return function pairFromServerRequest(request){
    // Enforce same-origin POST and the authenticated host-only cookie
    // before returning a callable pairing operation.
    const bindVerifiedRequest=bindPilotRequest(request,{mutation:true});
    const issuer=createSignedFamilyPairingIssuer({
      db:pairingDb,pairingHmacKey,getActiveSigningKey,
      bindVerifiedRequest,now
    });
    return function issueForFamily({
      familyId,businessAccountId:requestedBusiness,
      phoneNumberId:requestedPhone
    }={}){
      // Client must not choose or change the official WhatsApp destination.
      if((requestedBusiness!==undefined && requestedBusiness!==businessAccountId)||
         (requestedPhone!==undefined && requestedPhone!==phoneNumberId))
        throw new Error('WhatsApp pairing destination not authorized');
      // Caller-supplied userId, role and session are never forwarded.
      return issuer({familyId,businessAccountId,phoneNumberId});
    };
  };
}

module.exports={createPilotPairingIssuerFactory};
