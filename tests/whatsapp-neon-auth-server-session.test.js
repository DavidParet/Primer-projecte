'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createNeonAuthSessionVerifier,createNeonAuthFamilyBinderFactory,
  isolateSessionCookie,sessionEndpoint
}=require('../lib/whatsapp/neon-auth-server-session');
const {RESOLVE_CANONICAL_USER_SQL}=
  require('../lib/whatsapp/canonical-verified-session');
const {MEMBERSHIP_SQL}=
  require('../lib/whatsapp/membership-store');

const NOW=1800000000000;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const ISSUER='https://auth.example.test';
const URL=ISSUER+'/api/auth/get-session';
const COOKIE_A='better-auth.session_token=CI-SYNTHETIC-SESSION-TOKEN-A';
const COOKIE_B='better-auth.session_token=CI-SYNTHETIC-SESSION-TOKEN-B';
const audience='nexlupa-backend';

function fakeSession(userId='external-a',sessionId='session-a',overrides={}){
  return {
    user:{id:userId,name:'SYNTHETIC DISPLAY NAME',email:'synthetic@example.test'},
    session:{
      id:sessionId,userId,
      createdAt:new Date(NOW-60000).toISOString(),
      expiresAt:new Date(NOW+60000).toISOString(),
      token:'SYNTHETIC-NEVER-EXPOSE',
      ...overrides
    }
  };
}
function response(data,{status=200,contentType='application/json',
  contentLength}={}){
  const dataText=JSON.stringify(data);
  return {
    status,headers:{get:(key)=>{
      if(key==='content-type')return contentType;
      if(key==='content-length')return contentLength??null;
      return null;
    }},
    text:async()=>dataText
  };
}
function server({session=fakeSession(),reply,now=()=>NOW}={}){
  const calls=[];
  const fetchImpl=async(...args)=>{
    calls.push(args);
    return reply??response(session);
  };
  const getSession=createNeonAuthSessionVerifier({
    sessionUrl:URL,issuer:ISSUER,audience,fetchImpl,now
  });
  return {getSession,calls};
}
function request(cookie=COOKIE_A,body={}){
  return {headers:{cookie,
    authorization:'Bearer attacker-jwt',
    'x-user-id':'other-person',
    'x-family-id':B,
    'x-forwarded-host':'evil.example.test'
  },body};
}

test('pinned Neon Auth URL must be HTTPS, exactly get-session, no redirects',()=>{
  assert.equal(sessionEndpoint(URL).pathname,'/api/auth/get-session');
  for(const invalid of [
    'http://auth.example.test/api/auth/get-session',
    'https://user:pass@auth.example.test/api/auth/get-session',
    'https://auth.example.test/api/auth/get-session?token=fake',
    'https://auth.example.test/api/auth/get-session#fragment',
    'https://127.0.0.1/api/auth/get-session',
    'https://localhost/api/auth/get-session',
    'https://auth.example.test:8443/api/auth/get-session',
    'https://auth.example.test/redirect',
    'https://[::1]/api/auth/get-session'
  ])assert.throws(()=>sessionEndpoint(invalid));
  assert.throws(()=>createNeonAuthSessionVerifier({
    sessionUrl:URL,issuer:'https://other-provider.example.test',
    audience,fetchImpl:async()=>null
  }),/share origin/);
});

test('forward exactly one approved opaque session cookie; never unrelated data',()=>{
  assert.equal(isolateSessionCookie('trace=hi; '+COOKIE_A+'; analytics=test'),
    COOKIE_A);
  assert.equal(isolateSessionCookie(
    '__Secure-better-auth.session_token=CI-SYNTHETIC-SECURE-TOKEN'),
    '__Secure-better-auth.session_token=CI-SYNTHETIC-SECURE-TOKEN');
  for(const h of [
    'other_auth=CI-SYNTHETIC-SESSION-TOKEN-A',
    '',
    'better-auth.session_token=short',
    COOKIE_A+'; '+COOKIE_B,
    COOKIE_A+'; __Secure-better-auth.session_token=CI-SYNTHETIC-SECONDARY',
    COOKIE_A+'\r\nx-secret: 1',
    'a'.repeat(8193)
  ])assert.equal(isolateSessionCookie(h),null);
  assert.throws(()=>isolateSessionCookie(COOKIE_A,['attacker_cookie']),
    /approved Better Auth/);
});

test('session is verified remotely on EVERY check, without client headers',async()=>{
  const f=server();
  const result=await f.getSession(request(COOKIE_A,{userId:'forged-admin'}));
  assert.deepEqual(result,{
    verified:true,issuer:ISSUER,audience,
    subject:'external-a',sessionId:'session-a',
    issuedAtMs:NOW-60000,expiresAtMs:NOW+60000,revoked:false
  });
  assert.equal(Object.isFrozen(result),true);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],
    URL+'?disableCookieCache=true');
  assert.equal(f.calls[0][1].method,'GET');
  assert.equal(f.calls[0][1].redirect,'error');
  assert.equal(f.calls[0][1].cache,'no-store');
  assert.deepEqual(f.calls[0][1].headers,{
    Cookie:COOKIE_A,Accept:'application/json',
    'Cache-Control':'no-store'
  });
  assert.equal(JSON.stringify(result).includes('synthetic@example.test'),false);
  await f.getSession(request());
  assert.equal(f.calls.length,2,'No caching of revoked session decisions');
});

test('session token, user claims and unknown headers cannot be presented alone',async()=>{
  const f=server();
  assert.equal(await f.getSession(request(undefined)),null);
  assert.equal(await f.getSession({headers:{authorization:'Bearer forged-jwt'}}),null);
  assert.equal(await f.getSession({body:{session:fakeSession()}}),null);
  assert.equal(f.calls.length,0);
});

