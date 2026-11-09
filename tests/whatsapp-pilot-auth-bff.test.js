'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {
  createPilotAuthHandler,validatePilotConfig,providerSessionCookie,
  localCookieValue,encodePilotSession,decodePilotSession,PILOT_COOKIE
}=require('../lib/whatsapp/pilot-auth-bff');

const NOW=1800000000000;
const ORIGIN='https://nexlupa-pilot-example.vercel.app';
const AUTH='https://ep-ci.neonauth.c-7.eu-central-1.aws.neon.tech/nexlupa_pilot/auth';
const SESSION='CI-SYNTHETIC-OPAQUE-SESSION-TOKEN-1234567890';
const enabled=Object.freeze({
  VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
  NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN,NEXLUPA_AUTH_BASE_URL:AUTH,
  NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'fake-provider-user'
});

function request(method='GET',options={}){
 const input=options.body;
 const headers={
  host:'nexlupa-pilot-example.vercel.app',
  'x-forwarded-proto':'https',
  cookie:options.cookie,
  origin:ORIGIN,
  'content-type':'application/json',
  'sec-fetch-site':'same-origin'
 };
 return {method,headers:{...headers,...options.headers},body:input};
}
function response(){
 return {
  statusCode:200,headers:{},result:null,
  setHeader(k,v){this.headers[k.toLowerCase()]=v;},
  status(n){this.statusCode=n;return this;},
  json(data){this.result=data;return this;}
 };
}
function providerResponse(data,{status=200,cookie=null}={}){
 const raw=JSON.stringify(data);
 return {
  status,
  headers:{
    get:(header)=>header==='content-type'?'application/json':null,
    getSetCookie:()=>cookie?[cookie]:[]
  },
  text:async()=>raw
 };
}
function session(){
 return {user:{id:'fake-provider-user',email:'not-returned@example.test'},
  session:{id:'fake-session-id',userId:'fake-provider-user',
   createdAt:new Date(NOW-60000).toISOString(),
   expiresAt:new Date(NOW+60000).toISOString(),
   token:'NEVER-RETURN-IN-HTTP'
  }};
}
function mockProvider({cookieName='better-auth.session_token',signInStatus=200,
 sessionData=session(),throwOn=null,logoutStatus=200}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(throwOn && url.includes(throwOn))throw Error('Sensitive synthetic upstream error');
  if(url.endsWith('/sign-in/email'))
   return providerResponse({ok:signInStatus===200},{
     status:signInStatus,
     cookie:signInStatus===200?
      cookieName+'='+SESSION+'; HttpOnly; Secure; Path=/':null
   });
  if(url.includes('/get-session?'))return providerResponse(sessionData);
  if(url.endsWith('/sign-out'))
   return providerResponse(null,{status:logoutStatus});
  throw Error('Unapproved auth endpoint');
 };
 return {calls,fetchImpl};
}
async function run(handler,req){
 const res=response();
 await handler(req,res);
 return res;
}

test('production, wrong preview and unconfigured instances cannot open auth proxy',async()=>{
 const f=mockProvider();
 for(const env of [
  {},{...enabled,VERCEL_ENV:'production'},
  {...enabled,NEXLUPA_AUTH_PILOT:'disabled'},
  {...enabled,NEXLUPA_AUTH_PILOT_ORIGIN:'https://app.nexlupa.app'},
  {...enabled,NEXLUPA_AUTH_BASE_URL:'http://localhost/auth'},
  {...enabled,NEXLUPA_AUTH_BASE_URL:'https://evil.example.test/db/auth'},
  {...enabled,NEXLUPA_AUTH_BASE_URL:'https://ep-fake.neonauth.attacker.invalid/db/auth'},
  {...enabled,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:''},
  {...enabled,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'fake-provider-user,fake-provider-user'},
  {...enabled,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'invalid subject'},
  {...enabled,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'bad'}
 ]){
  assert.equal(validatePilotConfig(env),null);
  const h=createPilotAuthHandler({env,fetchImpl:f.fetchImpl,now:()=>NOW});
  const result=await run(h,request('POST',{
    body:{action:'sign_in',email:'ci@example.test',password:'ci-test-secret'}
  }));
  assert.equal(result.statusCode,404);
  assert.equal(result.result.state,'not_found');
 }
 assert.equal(f.calls.length,0);
});

