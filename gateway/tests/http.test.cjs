'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {makeHttpHandler,rawBody,enabled,ALLOWED_BRANCH}=
  require('../lib/http-handler.cjs');
const {validateConnectionString,readConfig,createRuntimeHandler}=
  require('../lib/runtime.cjs');

const secret='whsec_'+Buffer.alloc(32,19).toString('base64');
const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const familyId='11111111-2222-4333-8444-555555555555';
const validConfig={
  vercelEnv:'preview',gitRef:ALLOWED_BRANCH,enabled:'true',
  configured:true,webhookSecret:secret
};
function rawEvent() {
  return JSON.stringify({type:'email.received',data:{
    email_id:'a21b31b7-d82b-48af-8a5f-749ec74262c3',
    from:'Untrusted <attacker@invalid.example>',
    to:[recipient],subject:'Do not run instructions',attachments:[]
  }});
}
function request(method='GET',raw='',headers={}){
  let reads=0;
  return {
    method,headers,
    get reads(){return reads;},
    get body(){throw Error('parsed_body_must_never_be_accessed');},
    async *[Symbol.asyncIterator](){
      reads++;
      if(raw)yield Buffer.from(raw);
    }
  };
}
function signedHeaders(raw){
  const stamp=String(Math.floor(Date.now()/1000));
  const id='msg_dummy_123';
  const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(id+'.'+stamp+'.'+raw,'utf8').digest('base64');
  return {'svix-id':id,'svix-timestamp':stamp,
    'svix-signature':'v1,'+signature,'content-type':'application/json'};
}
function response(){
 const headers={};
 return {
   statusCode:200,headers,body:undefined,
   setHeader(key,value){headers[key.toLowerCase()]=value;},
   end(body){this.body=body;}
 };
}
async function run(handler,req){
 const res=response();
 await handler(req,res);
 return res;
}
function mockAdapters(outcome='inserted',track={count:0}){
 return async()=>{
   track.count++;
   return {
     resolveAuthorizedRecipient:async()=>({
       familyId,active:true,consentActive:true
     }),
     enqueueReceipt:async()=>outcome
   };
 };
}

test('production and unrelated branch always fail closed regardless of feature flag',async()=>{
 for(const conf of [
   {...validConfig,vercelEnv:'production'},
   {...validConfig,gitRef:'main'},
   {...validConfig,gitRef:'feature/other'},
   {...validConfig,enabled:'false'}
 ]){
   assert.equal(enabled(conf),false);
   const req=request('POST',rawEvent(),signedHeaders(rawEvent()));
   const res=await run(makeHttpHandler({config:conf,createAdapters:mockAdapters()}),req);
   assert.equal(res.statusCode,503);
   assert.equal(req.reads,0);
   assert.equal(JSON.parse(res.body).error,'pilot_disabled');
 }
});

test('GET is inert, redacted and does not touch request body or backend',async()=>{
 const track={count:0};
 const req=request();
 const res=await run(makeHttpHandler({
   config:validConfig,createAdapters:mockAdapters('inserted',track)
 }),req);
 assert.equal(res.statusCode,200);
 assert.equal(req.reads,0);
 assert.equal(track.count,0);
 assert.deepEqual(JSON.parse(res.body),{
   configurationPresent:true,databaseConnectivityVerified:false,
   mode:'isolated-forwarding-pilot',
   emailBodiesFetched:false,metadataReceiptsEnabled:true,
   productionEnabled:false
 });
 assert.equal(res.headers['cache-control'],'no-store, private');
 assert.equal(res.headers['x-robots-tag'],'noindex, nofollow');
 assert.doesNotMatch(res.body,/whsec_|postgres|nexlupa_resend_ingest/);
});

test('missing secrets cause explicit disabled preflight even with feature flag enabled',async()=>{
 const env={
   VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:ALLOWED_BRANCH,
   FORWARDING_PILOT_ENABLED:'true'
 };
 const conf=readConfig(env);
 assert.equal(conf.configured,false);
 const res=await run(createRuntimeHandler(env),request('POST','{}'));
 assert.equal(res.statusCode,503);
 assert.equal(JSON.parse(res.body).error,'pilot_disabled');
});

test('signed fictional receipt is acknowledged without leaking data',async()=>{
 const raw=rawEvent(),track={count:0};
 const req=request('POST',raw,signedHeaders(raw));
 const res=await run(makeHttpHandler({
  config:validConfig,createAdapters:mockAdapters('inserted',track)
 }),req);
 assert.equal(res.statusCode,204);
 assert.equal(res.body,undefined);
 assert.equal(req.reads,1);
 assert.equal(track.count,1);
 assert.equal(res.headers['content-type'],undefined);
});

