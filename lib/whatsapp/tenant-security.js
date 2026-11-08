'use strict';

/**
 * Read-only release gate for Neon WhatsApp tenant isolation.
 * Called with a PostgreSQL db adapter that supports query(sql).
 * Does not grant access, create policies, or expose row data.
 * A passing result is necessary, not sufficient, for production readiness.
 */
const TABLES = ['nex_whatsapp_inbound', 'nex_whatsapp_sender_authorizations'];
const ROLE_SQL = `
SELECT current_user AS role_name, r.rolbypassrls AS bypass_rls,
       r.rolsuper AS superuser
FROM pg_roles r WHERE r.rolname = current_user
`;
const TABLE_SQL = `
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS role_is_owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('nex_whatsapp_inbound', 'nex_whatsapp_sender_authorizations')
`;
const POLICIES_SQL = `
SELECT tablename AS table_name, policyname AS policy_name,
       cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('nex_whatsapp_inbound', 'nex_whatsapp_sender_authorizations')
`;

function evaluateIsolation({roles, tables, policies}) {
  const reasons = [];
  if (!Array.isArray(roles) || roles.length !== 1 ||
      !roles[0].role_name || roles[0].bypass_rls !== false ||
      roles[0].superuser !== false) {
    reasons.push('The connected role is unknown, privileged, or can bypass RLS');
  }
  if (!Array.isArray(tables) || tables.length !== TABLES.length) {
    reasons.push('Expected WhatsApp tables are missing or duplicated');
  }
  for (const name of TABLES) {
    const matches = (Array.isArray(tables) ? tables : []).filter(t => t.table_name === name);
    if (matches.length !== 1 || matches[0].rls_enabled !== true ||
        matches[0].rls_forced !== true || matches[0].role_is_owner !== false) {
      reasons.push(name + ': no verified forced-RLS non-owner access');
    }
  }
  // This is only a minimum structural check: a policy may still be too broad.
  for (const name of TABLES) {
    if (!Array.isArray(policies) ||
        !policies.some(p => p.table_name === name &&
          typeof p.policy_name === 'string' && p.policy_name.length > 0)) {
      reasons.push(name + ': no RLS policy configured');
    }
  }
  return { ready: reasons.length === 0, reasons };
}

async function inspectIsolation(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('Read-only PostgreSQL query adapter required');
  const [r,t,p] = await Promise.all([
    db.query(ROLE_SQL), db.query(TABLE_SQL), db.query(POLICIES_SQL)
  ]);
  return evaluateIsolation({roles:r.rows, tables:t.rows, policies:p.rows});
}

module.exports = { inspectIsolation, evaluateIsolation, ROLE_SQL, TABLE_SQL, POLICIES_SQL };