test('only explicitly allowlisted verified IdP subjects may use pilot login',async()=>{
 const outsider={...session(),
  user:{id:'not-on-test-list',email:'not-a-real-user@example.test'},
  session:{...session().session,userId:'not-on-test-list'}
 };
 const f=mockProvider({sessionData:outsider});
 const h=createPilotAuthHandler({env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW});
 const denied=await run(h,request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:'ci-test-password'}
 }));
 assert.equal(denied.statusCode,403);
 assert.deepEqual(denied.result,{state:'pilot_access_denied'});
 assert.equal(denied.headers['set-cookie'],undefined);
 assert.equal(f.calls.length,2);
 const local=encodePilotSession('better-auth.session_token='+SESSION);
 const existing=await run(h,request('GET',{cookie:PILOT_COOKIE+'='+local}));
 assert.equal(existing.statusCode,200);
 assert.deepEqual(existing.result,{state:'signed_out'});
 assert.match(existing.headers['set-cookie'],/Max-Age=0/);
});

test('pilot requires an exact Vercel preview host and matching POST origin',async()=>{
 const f=mockProvider();
 const handler=createPilotAuthHandler({
   env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW
 });
 for(const headers of [
  {host:'app.nexlupa.app'},
  {host:'evil.example.test'},
  {origin:'https://evil.example.test'},
  {'sec-fetch-site':'cross-site'},
  {'x-forwarded-proto':'http'}
 ]){
  const result=await run(handler,request('POST',{
    headers,body:{action:'sign_in',email:'ci@example.test',password:'ci-test-secret'}
  }));
  assert.equal(result.statusCode,403);
 }
 assert.equal(f.calls.length,0);
});

test('provider sign-in requires a second independently validated session read',async()=>{
 const f=mockProvider();
 const handler=createPilotAuthHandler({
   env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW
 });
 const secret='ci-test-password';
 const res=await run(handler,request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:secret}
 }));
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.result,{state:'authenticated'});
 const setCookie=res.headers['set-cookie'];
 assert.match(setCookie,/^__Host-nexlupa_pilot=/);
 assert.match(setCookie,/; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
 assert.equal(setCookie.includes('Domain='),false);
 assert.equal(JSON.stringify(res.result).includes(secret),false);
 assert.equal(JSON.stringify(res.result).includes('fake-provider-user'),false);
 assert.equal(JSON.stringify(res.result).includes(SESSION),false);
 assert.deepEqual(f.calls.map(x=>x.url),[
  AUTH+'/sign-in/email',AUTH+'/get-session?disableCookieCache=true'
 ]);
 assert.equal(f.calls[1].options.headers.Cookie,
  'better-auth.session_token='+SESSION);
 assert.equal(f.calls[0].options.redirect,'error');

 const localSet=setCookie.split(';')[0];
 const verified=await run(handler,request('GET',{cookie:localSet}));
 assert.deepEqual(verified.result,{state:'authenticated'});
 assert.equal(f.calls.length,3);
 assert.equal(f.calls[2].options.headers.Cookie,
  'better-auth.session_token='+SESSION);
});

test('secure provider cookie prefixes survive app-scoped cookie translation',async()=>{
 for(const name of [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  '__Host-better-auth.session_token'
 ]){
  const cookie=name+'='+SESSION;
  const encoded=encodePilotSession(cookie);
  assert.equal(decodePilotSession(encoded),cookie);
  const f=mockProvider({cookieName:name});
  const h=createPilotAuthHandler({env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW});
  const res=await run(h,request('POST',{
   body:{action:'sign_in',email:'ci@example.test',password:'ci-test-password'}
  }));
  assert.equal(res.statusCode,200);
  assert.equal(f.calls[1].options.headers.Cookie,cookie);
 }
});

test('client data never substitutes for valid session cookie',async()=>{
 const f=mockProvider();
 const h=createPilotAuthHandler({env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW});
 for(const cookie of [
  undefined,
  'other.session='+SESSION,
  PILOT_COOKIE+'=not-a-real-session',
  PILOT_COOKIE+'='+encodePilotSession('better-auth.session_token='+SESSION)+
   '; '+PILOT_COOKIE+'='+encodePilotSession('better-auth.session_token='+SESSION)
 ]){
  const result=await run(h,request('GET',{cookie}));
  assert.equal(result.statusCode,200);
  assert.equal(result.result.state,'signed_out');
 }
 assert.equal(f.calls.length,0);
 assert.equal(localCookieValue('other=value'),null);
});

