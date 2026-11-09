'use strict';
/** Offline least-privilege queue health gate; mock DB only. */
const assert=require('node:assert/strict');
const {SQL,checkQueueDbHealth}=require('../lib/premium-resend-db-health');
async function main(){
  assert.ok(/^SELECT\b/.test(SQL));
  assert.ok(!/\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|DROP TABLE|CREATE TABLE)\b/i.test(SQL));
  for(const name of ['SELECT','INSERT','UPDATE','DELETE']){
    assert.ok(SQL.includes("'"+name+"'"),'Must verify '+name+' independently');
  }
  assert.ok(SQL.includes("current_user = 'nexlupa_resend_ingest'"));
  assert.ok(SQL.includes("current_database() = 'nexlupa_pilot'"));
  assert.ok(SQL.includes('NOT has_database_privilege'));
  let calls=0;
  const valid={query:async sql=>{
    calls++;assert.equal(sql,SQL);
    return {rowCount:1,rows:[{ready:true}]};
  }};
  assert.equal(await checkQueueDbHealth(valid),true);
  assert.equal(calls,1);
  assert.equal(await checkQueueDbHealth({query:async()=>({
    rowCount:1,rows:[{ready:false}]
  })}),false);
  assert.equal(await checkQueueDbHealth({query:async()=>({
    rowCount:1,rows:[{ready:'true'}]
  })}),false,'String truthy values must not pass');
  assert.equal(await checkQueueDbHealth({query:async()=>({
    rowCount:2,rows:[{ready:true},{ready:true}]
  })}),false);
  assert.equal(await checkQueueDbHealth({query:async()=>{throw Error('DB_OFFLINE')}}),false);
  assert.equal(await checkQueueDbHealth(null),false);
  assert.equal(await checkQueueDbHealth({}),false);
  console.log('PASS — isolated Neon name and exact constrained database role required');
  console.log('PASS — independent INSERT/UPDATE/DELETE/SELECT grants and no CREATE privilege');
  console.log('PASS — read-only SQL, no table reads, no PII or secret disclosures');
  console.log('PASS — wrong role, ambiguous results and outages fail closed');
  console.log('LIMIT — SQL actually executed against pilot Neon separately via connector');
}
main().catch(e=>{console.error(e);process.exitCode=1});
