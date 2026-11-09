'use strict';

/**
 * PREVIEW ONLY. This is a real, authenticated preflight endpoint for a future
 * Gmail pilot, but it does not start OAuth or read/send any email.
 *
 * Required environment: GMAIL_PILOT_DATABASE_URL (scoped read-only DB role),
 * NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL.
 */
const { Pool } = require('pg');
const { createVerifiedFamilyResolver } = require('../../lib/gmail/verified-family.cjs');

let pool;
let resolverPromise;
function getPool() {
  if (typeof process.env.GMAIL_PILOT_DATABASE_URL !== 'string' ||
      !process.env.GMAIL_PILOT_DATABASE_URL.startsWith('postgresql://')) {
    throw new Error('pilot_not_configured');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.GMAIL_PILOT_DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 2,
      connectionTimeoutMillis: 4000,
      statement_timeout: 5000,
      idleTimeoutMillis: 1000
    });
  }
  return pool;
}
function getResolver() {
  if (!resolverPromise) {
    const db = getPool();
    resolverPromise = createVerifiedFamilyResolver({
      authBaseUrl: process.env.NEON_AUTH_BASE_URL,
      jwksUrl: process.env.NEON_AUTH_JWKS_URL,
      pgQuery: (sql, values) => db.query(sql, values)
    }).catch(error => { resolverPromise = null; throw error; });
  }
  return resolverPromise;
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // This endpoint is for isolated preview validation; the public application
  // must never expose family-membership probes, even if environment variables
  // are accidentally copied to production.
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(503).json({ready:false,error:'pilot_disabled'});
  }
  if (req.method === 'POST' && process.env.GMAIL_PILOT_ENABLED !== 'true') {
    return res.status(503).json({authorized:false,error:'pilot_disabled'});
  }

  if (req.method === 'GET') {
    try {
      const db = getPool();
      const check = await db.query(
        "SELECT current_user AS actor,has_schema_privilege(current_user,'nexlupa_worker_test','USAGE') AS direct_family_schema," +
        "has_function_privilege(current_user,'nexlupa_worker_rpc.is_verified_gmail_family(uuid,uuid)','EXECUTE') AS can_verify_membership"
      );
      const status = check.rows[0] || {};
      const ready = status.actor === 'nexlupa_gmail_auth_preview' &&
        status.direct_family_schema === false && status.can_verify_membership === true;
      return res.status(ready ? 200 : 503).json({
        ready, mode: 'preview-only', family_auth: 'neon-jwt-required',
        direct_family_table_access: false,
        real_email_access: false, oauth_authorization_started: false
      });
    } catch {
      return res.status(503).json({ ready: false, error: 'pilot_not_ready' });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Never accept credentials, flags, or family ownership from the JSON body.
  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (!Number.isSafeInteger(contentLength) || contentLength > 512) {
    return res.status(413).json({ error: 'invalid_request_size' });
  }
  const familyId = typeof req.body === 'object' && req.body !== null &&
    !Array.isArray(req.body) ? req.body.familyId : null;
  try {
    const verifier = await getResolver();
    const familySession = await verifier({
      authorization: req.headers?.authorization,
      requestedFamilyId: familyId
    });
    return res.status(200).json({
      authorized: true, familyId: familySession.familyId,
      next_step: 'oauth_client_configuration_required',
      access: 'no_mail_access'
    });
  } catch (error) {
    const code = error?.message;
    const status = code === 'authentication_required' ? 401 :
      code === 'family_not_authorized' ? 403 :
      code === 'invalid_family_selection' ? 400 : 503;
    return res.status(status).json({
      authorized: false,
      error: status === 503 ? 'pilot_not_ready' : code
    });
  }
};
