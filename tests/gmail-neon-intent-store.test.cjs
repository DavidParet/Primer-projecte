'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeNeonIntentStore } = require('../lib/gmail/neon-intent-store.cjs');
const sample = {
  stateDigest: 'a'.repeat(64),
  familyId: '10000000-0000-4000-8000-000000000001',
  authUserId: '20000000-0000-4000-8000-000000000001',
  sessionBinding: 'b'.repeat(64),
  codeVerifier: 'v'.repeat(43),
  redirectUri: 'https://pilot.example.com/api/gmail/callback',
  expiresAt: 1794213000000
};
test('requires private parameterized query adapter', () => {
  assert.throws(() => makeNeonIntentStore(), /missing_db_query/);
});
test('sends scoped insert through parameterized PostgreSQL RPC only', async () => {
  const calls = [];
  const db = makeNeonIntentStore(async (sql, args) => {
    calls.push({ sql, args });
    return { rows: [{ stored: true }] };
  });
  await db.saveIntent(sample);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /store_gmail_verified_state/);
  assert.match(calls[0].sql, /\$1::text/);
  assert.equal(calls[0].args[0], sample.stateDigest);
  assert.equal(calls[0].args[1], sample.authUserId);
  assert.equal(calls[0].args[2], sample.familyId);
  assert.equal(calls[0].args[4], sample.codeVerifier);
  assert.doesNotMatch(calls[0].sql, /v{43}/);
});
test('denies duplicate or DB-refused OAuth state', async () => {
  const db = makeNeonIntentStore(async () => ({ rows: [{ stored: false }] }));
  await assert.rejects(db.saveIntent(sample), /oauth_intent_storage_denied/);
});
test('invalid family id and state are rejected before any database call', async () => {
  let queries = 0;
  const db = makeNeonIntentStore(async () => { queries++; return { rows: [{ stored: true }] }; });
  await assert.rejects(db.saveIntent({ ...sample, familyId: 'not-a-family' }), /invalid_oauth_intent/);
  await assert.rejects(db.saveIntent({ ...sample, stateDigest: "x'; DROP TABLE students;--" }), /invalid_oauth_intent/);
  await assert.rejects(db.saveIntent({ ...sample, codeVerifier: 'short' }), /invalid_oauth_intent/);
  assert.equal(queries, 0);
});
test('takes one OAuth intent through stored procedure and normalizes timestamp', async () => {
  const db = makeNeonIntentStore(async (sql, args) => {
    assert.match(sql, /consume_gmail_verified_state/);
    assert.deepEqual(args, [sample.stateDigest, sample.authUserId, sample.familyId, sample.sessionBinding]);
    return { rows: [{
      state_digest: sample.stateDigest, family_id: sample.familyId,
      session_binding: sample.sessionBinding, code_verifier: sample.codeVerifier,
      redirect_uri: sample.redirectUri, expires_at_ms: String(sample.expiresAt)
    }] };
  });
  assert.deepEqual(await db.takeIntent(sample.stateDigest, {authUserId:sample.authUserId,familyId:sample.familyId,sessionBinding:sample.sessionBinding}), sample);
});
test('returns null for already-consumed or absent intent', async () => {
  const db = makeNeonIntentStore(async () => ({ rows: [] }));
  assert.equal(await db.takeIntent(sample.stateDigest, {authUserId:sample.authUserId,familyId:sample.familyId,sessionBinding:sample.sessionBinding}), null);
});
test('rejects invalid consume result shapes or unvalidated PKCE verifier', async () => {
  const db = makeNeonIntentStore(async () => ({ rows: [
    { state_digest: sample.stateDigest, family_id: sample.familyId, session_binding: sample.sessionBinding,
      code_verifier: 'short', redirect_uri: sample.redirectUri, expires_at_ms: String(sample.expiresAt) }
  ] }));
  await assert.rejects(db.takeIntent(sample.stateDigest, {authUserId:sample.authUserId,familyId:sample.familyId,sessionBinding:sample.sessionBinding}), /invalid_oauth_consumed_intent/);
  const duplicate = makeNeonIntentStore(async () => ({ rows: [{}, {}] }));
  await assert.rejects(duplicate.takeIntent(sample.stateDigest), /invalid_oauth_consume_result/);
});

test('database intent consumption requires a verified subject, family and session binding', async () => {
  let calls = 0;
  const db = makeNeonIntentStore(async () => { calls++; return { rows: [] }; });
  await assert.rejects(db.takeIntent(sample.stateDigest, {authUserId:'not-a-uuid',familyId:sample.familyId,sessionBinding:sample.sessionBinding}), /invalid_authorized_identity/);
  await assert.rejects(db.takeIntent(sample.stateDigest, {authUserId:sample.authUserId,familyId:sample.familyId,sessionBinding:'invalid'}), /invalid_authorized_identity/);
  assert.equal(calls, 0);
});
