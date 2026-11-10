'use strict';

/**
 * TTP241: server-side Neon Auth / Better Auth session introspection adapter.
 *
 * This sends only the configured session cookie over TLS to the FIXED trusted
 * Neon Auth get-session endpoint. Neon Auth, not this module, validates the
 * session cookie server-side. NO IdP is provisioned or publicly enabled here.
 *
 * For sensitive consent changes the auth server must use the session database
 * (disableCookieCache=true) rather than accepting cached browser claims.
 */
const {createCanonicalVerifiedSessionResolver}=
  require('./canonical-verified-session');
const {createMembershipLookup}=
  require('./membership-store');
const {createRequestIdentityBinder}=
  require('./request-identity-binding');

const DEFAULT_COOKIE_NAMES=Object.freeze([
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  '__Host-better-auth.session_token'
]);
const COOKIE_NAME=/^(?:__Secure-|__Host-)?better-auth[.]session_token$/;
const COOKIE_VALUE=/^[\x21-\x3A\x3C-\x7E]{16,2048}$/;
const MAX_COOKIE_HEADER=8192;
const MAX_SESSION_REPLY=8192;
const MAX_SESSION_AGE_MS=30*24*3600*1000;

function sessionEndpoint(input) {
  if(typeof input!=='string')throw new TypeError('Pinned Neon Auth URL required');
  let parsed;
  try{parsed=new URL(input);}
  catch{throw new TypeError('Invalid Neon Auth URL');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
     parsed.search||parsed.hash||parsed.port||
     parsed.hostname==='localhost'||parsed.hostname.endsWith('.localhost')||
     /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)||
     parsed.hostname.includes(':')) {
    throw new TypeError('HTTPS Neon Auth URL required');
  }
  // Neon managed Better Auth returns a branch-specific BASE URL:
  // https://ep-...neonauth.../<db>/auth . Better Auth adds /get-session.
  // Keep the earlier self-hosted Better Auth endpoint for test compatibility.
  const neonBase=/^\/[A-Za-z0-9_-]{1,63}\/auth$/.test(parsed.pathname);
  const legacyEndpoint=parsed.pathname==='/api/auth/get-session';
  if(!neonBase&&!legacyEndpoint)
    throw new TypeError('Expected branch-scoped Neon Auth base URL');
  return new URL(parsed.origin+parsed.pathname+
    (neonBase?'/get-session':''));
}

function isolateSessionCookie(raw,allowedNames=DEFAULT_COOKIE_NAMES){
  if(typeof raw!=='string'||raw.length>MAX_COOKIE_HEADER||
    /[\r\n\x00]/.test(raw))return null;
  if(!Array.isArray(allowedNames)||allowedNames.length===0||
    allowedNames.some(name=>!COOKIE_NAME.test(name)))
    throw new TypeError('Only explicitly approved Better Auth cookies permitted');
  const found=[];
  for(const item of raw.split(';')){
    const p=item.trim(),idx=p.indexOf('=');
    if(idx<=0)continue;
    const name=p.slice(0,idx),value=p.slice(idx+1);
    if(allowedNames.includes(name)){
      if(!COOKIE_VALUE.test(value))return null;
      found.push(name+'='+value);
    }
  }
  // A request with two session cookie names is ambiguous: deny instead of
  // choosing one that may belong to another identity or security domain.
  return found.length===1?found[0]:null;
}

function parseTimestamp(value){
  if(typeof value!=='string'||value.length<20||value.length>40||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value))return null;
  const time=Date.parse(value);
  return Number.isSafeInteger(time)?time:null;
}

