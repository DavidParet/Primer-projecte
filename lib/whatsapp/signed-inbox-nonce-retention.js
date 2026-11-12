'use strict';

/**
 * STAGED / CI-ONLY: bounded cleanup for one-use signed WhatsApp ingress
 * and family inbox-read nonces. Disabled by default. NEVER deploy this
 * worker before auditing the isolated Neon schema and maintenance account.
 *
 * The SQL privilege barrier uses a dedicated NOLOGIN maintenance role with
 * SELECT/DELETE on only expired nonce rows, further narrowed by FORCE RLS.
 * No access to messages, contacts, canonical membership or signing keys.
 */
const LOCK_SQL='SELECT pg_try_advisory_xact_lock(716200, 4) AS acquired';
const ROLE_SQL=`
SELECT current_user AS role_name,r.rolsuper AS superuser,
 r.rolbypassrls AS bypass_rls,
 has_table_privilege(current_user,'public.nex_ci_inbound_ingest_nonces','SELECT') AS ingest_read,
 has_table_privilege(current_user,'public.nex_ci_inbound_ingest_nonces','DELETE') AS ingest_delete,
 has_table_privilege(current_user,'public.nex_ci_inbox_read_nonces','SELECT') AS inbox_read,
 has_table_privilege(current_user,'public.nex_ci_inbox_read_nonces','DELETE') AS inbox_delete,
 has_table_privilege(current_user,'public.nex_ci_inbound_ingest_nonces','INSERT') AS ingest_insert,
 has_table_privilege(current_user,'public.nex_ci_inbox_read_nonces','INSERT') AS inbox_insert,
 has_table_privilege(current_user,'public.nex_ci_inbound_ingest_keys','SELECT') AS ingest_keys,
 has_table_privilege(current_user,'public.nex_ci_inbox_read_keys','SELECT') AS inbox_keys,
 has_table_privilege(current_user,'public.nex_whatsapp_inbound','SELECT') AS messages_read,
 has_table_privilege(current_user,'public.nex_whatsapp_inbound','DELETE') AS messages_delete
FROM pg_roles r WHERE r.rolname=current_user
`;
const INGEST_PURGE_SQL=`
WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbound_ingest_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT $1
)
DELETE FROM public.nex_ci_inbound_ingest_nonces AS ledger USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes'
`;
const INBOX_PURGE_SQL=`
WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbox_read_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT $1
)
DELETE FROM public.nex_ci_inbox_read_nonces AS ledger USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes'
`;
function checkLimits(batchSize,maxBatches){
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000||
    !Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>50)
  throw new RangeError('Signed inbox nonce maintenance bounds exceeded');
}
async function assertMaintenanceRole(client){
 const answer=await client.query(ROLE_SQL);
 const row=answer?.rows?.length===1?answer.rows[0]:null;
 if(!row||row.role_name!=='nex_ci_inbox_nonce_maintenance'||
  row.superuser!==false||row.bypass_rls!==false||
  row.ingest_read!==true||row.ingest_delete!==true||
  row.inbox_read!==true||row.inbox_delete!==true||
  row.ingest_insert!==false||row.inbox_insert!==false||
  row.ingest_keys!==false||row.inbox_keys!==false||
  row.messages_read!==false||row.messages_delete!==false)
  throw new Error('Signed inbox maintenance privilege preflight failed');
}
async function runSignedInboxNonceRetention({
 enabled=false,createDatabase,report,batchSize=250,maxBatches=20
}={}){
 if(enabled!==true)return Object.freeze({status:'disabled'});
 checkLimits(batchSize,maxBatches);
 if(typeof createDatabase!=='function'||typeof report!=='function')
  throw new TypeError('Dedicated signed inbox maintenance pool and reporting required');
 const pool=await createDatabase();
 if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function')
  throw new TypeError('Dedicated maintenance database pool required');
 let client,started=false,committed=false;
 try{
  client=await pool.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
   throw new TypeError('Dedicated maintenance database client required');
  await client.query('BEGIN');started=true;
  const lock=await client.query(LOCK_SQL);
  if(!lock||lock.rows?.length!==1||typeof lock.rows[0].acquired!=='boolean')
   throw new Error('Invalid nonce maintenance lock response');
  if(!lock.rows[0].acquired){
   await client.query('ROLLBACK');started=false;
   const busy=Object.freeze({status:'busy'});
   await report(busy);return busy;
  }
  await assertMaintenanceRole(client);
  let ingestDeleted=0,inboxDeleted=0,batches=0,mayHaveMore=false;
  for(let i=0;i<maxBatches;i++){
   const a=await client.query(INGEST_PURGE_SQL,[batchSize]);
   const b=await client.query(INBOX_PURGE_SQL,[batchSize]);
   if(!Number.isSafeInteger(a?.rowCount)||a.rowCount<0||a.rowCount>batchSize||
      !Number.isSafeInteger(b?.rowCount)||b.rowCount<0||b.rowCount>batchSize)
    throw new Error('Invalid signed inbox nonce retention count');
   ingestDeleted+=a.rowCount;inboxDeleted+=b.rowCount;batches++;
   mayHaveMore=a.rowCount===batchSize||b.rowCount===batchSize;
   if(!mayHaveMore)break;
  }
  const result=Object.freeze({status:'completed',
   ingestDeleted,inboxDeleted,batches,mayHaveMore});
  await client.query('COMMIT');committed=true;started=false;
  await report(result);return result;
 }catch(error){
  if(started&&!committed){
   try{await client?.query('ROLLBACK');}catch(e){error.cause=e;}
  }
  if(!committed){
   try{await report(Object.freeze({status:'failed'}));}
   catch(e){error.cause=e;}
  }
  throw error;
 }finally{
  try{client?.release();}finally{await pool.end();}
 }
}
module.exports={runSignedInboxNonceRetention,assertMaintenanceRole,
 LOCK_SQL,ROLE_SQL,INGEST_PURGE_SQL,INBOX_PURGE_SQL};
