'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createRequestIdentityBinder } =
  require('../lib/whatsapp/request-identity-binding');
const { createRequestBoundConsentRevoker } =
  require('../lib/whatsapp/request-bound-consent-revoker');
const { LOCK_MEMBERSHIP_SQL } =
  require('../lib/whatsapp/transactional-family-authorization');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const expiry=1893456000000;
const session=(userId='account-a',sessionId='server-session-a')=>({
  authenticated:true,userId,sessionId,revoked:false,expiresAtMs:expiry
});
const admin={userId:'account-a',familyId:A,role:'admin',active:true,revoked:false};
const key=randomBytes(32).toString('base64');

function env() {
  let current=session();
  let rows=[admin];
  const lookups=[],queries=[],dbArgs=[];
  const client={
    async query(sql,args) {
      queries.push(sql);
      if(sql===LOCK_MEMBERSHIP_SQL) {
        dbArgs.push(args);
        const exists=rows.find(x=>x.userId===args[0] && x.familyId===args[1] &&
          x.active===true && x.revoked!==true &&
          ['owner','admin'].includes(x.role));
        return {rows:[{allowed:!!exists}]};
      }
      if(['BEGIN','ROLLBACK','COMMIT'].includes(sql)) return {};
      if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))return {rowCount:1};
      if(sql.includes('DELETE FROM nex_whatsapp_inbound'))return {rowCount:2};
      throw new Error('Unexpected query');
    },
    release(){}
  };
  let connections=0;
  const db={async connect(){connections++;return client;}};
  return {
    getAuthenticatedSession:async()=>current,
    getMembership:async(q)=>{lookups.push(q);return rows.find(x=>x.userId===q.userId&&x.familyId===q.familyId)||null;},
    now:()=>1794000000000,
    db,lookups,queries,dbArgs,
    setSession:s=>{current=s;},
    setRows:r=>{rows=r;},
    connections:()=>connections
  };
}
const input=(familyId=A,extras={})=>({
  familyId, authorizationId:1,businessAccountId:'444444444',
  phoneNumberId:'333333333',senderWaId:'34600000000',...extras
});
test('one verified session authorizes both checks; database sees its principal only',async()=>{
  const f=env();
  const revoke=createRequestBoundConsentRevoker({
    db:f.db,senderHmacKey:key,getAuthenticatedSession:f.getAuthenticatedSession,
    getMembership:f.getMembership,now:f.now
  });
  const result=await revoke(input(A,{
    actor:{userId:'account-b',role:'owner',authenticated:true},
    userId:'account-b',sessionId:'server-session-b'
  }));
  assert.deepEqual(result,{state:'revoked',deletedMessages:2});
  assert.deepEqual(f.lookups,[{userId:'account-a',familyId:A}]);
  assert.deepEqual(f.dbArgs,[['account-a',A,'revoke_whatsapp_consent']]);
  assert.deepEqual(f.queries.map(x=>x==='BEGIN'?'BEGIN':x==='COMMIT'?'COMMIT':
    x.includes('UPDATE nex_whatsapp')?'UPDATE':
    x.includes('DELETE FROM nex_whatsapp')?'DELETE':'AUTH'),
    ['BEGIN','AUTH','UPDATE','DELETE','COMMIT']);
});
test('forged family and administrator flags cannot reach consent transaction',async()=>{
  const f=env();
  const revoke=createRequestBoundConsentRevoker({
    db:f.db,senderHmacKey:key,getAuthenticatedSession:f.getAuthenticatedSession,
    getMembership:f.getMembership,now:f.now
  });
  await assert.rejects(revoke(input(B,{
    actor:{authenticated:true,canManageFamily:true,role:'admin',familyId:B},
    userId:'account-b'
  })),/verified family administrator/);
  assert.equal(f.connections(),0);
});
test('changing session between preliminary auth and transaction denies, rolls back',async()=>{
  const f=env();
  let count=0;
  const getSession=async()=>{
    count++;
    if(count===3)return session('account-b','server-session-b');
    return session();
  };
  const revoke=createRequestBoundConsentRevoker({
    db:f.db,senderHmacKey:key,getAuthenticatedSession:getSession,
    getMembership:f.getMembership,now:f.now
  });
  await assert.rejects(revoke(input()),/current locked family authorization/);
  assert.deepEqual(f.queries,['BEGIN','ROLLBACK']);
  assert.equal(f.dbArgs.length,0);
});
test('same account with changed server session ID is denied after BEGIN',async()=>{
  const f=env();let count=0;
  const revoke=createRequestBoundConsentRevoker({
    db:f.db,senderHmacKey:key,
    getAuthenticatedSession:async()=>++count===3?
      session('account-a','different-valid-session'):session(),
    getMembership:f.getMembership,now:f.now
  });
  await assert.rejects(revoke(input()),/current locked family authorization/);
  assert.deepEqual(f.queries,['BEGIN','ROLLBACK']);
});
test('revoked or expired session after preliminary check denies without writes',async()=>{
  for(const invalid of [
    {...session(),revoked:true},
    {...session(),expiresAtMs:1793000000000},
    {...session(),authenticated:false}
  ]) {
    const f=env();let count=0;
    const revoke=createRequestBoundConsentRevoker({
      db:f.db,senderHmacKey:key,
      getAuthenticatedSession:async()=>++count===3?invalid:session(),
      getMembership:f.getMembership,now:f.now
    });
    await assert.rejects(revoke(input()),/current locked family authorization/);
    assert.deepEqual(f.queries,['BEGIN','ROLLBACK']);
  }
});
test('missing initial or unverified server session blocks before database connection',async()=>{
  for(const invalid of [null,{...session(),sessionId:''},
    {...session(),expiresAtMs:1793000000000},
    {authenticated:true,userId:'account-a',sessionId:'fake'},
    {...session(),revoked:true}
  ]) {
    const f=env();f.setSession(invalid);
    const revoke=createRequestBoundConsentRevoker({
      db:f.db,senderHmacKey:key,
      getAuthenticatedSession:f.getAuthenticatedSession,
      getMembership:f.getMembership,now:f.now
    });
    await assert.rejects(revoke(input()),/Verified active server session required/);
    assert.equal(f.connections(),0);
  }
});
test('membership revocation between checks is refused by locked DB function',async()=>{
  const f=env();
  const bind=createRequestIdentityBinder({
    getAuthenticatedSession:f.getAuthenticatedSession,
    getMembership:f.getMembership,now:f.now
  });
  const auth=await bind();
  assert.equal(await auth.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),true);
  f.setRows([{...admin,active:false,revoked:true}]);
  const result=await auth.authorizeFamilyTransaction({
    client:await f.db.connect(),familyId:A,action:'revoke_whatsapp_consent'
  });
  assert.equal(result,false);
});
test('new request cannot reuse old request pinned session if identity changes',async()=>{
  const f=env();
  const bind=createRequestIdentityBinder({
    getAuthenticatedSession:f.getAuthenticatedSession,
    getMembership:f.getMembership,now:f.now
  });
  const auth=await bind();
  f.setSession(session('account-b','server-session-b'));
  assert.equal(await auth.authorizeFamily({
    familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(await auth.authorizeFamilyTransaction({
    client:await f.db.connect(),familyId:A,action:'revoke_whatsapp_consent'
  }),false);
  assert.equal(f.dbArgs.length,0);
});
test('server session and membership resolvers are mandatory',()=>{
  assert.throws(()=>createRequestIdentityBinder({}),/Trusted server session/);
});
