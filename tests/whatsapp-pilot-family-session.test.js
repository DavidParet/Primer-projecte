'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPilotFamilyBinderFactory}=
  require('../lib/whatsapp/pilot-family-session');
const {PILOT_COOKIE,encodePilotSession}=
  require('../lib/whatsapp/pilot-auth-bff');
const {RESOLVE_CANONICAL_USER_SQL}=
  require('../lib/whatsapp/canonical-verified-session');
const {MEMBERSHIP_SQL}=
  require('../lib/whatsapp/membership-store');

const NOW=1800000000000;
const ORIGIN='https://nexlupa-internal-ci.vercel.app';
const AUTH='https://ep-test.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const TOKEN_A='SYNTHETIC-NEXLUPA-PILOT-SESSION-A-123456';
const TOKEN_B='SYNTHETIC-NEXLUPA-PILOT-SESSION-B-654321';
const env=Object.freeze({
  VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
  NEXLUPA_AUTH_PILOT_ORIGIN:ORIGIN,NEXLUPA_AUTH_BASE_URL:AUTH,
  NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'external-a,external-b'
});
function request(token=TOKEN_A,options={}){
  const providerCookie='better-auth.session_token='+token;
  return {
    method:'POST',
    headers:{
      host:'nexlupa-internal-ci.vercel.app',
      'x-forwarded-proto':'https',
      origin:ORIGIN,
      'sec-fetch-site':'same-origin',
      cookie:PILOT_COOKIE+'='+encodePilotSession(providerCookie),
      ...options.headers
    },
    body:{userId:'canonical-b',familyId:B,role:'owner'}
  };
}
function session(subject,sessionId='ci-session'){
  return {
    user:{id:subject,email:'not-returned@example.test'},
    session:{
      id:sessionId,userId:subject,
      createdAt:new Date(NOW-60000).toISOString(),
      expiresAt:new Date(NOW+60000).toISOString()
    }
  };
}
function fixture(){
  const calls=[],seen=[];let revoked=false;
  const lookup=new Map([
    ['external-a','canonical-a'],
    ['external-b','canonical-b']
  ]);
  const memberships=new Map([
    ['canonical-a|'+A,'owner'],
    ['canonical-b|'+B,'admin'],
    ['canonical-b|'+A,'member']
  ]);
  const db={async query(sql,args){
    calls.push({sql,args});
    if(sql===RESOLVE_CANONICAL_USER_SQL){
      const user=lookup.get(args[1]);
      return {rows:user?[{user_id:user}]:[]};
    }
    if(sql===MEMBERSHIP_SQL){
      const role=memberships.get(args.join('|'));
      return {rows:role?[{
        user_id:args[0],family_id:args[1],
        role,active:true,revoked:false
      }]:[]};
    }
    throw Error('Attempted unapproved table operation');
  }};
  const fetchImpl=async(url,opts)=>{
    seen.push({url,opts});
    const cookie=opts.headers.Cookie;
    const subject=cookie==='better-auth.session_token='+TOKEN_A?
      'external-a':cookie==='better-auth.session_token='+TOKEN_B?
      'external-b':null;
    const response=revoked||!subject?null:session(subject);
    return {
      status:response?200:401,
      headers:{get:key=>key==='content-type'?'application/json':null},
      text:async()=>JSON.stringify(response)
    };
  };
  const factory=createPilotFamilyBinderFactory({
    env,db,fetchImpl,now:()=>NOW
  });
  return {
    factory,calls,seen,lookup,memberships,
    revoke(){revoked=true;}
  };
}

test('BFF pilot cookie authorizes canonical Family A, not forged body Family B',async()=>{
  const f=fixture();
  const binder=await f.factory(request(),{mutation:true})();
  assert.equal(await binder.authorizeFamily({
    familyId:A,action:'enroll_whatsapp_sender'
  }),true);
  assert.equal(await binder.authorizeFamily({
    familyId:B,action:'read_whatsapp_messages'
  }),false);
  assert.equal((await binder.getVerifiedPrincipal()).userId,'canonical-a');
  assert.ok(f.seen.length>=4);
  assert.equal(f.seen.every(call=>call.url===
    AUTH+'/get-session?disableCookieCache=true'),true);
  assert.equal(f.seen.every(call=>
    call.opts.headers.Cookie==='better-auth.session_token='+TOKEN_A),true);
  assert.equal(f.calls.some(c=>c.args.includes('canonical-b')),false);
  assert.equal(f.calls.some(c=>c.sql.includes('FROM public.nex_family_memberships')),false);
});

test('two different provider sessions maintain separate family roles',async()=>{
  const f=fixture();
  const a=await f.factory(request(TOKEN_A),{mutation:true})();
  const b=await f.factory(request(TOKEN_B),{mutation:true})();
  assert.equal(await a.authorizeFamily({familyId:A,action:'enroll_whatsapp_sender'}),true);
  assert.equal(await a.authorizeFamily({familyId:B,action:'enroll_whatsapp_sender'}),false);
  assert.equal(await b.authorizeFamily({familyId:A,action:'read_whatsapp_messages'}),true);
  assert.equal(await b.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await b.authorizeFamily({familyId:B,action:'enroll_whatsapp_sender'}),true);
});

