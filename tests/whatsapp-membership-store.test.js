'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMembershipLookup,MEMBERSHIP_SQL}=require('../lib/whatsapp/membership-store');
const {createFamilyAuthorizer}=require('../lib/whatsapp/family-authorization');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
function makeDb(rows) {
  const calls=[];
  return {calls,async query(sql,args){calls.push({sql,args});return {rows};}};
}
test('trusted membership query is parameterized, not string-concatenated',async()=>{
  const db=makeDb([{
    user_id:'account-1',family_id:A,role:'admin',active:true,revoked:false
  }]);
  const lookup=createMembershipLookup({db});
  assert.deepEqual(await lookup({userId:'account-1',familyId:A}),{
    userId:'account-1',familyId:A,role:'admin',active:true,revoked:false
  });
  assert.equal(db.calls[0].sql,MEMBERSHIP_SQL);
  assert.deepEqual(db.calls[0].args,['account-1',A]);
  assert.ok(!db.calls[0].sql.includes('account-1'));
});
test('missing, revoked and malformed memberships deny access',async()=>{
  for(const rows of [[],[{user_id:'account-1',family_id:A,role:'admin',active:false,revoked:true}],
    [{user_id:'account-1',family_id:B,role:'admin',active:true,revoked:false}],
    [{user_id:'account-2',family_id:A,role:'admin',active:true,revoked:false}],
    [{user_id:'account-1',family_id:A,role:'superadmin',active:true,revoked:false}]]) {
    const lookup=createMembershipLookup({db:makeDb(rows)});
    assert.equal(await lookup({userId:'account-1',familyId:A}),null);
  }
});
test('duplicate membership responses fail closed',async()=>{
  const db=makeDb([{user_id:'account-1'},{user_id:'account-1'}]);
  await assert.rejects(createMembershipLookup({db})({
    userId:'account-1',familyId:A
  }),/Ambiguous/);
});
test('invalid user and family cannot query DB',async()=>{
  const db=makeDb([]);
  const lookup=createMembershipLookup({db});
  assert.equal(await lookup({userId:' ',familyId:A}),null);
  assert.equal(await lookup({userId:'account-1',familyId:'invalid'}),null);
  assert.equal(db.calls.length,0);
});
test('lookup outage never grants consent revocation',async()=>{
  const lookup=createMembershipLookup({db:{query:async()=>{throw Error('DB offline');}}});
  const authorize=createFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'}),
    getMembership:lookup
  });
  await assert.rejects(authorize({familyId:A,action:'revoke_whatsapp_consent'}),/DB offline/);
});
test('end-to-end adapter authorizes actual matching row only',async()=>{
  const db=makeDb([{user_id:'account-1',family_id:A,role:'member',active:true,revoked:false}]);
  const authorize=createFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'}),
    getMembership:createMembershipLookup({db})
  });
  assert.equal(await authorize({familyId:A,action:'read_whatsapp_messages'}),true);
  assert.equal(await authorize({familyId:A,action:'revoke_whatsapp_consent'}),false);
});
test('restricted DB adapter is required',()=>{
  assert.throws(()=>createMembershipLookup({}),/adapter/);
});
