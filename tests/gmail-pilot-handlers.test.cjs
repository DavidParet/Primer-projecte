'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {makePilotHandlers}=require('../lib/gmail/pilot-handlers.cjs');

const familyId='10000000-0000-4000-8000-000000000001';
const authUserId='20000000-0000-4000-8000-000000000001';
const label='Label_123';
const origin='https://nexlupa-pilot.example.com';
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const goodConfig=()=>({
  enabled:true,clientId:'dummy.apps.googleusercontent.com',
  clientSecret:'invisible-fake-secret',
  redirectUri:origin+'/api/gmail/callback',
  cookieKey:randomBytes(32).toString('base64url'),
  pilotLabelId:label
});
const makeResponse=()=>({
  headers:{},code:200,body:undefined,
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},
  status(n){this.code=n;return this},
  json(v){this.body=v;return this},
  send(v){this.body=v;return this}
});
function factory({
  allowed=true,
  verified=true,
  fakeSubject='123456789000001',
  fakeText='Excursió <div> prevista per al 15 de març',
  fakeTitle='Sortida escolar',
  settings=goodConfig()
}={}){
  const intents=new Map(), calls={verified:0,db:0,provider:[],consumed:0};
  let permission=allowed;
  const verifyFamily=async({authorization,requestedFamilyId})=>{
    calls.verified++;
    if(!verified)throw Error('authentication_required');
    if(authorization!=='Bearer valid-jwt' || requestedFamilyId!==familyId)throw Error('family_not_authorized');
    return {kind:'family-session',verifiedByServer:true,familyId,authUserId,sessionId:'server-verified-session-id'};
  };
  const pgQuery=async(_sql,params)=>{
    calls.db++;
    assert.deepEqual(params,[authUserId,familyId]);
    return {rows:[{allowed:permission}]};
  };
  const store=()=>{
    return {
      saveIntent:async intent=>{assert.equal(intents.has(intent.stateDigest),false);intents.set(intent.stateDigest,intent)},
      takeIntent:async key=>{calls.consumed++;const v=intents.get(key);intents.delete(key);return v||null}
    };
  };
  const fetchImpl=async(url,options)=>{
    const u=new URL(url);calls.provider.push({url:u.href,method:options.method});
    if(u.hostname==='oauth2.googleapis.com')return {ok:true,json:async()=>({
      access_token:'opaque-temporary-test-token',scope:'openid email '+SCOPE,expires_in:900
    })};
    if(u.hostname==='openidconnect.googleapis.com')return {ok:true,json:async()=>({
      sub:fakeSubject,email:'Pilot@example.com',email_verified:true
    })};
    if(u.pathname.endsWith('/messages'))return {ok:true,json:async()=>({messages:[{id:'m1'}]})};
    if(u.pathname.endsWith('/messages/m1'))return {ok:true,json:async()=>({
      id:'m1',labelIds:[label],sizeEstimate:111,payload:{
        mimeType:'text/plain',headers:[
          {name:'Subject',value:fakeTitle},{name:'From',value:'escola@example.com'}],
        body:{data:Buffer.from(fakeText).toString('base64url')}
      }
    })};
    throw Error('Unexpected provider route');
  };
  const handlers=makePilotHandlers({verifyFamily,pgQuery,createIntentStore:store,settings,fetchImpl});
  async function start(overrides={}){
    const req={method:'POST',headers:{
      origin,'content-type':'application/json',authorization:'Bearer valid-jwt','content-length':'62'
    },body:{familyId},...overrides};
    const res=makeResponse();
    await handlers.start(req,res);
    return res;
  }
  async function callback(startResponse,overrides={}){
    const u=new URL(startResponse.body.authorizationUrl);
    const req={method:'GET',query:{state:u.searchParams.get('state'),code:'synthetic-code'},
      headers:{cookie:startResponse.headers['set-cookie'].split(';')[0]},...overrides};
    const res=makeResponse();await handlers.callback(req,res);return res;
  }
  return {handlers,start,callback,calls,intents,settings,setAllowed:x=>{permission=x;}};
}
test('start returns scoped Google authorization and sets encrypted HttpOnly cookie',async()=>{
  const f=factory(),res=await f.start();
  assert.equal(res.code,200);assert.equal(res.body.scope,'gmail.readonly');
  assert.equal(res.body.expiresInSeconds,240);
  const u=new URL(res.body.authorizationUrl);
  assert.equal(u.hostname,'accounts.google.com');
  assert.equal(u.searchParams.get('access_type'),'online');
  assert.match(u.searchParams.get('scope'),/gmail\.readonly/);
  assert.ok(res.headers['set-cookie'].includes('Secure; HttpOnly; SameSite=Lax'));
  assert.equal(f.intents.size,1);
  assert.equal(f.calls.provider.length,0);
});
test('complete callback reads one synthetic email and only renders escaped text',async()=>{
  const f=factory({fakeTitle:'Sortida <script>alert(1)</script>'});
  const start=await f.start(),result=await f.callback(start);
  assert.equal(result.code,200);
  assert.match(result.body,/Correus preparats per revisar/);
  assert.match(result.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(result.body,/<script>alert\(1\)<\/script>/);
  assert.match(result.body,/history\.replaceState/);
  assert.match(result.body,/No s’han analitzat amb IA ni desat/);
  assert.ok(!result.body.includes('opaque-temporary-test-token'));
  assert.ok(!result.body.includes('synthetic-code'));
  assert.equal(f.calls.provider.length,4);
  assert.equal(f.intents.size,0);
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  assert.equal(result.headers['referrer-policy'],'no-referrer');
});
test('no request works without the pilot being explicitly enabled',async()=>{
  const f=factory({settings:{...goodConfig(),enabled:false}});
  const r=await f.start();
  assert.equal(r.code,503);
  assert.equal(f.calls.db,0);
  assert.equal(f.calls.provider.length,0);
});
test('cross-origin requests are rejected before authorization',async()=>{
  const f=factory();
  const r=await f.start({headers:{origin:'https://malicious.example','content-type':'application/json',
    authorization:'Bearer valid-jwt'}});
  assert.equal(r.code,403);assert.equal(f.calls.verified,0);
});
test('missing JWT cannot produce consent URL',async()=>{
  const f=factory({verified:false}),r=await f.start();
  assert.equal(r.code,401);assert.equal(f.intents.size,0);
});
test('revoked consent blocks start before creating state',async()=>{
  const f=factory({allowed:false}),r=await f.start();
  assert.equal(r.code,403);assert.equal(f.intents.size,0);
});
test('tampered cookie blocks callback without exchanging code',async()=>{
  const f=factory(),s=await f.start(),u=new URL(s.body.authorizationUrl);
  const r=makeResponse();await f.handlers.callback({
    method:'GET',query:{state:u.searchParams.get('state'),code:'synthetic-code'},
    headers:{cookie:s.headers['set-cookie'].split(';')[0].slice(0,-4)+'xxxx'}
  },r);
  assert.equal(r.code,400);assert.equal(f.calls.provider.length,0);
});
test('replay of a successful callback is blocked by one-time store',async()=>{
  const f=factory(),s=await f.start();
  const one=await f.callback(s),two=await f.callback(s);
  assert.equal(one.code,200);assert.equal(two.code,400);
  assert.equal(f.calls.consumed,2);
  assert.equal(f.calls.provider.length,4);
});
test('revocation between start and callback denies all Gmail access',async()=>{
  const f=factory(),s=await f.start();f.setAllowed(false);
  const r=await f.callback(s);
  assert.equal(r.code,400);assert.equal(f.calls.provider.length,0);
});
test('the Google denied-consent path cannot read email',async()=>{
  const f=factory(),s=await f.start(),u=new URL(s.body.authorizationUrl);
  const r=await f.callback(s,{query:{state:u.searchParams.get('state'),error:'access_denied'}});
  assert.equal(r.code,400);
  assert.equal(f.calls.provider.length,0);
});
test('missing or incorrect state never exchanges Google code',async()=>{
  const f=factory(),s=await f.start();
  const r=await f.callback(s,{query:{state:'x'.repeat(43),code:'synthetic-code'}});
  assert.equal(r.code,400);assert.equal(f.calls.provider.length,0);
});
test('JSON body family cannot choose an unauthorized family',async()=>{
  const f=factory(),r=await f.start({body:{familyId:'10000000-0000-4000-8000-000000000002'}});
  assert.equal(r.code,403);assert.equal(f.intents.size,0);
});
test('callback rejects all request verbs except top-level GET',async()=>{
  const f=factory(),s=await f.start();
  const r=await f.callback(s,{method:'POST'});
  assert.equal(r.code,405);
  assert.equal(f.calls.provider.length,0);
});
