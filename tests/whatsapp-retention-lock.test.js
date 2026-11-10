'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetentionLock, LOCK_SQL } = require('../lib/whatsapp/retention-lock');

function fixture(acquired=true,failOn) {
  const calls=[]; let released=0,connected=0;
  const client={
    async query(sql){
      calls.push(sql);
      if (failOn && sql===failOn) throw new Error('database test failure');
      if(sql===LOCK_SQL) return {rows:[{acquired}]};
      return {};
    },
    release(){released++;}
  };
  return {
    pool:{async connect(){connected++;return client;}},
    calls,stats:()=>({released,connected})
  };
}
test('single connection holds transaction lock through successful work and commit',async()=>{
  const f=fixture();
  const result=await withRetentionLock(f.pool,async(client)=>{
    await client.query('SELECT 1');
    return 12;
  });
  assert.deepEqual(result,{status:'completed',value:12});
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'SELECT 1','COMMIT']);
  assert.deepEqual(f.stats(),{released:1,connected:1});
});
test('another worker holding lock is signalled busy without invoking callback',async()=>{
  const f=fixture(false);let invoked=0;
  assert.deepEqual(await withRetentionLock(f.pool,async()=>{invoked++;}),{status:'busy'});
  assert.equal(invoked,0);
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'ROLLBACK']);
  assert.equal(f.stats().released,1);
});
test('unexpected lock output and worker failure roll back then release',async()=>{
  for(const result of [null,'unexpected']) {
    const f=fixture(result);
    await assert.rejects(withRetentionLock(f.pool,async()=>{}),/Unknown retention lock result/);
    assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'ROLLBACK']);
    assert.equal(f.stats().released,1);
  }
  const f=fixture();
  await assert.rejects(withRetentionLock(f.pool,async()=>{throw Error('work failed');}),/work failed/);
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'ROLLBACK']);
  assert.equal(f.stats().released,1);
});
test('commit failure causes rollback attempt and release',async()=>{
  const f=fixture(true,'COMMIT');
  await assert.rejects(withRetentionLock(f.pool,async()=>5),/database test failure/);
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'COMMIT','ROLLBACK']);
  assert.equal(f.stats().released,1);
});
test('missing pool and callback fail before connecting',async()=>{
  await assert.rejects(withRetentionLock({},async()=>{}),/pool and work callback/);
  await assert.rejects(withRetentionLock({connect:async()=>{}},null),/pool and work callback/);
});
