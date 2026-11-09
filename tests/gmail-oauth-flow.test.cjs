'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../lib/gmail/oauth-flow.cjs');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const redirectUri = 'https://nexlupa-test.example/api/gmail/callback';
const familyId = '10000000-0000-4000-8000-000000000001';
const otherFamilyId = '10000000-0000-4000-8000-000000000002';
const authUserId = '20000000-0000-4000-8000-000000000001';
const familySession = { kind: 'family-session', verifiedByServer: true, familyId, authUserId, sessionId: 'session-valid-123' };
const clientId = 'test.apps.googleusercontent.com', clientSecret = 'test-secret';

function setup() {
  const intents = new Map();
  let consent = true, approvedCalls = 0, tokenCalls = 0, identityCalls = 0;
  const fetchImpl = async (url, req) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls++;
      assert.equal(req.method, 'POST');
      return { ok: true, json: async () => ({ access_token: 'opaque-token', scope: 'openid email ' + SCOPE, expires_in: 1200 }) };
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      identityCalls++;
      return { ok: true, json: async () => ({ sub: '123456789000001', email: 'PILOT@example.com', email_verified: true }) };
    }
    throw new Error('unexpected_external_request');
  };
  const obj = {
    familySession, clientId, clientSecret, redirectUri, fetchImpl,
    hasCurrentConsent: async () => consent,
    saveIntent: async intent => { if (intents.has(intent.stateDigest)) throw Error('collision'); intents.set(intent.stateDigest, intent); },
    takeIntent: async digest => { const data = intents.get(digest); intents.delete(digest); return data; },
    onAuthorized: async d => { approvedCalls++; assert.equal(d.familyId, familyId); assert.equal(d.authUserId, authUserId); assert.equal(d.googleAccount.email, 'pilot@example.com'); assert.equal(d.accessToken, 'opaque-token'); },
    get approvedCalls() { return approvedCalls; },
    get tokenCalls() { return tokenCalls; },
    get identityCalls() { return identityCalls; },
    setConsent(value) { consent = value; },
    intents
  };
  return obj;
}
async function begin(ctx, overrides = {}) {
  const a = await flow.beginPilotOAuth({ ...ctx, ...overrides });
  const state = new URL(a.authorizationUrl).searchParams.get('state');
  return { ...a, callback: { state, code: 'test-code' } };
}
async function complete(ctx, callback, overrides = {}) {
  return flow.completePilotOAuth({ ...ctx, callback, ...overrides });
}
test('begin binds secure OAuth flow to an authenticated family session', async () => {
  const ctx = setup(), started = await begin(ctx, { clock: () => 1000000 });
  assert.equal(started.expiresInSeconds, 300);
  assert.match(started.authorizationUrl, /^https:\/\/accounts.google.com/);
  assert.equal(ctx.intents.size, 1);
  const stored = [...ctx.intents.values()][0];
  assert.equal(stored.familyId, familyId);
  assert.equal(stored.authUserId, authUserId);
  assert.notEqual(stored.stateDigest, started.callback.state);
  assert.match(stored.codeVerifier, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(stored.expiresAt, 1300000);
});
test('begin rejects browser-supplied or missing identity', async () => {
  const ctx = setup();
  for (const familySession of [null, { familyId, sessionId: 'session-valid-123' }, { kind: 'family-session', verifiedByServer: false, familyId, sessionId: 'session-valid-123' }]) {
    await assert.rejects(begin(ctx, { familySession }), /family_auth_required/);
  }
  assert.equal(ctx.intents.size, 0);
});
test('begin rejects absent family consent', async () => {
  const ctx = setup(); ctx.setConsent(false);
  await assert.rejects(begin(ctx), /gmail_consent_required/);
  assert.equal(ctx.intents.size, 0);
});
test('successful callback accepts one-time code, verifies Google identity and excludes token from result', async () => {
  const ctx = setup(), started = await begin(ctx);
  const value = await complete(ctx, started.callback);
  assert.deepEqual(value, { status: 'authorized_for_single_pilot_action', googleEmail: 'pilot@example.com' });
  assert.equal(ctx.approvedCalls, 1);
  assert.equal(ctx.tokenCalls, 1);
  assert.equal(ctx.identityCalls, 1);
  assert.equal(ctx.intents.size, 0);
});
test('replaying the same callback fails without another Google call', async () => {
  const ctx = setup(), started = await begin(ctx);
  await complete(ctx, started.callback);
  await assert.rejects(complete(ctx, started.callback), /oauth_state_rejected/);
  assert.equal(ctx.tokenCalls, 1);
  assert.equal(ctx.approvedCalls, 1);
});
test('callback from different verified family is denied', async () => {
  const ctx = setup(), started = await begin(ctx);
  const wrong = { ...familySession, familyId: otherFamilyId };
  await assert.rejects(complete(ctx, started.callback, { familySession: wrong }), /oauth_state_rejected/);
  assert.equal(ctx.tokenCalls, 0);
});
test('callback with different login session is denied', async () => {
  const ctx = setup(), started = await begin(ctx);
  const wrong = { ...familySession, sessionId: 'different-valid-session' };
  await assert.rejects(complete(ctx, started.callback, { familySession: wrong }), /oauth_state_rejected/);
  assert.equal(ctx.tokenCalls, 0);
});
test('expired state is consumed and cannot authorize', async () => {
  const ctx = setup(), started = await begin(ctx, { clock: () => 0 });
  await assert.rejects(complete(ctx, started.callback, { clock: () => flow.TTL_MS + 1 }), /oauth_state_rejected/);
  assert.equal(ctx.intents.size, 0);
  assert.equal(ctx.tokenCalls, 0);
});
test('revoking consent before callback denies token exchange', async () => {
  const ctx = setup(), started = await begin(ctx); ctx.setConsent(false);
  await assert.rejects(complete(ctx, started.callback), /gmail_consent_required/);
  assert.equal(ctx.tokenCalls, 0);
  assert.equal(ctx.approvedCalls, 0);
});
test('Google refusal is terminal and consumes state', async () => {
  const ctx = setup(), started = await begin(ctx);
  await assert.rejects(complete(ctx, { state: started.callback.state, error: 'access_denied' }), /oauth_consent_declined/);
  await assert.rejects(complete(ctx, started.callback), /oauth_state_rejected/);
});
test('unverified Google email cannot be linked to a family', async () => {
  const ctx = setup(), started = await begin(ctx);
  const rejectedFetch = async url => ({
    ok: true, json: async () => url.includes('token')
      ? { access_token: 'opaque-token', scope: SCOPE, expires_in: 1200 }
      : { sub: '123456789000001', email: 'pilot@example.com', email_verified: false }
  });
  await assert.rejects(complete(ctx, started.callback, { fetchImpl: rejectedFetch }), /google_identity_not_verified/);
  assert.equal(ctx.approvedCalls, 0);
});
test('callback requires atomic state storage adapter', async () => {
  const ctx = setup(), started = await begin(ctx);
  await assert.rejects(complete(ctx, started.callback, { takeIntent: undefined }), /missing_secure_backend_takeIntent/);
  assert.equal(ctx.approvedCalls, 0);
});
test('missing callback state cannot authorize', async () => {
  const ctx = setup();
  await assert.rejects(complete(ctx, { state: 'short', code: 'yes' }), /invalid_oauth_state/);
  assert.equal(ctx.approvedCalls, 0);
});
test('Google transport errors fail closed', async () => {
  const ctx = setup(), started = await begin(ctx);
  await assert.rejects(complete(ctx, started.callback, { fetchImpl: async () => ({ ok: false }) }), /upstream_request_failed/);
  assert.equal(ctx.approvedCalls, 0);
});

test('callback from another verified Neon user is rejected', async () => {
  const ctx = setup(), started = await begin(ctx);
  const wrong = { ...familySession, authUserId: '20000000-0000-4000-8000-000000000002' };
  await assert.rejects(complete(ctx, started.callback, { familySession: wrong }), /oauth_state_rejected/);
  assert.equal(ctx.tokenCalls, 0);
});
