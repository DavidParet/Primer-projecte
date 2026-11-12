'use strict';
/*
 * Real loopback HTTP smoke tests for the public gateway in OFF mode.
 * No Internet, Resend, Neon, user mailbox, encryption keys or webhook secret.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const gateway=require('../api/webhook.js');
const {createRuntimeHandler}=require('../lib/runtime.cjs');

async function withServer(handler,check){
 const server=http.createServer((req,res)=>{
   Promise.resolve(handler(req,res)).catch(()=>{
     res.statusCode=500;res.end();
   });
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 try{
   return await check('http://127.0.0.1:'+server.address().port);
 }finally{
   await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
}

test('actual exported public gateway refuses POST safely without environment secrets',async()=>{
 await withServer(gateway,async origin=>{
   const r=await fetch(origin+'/api/webhook',{
     method:'POST',
     headers:{'Content-Type':'application/json','svix-id':'msg_forged'},
     body:JSON.stringify({type:'email.received',data:{email_id:'faked'}})
   });
   assert.equal(r.status,503);
   assert.deepEqual(await r.json(),{error:'pilot_disabled'});
   assert.equal(r.headers.get('cache-control'),'no-store, private');
   assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');
 });
});

test('loopback GET returns public-safe operational flags only',async()=>{
 await withServer(gateway,async origin=>{
   const r=await fetch(origin+'/api/webhook');
   assert.equal(r.status,200);
   const body=await r.json();
   assert.deepEqual(body,{
     configurationPresent:false,
     databaseConnectivityVerified:false,
     mode:'isolated-forwarding-pilot',
     emailBodiesFetched:false,
     metadataReceiptsEnabled:false,
     productionEnabled:false
   });
   assert.equal(r.headers.get('cache-control'),'no-store, private');
 });
});

test('even an accidentally true production feature flag cannot start processing',async()=>{
 const handler=createRuntimeHandler({
   VERCEL_ENV:'production',
   VERCEL_GIT_COMMIT_REF:'feature/gmail-resend-forwarding-pilot-20261110',
   FORWARDING_PILOT_ENABLED:'true',
   FORWARDING_PILOT_DATABASE_URL:'',
   FORWARDING_PILOT_WEBHOOK_SECRET:'',
   FORWARDING_PILOT_ENCRYPTION_KEY:''
 });
 await withServer(handler,async origin=>{
   const r=await fetch(origin+'/api/webhook',{method:'POST',body:'{}'});
   assert.equal(r.status,503);
   assert.deepEqual(await r.json(),{error:'pilot_disabled'});
 });
});

test('unsupported HTTP methods return 405 and do not need credentials',async()=>{
 await withServer(gateway,async origin=>{
   const r=await fetch(origin+'/api/webhook',{method:'PUT',body:'{}'});
   assert.equal(r.status,405);
   assert.equal(r.headers.get('allow'),'GET, POST');
   assert.deepEqual(await r.json(),{error:'method_not_allowed'});
 });
});
