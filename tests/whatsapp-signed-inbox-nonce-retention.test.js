'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 runSignedInboxNonceRetention,assertMaintenanceRole,
 LOCK_SQL,ROLE_SQL,INGEST_PURGE_SQL,INBOX_PURGE_SQL
}=require('../lib/whatsapp/signed-inbox-nonce-retention');
const safeRole=()=>({
 role_name:'nex_ci_nonce_maintenance_e2e_login',purpose_role:true,
 superuser:false,bypass_rls:false,
 ingest_read:true,ingest_delete:true,inbox_read:true,inbox_delete:true,
 ingest_insert:false,inbox_insert:false,ingest_keys:false,inbox_keys:false,
 messages_read:false,messages_delete:false
});
function mockPool({lock=true,role=safeRole(),ingest=[2,1],inbox=[1,0],
 badCount=false,failOn=null}={}){
 const calls=[],reports=[];let released=0,ended=0;
 const client={
  release(){released++;},
  async query(sql,params){
   calls.push({sql,params});
   if(failOn&&sql===failOn)throw new Error('sensitive database details must not be reported');
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT')return {rowCount:0};
   if(sql===LOCK_SQL)return {rows:[{acquired:lock}]};
   if(sql===ROLE_SQL)return {rows:[role]};
   if(sql===INGEST_PURGE_SQL)return {rowCount:badCount?-1:(ingest.shift()??0)};
   if(sql===INBOX_PURGE_SQL)return {rowCount:inbox.shift()??0};
   throw new Error('Unexpected SQL access: '+sql);
  }
 };
 const pool={async connect(){return client;},async end(){ended++;}};
 return {
  createDatabase:async()=>pool,
  report:async result=>{reports.push(result);},
  calls,reports,ends:()=>ended,releases:()=>released
 };
}

test('disabled retention must not connect, lock or report',async()=>{
 let touched=false;
 assert.deepEqual(await runSignedInboxNonceRetention({
  createDatabase:async()=>{touched=true;}
 }),{status:'disabled'});
 assert.equal(touched,false);
});

test('valid bounded cleanup deletes from both ledgers within one transaction',async()=>{
 const f=mockPool({ingest:[2,1],inbox:[2,0]});
 const result=await runSignedInboxNonceRetention({
  enabled:true,createDatabase:f.createDatabase,report:f.report,
  batchSize:2,maxBatches:3
 });
 assert.deepEqual(result,{status:'completed',
  ingestDeleted:3,inboxDeleted:2,batches:2,mayHaveMore:false});
 assert.deepEqual(f.calls.map(x=>x.sql),[
  'BEGIN',LOCK_SQL,ROLE_SQL,INGEST_PURGE_SQL,INBOX_PURGE_SQL,
  INGEST_PURGE_SQL,INBOX_PURGE_SQL,'COMMIT'
 ]);
 assert.deepEqual(f.calls.filter(x=>
  x.sql===INGEST_PURGE_SQL||x.sql===INBOX_PURGE_SQL
 ).map(x=>x.params),[[2],[2],[2],[2]]);
 assert.equal(f.ends(),1);assert.equal(f.releases(),1);
 assert.deepEqual(f.reports,[result]);
});

test('unavailable advisory lock reports busy without any table access',async()=>{
 const f=mockPool({lock:false});
 const r=await runSignedInboxNonceRetention({
  enabled:true,createDatabase:f.createDatabase,report:f.report
 });
 assert.deepEqual(r,{status:'busy'});
 assert.deepEqual(f.calls.map(x=>x.sql),['BEGIN',LOCK_SQL,'ROLLBACK']);
 assert.equal(f.ends(),1);assert.equal(f.releases(),1);
});

test('rejects elevated, wrong-purpose or writable maintenance credentials',async()=>{
 for(const role of [
  {...safeRole(),role_name:'postgres',purpose_role:false},
  {...safeRole(),superuser:true},
  {...safeRole(),bypass_rls:true},
  {...safeRole(),inbox_read:false},
  {...safeRole(),ingest_insert:true},
  {...safeRole(),inbox_keys:true},
  {...safeRole(),messages_read:true},
  {...safeRole(),messages_delete:true}
 ]){
  const f=mockPool({role});
  await assert.rejects(runSignedInboxNonceRetention({
   enabled:true,createDatabase:f.createDatabase,report:f.report
  }),/privilege preflight/);
  assert.equal(f.calls.some(x=>x.sql===INGEST_PURGE_SQL),false);
  assert.deepEqual(f.reports,[{status:'failed'}]);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 }
 await assert.rejects(assertMaintenanceRole({
  query:async()=>({rows:[]})
 }),/preflight/);
});

test('invalid counts or database errors roll back and report only generic failure',async()=>{
 for(const options of [{badCount:true},{failOn:INBOX_PURGE_SQL}]){
  const f=mockPool(options);
  await assert.rejects(runSignedInboxNonceRetention({
   enabled:true,createDatabase:f.createDatabase,report:f.report
  }),/count|sensitive/);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  assert.deepEqual(f.reports,[{status:'failed'}]);
  assert.equal(f.ends(),1);assert.equal(f.releases(),1);
 }
});

test('strict limits reject before connecting',async()=>{
 for(const bounds of [
  {batchSize:0},{batchSize:1001},{batchSize:'10'},
  {maxBatches:0},{maxBatches:51},{maxBatches:NaN}
 ]){
  let contacted=false;
  await assert.rejects(runSignedInboxNonceRetention({
   enabled:true,createDatabase:async()=>{contacted=true;},
   report:async()=>{},...bounds
  }),/bounds/);
  assert.equal(contacted,false);
 }
});

test('reaching configured maximum batches signals more work without extra query',async()=>{
 const f=mockPool({ingest:[3,3,3],inbox:[1,2,3]});
 const r=await runSignedInboxNonceRetention({
  enabled:true,createDatabase:f.createDatabase,report:f.report,
  batchSize:3,maxBatches:2
 });
 assert.deepEqual(r,{
  status:'completed',ingestDeleted:6,inboxDeleted:3,batches:2,mayHaveMore:true
 });
 assert.equal(f.calls.filter(x=>x.sql===INGEST_PURGE_SQL).length,2);
});
