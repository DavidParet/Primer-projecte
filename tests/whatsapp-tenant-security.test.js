'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateIsolation, inspectIsolation, ROLE_SQL, TABLE_SQL, POLICIES_SQL } =
  require('../lib/whatsapp/tenant-security');

const tables = [
  {table_name:'nex_whatsapp_inbound',rls_enabled:true,rls_forced:true,role_is_owner:false},
  {table_name:'nex_whatsapp_sender_authorizations',rls_enabled:true,rls_forced:true,role_is_owner:false}
];
const policies = tables.map(t => ({table_name:t.table_name, policy_name:'restricted_service_policy'}));
const role = [{role_name:'nexlupa_whatsapp_service',bypass_rls:false,superuser:false}];

test('preflight passes structurally restricted non-owner role and policies',()=>{
  assert.deepEqual(evaluateIsolation({roles:role,tables,policies}),{ready:true,reasons:[]});
});
test('realistic current Neon owner configuration is blocked',()=>{
  const result=evaluateIsolation({
    roles:[{role_name:'nexlupa_pilot_owner',bypass_rls:true,superuser:false}],
    tables:tables.map(t=>({...t,rls_enabled:false,rls_forced:false,role_is_owner:true})),
    policies:[]
  });
  assert.equal(result.ready,false);
  assert.ok(result.reasons.length>=3);
});
test('role with bypass or superuser flags fails closed',()=>{
  for (const key of ['bypass_rls','superuser']) {
    const result=evaluateIsolation({roles:[{...role[0],[key]:true}],tables,policies});
    assert.equal(result.ready,false);
  }
});
test('missing table, disabled force RLS and missing policies fail closed',()=>{
  assert.equal(evaluateIsolation({roles:role,tables:tables.slice(0,1),policies}).ready,false);
  assert.equal(evaluateIsolation({roles:role,tables:[{...tables[0],rls_forced:false},tables[1]],policies}).ready,false);
  assert.equal(evaluateIsolation({roles:role,tables,policies:[]}).ready,false);
});
test('catalog queries do not read family messages or mutate data',async()=>{
  const queries=[];
  const db={async query(sql) {
    queries.push(sql);
    if (sql===ROLE_SQL) return {rows:role};
    if (sql===TABLE_SQL) return {rows:tables};
    if (sql===POLICIES_SQL) return {rows:policies};
    throw Error('unexpected catalog query');
  }};
  assert.equal((await inspectIsolation(db)).ready,true);
  assert.equal(queries.length,3);
  assert.ok(queries.every(sql=>/^\s*SELECT /i.test(sql)));
  assert.ok(queries.every(sql=>!/(INSERT INTO|DELETE FROM|UPDATE nex_whatsapp|ALTER TABLE)/i.test(sql)));
});
test('unavailable database or malformed catalog metadata never passes',async()=>{
  await assert.rejects(inspectIsolation({query:async()=>{throw Error('offline');}}),/offline/);
  assert.equal(evaluateIsolation({roles:[],tables:[],policies:[]}).ready,false);
  await assert.rejects(inspectIsolation({}),/query adapter/);
});


test('public or trivially permissive policies never pass the structural gate',()=>{
  const variants=[
    {...policies[0],roles:['public']},
    {...policies[0],qual:'true'},
    {...policies[0],with_check:' ( true ) '}
  ];
  for (const variant of variants) {
    const result=evaluateIsolation({roles:role,tables,policies:[variant,policies[1]]});
    assert.equal(result.ready,false);
    assert.ok(result.reasons.some(s=>s.includes('globally permissive')));
  }
});
