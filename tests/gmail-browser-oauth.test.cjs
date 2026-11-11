'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {beginBrowserOAuth,completeBrowserOAuth,getStateCookie,clearStateCookie,validateRedirectUri,COOKIE_NAME}=require('../lib/gmail/browser-oauth.cjs');
const {createHash}=require('node:crypto');
const familyId='10000000-0000-4000-8000-000000000001';
const authUserId='20000000-0000-4000-8000-000000000001';
const session={kind:'family-session',verifiedByServer:true,familyId,authUserId,sessionId:'verified-original-session'};
const clientId='123456789123.apps.googleusercontent.com';
const clientSecret='mock-client-secret';
const redirectUri='https://pilot.example.com/api/gmail/pilot/callback';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
  let saved=null,used=false,tokenCalls=0,identityCalls=0,authorized=0,consent=true;
  const saveIntent=async value=>{saved=value};
  const takeBrowserIntent=async ({stateDigest,sessionBinding})=>{
    if(used||!saved||saved.stateDigest!==stateDigest||saved.sessionBinding!==sessionBinding)return null;
    used=true;return saved;
  };
  const fetchImpl=async(url,opts)=>{
    if(url==='https://oauth2.googleapis.com/token'){
      tokenCalls++;assert.equal(opts.method,'POST');return {ok:true,json:async()=>({
        access_token:'temporary-access-token',scope:'openid email https://www.googleapis.com/auth/gmail.readonly',expires_in:1800
      })};
    }
    if(url==='https://openidconnect.googleapis.com/v1/userinfo'){
      identityCalls++;return {ok:true,json:async()=>({sub:'1234567890123456',email:'TEST@example.com',email_verified:true})};
    }
    throw Error('unexpected_network_call');
  };
  const base={clientId,clientSecret,redirectUri,
    checkCurrentFamilyConsent:async()=>consent,fetchImpl,
    onAuthorized:async result=>{authorized++;assert.equal(result.familyId,familyId);assert.equal(result.authUserId,authUserId);assert.match(result.familySession.sessionId,/^[A-Za-z0-9_-]{43}$/);assert.equal(result.accessToken,'temporary-access-token');}
  };
  return {base,saveIntent,takeBrowserIntent,get saved(){return saved},get tokenCalls(){return tokenCalls},get identityCalls(){return identityCalls},get authorized(){return authorized},setConsent:b=>{consent=b}};
}
async function started(f){
  const begin=await beginBrowserOAuth({familySession:session,clientId,redirectUri,saveIntent:f.saveIntent,hasCurrentConsent:async()=>true});
  const state=new URL(begin.authorizationUrl).searchParams.get('state');
  const nonce=getStateCookie(begin.setCookie);
  return {begin,state,nonce,cookieHeader:COOKIE_NAME+'='+nonce};
}
test('begin creates secure browser-only state cookie and binds state+family+user',async()=>{
  const f=fixture(),a=await started(f);
  assert.ok(a.begin.setCookie.includes('Secure; HttpOnly; SameSite=Lax'));
  assert.ok(a.begin.setCookie.includes('Max-Age=240'));
  assert.equal(a.begin.expiresInSeconds,240);
  assert.match(a.state,/^[A-Za-z0-9_-]{43}$/);
  assert.match(a.nonce,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.state,a.nonce);
  assert.equal(f.saved.sessionBinding,hash(a.nonce));
  assert.equal(f.saved.authUserId,authUserId);
  assert.equal(f.saved.familyId,familyId);
  assert.equal(f.saved.stateDigest,hash(a.state));
  assert.ok(!JSON.stringify(a.begin).includes(f.saved.codeVerifier));
});
test('callback is single-use and exchanges only after matching browser cookie',async()=>{
  const f=fixture(),a=await started(f);
  const res=await completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:a.cookieHeader,state:a.state,code:'mock-code'});
  assert.deepEqual(res,{status:'authorized_for_single_pilot_action',googleEmail:'test@example.com'});
  assert.equal(f.tokenCalls,1);assert.equal(f.identityCalls,1);assert.equal(f.authorized,1);
  await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:a.cookieHeader,state:a.state,code:'mock-code'}),/oauth_state_rejected/);
  assert.equal(f.tokenCalls,1);
});
test('different browser cookie cannot consume or exchange OAuth code',async()=>{
  const f=fixture(),a=await started(f);
  await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:COOKIE_NAME+'='+('z'.repeat(43)),state:a.state,code:'mock-code'}),/oauth_state_rejected/);
  assert.equal(f.tokenCalls,0);assert.equal(f.authorized,0);
});
test('missing or duplicate cookie is rejected before DB consumption',async()=>{
  const f=fixture(),a=await started(f);
  for(const header of ['',COOKIE_NAME+'='+a.nonce+'; '+COOKIE_NAME+'='+a.nonce]){
    await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
      cookieHeader:header,state:a.state,code:'mock-code'}),/invalid_browser_state/);
  }
  assert.equal(f.tokenCalls,0);
});
test('unknown, forged or missing callback state is denied',async()=>{
  const f=fixture(),a=await started(f);
  for(const state of ['x', 'a'.repeat(43),'']){
    await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
      cookieHeader:a.cookieHeader,state,code:'mock-code'}),/invalid_browser_state|oauth_state_rejected/);
  }
  assert.equal(f.tokenCalls,0);
});
test('revoked consent blocks Google token exchange even after state validation',async()=>{
  const f=fixture(),a=await started(f);f.setConsent(false);
  await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:a.cookieHeader,state:a.state,code:'mock-code'}),/gmail_consent_required/);
  assert.equal(f.tokenCalls,0);
});
test('Google refusal consumes state and cannot subsequently be replayed',async()=>{
  const f=fixture(),a=await started(f);
  await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:a.cookieHeader,state:a.state,error:'access_denied'}),/oauth_consent_declined/);
  await assert.rejects(completeBrowserOAuth({...f.base,takeBrowserIntent:f.takeBrowserIntent,
    cookieHeader:a.cookieHeader,state:a.state,code:'mock-code'}),/oauth_state_rejected/);
  assert.equal(f.tokenCalls,0);
});
test('invalid preview redirect URLs are blocked',()=>{
  for(const x of ['http://pilot.example.com/api/gmail/pilot/callback',
    'https://pilot.example.com/other','https://pilot.example.com/api/gmail/pilot/callback?code=x',
    'https://user@pilot.example.com/api/gmail/pilot/callback']){
    assert.throws(()=>validateRedirectUri(x),/invalid_pilot_redirect_uri/);
  }
  assert.equal(validateRedirectUri(redirectUri),redirectUri);
});
test('cookie clearing is secure, short and does not reveal state',()=>{
  assert.equal(clearStateCookie(),COOKIE_NAME+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
});
