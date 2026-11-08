'use strict';

/**
 * Safe entrypoint for a future WhatsApp retention scheduler.
 * No database connections or secrets are acquired in this module.
 * Production activation requires a trusted explicit enabled flag,
 * dedicated DB maintenance adapter, and reliable operations monitor.
 */
const { createRetentionWorker } = require('./retention-worker');
const { withRetentionLock } = require('./retention-lock');

const RETENTION_ROLE_SQL = `
SELECT current_user AS role_name, r.rolsuper AS superuser,
       r.rolbypassrls AS bypass_rls,
       (c.relowner = r.oid) AS is_owner,
       has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'SELECT') AS can_read_inbound,
       has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'DELETE') AS can_delete_inbound,
       has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'INSERT') AS can_insert_inbound,
       has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'UPDATE') AS can_update_inbound,
       has_table_privilege(current_user, 'public.nex_whatsapp_sender_authorizations', 'SELECT') AS can_read_consents
FROM pg_roles r
JOIN pg_class c ON c.oid = 'public.nex_whatsapp_inbound'::regclass
WHERE r.rolname = current_user
`;

async function assertRestrictedRetentionRole(db) {
  const result = await db.query(RETENTION_ROLE_SQL);
  const rows = result && result.rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('Retention role preflight failed');
  }
  const r = rows[0];
  if (r.role_name !== 'nexlupa_whatsapp_retention' ||
      r.superuser !== false || r.bypass_rls !== false || r.is_owner !== false ||
      r.can_read_inbound !== true || r.can_delete_inbound !== true ||
      r.can_insert_inbound !== false || r.can_update_inbound !== false ||
      r.can_read_consents !== false) {
    throw new Error('Retention role preflight failed');
  }
  return true;
}

async function runRetentionJob({
  enabled = false,
  createDatabase,
  report,
  batchSize = 250,
  maxBatches = 20
} = {}) {
  if (enabled !== true) {
    return Object.freeze({ status: 'disabled' });
  }
  if (typeof createDatabase !== 'function' || typeof report !== 'function') {
    throw new TypeError('Active retention requires database factory and monitor');
  }
  // Acquire a dedicated maintenance adapter only AFTER verifying enablement.
  const db = await createDatabase();
  if (!db || typeof db.connect !== 'function' || typeof db.end !== 'function') {
    throw new TypeError('Maintenance pool requires connect() and end()');
  }

  let committed = false;
  try {
    const locked = await withRetentionLock(db, async client => {
      // Role check and ALL deletion batches share exactly one connection and
      // transaction. No pool.query() calls can bypass the advisory lock.
      await assertRestrictedRetentionRole(client);
      return await createRetentionWorker({
        db: client, batchSize, maxBatches,
        // Retention worker emits pre-commit status. Do NOT send any success
        // externally until withRetentionLock has committed the transaction.
        report: async () => {}
      })();
    });
    if (locked.status === 'busy') {
      const result = Object.freeze({ status: 'busy' });
      await report(result);
      return result;
    }
    committed = true;
    const result = locked.value;
    await report(result); // Definitive success is emitted only after COMMIT.
    return result;
  } catch (error) {
    if (!committed) {
      // No database error or personal message content enters monitoring.
      try { await report(Object.freeze({ status: 'failed' })); }
      catch (monitorError) { error.cause = monitorError; }
    }
    // A post-commit reporting failure must not be mislabeled as a rolled-back
    // delete: the caller must alert and reconcile delivery separately.
    throw error;
  } finally {
    await db.end();
  }
}

module.exports = { runRetentionJob, assertRestrictedRetentionRole, RETENTION_ROLE_SQL };
