'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const start=require('../api/gmail/pilot/start.js');
const callback=require('../api/gmail/pilot/callback.js');
const preflight=require('../api/gmail/pilot-auth.js');

function mockRes(){
  const headers={};const res={statusCode:200,data:null,headers,
    setHeader(key,val){headers[key.toLowerCase()]=val;return this;},
    status(v){this.statusCode=v;return this;},
    json(v){this.data=v;return this;}
  };return res;
}
test('start endpoint is POST-only and cannot start OAuth on GET',async()=>{
  const r=mockRes();
  await start({method:'GET',headers:{}},r);
  assert.equal(r.statusCode,405);
  assert.equal(r.headers.allow,'POST');
  assert.equal(r.headers['cache-control'],'no-store');
});
test('start endpoint refuses requests without private preview and Google OAuth configuration',async()=>{
  const old={...process.env};
  try{
    process.env.VERCEL_ENV='production';
    delete process.env.GOOGLE_CLIENT_ID;delete process.env.GMAIL_PILOT_ENABLED;
    const r=mockRes();
    await start({method:'POST',headers:{origin:'https://pilot.example.com',host:'pilot.example.com'},body:{familyId:'10000000-0000-4000-8000-000000000001'}},r);
    assert.equal(r.statusCode,503);
    assert.deepEqual(r.data,{error:'gmail_pilot_unavailable'});
    assert.equal(r.headers['set-cookie'],undefined);
  }finally{process.env=old}
});
test('callback clears private browser nonce and refuses to process POST',async()=>{
  const r=mockRes();
  await callback({method:'POST',headers:{},query:{}},r);
  assert.equal(r.statusCode,405);
  assert.equal(r.headers.allow,'GET');
  assert.match(r.headers['set-cookie'],/Max-Age=0; Secure; HttpOnly; SameSite=Lax/);
  assert.match(r.headers['content-security-policy'],/default-src 'none'/);
});
test('callback refuses a disabled pilot before reaching Google',async()=>{
  const old={...process.env};
  try{
    process.env.VERCEL_ENV='production';delete process.env.GMAIL_PILOT_ENABLED;
    const r=mockRes();
    await callback({method:'GET',headers:{host:'pilot.example.com'},query:{state:'s'.repeat(43),code:'not-a-real-code'}},r);
    assert.equal(r.statusCode,503);
    assert.deepEqual(r.data,{error:'gmail_pilot_unavailable'});
    assert.ok(!JSON.stringify(r.data).includes('not-a-real-code'));
  }finally{process.env=old}
});
test('preflight is read-only and discloses no config when disabled',async()=>{
  const old={...process.env};
  try{
    delete process.env.GMAIL_PILOT_DATABASE_URL;
    const r=mockRes();
    await preflight({method:'GET',headers:{}},r);
    assert.equal(r.statusCode,503);
    assert.equal(r.data.ready,false);
    assert.equal(r.headers['cache-control'],'no-store');
  }finally{process.env=old}
});
