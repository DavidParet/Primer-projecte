'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const preflight=require('../api/gmail/pilot-auth.js');
function response(){
  return {headers:{},code:200,body:null,
    setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},
    status(n){this.code=n;return this},
    json(v){this.body=v;return this}
  };
}
async function withEnvironment(changes,fn){
  const previous=Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]));
  try{
    for(const [k,v] of Object.entries(changes)){if(v===null)delete process.env[k];else process.env[k]=v}
    await fn();
  }finally{
    for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}
  }
}
test('production refuses even preflight GET without reaching PostgreSQL',async()=>{
  await withEnvironment({VERCEL_ENV:'production',GMAIL_PILOT_ENABLED:'true',GMAIL_PILOT_DATABASE_URL:'postgresql://invalid.example/nexlupa'},async()=>{
    const r=response();
    await preflight({method:'GET',headers:{}},r);
    assert.equal(r.code,503);
    assert.deepEqual(r.body,{ready:false,error:'pilot_disabled'});
    assert.equal(r.headers['cache-control'],'no-store');
  });
});
test('production refuses authenticated POST even with pilot flag accidentally enabled',async()=>{
  await withEnvironment({VERCEL_ENV:'production',GMAIL_PILOT_ENABLED:'true'},async()=>{
    const r=response();
    await preflight({method:'POST',headers:{authorization:'Bearer fake'}},r);
    assert.equal(r.code,503);
    assert.deepEqual(r.body,{ready:false,error:'pilot_disabled'});
  });
});
test('preview refuses POST until authorized activation flag is enabled',async()=>{
  await withEnvironment({VERCEL_ENV:'preview',GMAIL_PILOT_ENABLED:'false'},async()=>{
    const r=response();
    await preflight({method:'POST',headers:{}},r);
    assert.equal(r.code,503);
    assert.deepEqual(r.body,{authorized:false,error:'pilot_disabled'});
  });
});
test('preview without a configured PostgreSQL credential fails closed on diagnostic GET',async()=>{
  await withEnvironment({VERCEL_ENV:'preview',GMAIL_PILOT_ENABLED:'false',GMAIL_PILOT_DATABASE_URL:null},async()=>{
    const r=response();
    await preflight({method:'GET',headers:{}},r);
    assert.equal(r.code,503);
    assert.deepEqual(r.body,{ready:false,error:'pilot_not_ready'});
    assert.ok(!JSON.stringify(r.body).includes('postgresql'));
  });
});
