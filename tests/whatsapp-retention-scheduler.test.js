'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRetentionJob, RETENTION_ROLE_SQL, assertRestrictedRetentionRole } =
  require('../lib/whatsapp/retention-scheduler');
const { LOCK_SQL } = require('../lib/whatsapp/retention-lock');
const { PURGE_BATCH_SQL } = require('../lib/whatsapp/retention-worker');

const restrictedRole=Object.freeze({
  role_name:'nexlupa_whatsapp_retention',
  superuser:false,bypass_rls:false,is_owner:false,
  can_read_inbound:true,can_delete_inbound:true,
  can_insert_inbound:false,can_update_inbound:false,can_read_consents:false
});

function fixture({acquired=true,role=restrictedRole,deleteCounts=[2],failSQL=null,
                  monitorFails=false}={}) {
  const calls=[],reports=[];
  let closed=0,released=0,connected=0,deleteIndex=0;
  const client={
    async query(sql) {
      calls.push(sql);
      if(sql===failSQL) throw Error('SQL failure');
      if(sql===LOCK_SQL) return {rows:[{acquired}]};
      if(sql===RETENTION_ROLE_SQL) return {rows:[role]};
      if(sql===PURGE_BATCH_SQL) return {rowCount:deleteCounts[deleteIndex++]};
      if(['BEGIN','ROLLBACK','COMMIT'].includes(sql)) return {};
      throw Error('unexpected query');
    },
    release(){released++;}
  };
  const db={
    async connect(){connected++;return client;},
    async end(){closed++;}
  };
  return {
    createDatabase:async()=>db,
    report:async event=>{reports.push(event);if(monitorFails)throw Error('monitor outage');},
    calls,reports,
    stats:()=>({connected,released,closed})
  };
}

test('disabled by default: no database or monitor use',async()=>{
  let connections=0;
  const res=await runRetentionJob({
    createDatabase:async()=>{connections++;throw Error('must not connect');},
    report:async()=>{throw Error('must not report');}
  });
  assert.deepEqual(res,{status:'disabled'});
  assert.equal(connections,0);
});

test('holds lock through role check and DELETE; reports only after COMMIT',async()=>{
  const f=fixture();
  const result=await runRetentionJob({enabled:true,...f,batchSize:5});
  assert.deepEqual(result,{status:'completed',deleted:2,batches:1,mayHaveMore:false});
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,RETENTION_ROLE_SQL,PURGE_BATCH_SQL,'COMMIT']);
  assert.deepEqual(f.reports,[result]);
  assert.deepEqual(f.stats(),{connected:1,released:1,closed:1});
});

test('busy scheduler never checks role or deletes',async()=>{
  const f=fixture({acquired:false});
  assert.deepEqual(await runRetentionJob({enabled:true,...f}),{status:'busy'});
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,'ROLLBACK']);
  assert.deepEqual(f.reports,[{status:'busy'}]);
  assert.equal(f.stats().closed,1);
});

test('owner role rejected in transaction before DELETE, reports failure after rollback',async()=>{
  const f=fixture({role:{...restrictedRole,role_name:'nexlupa_pilot_owner',bypass_rls:true}});
  await assert.rejects(runRetentionJob({enabled:true,...f}),/Retention role preflight failed/);
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,RETENTION_ROLE_SQL,'ROLLBACK']);
  assert.deepEqual(f.reports,[{status:'failed'}]);
  assert.deepEqual(f.stats(),{connected:1,released:1,closed:1});
});

test('SQL failure rolls back and never reports completed or misleading counts',async()=>{
  const f=fixture({failSQL:PURGE_BATCH_SQL});
  await assert.rejects(runRetentionJob({enabled:true,...f}),/SQL failure/);
  assert.deepEqual(f.calls,['BEGIN',LOCK_SQL,RETENTION_ROLE_SQL,PURGE_BATCH_SQL,'ROLLBACK']);
  assert.deepEqual(f.reports,[{status:'failed'}]);
});

test('post-COMMIT monitor error never claims rollback or false failure',async()=>{
  const f=fixture({monitorFails:true});
  await assert.rejects(runRetentionJob({enabled:true,...f}),/monitor outage/);
  assert.deepEqual(f.calls.at(-1),'COMMIT');
  assert.equal(f.reports.length,1);
  assert.equal(f.reports[0].status,'completed');
  assert.equal(f.stats().closed,1);
});

test('extra privileges rejected before the purge begins',async()=>{
  const variants=[
    {can_read_consents:true},{can_insert_inbound:true},{can_update_inbound:true},
    {can_delete_inbound:false},{can_read_inbound:false},
    {superuser:true},{bypass_rls:true},{is_owner:true}
  ];
  for (const variant of variants) {
    const db={query:async()=>({rows:[{...restrictedRole,...variant}]})};
    await assert.rejects(assertRestrictedRetentionRole(db),/preflight failed/);
  }
});

test('invalid enabled adapter fails closed; default remains disabled',async()=>{
  await assert.rejects(runRetentionJob({enabled:true}),/requires database factory/);
  await assert.rejects(runRetentionJob({
    enabled:true,createDatabase:async()=>({query:async()=>{}}),report:async()=>{}
  }),/requires connect\(\) and end\(\)/);
});
