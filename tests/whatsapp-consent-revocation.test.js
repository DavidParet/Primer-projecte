'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createConsentRevoker } = require('../lib/whatsapp/revoke-consent');
const familyId = '5c2f6d1a-4f63-46cb-a313-708f49952c2a';
const otherFamily = 'c6d8f3d5-65bc-4dd0-868d-362a57893f7d';
const key = randomBytes(32).toString('base64');
function input(extra={}) {
  return {
    actor:{authenticated:true,canManageFamily:true,familyId},
    familyId,authorizationId:12,businessAccountId:'123456789',
    phoneNumberId:'987654321',senderWaId:'34600000000',...extra
  };
}
function mock({updateCount=1, failDelete=false}={}) {
  const queries=[];let releases=0;
  const client={
    async query(sql,values) {
      queries.push({sql,values});
      if (sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {};
      if (sql.includes('UPDATE nex_whatsapp_sender_authorizations')) return {rowCount:updateCount};
      if (sql.includes('DELETE FROM nex_whatsapp_inbound')) {
        if(failDelete) throw new Error('delete failed');
        return {rowCount:2};
      }
      throw new Error('unexpected SQL');
    },
    release(){releases++;}
  };
  return {db:{connect:async()=>client}, queries, get releases(){return releases;}};
}
test('revocation deletes linked content and commits in one transaction',async()=>{
  const m=mock();
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,authorizeFamily:async ({familyId:target})=>target===familyId,
    authorizeFamilyTransaction:async ({familyId:target})=>target===familyId});
  assert.deepEqual(await revoke(input()),{state:'revoked',deletedMessages:2});
  assert.deepEqual(m.queries.map(x=>x.sql==='BEGIN'?'BEGIN':x.sql==='COMMIT'?'COMMIT':
    x.sql.trimStart().startsWith('UPDATE')?'UPDATE':'DELETE'),['BEGIN','UPDATE','DELETE','COMMIT']);
  assert.equal(m.queries[1].values[4].length,32);
  assert.equal(m.queries.flatMap(x=>x.values||[]).includes('34600000000'),false);
  assert.equal(m.releases,1);
});
test('wrong-family administrator never reaches database',async()=>{
  const m=mock();
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,authorizeFamily:async ({familyId:target})=>target===familyId,
    authorizeFamilyTransaction:async ({familyId:target})=>target===familyId});
  await assert.rejects(revoke(input({familyId:otherFamily,actor:{authenticated:true,canManageFamily:true,familyId:otherFamily}})),/verified family/);
  assert.equal(m.queries.length,0);
});
test('unverified administrator never reaches database',async()=>{
  const m=mock();
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,authorizeFamily:async()=>false,authorizeFamilyTransaction:async()=>false});
  await assert.rejects(revoke(input({actor:{authenticated:true,canManageFamily:true,familyId}})),/verified family/);
  assert.equal(m.queries.length,0);
});
test('inactive or foreign grant never deletes messages',async()=>{
  const m=mock({updateCount:0});
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,authorizeFamily:async ({familyId:target})=>target===familyId,
    authorizeFamilyTransaction:async ({familyId:target})=>target===familyId});
  assert.deepEqual(await revoke(input()),{state:'not_active'});
  assert.equal(m.queries.some(x=>x.sql.includes('DELETE FROM')),false);
  assert.equal(m.queries.at(-1).sql,'ROLLBACK');
  assert.equal(m.releases,1);
});
test('delete failure rolls back revocation',async()=>{
  const m=mock({failDelete:true});
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,authorizeFamily:async ({familyId:target})=>target===familyId,
    authorizeFamilyTransaction:async ({familyId:target})=>target===familyId});
  await assert.rejects(revoke(input()),/delete failed/);
  assert.equal(m.queries.at(-1).sql,'ROLLBACK');
  assert.equal(m.queries.some(x=>x.sql==='COMMIT'),false);
  assert.equal(m.releases,1);
});

test('missing trusted authorization callbacks are rejected',()=>{
  const m=mock();
  assert.throws(()=>createConsentRevoker({db:m.db,senderHmacKey:key}),/Trusted family authorization/);
});
test('authorization service failure blocks all database access',async()=>{
  const m=mock();
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,
    authorizeFamily:async()=>{throw Error('identity provider offline');},
    authorizeFamilyTransaction:async()=>true});
  await assert.rejects(revoke(input()),/identity provider offline/);
  assert.equal(m.queries.length,0);
});

test('previously authorized user revoked before transaction cannot change consent',async()=>{
  const m=mock();let checked=false;
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,
    authorizeFamily:async()=>true,
    authorizeFamilyTransaction:async({client,action})=>{
      checked=true;
      assert.equal(action,'revoke_whatsapp_consent');
      assert.equal(typeof client.query,'function');
      return false;
    }
  });
  await assert.rejects(revoke(input()),/current locked family authorization/);
  assert.equal(checked,true);
  assert.deepEqual(m.queries.map(x=>x.sql),['BEGIN','ROLLBACK']);
  assert.equal(m.releases,1);
});

test('in-transaction authorization lookup failure rolls back without any writes',async()=>{
  const m=mock();
  const revoke=createConsentRevoker({db:m.db,senderHmacKey:key,
    authorizeFamily:async()=>true,
    authorizeFamilyTransaction:async()=>{throw Error('membership database unavailable');}
  });
  await assert.rejects(revoke(input()),/membership database unavailable/);
  assert.deepEqual(m.queries.map(x=>x.sql),['BEGIN','ROLLBACK']);
  assert.equal(m.releases,1);
});

test('transactional authorization callback is mandatory even when initial auth exists',()=>{
  const m=mock();
  assert.throws(()=>createConsentRevoker({
    db:m.db,senderHmacKey:key,authorizeFamily:async()=>true
  }),/in-transaction family authorization/);
});
