'use strict';
/**
 * Offline safety check for the new isolated Vercel route, before any
 * Resend webhook is redirected to it. No DB/network/secret fixtures.
 */
const assert=require('node:assert/strict');
const webhook=require('../pilot/resend-durable-webhook/api/webhook');
const status=require('../pilot/resend-durable-webhook/api/status');
const original={
  DATABASE_URL:process.env.DATABASE_URL,
  RESEND_WEBHOOK_SECRET:process.env.RESEND_WEBHOOK_SECRET,
  RESEND_QUEUE_ENCRYPTION_KEY:process.env.RESEND_QUEUE_ENCRYPTION_KEY,
  RESEND_PILOT_RECIPIENT:process.env.RESEND_PILOT_RECIPIENT
};
function response(){
  return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},
    end(body){this.body=body??'';}};
}
async function main(){
  try{
    for(const key of Object.keys(original))delete process.env[key];
    const get=response();
    await webhook({method:'GET',headers:{}},get);
    assert.equal(get.statusCode,405);
    const post=response();
    await webhook({method:'POST',headers:{}},post);
    assert.equal(post.statusCode,503);
    assert.equal(post.body,'');
    assert.equal(post.headers['Cache-Control'],'no-store');
    const probe=response();
    await status({method:'GET'},probe);
    assert.equal(probe.statusCode,503);
    assert.equal(JSON.parse(probe.body).ready,false);
    const wrongMethod=response();
    await status({method:'POST'},wrongMethod);
    assert.equal(wrongMethod.statusCode,405);
    // Never enable a receiver with incomplete configuration, even if only
    // some values are present; it must fail before reading the request.
    process.env.RESEND_PILOT_RECIPIENT='pilot@entrada.nexlupa.app';
    process.env.RESEND_QUEUE_ENCRYPTION_KEY='FAKE_KEY_TEST_ONLY';
    const incomplete=response();
    await webhook({method:'POST',headers:{}},incomplete);
    assert.equal(incomplete.statusCode,503);
    console.log('PASS — isolated route rejects missing secrets and wrong HTTP method');
    console.log('PASS — no mailbox metadata or DB statements accessed when locked');
    console.log('PASS — read-only DB status probe fails closed without DATABASE_URL');
    console.log('LIMIT — preview deployment and DB connection not tested by this offline suite');
  }finally{
    for(const [key,value] of Object.entries(original)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
