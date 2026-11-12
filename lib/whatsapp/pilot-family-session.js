'use strict';

/**
 * TTP244: internal preview-only bridge between the app-scoped HttpOnly
 * pilot login cookie and the canonical NexLupa family authorization model.
 *
 * No public route imports this module. No production IdP or Neon migrations
 * are enabled by merely adding this code.
 */
const {validatePilotConfig,localCookieValue,decodePilotSession}=
  require('./pilot-auth-bff');
const {createNeonAuthSessionVerifier}=
  require('./neon-auth-server-session');
const {createCanonicalVerifiedSessionResolver}=
  require('./canonical-verified-session');
const {createMembershipLookup}=require('./membership-store');
const {createRequestIdentityBinder}=require('./request-identity-binding');

function requestAllowed(request,origin,{mutation=true}={}){
  if(!request || !request.headers ||
     request.headers.host!==new URL(origin).host ||
     (request.headers['x-forwarded-proto'] &&
      request.headers['x-forwarded-proto']!=='https'))return false;
  if(mutation && (
    request.method!=='POST' ||
    request.headers.origin!==origin ||
    (request.headers['sec-fetch-site'] &&
     request.headers['sec-fetch-site']!=='same-origin')
  ))return false;
  // Read-only binding is explicitly for same-origin GET, not an
  // alternative route for POST/DELETE or cross-site browser requests.
  if(!mutation && (
    request.method!=='GET' ||
    (request.headers.origin && request.headers.origin!==origin) ||
    (request.headers['sec-fetch-site'] &&
     request.headers['sec-fetch-site']!=='same-origin')
  ))return false;
  return true;
}

function createPilotFamilyBinderFactory({
  env,db,fetchImpl=fetch,now=Date.now
}={}){
  const config=validatePilotConfig(env);
  if(!config)throw new Error('Preview pilot access is disabled');
  if(!db||typeof db.query!=='function')
    throw new TypeError('Restricted canonical family DB client required');
  const verifyProvider=createNeonAuthSessionVerifier({
    sessionUrl:config.authBase,
    issuer:config.authBase,
    audience:'nexlupa-pilot',
    fetchImpl,now
  });
  const getMembership=createMembershipLookup({db});

  return function bindPilotRequest(request,{mutation=true}={}){
    if(!requestAllowed(request,config.origin,{mutation}))
      throw new Error('Untrusted pilot request origin');
    // The browser has ONLY the HttpOnly __Host-nexlupa_pilot cookie.
    // Convert it to the provider's exact cookie name on the server.
    const encoded=localCookieValue(request.headers.cookie);
    const providerCookie=decodePilotSession(encoded);
    if(!providerCookie)throw new Error('Verified pilot session required');
    const serverContext=Object.freeze({
      headers:Object.freeze({cookie:providerCookie})
    });
    const getAuthenticatedSession=createCanonicalVerifiedSessionResolver({
      db,
      issuer:config.authBase,
      audience:'nexlupa-pilot',
      requestContext:serverContext,
      now,
      // Recheck remote session and allowlisted provider subject EVERY TIME.
      // A later account removal invalidates an already bound request.
      verifyRequestSession:async context=>{
        const verified=await verifyProvider(context);
        return verified && config.allowedSubjects.has(verified.subject)?
          verified:null;
      }
    });
    const bind=createRequestIdentityBinder({
      getAuthenticatedSession,getMembership,now
    });
    if(mutation)return bind;
    // Explicit GET read-only callers never receive consent mutation or
    // privileged transaction methods, even if endpoint wiring errs.
    return async function bindReadOnly(){
      const bound=await bind();
      return Object.freeze({
        getVerifiedPrincipal:()=>bound.getVerifiedPrincipal(),
        authorizeFamily:({familyId,action}={})=>
          action==='read_whatsapp_messages'?
            bound.authorizeFamily({familyId,action}):Promise.resolve(false)
      });
    };
  };
}

module.exports={createPilotFamilyBinderFactory,requestAllowed};