test('bad credentials, malformed inputs and missing provider cookie fail closed',async()=>{
 const invalid=mockProvider({signInStatus:401});
 const h=createPilotAuthHandler({
  env:enabled,fetchImpl:invalid.fetchImpl,now:()=>NOW
 });
 const result=await run(h,request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:'not-the-password'}
 }));
 assert.equal(result.statusCode,401);
 assert.equal(result.result.state,'invalid_credentials');
 assert.equal(result.headers['set-cookie'],undefined);
 for(const bad of [
  {action:'sign_up',email:'ci@example.test',password:'secretpass'},
  {action:'sign_in',email:'invalid',password:'secretpass'},
  {action:'sign_in',email:'ci@example.test',password:'short'}
 ]){
  const r=await run(h,request('POST',{body:bad}));
  assert.equal(r.statusCode,400);
 }
 const withoutCookie=mockProvider({cookieName:'untrusted.session'});
 const missing=await run(createPilotAuthHandler({
  env:enabled,fetchImpl:withoutCookie.fetchImpl,now:()=>NOW
 }),request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:'validpassword'}
 }));
 assert.equal(missing.statusCode,503);
 assert.equal(missing.result.state,'auth_cookie_missing');
});

test('unavailable remote session cannot be misreported as authenticated',async()=>{
 const f=mockProvider({sessionData:{user:null,session:null}});
 const h=createPilotAuthHandler({env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW});
 const r=await run(h,request('POST',{
   body:{action:'sign_in',email:'ci@example.test',password:'validpassword'}
 }));
 assert.equal(r.statusCode,503);
 assert.equal(r.result.state,'auth_verification_failed');
 assert.equal(r.headers['set-cookie'],undefined);
 const down=mockProvider({throwOn:'/sign-in/email'});
 const d=await run(createPilotAuthHandler({
  env:enabled,fetchImpl:down.fetchImpl,now:()=>NOW
 }),request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:'validpassword'}
 }));
 assert.equal(d.statusCode,503);
 assert.equal(JSON.stringify(d.result).includes('Sensitive'),false);
});

test('sign out revokes remote provider and erases host-only browser session',async()=>{
 const f=mockProvider();
 const h=createPilotAuthHandler({env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW});
 const local=encodePilotSession('better-auth.session_token='+SESSION);
 const res=await run(h,request('POST',{
  cookie:PILOT_COOKIE+'='+local,
  body:{action:'sign_out'}
 }));
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.result,{state:'signed_out'});
 assert.match(res.headers['set-cookie'],/Max-Age=0/);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].options.headers.Cookie,
  'better-auth.session_token='+SESSION);
 const outage=mockProvider({logoutStatus:503});
 const failed=await run(createPilotAuthHandler({
  env:enabled,fetchImpl:outage.fetchImpl,now:()=>NOW
 }),request('POST',{cookie:PILOT_COOKIE+'='+local,body:{action:'sign_out'}}));
 assert.equal(failed.statusCode,503);
 assert.equal(failed.result.state,'remote_logout_unconfirmed');
 assert.match(failed.headers['set-cookie'],/Max-Age=0/);
});

test('wrong method and content type never contact provider',async()=>{
 const f=mockProvider(),h=createPilotAuthHandler({
  env:enabled,fetchImpl:f.fetchImpl,now:()=>NOW
 });
 assert.equal((await run(h,request('PATCH'))).statusCode,405);
 assert.equal((await run(h,request('POST',{
  body:{action:'sign_in',email:'ci@example.test',password:'validpassword'},
  headers:{'content-type':'text/plain'}
 }))).statusCode,400);
 assert.equal(f.calls.length,0);
});

test('production static build omits pilot assets; gated preview includes them',()=>{
 const root=path.resolve(__dirname,'..');
 const command=path.join(root,'scripts/build-static.js');
 const base={...process.env,VERCEL_ENV:'production',
  NEXLUPA_AUTH_PILOT:'enabled',
  NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN};
 const production=spawnSync(process.execPath,[command],{
  cwd:root,env:base,encoding:'utf8'
 });
 assert.equal(production.status,0,production.stderr);
 assert.equal(fs.existsSync(path.join(root,'public/pilot-auth/index.html')),false);
 const preview=spawnSync(process.execPath,[command],{
  cwd:root,env:{...base,VERCEL_ENV:'preview'},encoding:'utf8'
 });
 assert.equal(preview.status,0,preview.stderr);
 assert.equal(fs.existsSync(path.join(root,'public/pilot-auth/index.html')),true);
 // Leave the working tree in the SAFE production output state.
 const cleanup=spawnSync(process.execPath,[command],{
  cwd:root,env:{...base,VERCEL_ENV:'production'},encoding:'utf8'
 });
 assert.equal(cleanup.status,0,cleanup.stderr);
 assert.equal(fs.existsSync(path.join(root,'public/pilot-auth/index.html')),false);
});
