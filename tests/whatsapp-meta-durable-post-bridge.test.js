'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHmac}=require('node:crypto');
const {createMetaDurablePostBridge,pureStatusOnlyEvent}=
  require('../lib/whatsapp/meta-durable-post-bridge');
const {MAX_BODY_BYTES}=require('../lib/whatsapp/webhook-security');
const secret='fictional-meta-app-secret-ci-only';
const envelope=JSON.stringify({object:'whatsapp_business_account',entry:[{
  id:'123456789',
  changes:[{field:'messages',value:{
    metadata:{phone_number_id:'987654321'},
    messages:[{
      id:'wamid.synthetic-message',
      from:'34600000000',
      timestamp:'1794150000',
      type:'text',
      text:{body:'Reunió fictícia a les 18 h'}
    }]
  }}]
}]});
const statusOnly=JSON.stringify({object:'whatsapp_business_account',entry:[{
  id:'123456789',changes:[{field:'messages',value:{
    statuses:[{id:'wamid.synthetic-status',status:'delivered'}]
  }}]
}]});

function signature(body) {
  return 'sha256='+createHmac('sha256',secret).update(body).digest('hex');
}
async function send(handler,body=envelope,overrides={}) {
  const raw=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');
  const request=Readable.from([raw]);
  request.method=overrides.method||'POST';
  request.headers={
    'content-type':'application/json',
    'x-hub-signature-256':signature(raw),
    ...overrides.headers
  };
  const res={
    code:200,headers:{},body:null,
    setHeader(name,value){this.headers[name.toLowerCase()]=value;},
    status(status){this.code=status;return this;},
    json(data){this.body=data;return this;}
  };
  await handler(request,res);
  return res;
}
function handler({counts={
 stored:1,duplicate:0,unlinked:0,unsupported:0},fail=false}={}){
  let calls=0;
  const inbox={
    async persistVerifiedBatch(){
      calls++;
      if(fail)throw new Error('sensitive SQL connection info');
      return counts;
    }
  };
  return {
    post:createMetaDurablePostBridge({enabled:true,appSecret:secret,inbox}),
    calls:()=>calls
  };
}

test('disabled by default never accesses an inbox or app secret',async()=>{
  const result=await send(createMetaDurablePostBridge(),envelope);
  assert.equal(result.code,503);
  assert.deepEqual(result.body,{status:'disabled'});
});

test('valid signed event is acknowledged only after durable message write',async()=>{
  const f=handler();
  const response=await send(f.post);
  assert.equal(response.code,200);
  assert.deepEqual(response.body,{status:'accepted'});
  assert.equal(f.calls(),1);
  assert.equal(response.headers['cache-control'],'no-store');
});

test('never ACKs a signed batch if persistence reports fewer messages than delivered',async()=>{
  const two=JSON.parse(envelope);
  two.entry[0].changes[0].value.messages.push({
    ...two.entry[0].changes[0].value.messages[0],
    id:'wamid.synthetic-second-message'
  });
  const body=JSON.stringify(two);
  const partial=handler({counts:{stored:1,duplicate:0,unlinked:0,unsupported:0}});
  const response=await send(partial.post,body);
  assert.equal(response.code,503);
  assert.equal(response.headers['retry-after'],'60');
  assert.equal(partial.calls(),1);
  const complete=handler({counts:{stored:1,duplicate:1,unlinked:0,unsupported:0}});
  assert.equal((await send(complete.post,body)).code,200);
});

test('never ACKs a signed batch with malformed or truncated messages',async()=>{
  const malformed=JSON.parse(envelope);
  malformed.entry[0].changes[0].value.messages.push({
    ...malformed.entry[0].changes[0].value.messages[0],
    id:'invalid-message-id'
  });
  const f=handler();
  assert.equal((await send(f.post,JSON.stringify(malformed))).code,503);
  const tooMany=JSON.parse(envelope);
  tooMany.entry[0].changes[0].value.messages=Array.from({length:51},(_,i)=>({
    ...tooMany.entry[0].changes[0].value.messages[0],
    id:'wamid.synthetic-'+i
  }));
  assert.equal((await send(f.post,JSON.stringify(tooMany))).code,503);
});

