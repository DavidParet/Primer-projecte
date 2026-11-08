'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTransactionalFamilyAuthorizer,LOCK_MEMBERSHIP_SQL}=
  require('../lib/whatsapp/transactional-family-authorization');
const A='11111111-1111-4111-8111-111111111111';
function fixture({session={authenticated:true,userId:'account-1'},allowed=true}={}) {
  const queries=[];
  const client={async query(sql,params){queries.push({sql,params});return {rows:[{allowed}]};}};
  const auth=createTransactionalFamilyAuthorizer({getAuthenticatedSession:async()=>session});
  return {auth,client,queries};
}
test('uses one safe database function on the same transaction client',async()=>{
  const f=fixture();
  assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),true);
  assert.equal(f.queries[0].sql,LOCK_MEMBERSHIP_SQL);
  assert.match(LOCK_MEMBERSHIP_SQL,/nex_authorize_family_locked/);
  assert.doesNotMatch(LOCK_MEMBERSHIP_SQL,/FOR SHARE|UPDATE |DELETE /);
  assert.deepEqual(f.queries[0].params,['account-1',A,'revoke_whatsapp_consent']);
});
test('database function returning false, null or unexpected value denies access',async()=>{
  for(const allowed of [false,null,0,'true','false',{},undefined]) {
    const f=fixture({allowed});
    assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),false);
  }
});
test('unknown action and missing transaction client never reach SQL',async()=>{
  const f=fixture();
  assert.equal(await f.auth({familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await f.auth({client:f.client,familyId:A,action:'invalid'}),false);
  assert.equal(f.queries.length,0);
});
test('revoked or invalid server session denies before DB access',async()=>{
  for(const session of [{authenticated:false,userId:'account-1'},
    {authenticated:true,userId:'account-1',revoked:true},null]) {
    const f=fixture({session});
    assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),false);
    assert.equal(f.queries.length,0);
  }
});
test('missing or duplicated function results fail closed',async()=>{
  const auth=createTransactionalFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'})
  });
  for(const rows of [[],[{allowed:true},{allowed:true}],null]) {
    assert.equal(await auth({
      client:{query:async()=>({rows})},
      familyId:A,action:'revoke_whatsapp_consent'
    }),false);
  }
});
test('database outage propagates to revoke transaction rollback',async()=>{
  const auth=createTransactionalFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'})
  });
  await assert.rejects(auth({
    client:{query:async()=>{throw Error('database offline');}},
    familyId:A,action:'revoke_whatsapp_consent'
  }),/database offline/);
});
test('untrusted principal flags cannot substitute server identity',async()=>{
  const f=fixture({session:{authenticated:true,userId:'account-2'}});
  assert.equal(await f.auth({
    client:f.client,familyId:A,action:'revoke_whatsapp_consent',
    userId:'account-1',role:'admin'
  }),true);
  assert.deepEqual(f.queries[0].params,['account-2',A,'revoke_whatsapp_consent']);
});
test('requires verified session resolver',()=>{
  assert.throws(()=>createTransactionalFamilyAuthorizer({}),/session resolver/);
});
