'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetentionWorker, PURGE_BATCH_SQL } =
  require('../lib/whatsapp/retention-worker');

function fixture(counts, opts={}) {
  const queries=[], events=[];
  let call=0;
  const db={async query(sql,values) {
    queries.push({sql,values});
    if (opts.failAt === call++) throw new Error('DB temporarily unavailable');
    return { rowCount: counts[queries.length-1] };
  }};
  const report=async event=>{
    events.push(event);
    if (opts.monitorFails) throw new Error('Monitor unavailable');
  };
  return {db,report,queries,events};
}

test('deletes bounded batches, reports only counts and stops on partial batch',async()=>{
  const f=fixture([2,1]);
  const worker=createRetentionWorker({db:f.db,report:f.report,batchSize:2,maxBatches:5});
  assert.deepEqual(await worker(),{
    status:'completed',deleted:3,batches:2,mayHaveMore:false
  });
  assert.deepEqual(f.queries.map(q=>q.values),[[2],[2]]);
  assert.equal(f.queries[0].sql,PURGE_BATCH_SQL);
  assert.match(f.queries[0].sql,/SKIP LOCKED/);
  assert.deepEqual(f.events,[{status:'completed',deleted:3,batches:2,mayHaveMore:false}]);
});
test('full final batch conservatively marks that records may remain',async()=>{
  const f=fixture([2,2]);
  const result=await createRetentionWorker({
    db:f.db,report:f.report,batchSize:2,maxBatches:2
  })();
  assert.deepEqual(result,{status:'completed',deleted:4,batches:2,mayHaveMore:true});
  assert.equal(f.queries.length,2);
});
test('empty database reports zero deletions',async()=>{
  const f=fixture([0]);
  assert.equal((await createRetentionWorker({db:f.db,report:f.report})()).deleted,0);
  assert.equal(f.queries.length,1);
});
test('database failure is not swallowed and monitoring gets no error details',async()=>{
  const f=fixture([2],{failAt:1});
  const run=createRetentionWorker({db:f.db,report:f.report,batchSize:2});
  await assert.rejects(run(),/DB temporarily unavailable/);
  assert.deepEqual(f.events,[{status:'failed',deleted:2,batches:1}]);
  assert.ok(!JSON.stringify(f.events).includes('unavailable'));
});
test('invalid deletion counts fail closed',async()=>{
  for(const invalid of [-1,5,undefined,1.5]) {
    const f=fixture([invalid]);
    const run=createRetentionWorker({db:f.db,report:f.report,batchSize:3});
    await assert.rejects(run(),/Invalid retention deletion result/);
    assert.equal(f.events[0].status,'failed');
  }
});
test('monitor failure cannot be mistaken for operational success',async()=>{
  const f=fixture([0],{monitorFails:true});
  await assert.rejects(createRetentionWorker({db:f.db,report:f.report})(),/Monitor unavailable/);
  assert.equal(f.events.at(-1).status,'failed');
});
test('configuration must include monitoring and bounded limits',()=>{
  const f=fixture([0]);
  assert.throws(()=>createRetentionWorker({db:f.db}),/monitor/);
  assert.throws(()=>createRetentionWorker({db:f.db,report:f.report,batchSize:0}),/limits/);
  assert.throws(()=>createRetentionWorker({db:f.db,report:f.report,maxBatches:101}),/limits/);
  assert.throws(()=>createRetentionWorker({report:f.report}),/adapter/);
});
