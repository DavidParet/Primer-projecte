'use strict';

/**
 * Read-once adapter to the restricted Neon RPC for OAuth browser callbacks.
 * The SQL function validates state and HttpOnly-cookie hashes together,
 * then atomically consumes the record with current membership+consent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
function makeBrowserIntentReader(pgQuery) {
  if (typeof pgQuery !== 'function') throw new Error('missing_private_database');
  return async function takeBrowserIntent({ stateDigest, sessionBinding } = {}) {
    if (!HEX64.test(stateDigest || '') || !HEX64.test(sessionBinding || '')) {
      throw new Error('invalid_browser_state');
    }
    const result = await pgQuery(
      'SELECT state_digest,auth_user_id,family_id,session_binding,code_verifier,redirect_uri,expires_at_ms FROM nexlupa_worker_rpc.consume_gmail_browser_state($1::text,$2::text)',
      [stateDigest, sessionBinding]
    );
    if (!Array.isArray(result?.rows) || result.rows.length > 1) {
      throw new Error('invalid_browser_state_result');
    }
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const expiresAt = Number(row.expires_at_ms);
    if (row.state_digest !== stateDigest ||
        row.session_binding !== sessionBinding ||
        !UUID.test(row.auth_user_id || '') ||
        !UUID.test(row.family_id || '') ||
        !VERIFIER.test(row.code_verifier || '') ||
        typeof row.redirect_uri !== 'string' ||
        !Number.isSafeInteger(expiresAt)) {
      throw new Error('invalid_browser_state_result');
    }
    return {
      stateDigest: row.state_digest,
      authUserId: row.auth_user_id,
      familyId: row.family_id,
      sessionBinding: row.session_binding,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      expiresAt
    };
  };
}
module.exports = { makeBrowserIntentReader };
