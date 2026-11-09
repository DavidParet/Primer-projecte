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
  return function pairFromServerRequest(request){
    // Enforce same-origin POST and the authenticated host-only cookie
    // before returning a callable pairing operation.
    const bindVerifiedRequest=bindPilotRequest(request,{mutation:true});
    const issuer=createSignedFamilyPairingIssuer({
      db:pairingDb,pairingHmacKey,getActiveSigningKey,
      bindVerifiedRequest,now
    });
    return function issueForFamily({familyId,businessAccountId,phoneNumberId}={}){
      // Caller-supplied user IDs, session data and roles are deliberately
      // not forwarded to the signer or privileged PostgreSQL operation.
      return issuer({familyId,businessAccountId,phoneNumberId});
    };
  };
}

module.exports={createPilotPairingIssuerFactory};
