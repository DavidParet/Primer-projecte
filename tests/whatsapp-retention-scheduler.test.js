'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRetentionJob } = require('../lib/whatsapp/retention-scheduler');

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

test('enabled run reports bounded result and closes maintenance database',async()=>{
  let connected=0,closed=0;
  const reports=[];
  const result=await runRetentionJob({
    enabled:true, batchSize:5, maxBatches:2,
    createDatabase:async()=>{
      connected++;
      return {query:async()=>({rowCount:2}),end:async()=>{closed++;}};
    },
    report:async evt=>reports.push(evt)
  });
  assert.equal(connected,1);
  assert.equal(closed,1);
  assert.deepEqual(result,{status:'completed',deleted:2,batches:1,mayHaveMore:false});
  assert.deepEqual(reports,[result]);
});

test('failure propagates and maintenance database is still closed',async()=>{
  let closed=0;
  const reports=[];
  await assert.rejects(runRetentionJob({
    enabled:true,
    createDatabase:async()=>({
      query:async()=>{throw Error('database test outage');},
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
    enabled:true, createDatabase:async()=>({query:async()=>({rowCount:0})}), report:async()=>{}
  }),/requires query\(\) and end\(\)/);
});
