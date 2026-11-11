'use strict';

/**
 * OAuth pilot orchestration for server-side callers only.
 * This module is intentionally NOT an HTTP handler and cannot authenticate a request.
 * The caller MUST supply a real server-authenticated family session and an atomic
 * persistent intent store. Never copy verifiedByServer from request JSON or cookies.
 */
const { createHash, timingSafeEqual } = require('node:crypto');
const transport = require('./pilot.cjs');

// Use four minutes: the Neon RPC requires expiration strictly within 4m59s.
const TTL_MS = 4 * 60 * 1000;
const VALID_ID = /^[a-zA-Z0-9_-]{10,150}$/;
const VALID_FAMILY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function verifiedFamilySession(session) {
  if (session?.kind !== 'family-session' || session?.verifiedByServer !== true ||
      !VALID_FAMILY.test(session.familyId || '') || !VALID_FAMILY.test(session.authUserId || '') ||
      !VALID_ID.test(session.sessionId || '')) throw new Error('family_auth_required');
  return { familyId: session.familyId.toLowerCase(), authUserId: session.authUserId.toLowerCase(), sessionBinding: digest(session.sessionId) };
}
function requireCallbacks(methods, list) {
  for (const key of list) if (typeof methods?.[key] !== 'function') throw new Error('missing_secure_backend_' + key);
}
async function beginPilotOAuth({
  familySession, clientId, redirectUri, hasCurrentConsent, saveIntent, clock = Date.now
}) {
  const identity = verifiedFamilySession(familySession);
  requireCallbacks({ hasCurrentConsent, saveIntent }, ['hasCurrentConsent', 'saveIntent']);
  if (await hasCurrentConsent(identity.familyId) !== true) throw new Error('gmail_consent_required');
  const state = transport.makeState();
  const { verifier, challenge } = transport.makePkce();
  const authorizationUrl = transport.authorizationUrl({ clientId, redirectUri, state, challenge });
  const startedAt = clock();
  if (!Number.isFinite(startedAt)) throw new Error('invalid_clock');
  await saveIntent({
    stateDigest: digest(state),
    authUserId: identity.authUserId,
    familyId: identity.familyId,
    sessionBinding: identity.sessionBinding,
    codeVerifier: verifier,
    redirectUri,
    expiresAt: startedAt + TTL_MS
  });
  return { authorizationUrl, expiresInSeconds: TTL_MS / 1000 };
}
async function fetchVerifiedGoogleIdentity(accessToken, fetchImpl = fetch) {
  if (typeof accessToken !== 'string' || !accessToken || /[\r\n]/.test(accessToken)) {
    throw new Error('invalid_access_token');
  }
  const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(8000)
  });
  if (!response?.ok) throw new Error('google_identity_unavailable');
  const profile = await response.json();
  if (typeof profile?.sub !== 'string' || !/^[0-9]{5,50}$/.test(profile.sub) ||
      profile.email_verified !== true ||
      typeof profile.email !== 'string' || profile.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    throw new Error('google_identity_not_verified');
  }
  return { sub: profile.sub, email: profile.email.toLowerCase() };
}
async function completePilotOAuth({
  familySession, callback, clientId, clientSecret, redirectUri,
  takeIntent, hasCurrentConsent, onAuthorized,
  fetchImpl = fetch, clock = Date.now
}) {
  const identity = verifiedFamilySession(familySession);
  requireCallbacks({ takeIntent, hasCurrentConsent, onAuthorized }, ['takeIntent', 'hasCurrentConsent', 'onAuthorized']);
  const state = callback?.state;
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('invalid_oauth_state');
  // takeIntent MUST atomically consume the state (e.g., DELETE ... RETURNING).
  // Consumption is before the token exchange so replay fails even after errors.
  const saved = await takeIntent(digest(state), identity);
  if (!saved || !same(saved.stateDigest, digest(state)) ||
      !same(saved.sessionBinding, identity.sessionBinding) ||
      saved.familyId !== identity.familyId || saved.authUserId !== identity.authUserId ||
      saved.redirectUri !== redirectUri ||
      !Number.isFinite(saved.expiresAt) ||
      !(clock() < saved.expiresAt) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(saved.codeVerifier || '')) {
    throw new Error('oauth_state_rejected');
  }
  if (callback?.error) throw new Error('oauth_consent_declined');
  if (typeof callback?.code !== 'string' || !callback.code ||
      callback.code.length > 4096 || /[\r\n]/.test(callback.code)) throw new Error('invalid_oauth_code');
  if (await hasCurrentConsent(identity.familyId) !== true) throw new Error('gmail_consent_required');

  const token = await transport.exchangeCode({
    clientId, clientSecret, redirectUri, code: callback.code,
    verifier: saved.codeVerifier, fetchImpl
  });
  const googleAccount = await fetchVerifiedGoogleIdentity(token.accessToken, fetchImpl);
  if (await hasCurrentConsent(identity.familyId) !== true) throw new Error('gmail_consent_revoked');
  // This callback must perform a tightly scoped, one-time action. It must NEVER
  // return or persist the token or make it available to any browser.
  await onAuthorized({
    familyId: identity.familyId,
    authUserId: identity.authUserId,
    googleAccount,
    accessToken: token.accessToken,
    expiresIn: token.expiresIn
  });
  return { status: 'authorized_for_single_pilot_action', googleEmail: googleAccount.email };
}
module.exports = { TTL_MS, beginPilotOAuth, completePilotOAuth, fetchVerifiedGoogleIdentity };
