'use strict';
/**
 * Offline safety regression for isolated Vercel API. No accounts, keys,
 * webhook registration, family data, sends or calendar updates.
 */
const assert=require('node:assert/strict');
async function main(){
  const status=await import('../pilot/resend-vercel/api/status.js');
  const webhook=await import('../pilot/resend-vercel/api/webhook.js');
  const s=await status.GET();
  assert.equal(s.status,200);
  assert.equal(s.headers.get('cache-control'),'no-store');
  const j=await s.json();
  assert.equal(j.phase,'locked');
  assert.equal(j.webhookIngestion,false);
  assert.equal(j.durableQueue,false);
  assert.equal(j.familyAgent,false);
  assert.equal(j.calendarWrites,false);
  const old={
    enabled:process.env.RESEND_PILOT_ENABLED,
    key:process.env.RESEND_API_KEY,
    secret:process.env.RESEND_WEBHOOK_SECRET
  };
  const req={
    headers:{get(){throw Error('must not read untrusted headers when disabled')}},
    text(){throw Error('must not read untrusted body when disabled')}
  };
  try{
    delete process.env.RESEND_PILOT_ENABLED;
    const locked=await webhook.POST(req);
    assert.equal(locked.status,503);
    assert.equal((await locked.json()).accepted,false);
    assert.equal(locked.headers.get('retry-after'),'300');
    process.env.RESEND_PILOT_ENABLED='true';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_WEBHOOK_SECRET;
    const noCredentials=await webhook.POST(req);
    assert.equal(noCredentials.status,503);
    assert.equal((await noCredentials.json()).accepted,false);
    process.env.RESEND_API_KEY='re_FAKE_OFFLINE_TEST_ONLY';
    process.env.RESEND_WEBHOOK_SECRET='whsec_FAKE_OFFLINE_TEST_ONLY';
    const missingSignature=await webhook.POST({headers:{get:()=>null},text(){
      throw Error('no text read for missing signatures');
    }});
    assert.equal(missingSignature.status,401);
    assert.equal((await missingSignature.json()).error,'invalid_signature');
  }finally{
    for(const [k,v] of Object.entries({
      RESEND_PILOT_ENABLED:old.enabled,
      RESEND_API_KEY:old.key,
      RESEND_WEBHOOK_SECRET:old.secret
    })){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  }
  console.log('PASS — isolated Vercel health reports locked / no queue / no Calendar writes');
  console.log('PASS — webhook returns 503 before reading body or headers when disabled');
  console.log('PASS — missing secrets fail closed and missing signature is rejected');
  console.log('LIMIT — no real Resend delivery is acknowledged or processed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