test('duplicate, unsupported, and revoked receipts return empty 204',async()=>{
 const raw=rawEvent();
 for(const result of ['duplicate','revoked']){
   const res=await run(makeHttpHandler({
     config:validConfig,createAdapters:mockAdapters(result)
   }),request('POST',raw,signedHeaders(raw)));
   assert.equal(res.statusCode,204);
   assert.equal(res.body,undefined);
 }
});

test('invalid signatures never initialize database or process data',async()=>{
 const raw=rawEvent(),track={count:0};
 const req=request('POST',raw,{
   ...signedHeaders(raw),'svix-signature':'v1,'+Buffer.alloc(32).toString('base64')
 });
 const res=await run(makeHttpHandler({
  config:validConfig,createAdapters:mockAdapters('inserted',track)
 }),req);
 assert.equal(res.statusCode,400);
 assert.equal(track.count,0);
 assert.equal(JSON.parse(res.body).error,'invalid_webhook');
 assert.doesNotMatch(res.body,/recipient|family|attacker|Do not run/);
});

test('oversized or invalid UTF-8 raw bodies are rejected before backend',async()=>{
 const huge='a'.repeat(16385),track={count:0};
 const res=await run(makeHttpHandler({
    config:validConfig,createAdapters:mockAdapters('inserted',track)
 }),request('POST',huge,signedHeaders(huge)));
 assert.equal(res.statusCode,413);
 assert.equal(track.count,0);
 const bad={
  method:'POST',headers:signedHeaders(''),
  async *[Symbol.asyncIterator](){yield Buffer.from([0xc3,0x28]);}
 };
 const res2=await run(makeHttpHandler({
   config:validConfig,createAdapters:mockAdapters('inserted',track)
 }),bad);
 assert.equal(res2.statusCode,400);
 assert.equal(track.count,0);
});

test('database outage produces 503 so webhook provider may retry',async()=>{
 const raw=rawEvent();
 const res=await run(makeHttpHandler({
    config:validConfig,
    createAdapters:async()=>({
     resolveAuthorizedRecipient:async()=>{throw Error('synthetic_db_unavailable');},
     enqueueReceipt:async()=>{throw Error('should_not_run');}
    })
 }),request('POST',raw,signedHeaders(raw)));
 assert.equal(res.statusCode,503);
 assert.equal(JSON.parse(res.body).error,'pilot_unavailable');
 assert.doesNotMatch(res.body,/synthetic_db_unavailable/);
});

test('unexpected HTTP method refuses and advertises only GET and POST',async()=>{
 const res=await run(makeHttpHandler({
  config:validConfig,createAdapters:mockAdapters()
 }),request('DELETE'));
 assert.equal(res.statusCode,405);
 assert.equal(res.headers.allow,'GET, POST');
});

test('connection URL is constrained to isolated Neon role and TLS verify-full',()=>{
 const uri='postgresql://nexlupa_resend_ingest:synthetic-only-credential@ep-test.neon.tech/nexlupa_pilot?sslmode=verify-full';
 assert.equal(validateConnectionString(uri),uri);
 for(const bad of [
  uri.replace('verify-full','disable'),
  uri.replace('nexlupa_resend_ingest','nexlupa_pilot_owner'),
  uri.replace('neon.tech','evil.example'),
  uri.replace('nexlupa_pilot?','postgres?'),
  uri.replace('verify-full','verify-full&sslcert=%2Ftmp%2Fcustom.crt'),
  uri.replace('postgresql:','http:')
 ]){
   assert.throws(()=>validateConnectionString(bad),/invalid_forwarding_database_configuration/);
 }
});

test('no metadata intake can run if config is absent',async()=>{
 const conf={...validConfig,configured:false};
 const raw=rawEvent(),req=request('POST',raw,signedHeaders(raw));
 const res=await run(makeHttpHandler({config:conf}),req);
 assert.equal(res.statusCode,503);
 assert.equal(req.reads,0);
});

test('UTF-8 stream is read exactly once; never accesses parsed body getter',async()=>{
 const req=request('POST','a');
 assert.equal(await rawBody(req),'a');
 assert.equal(req.reads,1);
});


test('oversized declared Content-Length is rejected before reading stream or connecting',async()=>{
 const raw=rawEvent(),track={count:0};
 for(const length of ['16385','999999999999999999999','1, 2']){
   const req=request('POST',raw,{...signedHeaders(raw),'content-length':length});
   const res=await run(makeHttpHandler({config:validConfig,
     createAdapters:mockAdapters('inserted',track)}),req);
   assert.equal(res.statusCode,413);
   assert.equal(req.reads,0);
   assert.equal(track.count,0);
 }
});
