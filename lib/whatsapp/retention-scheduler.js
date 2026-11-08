'use strict';

/**
 * Safe entrypoint for a future WhatsApp retention scheduler.
 * No database connections or secrets are acquired in this module.
 * Production activation requires a trusted explicit enabled flag,
 * dedicated DB maintenance adapter, and reliable operations monitor.
 */
const { createRetentionWorker } = require('./retention-worker');

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
  if (!db || typeof db.query !== 'function' || typeof db.end !== 'function') {
    throw new TypeError('Dedicated maintenance database adapter requires query() and end()');
  }
  try {
    // Fail closed before any DELETE. Only the dedicated maintenance role is
    // permitted, not the Neon project owner or the Resend service role.
    await assertRestrictedRetentionRole(db);
    return await createRetentionWorker({ db, report, batchSize, maxBatches })();
  } finally {
    await db.end();
  }
}

module.exports = { runRetentionJob, assertRestrictedRetentionRole, RETENTION_ROLE_SQL };
