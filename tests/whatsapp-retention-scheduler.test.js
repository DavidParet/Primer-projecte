'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRetentionJob, RETENTION_ROLE_SQL, assertRestrictedRetentionRole } =
  require('../lib/whatsapp/retention-scheduler');

const restrictedRole = Object.freeze({
  role_name:'nexlupa_whatsapp_retention',
  superuser:false,bypass_rls:false,is_owner:false,
  can_read_inbound:true,can_delete_inbound:true,
  can_insert_inbound:false,can_update_inbound:false,
  can_read_consents:false
});

test('disabled by default: never asks for database or reporting',async()=>{
  let connected=0, reported=0;
  const options={
    createDatabase:async()=>{ connected++; throw Error('should not connect'); },
    report:async()=>{ reported++; }
  };
  assert.deepEqual(await runRetentionJob(options),{status:'disabled'});
  assert.deepEqual(await runRetentionJob({...options,enabled:'true'}),{status:'disabled'});
  assert.equal(connected,0);
  assert.equal(reported,0);
});

test('enabled run checks dedicated role before deleting and closes database',async()=>{
  let closed=0;
  const queries=[],reports=[];
  const result=await runRetentionJob({
    enabled:true,batchSize:5,maxBatches:2,
    createDatabase:async()=>({
      async query(sql) {
        queries.push(sql);
        if(sql===RETENTION_ROLE_SQL) return {rows:[restrictedRole]};
        return {rowCount:2};
      },
      async end(){closed++;}
    }),
    report:async evt=>reports.push(evt)
  });
  assert.equal(closed,1);
  assert.equal(queries[0],RETENTION_ROLE_SQL);
  assert.equal(queries.length,2);
  assert.deepEqual(result,{status:'completed',deleted:2,batches:1,mayHaveMore:false});
  assert.deepEqual(reports,[result]);
});

test('unauthorized project owner never triggers a DELETE',async()=>{
  let closed=0,queries=0;
  await assert.rejects(runRetentionJob({
    enabled:true,
    createDatabase:async()=>({
      query:async(sql)=>{
        queries++;
        assert.equal(sql,RETENTION_ROLE_SQL);
        return {rows:[{...restrictedRole,role_name:'nexlupa_pilot_owner',bypass_rls:true}]};
      },
      end:async()=>{closed++;}
    }),
    report:async()=>{throw Error('must not report a purge that never started');}
  }),/Retention role preflight failed/);
  assert.equal(queries,1);
  assert.equal(closed,1);
});

test('extra privileges and missing grant fail closed',async()=>{
  const variants=[
    {can_read_consents:true}, {can_insert_inbound:true},
    {can_update_inbound:true}, {can_delete_inbound:false},
    {can_read_inbound:false}, {superuser:true},{bypass_rls:true},{is_owner:true}
  ];
  for(const variant of variants) {
    const db={query:async()=>({rows:[{...restrictedRole,...variant}]})};
    await assert.rejects(assertRestrictedRetentionRole(db),/preflight failed/);
  }
});

test('failure propagates and maintenance database is still closed',async()=>{
  let closed=0;
  const reports=[];
  await assert.rejects(runRetentionJob({
    enabled:true,
    createDatabase:async()=>({
      query:async sql=>{
        if(sql===RETENTION_ROLE_SQL) return {rows:[restrictedRole]};
        throw Error('database test outage');
      },
      end:async()=>{closed++;}
    }),
    report:async evt=>reports.push(evt)
  }),/database test outage/);
  assert.equal(closed,1);
  assert.deepEqual(reports,[{status:'failed',deleted:0,batches:0}]);
});

test('enabled scheduler fails closed without monitor or DB factory',async()=>{
  await assert.rejects(runRetentionJob({enabled:true}),/requires database factory and monitor/);
  await assert.rejects(runRetentionJob({
    enabled:true,createDatabase:async()=>({query:async()=>({rowCount:0})}),report:async()=>{}
  }),/requires query\(\) and end\(\)/);
});
