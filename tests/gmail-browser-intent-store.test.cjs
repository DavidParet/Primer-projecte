'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {makeBrowserIntentReader}=require('../lib/gmail/browser-intent-store.cjs');
const familyId='10000000-0000-4000-8000-000000000001';
const authUserId='20000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64),sessionBinding='b'.repeat(64);
const row={state_digest:hash,auth_user_id:authUserId,family_id:familyId,
  session_binding:sessionBinding,code_verifier:'v'.repeat(43),
  redirect_uri:'https://pilot.example.com/api/gmail/pilot/callback',expires_at_ms:'1794230000000'};
test('rejects use of callback reader without database connector',()=>{
  assert.throws(()=>makeBrowserIntentReader(),/missing_private_database/);
});
test('consumes state AND browser nonce hash using parameterized, scoped RPC',async()=>{
  const calls=[];const take=makeBrowserIntentReader(async(sql,args)=>{
    calls.push({sql,args});return {rows:[row]};
  });
  const value=await take({stateDigest:hash,sessionBinding});
  assert.deepEqual(calls[0].args,[hash,sessionBinding]);
  assert.match(calls[0].sql,/consume_gmail_browser_state\(\$1::text,\$2::text\)/);
  assert.equal(value.authUserId,authUserId);
  assert.equal(value.codeVerifier,row.code_verifier);
  assert.equal(value.expiresAt,1794230000000);
  assert.ok(!calls[0].sql.includes(hash));
});
test('invalid hashes fail before database call',async()=>{
  let count=0;
  const take=makeBrowserIntentReader(async()=>{count++;return {rows:[]}});
  for(const input of [{stateDigest:'broken',sessionBinding},{stateDigest:hash,sessionBinding:"';SELECT 1"}]){
    await assert.rejects(take(input),/invalid_browser_state/);
  }
  assert.equal(count,0);
});
test('unknown, used and expired states return no browser intent',async()=>{
  const take=makeBrowserIntentReader(async()=>({rows:[]}));
  assert.equal(await take({stateDigest:hash,sessionBinding}),null);
});
test('invalid and overreturned records fail closed',async()=>{
  const take=makeBrowserIntentReader(async()=>({rows:[{...row,auth_user_id:'bad'}]}));
  await assert.rejects(take({stateDigest:hash,sessionBinding}),/invalid_browser_state_result/);
  const duplicate=makeBrowserIntentReader(async()=>({rows:[row,row]}));
  await assert.rejects(duplicate({stateDigest:hash,sessionBinding}),/invalid_browser_state_result/);
});
test('mismatched browser hash cannot return a privileged identity',async()=>{
  const take=makeBrowserIntentReader(async()=>({rows:[{...row,session_binding:'c'.repeat(64)}]}));
  await assert.rejects(take({stateDigest:hash,sessionBinding}),/invalid_browser_state_result/);
});