test('already persisted duplicate can be acknowledged idempotently',async()=>{
  const f=handler({counts:{stored:0,duplicate:1,unlinked:0,unsupported:0}});
  assert.equal((await send(f.post)).code,200);
});

test('verified status-only event may be acknowledged without storing personal text',async()=>{
  const f=handler({counts:{stored:0,duplicate:0,unlinked:0,unsupported:0}});
  assert.equal(pureStatusOnlyEvent(Buffer.from(statusOnly)),true);
  assert.equal((await send(f.post,statusOnly)).code,200);
  assert.equal(f.calls(),1);
});

test('empty or ambiguous webhook is not claimed durable',async()=>{
  const f=handler({counts:{stored:0,duplicate:0,unlinked:0,unsupported:0}});
  const empty=JSON.stringify({object:'whatsapp_business_account',entry:[]});
  const r=await send(f.post,empty);
  assert.equal(r.code,503);
  assert.equal(r.headers['retry-after'],'60');
});

test('unlinked sender and unsupported media cannot be acknowledged',async()=>{
  for(const key of ['unlinked','unsupported']){
    const counts={stored:0,duplicate:0,unlinked:0,unsupported:0};
    counts[key]=1;
    const f=handler({counts});
    const r=await send(f.post);
    assert.equal(r.code,503);
    assert.equal(r.headers['retry-after'],'60');
  }
});

test('successful stored message mixed with review-needed event is not acknowledged',async()=>{
  const f=handler({counts:{stored:1,duplicate:0,unlinked:1,unsupported:0}});
  assert.equal((await send(f.post)).code,503);
});

test('bad signature or altered raw body is rejected before storage',async()=>{
  const f=handler();
  const r=await send(f.post,envelope,{
    headers:{'x-hub-signature-256':'sha256='+('0'.repeat(64))}
  });
  assert.equal(r.code,403);
  assert.equal(f.calls(),0);
  const different=JSON.stringify(JSON.parse(envelope),null,2);
  const altered=await send(f.post,different,{
    headers:{'x-hub-signature-256':signature(Buffer.from(envelope))}
  });
  assert.equal(altered.code,403);
  assert.equal(f.calls(),0);
});

test('invalid JSON and wrong Meta event type are never acknowledged',async()=>{
  const f=handler();
  assert.equal((await send(f.post,'{broken')).code,400);
  assert.equal((await send(f.post,JSON.stringify({object:'page',entry:[]}))).code,400);
  assert.equal(f.calls(),0);
});

test('database failures and malformed storage answers fail closed without detail leak',async()=>{
  for(const f of [
    handler({fail:true}),
    handler({counts:{stored:'1',duplicate:0,unlinked:0,unsupported:0}})
  ]) {
    const r=await send(f.post);
    assert.equal(r.code,503);
    assert.equal(r.headers['retry-after'],'60');
    assert.equal(JSON.stringify(r.body).includes('SQL'),false);
    assert.equal(JSON.stringify(r.body).includes('Reunió'),false);
  }
});

test('wrong method, non-JSON and oversized raw requests fail',async()=>{
  const f=handler();
  assert.equal((await send(f.post,envelope,{method:'GET'})).code,405);
  assert.equal((await send(f.post,envelope,{
    headers:{'content-type':'text/plain'}
  })).code,415);
  const huge=Buffer.alloc(MAX_BODY_BYTES+1,65);
  assert.equal((await send(f.post,huge)).code,413);
  assert.equal(f.calls(),0);
});

test('a signed empty-status envelope cannot be used to bypass persistence',async()=>{
  const f=handler({counts:{stored:0,duplicate:0,unlinked:0,unsupported:0}});
  const malformed=JSON.stringify({
    object:'whatsapp_business_account',entry:[{
      id:'123456789',changes:[{field:'messages',value:{statuses:[]}}]
    }]
  });
  assert.equal(pureStatusOnlyEvent(Buffer.from(malformed)),false);
  assert.equal((await send(f.post,malformed)).code,503);
});
