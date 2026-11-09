'use strict';

/**
 * Neon-only adapter for Gmail pilot's single-use OAuth intent state.
 * Never expose the methods directly to HTTP callers. The underlying database
 * role must only have EXECUTE on scoped RPC functions, not raw table privileges.
 */
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
function makeNeonIntentStore(pgQuery) {
  if (typeof pgQuery !== 'function') throw new Error('missing_db_query');
  async function saveIntent(intent) {
    if (!intent || !HEX64.test(intent.stateDigest || '') || !UUID.test(intent.familyId || '') ||
        !HEX64.test(intent.sessionBinding || '') || !VERIFIER.test(intent.codeVerifier || '') ||
        typeof intent.redirectUri !== 'string' || !intent.redirectUri.startsWith('https://') ||
        !Number.isFinite(intent.expiresAt)) throw new Error('invalid_oauth_intent');
    const result = await pgQuery(
      'SELECT nexlupa_worker_rpc.store_gmail_pilot_state($1::text,$2::uuid,$3::text,$4::text,$5::text,to_timestamp($6::double precision / 1000)) AS stored',
      [intent.stateDigest, intent.familyId, intent.sessionBinding,
        intent.codeVerifier, intent.redirectUri, intent.expiresAt]
    );
    if (result?.rows?.length !== 1 || result.rows[0].stored !== true) {
      throw new Error('oauth_intent_storage_denied');
    }
  }
  async function takeIntent(stateDigest) {
    if (!HEX64.test(stateDigest || '')) throw new Error('invalid_oauth_state_digest');
    const result = await pgQuery(
      'SELECT state_digest,family_id,session_binding,code_verifier,redirect_uri,expires_at_ms FROM nexlupa_worker_rpc.consume_gmail_pilot_state($1::text)',
      [stateDigest]
    );
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) throw new Error('invalid_oauth_consume_result');
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const expiresAt = Number(row.expires_at_ms);
    if (row.state_digest !== stateDigest || !UUID.test(row.family_id || '') ||
        !HEX64.test(row.session_binding || '') || !VERIFIER.test(row.code_verifier || '') ||
        !Number.isSafeInteger(expiresAt)) throw new Error('invalid_oauth_consumed_intent');
    return {
      stateDigest: row.state_digest,
      familyId: row.family_id,
      sessionBinding: row.session_binding,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      expiresAt
    };
  }
  return { saveIntent, takeIntent };
}
module.exports = { makeNeonIntentStore };
