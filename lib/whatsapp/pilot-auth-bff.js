'use strict';

/**
 * TTP243: preview-only backend-for-frontend for Neon Auth email/password.
 * NOT a live login entrypoint. Enabled only with all explicit pilot gates.
 * The browser receives only an app-scoped HttpOnly cookie, never a Neon
 * session token in JSON or localStorage. Provider verifies sessions remotely.
 */
const {createNeonAuthSessionVerifier,sessionEndpoint}=
  require('./neon-auth-server-session');

const PILOT_COOKIE='__Host-nexlupa_pilot';
const COOKIE_VALUE=/^[\x21-\x3A\x3C-\x7E]{16,2048}$/;
const MAX_BODY=4096;

function validatePilotConfig(env) {
  if(env?.VERCEL_ENV!=='preview' ||
     env?.NEXLUPA_AUTH_PILOT!=='enabled')return null;
  let origin,authBase;
  try{
    origin=new URL(env.NEXLUPA_AUTH_PILOT_ORIGIN);
    authBase=new URL(env.NEXLUPA_AUTH_BASE_URL);
    sessionEndpoint(authBase.href);
  }catch{return null;}
  if(origin.protocol!=='https:' || origin.pathname!=='/' ||
     origin.search||origin.hash||origin.port||origin.username||
     origin.password|| !origin.hostname.endsWith('.vercel.app') ||
     authBase.protocol!=='https:' || !authBase.hostname.includes('.neonauth.') ||
     !/^\/[A-Za-z0-9_-]{1,63}\/auth$/.test(authBase.pathname)||
     authBase.search||authBase.hash||authBase.port)
    return null;
  return Object.freeze({origin:origin.origin,authBase:authBase.origin+authBase.pathname});
}

function localCookieValue(header) {
  if(typeof header!=='string'||header.length>8192||
    /[\r\n\x00]/.test(header))return null;
  const matches=[];
  for(const segment of header.split(';')){
    const piece=segment.trim();
    if(piece.startsWith(PILOT_COOKIE+'=')){
      const token=piece.slice(PILOT_COOKIE.length+1);
      if(!COOKIE_VALUE.test(token))return null;
      matches.push(token);
    }
  }
  return matches.length===1?matches[0]:null;
}

function providerSessionCookie(response){
  const list=response?.headers?.getSetCookie?.();
  if(!Array.isArray(list)||list.length>15)return null;
  const tokens=[];
  for(const str of list){
    if(typeof str!=='string'||str.length>8192)continue;
    const match=/^((?:__Secure-|__Host-)?better-auth\.session_token)=([^;]+)(?:;|$)/.exec(str);
    if(match&&COOKIE_VALUE.test(match[2]))tokens.push(match);
  }
  return tokens.length===1?tokens[0][1]+'='+tokens[0][2]:null;
}

function safeHeaders(res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'");
}

function reply(res,code,state){
  return res.status(code).json({state});
}

function cookieForBrowser(token){
  // Host-only cookie; no Domain; never expose token to page JavaScript.
  return PILOT_COOKIE+'='+token+
    '; Path=/api/pilot-auth; Secure; HttpOnly; SameSite=Strict; Max-Age=3600';
}
const clearCookie=PILOT_COOKIE+
  '=; Path=/api/pilot-auth; Secure; HttpOnly; SameSite=Strict; Max-Age=0';

function requestHostMatches(req,origin){
  const target=new URL(origin);
  const host=req?.headers?.host;
  const proto=req?.headers?.['x-forwarded-proto'];
  return host===target.host && (!proto||proto==='https');
}

function readInput(req){
  const n=Number(req?.headers?.['content-length']??0);
  if(!Number.isFinite(n)||n<0||n>MAX_BODY)
    throw new Error('Invalid body size');
  if(!/^application\/json(?:\s*;|$)/i.test(
    String(req?.headers?.['content-type']||'')))
    throw new Error('JSON content type required');
  const body=req.body;
  const parsed=Buffer.isBuffer(body)||typeof body==='string'?
    JSON.parse(body.toString('utf8')):body;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
     Buffer.byteLength(JSON.stringify(parsed),'utf8')>MAX_BODY)
    throw new Error('Invalid pilot request');
  return parsed;
}