function createNeonAuthSessionVerifier({
  sessionUrl,issuer,audience,fetchImpl=fetch,now=Date.now,
  allowedCookieNames=DEFAULT_COOKIE_NAMES
}={}){
  const target=sessionEndpoint(sessionUrl);
  if(typeof issuer!=='string'||!issuer.trim()||
     typeof audience!=='string'||!audience.trim()||
     typeof fetchImpl!=='function'||typeof now!=='function')
    throw new TypeError('Trusted issuer/audience, fetch and clock required');

  // The exact provider issuer and session endpoint are deployment-scoped.
  // Reject a server config pointing the session cookie to another host.
  let providerOrigin;
  try{providerOrigin=new URL(issuer).origin;}catch{providerOrigin=null;}
  if(providerOrigin!==target.origin)
    throw new TypeError('Auth issuer and session endpoint must share origin');
  // A managed Neon endpoint is scoped to its exact database and branch.
  // Cross-database identity issuers must never be accepted interchangeably.
  const neonBaseIssuer=target.origin+target.pathname.slice(0,-'/get-session'.length);
  const isManagedEndpoint=target.pathname!=='/api/auth/get-session';
  if(isManagedEndpoint && issuer!==neonBaseIssuer)
    throw new TypeError('Auth issuer must match the exact Neon branch base URL');

  const fixedUrl=target.origin+target.pathname+'?disableCookieCache=true';

  return async function verifyRequestSession(serverRequest){
    // Only a trusted server request, NEVER a caller-provided headers object,
    // may enter this function from application wiring.
    const rawCookie=serverRequest?.headers?.cookie;
    const cookie=isolateSessionCookie(rawCookie,allowedCookieNames);
    if(!cookie)return null;
    const response=await fetchImpl(fixedUrl,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:Object.freeze({
        Cookie:cookie,Accept:'application/json',
        'Cache-Control':'no-store'
      })
    });
    if(!response||response.status===401||response.status===403)return null;
    if(response.status!==200)
      throw new Error('Identity service failed closed');
    if(!/^application\/json(?:\s*;|$)/i.test(
      String(response.headers?.get?.('content-type')||'')))
      throw new Error('Unexpected identity service response type');
    const reportedLength=Number(response.headers?.get?.('content-length')||0);
    if(reportedLength>MAX_SESSION_REPLY)
      throw new Error('Identity session response too large');
    const raw=await response.text();
    if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_SESSION_REPLY)
      throw new Error('Identity session response too large');
    let data;
    try{data=JSON.parse(raw);}catch{
      throw new Error('Malformed identity service response');
    }
    const user=data?.user,session=data?.session;
    if(!user||!session)return null;
    if(typeof user.id!=='string'||!user.id.trim()||
       user.id.length>256||
       typeof session.userId!=='string'||session.userId!==user.id||
       typeof session.id!=='string'||!session.id.trim()||
       session.id.length>256)return null;
    const createdAtMs=parseTimestamp(session.createdAt);
    const expiresAtMs=parseTimestamp(session.expiresAt);
    const time=now();
    if(createdAtMs===null||expiresAtMs===null||
      !Number.isSafeInteger(time)||createdAtMs>time||
      expiresAtMs<=time||createdAtMs>=expiresAtMs||
      expiresAtMs-createdAtMs>MAX_SESSION_AGE_MS)return null;
    return Object.freeze({
      verified:true,issuer,audience,
      subject:user.id,sessionId:session.id,
      issuedAtMs:createdAtMs,expiresAtMs,revoked:false
    });
  };
}

function createNeonAuthFamilyBinderFactory({
  db,sessionUrl,issuer,audience,fetchImpl=fetch,now=Date.now,
  allowedCookieNames=DEFAULT_COOKIE_NAMES
}={}){
  if(!db||typeof db.query!=='function')
    throw new TypeError('Restricted family database client required');
  const verifyRequestSession=createNeonAuthSessionVerifier({
    sessionUrl,issuer,audience,fetchImpl,now,allowedCookieNames
  });
  const getMembership=createMembershipLookup({db});
  return function bindServerRequest(request){
    // Capture the session cookie on THIS request only, never from JSON body.
    const cookie=request?.headers?.cookie;
    const requestContext=Object.freeze({
      headers:Object.freeze({cookie})
    });
    const getAuthenticatedSession=createCanonicalVerifiedSessionResolver({
      db,verifyRequestSession,requestContext,issuer,audience,now
    });
    return createRequestIdentityBinder({
      getAuthenticatedSession,getMembership,now
    });
  };
}

module.exports={
  createNeonAuthSessionVerifier,createNeonAuthFamilyBinderFactory,
  isolateSessionCookie,sessionEndpoint,DEFAULT_COOKIE_NAMES
};
