'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runNonceRetentionJob,NONCE_PURGE_SQL,NONCE_PURGE_LOCK_SQL,
  NONCE_ROLE_SQL}=require('../lib/whatsapp/nonce-retention');

const permittedRole={
  role_name:'nex_ci_nonce_retention',superuser:false,bypass_rls:false,
  is_owner:false,can_read:true,can_delete:true,can_insert:false,
  can_update:false,can_read_keys:false
};

function fixture({acquired=true,counts=[2,1],role=permittedRole,failAt=null,
 report=async()=>{}}={}){
  const queries=[];let released=0,ended=0,index=0;
  const client={
    async query(sql,args){
      queries.push({sql,args});
      if(sql===failAt)throw Error('Sensitive SQL error: do not report');
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {};
      if(sql===NONCE_PURGE_LOCK_SQL)return {rows:[{acquired}]};
      if(sql===NONCE_ROLE_SQL)return {rows:[role]};
      if(sql===NONCE_PURGE_SQL)return {rowCount:counts[index++]??0};
      throw Error('Unexpected query');
    },
    release(){released++;}
  };
  const reported=[];
  const createDatabase=async()=>({connect:async()=>client,end:async()=>{ended++;}});
  return {
    run:config=>runNonceRetentionJob({
      enabled:true,createDatabase,report:async event=>{
        reported.push(event);await report(event);
      },batchSize:2,maxBatches:3,...config
    }),
    queries,reported,get released(){return released;},get ended(){return ended;}
  };
}

test('disabled by default does not create a database or a monitor',async()=>{
  let called=0;
  const result=await runNonceRetentionJob({
    createDatabase:async()=>{called++;throw Error('unexpected connection');},
    report:async()=>{called++;}
  });
  assert.deepEqual(result,{status:'disabled'});
  assert.equal(called,0);
});

test('commits bounded eligible cleanup under lock and checks role first',async()=>{
  const f=fixture();
  const result=await f.run();
  assert.deepEqual(result,{status:'completed',deleted:3,batches:2,
    mayHaveMore:false});
  assert.deepEqual(f.queries.map(q=>q.sql),[
    'BEGIN',NONCE_PURGE_LOCK_SQL,NONCE_ROLE_SQL,
    NONCE_PURGE_SQL,NONCE_PURGE_SQL,'COMMIT'
  ]);
  assert.deepEqual(f.queries.filter(q=>q.sql===NONCE_PURGE_SQL)
    .map(q=>q.args),[[2],[2]]);
  assert.equal(f.reported.length,1);
  assert.deepEqual(f.reported[0],result);
  assert.equal(f.released,1);assert.equal(f.ended,1);
});

test('busy job does not query role or delete any nonce',async()=>{
  const f=fixture({acquired:false});
  assert.deepEqual(await f.run(),{status:'busy'});
  assert.deepEqual(f.queries.map(q=>q.sql),
    ['BEGIN',NONCE_PURGE_LOCK_SQL,'ROLLBACK']);
  assert.equal(f.ended,1);assert.equal(f.released,1);
});

test('stops at max batches and marks possible remaining work',async()=>{
  const f=fixture({counts:[2,2,2]});
  assert.deepEqual(await f.run(),{status:'completed',deleted:6,batches:3,
    mayHaveMore:true});
  assert.equal(f.queries.filter(q=>q.sql===NONCE_PURGE_SQL).length,3);
});

test('rejects owner, bypass RLS and any excess privileges before deletion',async()=>{
  for(const fields of [
    {role_name:'postgres'},{superuser:true},{bypass_rls:true},
    {is_owner:true},{can_read:false},{can_delete:false},
    {can_insert:true},{can_update:true},{can_read_keys:true}
  ]) {
    const f=fixture({role:{...permittedRole,...fields}});
    await assert.rejects(f.run(),/preflight failed/);
    assert.deepEqual(f.queries.map(q=>q.sql),[
      'BEGIN',NONCE_PURGE_LOCK_SQL,NONCE_ROLE_SQL,'ROLLBACK'
    ]);
    assert.deepEqual(f.reported,[{status:'failed'}]);
    assert.equal(f.released,1);assert.equal(f.ended,1);
  }
});

test('database failures roll back and report no personal data or secrets',async()=>{
  const f=fixture({failAt:NONCE_PURGE_SQL});
  await assert.rejects(f.run(),/Sensitive SQL error/);
  assert.equal(f.queries.at(-1).sql,'ROLLBACK');
  assert.deepEqual(f.reported,[{status:'failed'}]);
});

test('invalid purge row count rolls back without claiming completion',async()=>{
  for(const count of [-1,3,'2',null]) {
    const f=fixture({counts:[count]});
    await assert.rejects(f.run(),/Invalid nonce purge result/);
    assert.equal(f.queries.at(-1).sql,'ROLLBACK');
  }
});

test('refuses unbounded configuration before opening connection',async()=>{
  for(const config of [
    {batchSize:0},{batchSize:1001},{maxBatches:0},
    {maxBatches:101},{maxBatches:1.5}
  ]){
    const f=fixture();
    await assert.rejects(f.run(config),/bounds exceeded/);
    assert.equal(f.queries.length,0);assert.equal(f.ended,0);
  }
});

test('SQL includes database-side five-minute margin and batch cap',()=>{
  assert.match(NONCE_PURGE_SQL,/interval '5 minutes'/);
  assert.match(NONCE_PURGE_SQL,/LIMIT \$1/);
  assert.match(NONCE_PURGE_SQL,/expires_at < clock_timestamp\(\)/);
  assert.doesNotMatch(NONCE_PURGE_SQL,/RETURNING/i);
});

test('no success telemetry is emitted until COMMIT',async()=>{
  const f=fixture();
  await f.run();
  const commitIndex=f.queries.findIndex(q=>q.sql==='COMMIT');
  assert.ok(commitIndex>0);
  assert.deepEqual(f.reported.map(e=>e.status),['completed']);
});