test('identity service rejects login and expired sessions without positive claims',async()=>{
  for(const status of [401,403]){
    const f=server({reply:response(null,{status})});
    assert.equal(await f.getSession(request()),null);
  }
  for(const payload of [
    {user:null,session:null},
    fakeSession('external-a','session-a',{userId:'external-b'}),
    fakeSession('external-a','session-a',{
      expiresAt:new Date(NOW-1000).toISOString()
    }),
    fakeSession('external-a','session-a',{
      createdAt:new Date(NOW+1000).toISOString()
    }),
    fakeSession('external-a','session-a',{
      expiresAt:new Date(NOW+32*24*3600*1000).toISOString()
    }),
    fakeSession('external-a','',{userId:'external-a'}),
    fakeSession('external-a','session-a',{createdAt:'not-a-time'})
  ]){
    const f=server({session:payload});
    assert.equal(await f.getSession(request()),null);
  }
});

test('outage, malformed type, or oversized response never authorizes family',async()=>{
  const failed=[
    response({}, {status:500}),
    response({user:{id:'external-a'}},{contentType:'text/html'}),
    response(fakeSession(),{contentLength:'9001'}),
    {status:200,headers:{get:()=> 'application/json'},
      text:async()=>'{broken json'},
    {status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify(fakeSession())+'x'.repeat(9000)}
  ];
  for(const reply of failed){
    const f=server({reply});
    await assert.rejects(f.getSession(request()));
  }
  const fail=createNeonAuthSessionVerifier({
    sessionUrl:URL,issuer:ISSUER,audience,
    fetchImpl:async()=>{throw Error('Provider unavailable');}
  });
  await assert.rejects(fail(request()),/Provider unavailable/);
});

function familyBackend(){
  let revoked=false,disabled=false;
  const calls=[];
  const ids=new Map([['external-a','canonical-a'],['external-b','canonical-b']]);
  const memberships=new Map([
    ['canonical-a|'+A,'owner'],['canonical-b|'+B,'admin'],
    ['canonical-b|'+A,'member']
  ]);
  const db={
    async query(sql,args){
      calls.push({sql,args});
      if(sql===RESOLVE_CANONICAL_USER_SQL){
        const id=ids.get(args[1]);
        return {rows:id&&!disabled?[{user_id:id}]:[]};
      }
      if(sql===MEMBERSHIP_SQL){
        const role=memberships.get(args[0]+'|'+args[1]);
        return {rows:role&&!revoked?[{
          user_id:args[0],family_id:args[1],role,
          active:true,revoked:false
        }]:[]};
      }
      throw Error('Direct raw account table query forbidden');
    }
  };
  const received=[];
  const fetchImpl=async(_url,options)=>{
    received.push(options);
    const token=options.headers.Cookie;
    if(revoked)return response(null);
    if(token===COOKIE_A)return response(fakeSession());
    if(token===COOKIE_B)
      return response(fakeSession('external-b','session-b'));
    return response(null,{status:401});
  };
  const factory=createNeonAuthFamilyBinderFactory({
    db,sessionUrl:URL,issuer:ISSUER,audience,
    fetchImpl,now:()=>NOW
  });
  return {
    factory,calls,received,
    revoke(){revoked=true;},
    disable(){disabled=true;},
    unlinkUser(user){ids.delete(user);}
  };
}

test('two verified Neon accounts have independent canonical family permissions',async()=>{
  const f=familyBackend();
  const a=await f.factory(request(COOKIE_A))();
  assert.equal(await a.authorizeFamily({
    familyId:A,action:'enroll_whatsapp_sender'
  }),true);
  assert.equal(await a.authorizeFamily({
    familyId:B,action:'read_whatsapp_messages'
  }),false);
  const b=await f.factory(request(COOKIE_B))();
  assert.equal(await b.authorizeFamily({
    familyId:B,action:'enroll_whatsapp_sender'
  }),true);
  assert.equal(await b.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),true);
  assert.equal(await b.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(f.calls.some(c=>c.sql.includes('FROM public.nex_family_memberships')),false);
  assert.ok(f.received.length>=6);
});

test('identity revocation removes privileges on the NEXT provider check',async()=>{
  const f=familyBackend();
  const admin=await f.factory(request(COOKIE_A))();
  assert.equal(await admin.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),true);
  f.revoke();
  assert.equal(await admin.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(await admin.getVerifiedPrincipal(),null);
});

test('a revoked canonical link or disabled user fails closed after a valid session',async()=>{
  const f=familyBackend();
  const binder=await f.factory(request(COOKIE_A))();
  f.unlinkUser('external-a');
  assert.equal(await binder.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),false);
  const g=familyBackend();
  const other=await g.factory(request(COOKIE_B))();
  g.disable();
  assert.equal(await other.authorizeFamily({
    familyId:B,action:'read_whatsapp_messages'
  }),false);
});

test('request body cannot replace protected Neon server cookies or family ID',async()=>{
  const f=familyBackend();
  const forged=request(COOKIE_A,{
    actor:{authenticated:true,role:'owner',userId:'canonical-b'},
    session:{userId:'canonical-b'},
    familyId:B
  });
  const binder=await f.factory(forged)();
  assert.equal(await binder.authorizeFamily({
    familyId:B,action:'enroll_whatsapp_sender'
  }),false);
  assert.deepEqual(f.calls[0].args,[ISSUER,'external-a']);
});

test('missing signed cookie never reaches Neon Auth or canonical database',async()=>{
  const f=familyBackend();
  await assert.rejects(f.factory({headers:{authorization:'Bearer forged'}})(),
    /Verified active server session required/);
  assert.equal(f.received.length,0);
  assert.equal(f.calls.length,0);
});
