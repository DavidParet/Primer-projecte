'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

// Exercise the actual serverless HTTP handlers without Google, Neon, tokens,
// credentials, cookies, or external HTTP. This is NOT a live preview probe.
const preflight=require('../api/gmail/pilot-auth.js');
const start=require('../api/gmail/pilot/start.js');
const callback=require('../api/gmail/pilot/callback.js');

function response(){
  const headers={};
  return {
    headers,code:null,body:null,
    setHeader(name,value){headers[name.toLowerCase()]=value;return this;},
    status(code){this.code=code;return this;},
    json(value){this.body=value;return this;}
  };
}
async function invoke(handler,{method='GET',headers={},body,query}={}){
  const res=response();
  await handler({method,headers,body,query},res);
  return res;
}
async function withEnvironment(env,fn){
  const keys=['VERCEL_ENV','GMAIL_PILOT_ENABLED','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GMAIL_PILOT_DATABASE_URL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    for(const k of keys) delete process.env[k];
    Object.assign(process.env,env);
    return await fn();
  }finally{
    for(const k of keys){
      if(saved[k]===undefined)delete process.env[k];
      else process.env[k]=saved[k];
    }
  }
}
test('production preflight is disabled and never probes family data',async()=>{
  await withEnvironment({VERCEL_ENV:'production',GMAIL_PILOT_ENABLED:'false'},async()=>{
    for(const method of ['GET','POST']){
      const res=await invoke(preflight,{method,body:{familyId:'synthetic-family'}});
      assert.equal(res.code,503);
      assert.equal(res.body.error,'pilot_disabled');
      assert.equal(res.headers['cache-control'],'no-store');
      assert.equal(res.headers['x-robots-tag'],'noindex, nofollow');
      assert.equal(JSON.stringify(res.body).includes('synthetic-family'),false);
    }
  });
});
test('preview disabled POST fails closed before any authentication or DB access',async()=>{
  await withEnvironment({VERCEL_ENV:'preview',GMAIL_PILOT_ENABLED:'false'},async()=>{
    const res=await invoke(preflight,{method:'POST',headers:{authorization:'Bearer dummy'},body:{familyId:'synthetic-family'}});
    assert.equal(res.code,503);
    assert.deepEqual(res.body,{authorized:false,error:'pilot_disabled'});
    assert.equal(JSON.stringify(res.body).includes('dummy'),false);
  });
});
test('OAuth start rejects GET without starting an authorization flow',async()=>{
  await withEnvironment({VERCEL_ENV:'preview',GMAIL_PILOT_ENABLED:'false'},async()=>{
    const res=await invoke(start,{method:'GET'});
    assert.equal(res.code,405);
    assert.equal(res.headers.allow,'POST');
    assert.equal(res.headers['cache-control'],'no-store');
    assert.equal(res.headers['referrer-policy'],'no-referrer');
    assert.equal(res.headers['content-security-policy'],"default-src 'none'; frame-ancestors 'none'");
  });
});
test('OAuth callback rejects POST, clears state cookie and disables caching',async()=>{
  await withEnvironment({VERCEL_ENV:'preview',GMAIL_PILOT_ENABLED:'false'},async()=>{
    const res=await invoke(callback,{method:'POST',query:{code:'synthetic-code',state:'synthetic-state'}});
    assert.equal(res.code,405);
    assert.equal(res.headers.allow,'GET');
    assert.match(res.headers['set-cookie'],/Max-Age=0; Secure; HttpOnly; SameSite=Lax/);
    assert.equal(res.headers['cache-control'],'no-store, private');
    assert.equal(res.headers['referrer-policy'],'no-referrer');
    assert.equal(JSON.stringify(res.body).includes('synthetic-code'),false);
  });
});