function createPilotAuthHandler({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  const config=validatePilotConfig(env);
  return async function handle(req,res){
    safeHeaders(res);
    // Never expose an auth route on main/prod, even if environment variables
    // accidentally leak into the production deployment.
    if(!config)return reply(res,404,'not_found');
    if(!requestHostMatches(req,config.origin))
      return reply(res,403,'forbidden_host');
    if(!['GET','POST'].includes(req.method)){
      res.setHeader('Allow','GET, POST');
      return reply(res,405,'method_not_allowed');
    }
    if(req.method==='POST' &&
       (req.headers.origin!==config.origin ||
        (req.headers['sec-fetch-site']&&
         req.headers['sec-fetch-site']!=='same-origin')))
      return reply(res,403,'forbidden_origin');

    const loginCookie=localCookieValue(req.headers.cookie);
    const verify=createNeonAuthSessionVerifier({
      sessionUrl:config.authBase,issuer:config.authBase,
      audience:'nexlupa-pilot',fetchImpl,now
    });

    if(req.method==='GET'){
      if(!loginCookie)return reply(res,200,'signed_out');
      try{
        const result=await verify({
          headers:{cookie:'better-auth.session_token='+loginCookie}
        });
        if(result)return reply(res,200,'authenticated');
        res.setHeader('Set-Cookie',clearCookie);
        return reply(res,200,'signed_out');
      }catch{
        return reply(res,503,'auth_unavailable');
      }
    }

    let input;
    try{input=readInput(req);}
    catch{return reply(res,400,'invalid_request');}
    if(input.action==='sign_out'){
      res.setHeader('Set-Cookie',clearCookie);
      if(!loginCookie)return reply(res,200,'signed_out');
      try{
        const response=await fetchImpl(config.authBase+'/sign-out',{
          method:'POST',redirect:'error',cache:'no-store',
          headers:{
            Cookie:'better-auth.session_token='+loginCookie,
            'Content-Type':'application/json',Origin:config.origin
          },
          body:'{}'
        });
        if(!response||response.status<200||response.status>=300)
          return reply(res,503,'remote_logout_unconfirmed');
        return reply(res,200,'signed_out');
      }catch{return reply(res,503,'remote_logout_unconfirmed');}
    }
    if(input.action!=='sign_in'||typeof input.email!=='string'||
      typeof input.password!=='string'||input.email.length>254||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)||
      input.password.length<8||input.password.length>512)
      return reply(res,400,'invalid_request');

    try{
      const result=await fetchImpl(config.authBase+'/sign-in/email',{
        method:'POST',redirect:'error',cache:'no-store',
        headers:{
          'Content-Type':'application/json',
          Accept:'application/json',
          Origin:config.origin
        },
        body:JSON.stringify({email:input.email,password:input.password})
      });
      if(!result)return reply(res,503,'auth_unavailable');
      if(result.status===401||result.status===403||
        result.status===400||result.status===422)
        return reply(res,401,'invalid_credentials');
      if(result.status!==200)
        return reply(res,503,'auth_unavailable');
      const providerCookie=providerSessionCookie(result);
      if(!providerCookie)return reply(res,503,'auth_cookie_missing');
      const verified=await verify({headers:{cookie:providerCookie}});
      if(!verified)return reply(res,503,'auth_verification_failed');
      res.setHeader('Set-Cookie',
        cookieForBrowser(providerCookie.slice(providerCookie.indexOf('=')+1)));
      return reply(res,200,'authenticated');
    }catch{
      return reply(res,503,'auth_unavailable');
    }
  };
}
module.exports={createPilotAuthHandler,validatePilotConfig,
  providerSessionCookie,localCookieValue,PILOT_COOKIE};
