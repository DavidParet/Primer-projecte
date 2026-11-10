'use strict';

/**
 * TTP234, DISPOSABLE CI PROTOTYPE. The nonce-ledger table in this module
 * is nex_ci_* and is not deployed to Neon. No scheduler is activated.
 *
 * A nonce can be discarded ONLY after its signed permit has expired,
 * plus five minutes of conservative clock/operational margin. The verifier
 * must independently enforce permit expiry BEFORE consulting nonce state.
 */
const NONCE_PURGE_LOCK_SQL =
  'SELECT pg_try_advisory_xact_lock(716200, 2) AS acquired';

const NONCE_PURGE_SQL = `
WITH eligible AS (
  SELECT nonce FROM public.nex_ci_revocation_permit_uses
  WHERE expires_at < clock_timestamp() - interval '5 minutes'
  ORDER BY expires_at, nonce
  LIMIT $1
)
DELETE FROM public.nex_ci_revocation_permit_uses AS used
USING eligible
WHERE used.nonce = eligible.nonce
  AND used.expires_at < clock_timestamp() - interval '5 minutes'
`;

const NONCE_ROLE_SQL = `
SELECT current_user AS role_name, r.rolsuper AS superuser,
  r.rolbypassrls AS bypass_rls, (c.relowner = r.oid) AS is_owner,
  has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','SELECT') AS can_read,
  has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','DELETE') AS can_delete,
  has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','INSERT') AS can_insert,
  has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','UPDATE') AS can_update,
  has_table_privilege(current_user,
    'public.nex_ci_revocation_keyring_v2','SELECT') AS can_read_keys
FROM pg_roles r
JOIN pg_class c
 ON c.oid='public.nex_ci_revocation_permit_uses'::regclass
WHERE r.rolname=current_user
`;

function checkLimits(batchSize,maxBatches) {
  if (!Number.isSafeInteger(batchSize) || batchSize<1 || batchSize>1000 ||
      !Number.isSafeInteger(maxBatches) || maxBatches<1 || maxBatches>100) {
    throw new RangeError('Nonce retention bounds exceeded');
  }
}

async function assertNonceRetentionRole(client) {
  const result=await client.query(NONCE_ROLE_SQL);
  const rows=result?.rows;
  const role=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if (!role || role.role_name!=='nex_ci_nonce_retention' ||
      role.superuser!==false || role.bypass_rls!==false ||
      role.is_owner!==false || role.can_read!==true ||
      role.can_delete!==true || role.can_insert!==false ||
      role.can_update!==false || role.can_read_keys!==false) {
    throw new Error('Nonce retention role preflight failed');
  }
}

async function purgeOnClient(client,{batchSize,maxBatches}) {
  let deleted=0,batches=0,mayHaveMore=false;
  while(batches<maxBatches) {
    const res=await client.query(NONCE_PURGE_SQL,[batchSize]);
    const n=res?.rowCount;
    if(!Number.isSafeInteger(n)||n<0||n>batchSize)
      throw new Error('Invalid nonce purge result');
    deleted+=n;batches++;
    mayHaveMore=n===batchSize;
    if(!mayHaveMore)break;
  }
  return Object.freeze({status:'completed',deleted,batches,mayHaveMore});
}

async function runNonceRetentionJob({
  enabled=false,createDatabase,report,batchSize=250,maxBatches=20
}={}) {
  if(enabled!==true)return Object.freeze({status:'disabled'});
  checkLimits(batchSize,maxBatches);
  if(typeof createDatabase!=='function'||typeof report!=='function')
    throw new TypeError('Trusted nonce maintenance pool factory and monitor required');
  const pool=await createDatabase();
  if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function')
    throw new TypeError('Dedicated nonce retention pool required');
  let client,started=false,committed=false,closed=false;
  try {
    client=await pool.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new TypeError('Dedicated nonce retention client required');
    await client.query('BEGIN');started=true;
    const lock=await client.query(NONCE_PURGE_LOCK_SQL);
    if(lock?.rows?.length!==1||typeof lock.rows[0].acquired!=='boolean')
      throw new Error('Invalid nonce maintenance lock result');
    if(!lock.rows[0].acquired){
      await client.query('ROLLBACK');started=false;
      const busy=Object.freeze({status:'busy'});
      await report(busy);
      return busy;
    }
    await assertNonceRetentionRole(client);
    const result=await purgeOnClient(client,{batchSize,maxBatches});
    await client.query('COMMIT');committed=true;started=false;
    await report(result);
    return result;
  }catch(error){
    if(started&&!committed) {
      try{await client.query('ROLLBACK');}
      catch(e){error.cause=e;}
    }
    // Never report SQL exception text, signed permits, users or key material.
    if(!committed){
      try{await report(Object.freeze({status:'failed'}));}
      catch(e){error.cause=e;}
    }
    throw error;
  }finally{
    try{client?.release();}finally{await pool.end();}
  }
}

module.exports={runNonceRetentionJob,assertNonceRetentionRole,
  NONCE_PURGE_SQL,NONCE_PURGE_LOCK_SQL,NONCE_ROLE_SQL};