test('unauthorized host, wrong origin and a GET mutation are rejected before provider/DB',()=>{
  const f=fixture();
  for(const bad of [
    request(TOKEN_A,{headers:{host:'app.nexlupa.app'}}),
    request(TOKEN_A,{headers:{'x-forwarded-proto':'http'}}),
    request(TOKEN_A,{headers:{origin:'https://attacker.example.test'}}),
    request(TOKEN_A,{headers:{'sec-fetch-site':'cross-site'}}),
    {...request(),method:'GET'},
    {method:'POST',headers:{origin:ORIGIN,host:'evil.example.test',
      cookie:PILOT_COOKIE+'='+encodePilotSession(
        'better-auth.session_token='+TOKEN_A)}}
  ])assert.throws(()=>f.factory(bad,{mutation:true}),/Untrusted/);
  assert.equal(f.seen.length,0);
  assert.equal(f.calls.length,0);
});

test('family operations reject unsafe GET by default; explicit read-only use is separate',async()=>{
  const f=fixture();
  const req={...request(),method:'GET',headers:{...request().headers}};
  assert.throws(()=>f.factory(req),/Untrusted pilot request origin/);
  assert.equal(f.seen.length,0);
  // Read-only introspection may be explicitly selected, but does not
  // downgrade the default access policy for family mutations.
  const binder=await f.factory(req,{mutation:false})();
  assert.equal(await binder.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),true);
  assert.equal(await binder.authorizeFamily({
    familyId:A,action:'enroll_whatsapp_sender'
  }),false);
  assert.equal(await binder.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(typeof binder.authorizeFamilyTransaction,'undefined');
  assert.equal(f.seen.length>=2,true);
});

test('read-only pilot binding refuses POST, cross-site GET and wrong Origin',()=>{
  const f=fixture();
  const baseline={...request(),method:'GET'};
  for(const bad of [
    {...request(),method:'POST'},
    {...request(),method:'DELETE'},
    {...baseline,headers:{...baseline.headers,origin:'https://attacker.example.test'}},
    {...baseline,headers:{...baseline.headers,'sec-fetch-site':'cross-site'}},
    {...baseline,headers:{...baseline.headers,'sec-fetch-site':'same-site'}},
    {...baseline,headers:{...baseline.headers,host:'unrelated.vercel.app'}}
  ]){
    assert.throws(()=>f.factory(bad,{mutation:false}),
      /Untrusted pilot request origin/);
  }
  assert.equal(f.calls.length,0);
  assert.equal(f.seen.length,0);
  assert.doesNotThrow(()=>f.factory(baseline,{mutation:false}));
});

test('missing, malformed and duplicate host cookies never contact provider',()=>{
  const f=fixture();
  const good=request();
  for(const cookie of [
    '',undefined,'arbitrary='+TOKEN_A,
    PILOT_COOKIE+'=malformed',
    good.headers.cookie+'; '+good.headers.cookie
  ]){
    assert.throws(()=>f.factory(request(TOKEN_A,{headers:{cookie}})),/session/);
  }
  assert.equal(f.seen.length,0);
  assert.equal(f.calls.length,0);
});

test('disabling pilot configuration or missing family database fails at setup',()=>{
  const f=fixture();
  for(const bad of [
    {},{...env,VERCEL_ENV:'production'},
    {...env,NEXLUPA_AUTH_PILOT:'disabled'},
    {...env,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:''}
  ])assert.throws(()=>createPilotFamilyBinderFactory({
    env:bad,db:{query:async()=>({rows:[]})}
  }),/disabled/);
  assert.throws(()=>createPilotFamilyBinderFactory({env}),/DB client/);
});

test('revoking an IdP session after binding denies subsequent family operations',async()=>{
  const f=fixture(),bound=await f.factory(request(),{mutation:true})();
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),true);
  f.revoke();
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(await bound.getVerifiedPrincipal(),null);
});

test('removing verified identity mapping cancels access on the next operation',async()=>{
  const f=fixture(),bound=await f.factory(request(),{mutation:true})();
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),true);
  f.lookup.delete('external-a');
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),false);
});

test('signed-in user removed from pilot allowlist cannot bind to any family',async()=>{
  const outsiderEnv={...env,NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:'external-b'};
  let providerCalls=0,dbCalls=0;
  const factory=createPilotFamilyBinderFactory({
    env:outsiderEnv,now:()=>NOW,
    db:{query:async()=>{dbCalls++;return {rows:[{user_id:'canonical-a'}]};}},
    fetchImpl:async()=>{
      providerCalls++;
      return {status:200,
        headers:{get:name=>name==='content-type'?'application/json':null},
        text:async()=>JSON.stringify(session('external-a'))};
    }
  });
  await assert.rejects(factory(request(),{mutation:true})(),/Verified active server session/);
  assert.equal(providerCalls,1);
  assert.equal(dbCalls,0);
});

test('failed remote provider call cannot silently authorize a family',async()=>{
  const factory=createPilotFamilyBinderFactory({
    env,now:()=>NOW,db:{query:async()=>({rows:[]})},
    fetchImpl:async()=>{throw Error('SYNTHETIC IDP OUTAGE');}
  });
  await assert.rejects(factory(request(),{mutation:true})(),/SYNTHETIC IDP OUTAGE/);
});
