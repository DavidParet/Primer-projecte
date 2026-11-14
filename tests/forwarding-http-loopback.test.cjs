'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createHmac}=require('node:crypto');
const {makeHttpHandler,ALLOWED_BRANCH}=require('../lib/forwarding/http-handler.cjs');

const secret='whsec_'+Buffer.alloc(32,23).toString('base64');
const config={vercelEnv:'preview',gitRef:ALLOWED_BRANCH,enabled:'true',
  configured:true,webhookSecret:secret};
const recipient='in-0123456789abcdef0123456789abcdef@entrada.nexlupa.app';
const familyId='11111111-2222-4333-8444-555555555555';
function signature(raw,id){
  const timestamp=String(Math.floor(Date.now()/1000));
  const digest=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(id+'.'+timestamp+'.'+raw,'utf8').digest('base64');
  return {'svix-id':id,'svix-timestamp':timestamp,
    'svix-signature':'v1,'+digest,'content-type':'application/json'};
}
async function withServer(handler,fn){
  const server=http.createServer((req,res)=>{
    Promise.resolve(handler(req,res)).catch(()=>{res.statusCode=500;res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await fn('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
test('real loopback HTTP preview boundary: signed metadata, duplicate, forgery, and inert GET',async()=>{
  const seen=new Set(),receipts=[],track={adapters:0,lookups:0};
  const handler=makeHttpHandler({config,createAdapters:async()=>{
    track.adapters++;
    return {
      resolveAuthorizedRecipient:async()=>{track.lookups++;return {
        familyId,active:true,consentActive:true};},
      enqueueReceipt:async receipt=>{
        receipts.push(receipt);
        const key=JSON.stringify(receipt);
        if(seen.has(key))return 'duplicate';
        seen.add(key);return 'inserted';
      }
    };
  }});
  await withServer(handler,async base=>{
    const health=await fetch(base);
    assert.equal(health.status,200);
    assert.equal((await health.json()).databaseConnectivityVerified,false);
    assert.equal(track.adapters,0);
    const raw=JSON.stringify({type:'email.received',data:{
      email_id:'a21b31b7-d82b-48af-8a5f-749ec74262c3',
      from:'Synthetic <sender@example.invalid>',to:[recipient],
      subject:'Synthetic pilot receipt',attachments:[]}});
    const headers=signature(raw,'msg_loopback_001');
    const first=await fetch(base,{method:'POST',headers,body:raw});
    assert.equal(first.status,204);
    assert.equal(await first.text(),'');
    assert.equal(track.adapters,1);
    assert.equal(receipts.length,1);
    const replay=await fetch(base,{method:'POST',headers,body:raw});
    assert.equal(replay.status,204);
    assert.equal(track.adapters,2);
    const forged=await fetch(base,{method:'POST',headers:{
      ...headers,'svix-signature':'v1,'+Buffer.alloc(32).toString('base64')
    },body:raw});
    assert.equal(forged.status,400);
    assert.equal(track.adapters,2,'forged events must not initialize adapters');
    assert.equal(receipts.length,2,'only signed events reach the mock queue');
    const disabled=await fetch(base,{method:'DELETE'});
    assert.equal(disabled.status,405);
    assert.equal(disabled.headers.get('allow'),'GET, POST');
  });
});

test('loopback HTTP: revoked consent acknowledges signed metadata without persistence',async()=>{
  let authorized=true;
  let queued=0;
  const handler=makeHttpHandler({config,createAdapters:async()=>({
    resolveAuthorizedRecipient:async()=>({
      familyId,active:true,consentActive:authorized
    }),
    enqueueReceipt:async()=>{queued++;return 'inserted';}
  })});
  await withServer(handler,async base=>{
    const raw=JSON.stringify({type:'email.received',data:{
      email_id:'b21b31b7-d82b-48af-8a5f-749ec74262c3',
      from:'Synthetic <sender@example.invalid>',to:[recipient],
      subject:'Consent regression',attachments:[]}});
    authorized=false;
    const response=await fetch(base,{method:'POST',
      headers:signature(raw,'msg_revoked_001'),body:raw});
    assert.equal(response.status,204);
    assert.equal(queued,0,'revoked consent must not enqueue metadata');
    authorized=true;
    const permitted=await fetch(base,{method:'POST',
      headers:signature(raw,'msg_revoked_002'),body:raw});
    assert.equal(permitted.status,204);
    assert.equal(queued,1,'active consent allows one synthetic receipt');
  });
});
