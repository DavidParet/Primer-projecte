'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFamilyAuthorizer}=require('../lib/whatsapp/family-authorization');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
function fixture({session={authenticated:true,userId:'account-1'},
  membership={userId:'account-1',familyId:A,role:'admin',active:true}}={}) {
  const seen=[];
  const authorizeFamily=createFamilyAuthorizer({
    getAuthenticatedSession:async()=>session,
    getMembership:async query=>{seen.push(query);return membership;}
  });
  return {authorizeFamily,seen};
}
test('verified admin can revoke consent for own family',async()=>{
  const f=fixture();
  assert.equal(await f.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),true);
  assert.deepEqual(f.seen,[{userId:'account-1',familyId:A}]);
});
test('forged family ID cannot access another family',async()=>{
  const f=fixture();
  assert.equal(await f.authorizeFamily({familyId:B,action:'revoke_whatsapp_consent'}),false);
  assert.deepEqual(f.seen,[{userId:'account-1',familyId:B}]);
});
test('untrusted actor fields are ignored; authenticated session is authoritative',async()=>{
  const f=fixture({session:{authenticated:true,userId:'account-2'}});
  assert.equal(await f.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent',userId:'account-1',
    actorRole:'admin',verified:true
  }),false);
  assert.deepEqual(f.seen,[{userId:'account-2',familyId:A}]);
});
test('member may read but cannot enroll or revoke',async()=>{
  const f=fixture({membership:{userId:'account-1',familyId:A,role:'member',active:true}});
  assert.equal(await f.authorizeFamily({familyId:A,action:'read_whatsapp_messages'}),true);
  assert.equal(await f.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await f.authorizeFamily({familyId:A,action:'enroll_whatsapp_sender'}),false);
});
test('revoked, inactive and malformed memberships fail closed',async()=>{
  for(const changes of [{active:false},{revoked:true},{role:'superadmin'},{
    familyId:B},{userId:'account-2'},{active:'true'}]) {
    const f=fixture({membership:{userId:'account-1',familyId:A,role:'owner',active:true,...changes}});
    assert.equal(await f.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),false);
  }
});
test('invalid input and unknown actions denied before membership lookup',async()=>{
  const f=fixture();
  for(const value of [{familyId:'invalid',action:'revoke_whatsapp_consent'},
    {familyId:A,action:'delete_everything'}, {familyId:A}, {}]) {
    assert.equal(await f.authorizeFamily(value),false);
  }
  assert.equal(f.seen.length,0);
});
test('missing or revoked session cannot authorize',async()=>{
  for(const session of [null,{}, {authenticated:false,userId:'account-1'},
    {authenticated:true,userId:'  '},
    {authenticated:true,userId:'account-1',revoked:true}]) {
    const f=fixture({session});
    assert.equal(await f.authorizeFamily({familyId:A,action:'revoke_whatsapp_consent'}),false);
    assert.equal(f.seen.length,0);
  }
});
test('resolver failures propagate rather than granting permission',async()=>{
  const authorize=createFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'}),
    getMembership:async()=>{throw new Error('lookup offline');}
  });
  await assert.rejects(authorize({familyId:A,action:'revoke_whatsapp_consent'}),/lookup offline/);
});
test('requires both trusted server-side resolvers',()=>{
  assert.throws(()=>createFamilyAuthorizer({}),/resolvers/);
  assert.throws(()=>createFamilyAuthorizer({getAuthenticatedSession:async()=>({})}),/resolvers/);
});
