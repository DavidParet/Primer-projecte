'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTransactionalFamilyAuthorizer,LOCK_MEMBERSHIP_SQL}=
  require('../lib/whatsapp/transactional-family-authorization');
const A='11111111-1111-4111-8111-111111111111';
function fixture({session={authenticated:true,userId:'account-1'},
  rows=[{role:'admin',status:'active',revoked_at:null}]}={}) {
  const queries=[];
  const client={async query(sql,params){queries.push({sql,params});return {rows};}};
  const auth=createTransactionalFamilyAuthorizer({getAuthenticatedSession:async()=>session});
  return {auth,client,queries};
}
test('locks current membership on same transaction client',async()=>{
  const f=fixture();
  assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),true);
  assert.equal(f.queries[0].sql,LOCK_MEMBERSHIP_SQL);
  assert.match(LOCK_MEMBERSHIP_SQL,/FOR SHARE/);
  assert.deepEqual(f.queries[0].params,['account-1',A]);
});
test('missing, revoked or suspended membership is denied',async()=>{
  for(const rows of [[],[{role:'admin',status:'suspended',revoked_at:null}],
    [{role:'admin',status:'active',revoked_at:'2026-11-08T00:00:00Z'}],
    [{role:'admin',status:'active',revoked_at:null},
      {role:'admin',status:'active',revoked_at:null}]]) {
    const f=fixture({rows});
    assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),false);
  }
});
test('members cannot revoke consent even when their membership is current',async()=>{
  const f=fixture({rows:[{role:'member',status:'active',revoked_at:null}]});
  assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await f.auth({client:f.client,familyId:A,action:'read_whatsapp_messages'}),true);
});
test('unauthenticated request cannot reach membership SQL',async()=>{
  const f=fixture({session:{authenticated:false,userId:'account-1'}});
  assert.equal(await f.auth({client:f.client,familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(f.queries.length,0);
});
test('missing transaction client and unknown action fail closed',async()=>{
  const f=fixture();
  assert.equal(await f.auth({familyId:A,action:'revoke_whatsapp_consent'}),false);
  assert.equal(await f.auth({client:f.client,familyId:A,action:'unknown'}),false);
  assert.equal(f.queries.length,0);
});
test('membership database outage fails closed, never returns true',async()=>{
  const auth=createTransactionalFamilyAuthorizer({
    getAuthenticatedSession:async()=>({authenticated:true,userId:'account-1'})
  });
  await assert.rejects(auth({
    client:{query:async()=>{throw Error('membership offline');}},
    familyId:A,action:'revoke_whatsapp_consent'
  }),/membership offline/);
});
test('missing server session resolver is rejected',()=>{
  assert.throws(()=>createTransactionalFamilyAuthorizer({}),/session resolver/);
});
