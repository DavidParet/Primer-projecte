'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createCanonicalVerifiedSessionResolver,RESOLVE_CANONICAL_USER_SQL
}=require('../lib/whatsapp/canonical-verified-session');
const {createMembershipLookup,MEMBERSHIP_SQL}=
  require('../lib/whatsapp/membership-store');
const {createRequestIdentityBinder}=
  require('../lib/whatsapp/request-identity-binding');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const NOW=1800000000000;
const ISSUER_A='https://idp.example.test';
const ISSUER_B='https://second-idp.example.test';
const AUDIENCE='nexlupa-backend';

function source(issuer=ISSUER_A,overrides={}) {
  return {
    verified:true,issuer,audience:AUDIENCE,
    subject:'same-subject',sessionId:'server-sid-1',
    issuedAtMs:NOW-60000,expiresAtMs:NOW+60000,
    revoked:false,...overrides
  };
}
function createMock(){
  const calls=[];
  const mappings=new Map([
    [ISSUER_A+'|same-subject','canonical-a'],
    [ISSUER_B+'|same-subject','canonical-b']
  ]);
  const memberships=new Map([
    ['canonical-a|'+A,{role:'owner'}],
    ['canonical-b|'+B,{role:'admin'}],
    ['canonical-b|'+A,{role:'member'}]
  ]);
  const db={async query(sql,args){
    calls.push({sql,args});
    if(sql===RESOLVE_CANONICAL_USER_SQL){
      const user=mappings.get(args.join('|'));
      return {rows:user?[{user_id:user}]:[]};
    }
    if(sql===MEMBERSHIP_SQL){
      const row=memberships.get(args.join('|'));
      return {rows:row?[{
        user_id:args[0],family_id:args[1],
        role:row.role,active:true,revoked:false
      }]:[]};
    }
    throw Error('Direct private table query refused');
  }};
  return {db,calls,mappings,memberships};
}
function sessionResolver(db,issuer=ISSUER_A,getClaims=async()=>source(issuer)){
  return createCanonicalVerifiedSessionResolver({
    db,issuer,audience:AUDIENCE,now:()=>NOW,
    requestContext:Object.freeze({request:'server-auth-context'}),
    verifyRequestSession:getClaims
  });
}

test('same external subject maps to different internal users across issuers',async()=>{
  const m=createMock();
  const a=await sessionResolver(m.db)();
  const b=await sessionResolver(m.db,ISSUER_B)();
  assert.equal(a.userId,'canonical-a');
  assert.equal(b.userId,'canonical-b');
  assert.notEqual(a.sessionId,b.sessionId);
  assert.equal(a.authenticated,true);
  assert.equal(Object.isFrozen(a),true);
  assert.deepEqual(m.calls.map(c=>c.sql),
    [RESOLVE_CANONICAL_USER_SQL,RESOLVE_CANONICAL_USER_SQL]);
  assert.deepEqual(m.calls.map(c=>c.args),[
    [ISSUER_A,'same-subject'],
    [ISSUER_B,'same-subject']
  ]);
});

test('canonical family permissions work with request-pinned verified session',async()=>{
  const m=createMock();
  const first=createRequestIdentityBinder({
    getAuthenticatedSession:sessionResolver(m.db),
    getMembership:createMembershipLookup({db:m.db}),
    now:()=>NOW
  });
  const a=await first();
  assert.equal(await a.authorizeFamily({familyId:A,action:'enroll_whatsapp_sender'}),true);
  assert.equal(await a.authorizeFamily({familyId:B,action:'read_whatsapp_messages'}),false);
  assert.equal((await a.getVerifiedPrincipal()).userId,'canonical-a');

  const second=createRequestIdentityBinder({
    getAuthenticatedSession:sessionResolver(m.db,ISSUER_B),
    getMembership:createMembershipLookup({db:m.db}),now:()=>NOW
  });
  const b=await second();
  assert.equal(await b.authorizeFamily({familyId:A,action:'read_whatsapp_messages'}),true);
  assert.equal(await b.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await b.authorizeFamily({familyId:B,action:'enroll_whatsapp_sender'}),true);
});

test('an unverified or wrong-audience IdP result never reaches database',async()=>{
  const m=createMock();
  for(const claims of [
    source(ISSUER_A,{verified:false}),
    source(ISSUER_A,{audience:'untrusted-web-client'}),
    source(ISSUER_A,{issuer:ISSUER_B}),
    source(ISSUER_A,{expiresAtMs:NOW}),
    source(ISSUER_A,{revoked:true})
  ]){
    assert.equal(await sessionResolver(m.db,ISSUER_A,async()=>claims)(),null);
  }
  assert.equal(m.calls.length,0);
});

test('account disable or identity unlink invalidates next session resolution',async()=>{
  const m=createMock();
  const resolve=sessionResolver(m.db);
  assert.equal((await resolve()).userId,'canonical-a');
  m.mappings.delete(ISSUER_A+'|same-subject');
  assert.equal(await resolve(),null);
  assert.equal(m.calls.length,2);
});

test('swapping provider session or mapped account inside request is rejected',async()=>{
  const m=createMock();
  let claims=source();
  const canonical=sessionResolver(m.db,ISSUER_A,async()=>claims);
  const binder=createRequestIdentityBinder({
    getAuthenticatedSession:canonical,
    getMembership:createMembershipLookup({db:m.db}),now:()=>NOW
  });
  const bound=await binder();
  claims={...claims,sessionId:'swapped-server-session'};
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  claims=source();
  m.mappings.set(ISSUER_A+'|same-subject','canonical-b');
  assert.equal(await bound.authorizeFamily({
    familyId:A,action:'read_whatsapp_messages'
  }),false);
});

test('ambiguous or malformed internal mapping fails closed',async()=>{
  const db={query:async()=>({rows:[{user_id:'canonical-a'},{user_id:'canonical-b'}]})};
  await assert.rejects(sessionResolver(db)(),/Ambiguous/);
  for(const rows of [[{user_id:'not a canonical id'}],[],[{user_id:null}]]) {
    const broken={query:async()=>({rows})};
    assert.equal(await sessionResolver(broken)(),null);
  }
});

test('DB outage never becomes an authenticated family session',async()=>{
  const db={query:async()=>{throw Error('Neon unavailable');}};
  await assert.rejects(sessionResolver(db)(),/Neon unavailable/);
});

test('untrusted request body identity never reaches verified provider callback',async()=>{
  const m=createMock(),contexts=[];
  const getSession=createCanonicalVerifiedSessionResolver({
    db:m.db,issuer:ISSUER_A,audience:AUDIENCE,now:()=>NOW,
    requestContext:Object.freeze({requestId:'server-context-1'}),
    verifyRequestSession:async c=>{
      contexts.push(c);
      return source();
    }
  });
  await getSession({userId:'canonical-b',role:'owner',familyId:B});
  assert.deepEqual(contexts,[{requestId:'server-context-1'}]);
  assert.deepEqual(m.calls[0].args,[ISSUER_A,'same-subject']);
});
