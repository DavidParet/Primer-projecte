'use strict';

/**
 * Browser-bound OAuth bridge. The initiating API has already verified a Neon
 * Auth JWT and an active family membership. The browser receives only a random,
 * HttpOnly cookie; JWTs and the PKCE verifier stay server-side.
 *
 * The callback's database adapter MUST atomically consume state+cookie hash
 * and recheck current membership and consent before returning identity.
 */
const { randomBytes, createHash } = require('node:crypto');
const { beginPilotOAuth, completePilotOAuth } = require('./oauth-flow.cjs');

const NONCE = /^[A-Za-z0-9_-]{43}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE_NAME = '__Host-nxl_gmail_state';

function sha256(input) { return createHash('sha256').update(input, 'utf8').digest('hex'); }

function validateRedirectUri(input) {
  try {
    const uri = new URL(input);
    if (uri.protocol !== 'https:' || uri.username || uri.password ||
        uri.hash || uri.search || uri.pathname !== '/api/gmail/pilot/callback' ||
        !uri.hostname || uri.port) throw Error('invalid');
    return uri.toString();
  } catch { throw new Error('invalid_pilot_redirect_uri'); }
}

function setStateCookie(nonce) {
  if (!NONCE.test(nonce || '')) throw new Error('invalid_browser_nonce');
  return COOKIE_NAME + '=' + nonce +
    '; Path=/; Max-Age=240; Secure; HttpOnly; SameSite=Lax';
}
function clearStateCookie() {
  return COOKIE_NAME + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
}
function getStateCookie(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const values = header.split(';').map(x => x.trim());
  const matches = values.filter(x => x.startsWith(COOKIE_NAME + '='));
  if (matches.length !== 1) return null;
  const nonce = matches[0].slice(COOKIE_NAME.length + 1);
  return NONCE.test(nonce) ? nonce : null;
}
async function beginBrowserOAuth({
  familySession, clientId, redirectUri, hasCurrentConsent, saveIntent, clock
}) {
  validateRedirectUri(redirectUri);
  if (familySession?.verifiedByServer !== true ||
      familySession?.kind !== 'family-session') throw new Error('family_auth_required');
  const nonce = randomBytes(32).toString('base64url');
  // sessionId is a fresh server-generated browser nonce, NOT request JSON.
  const verifiedForBrowser = { ...familySession, sessionId: nonce };
  const started = await beginPilotOAuth({
    familySession: verifiedForBrowser, clientId, redirectUri,
    hasCurrentConsent, saveIntent, clock
  });
  return {
    authorizationUrl: started.authorizationUrl,
    setCookie: setStateCookie(nonce),
    expiresInSeconds: started.expiresInSeconds
  };
}
async function completeBrowserOAuth({
  state, code, error, cookieHeader,
  clientId, clientSecret, redirectUri,
  takeBrowserIntent, checkCurrentFamilyConsent,
  onAuthorized, fetchImpl, clock
}) {
  validateRedirectUri(redirectUri);
  if (typeof takeBrowserIntent !== 'function' ||
      typeof checkCurrentFamilyConsent !== 'function' ||
      typeof onAuthorized !== 'function') throw new Error('missing_secure_backend');
  const nonce = getStateCookie(cookieHeader);
  if (!nonce || !NONCE.test(state || '')) throw new Error('invalid_browser_state');

  const stateDigest = sha256(state);
  const sessionBinding = sha256(nonce);
  // This DB function must perform UPDATE ... RETURNING and use BOTH hashes.
  const intent = await takeBrowserIntent({ stateDigest, sessionBinding });
  if (!intent ||
      intent.stateDigest !== stateDigest ||
      intent.sessionBinding !== sessionBinding ||
      !UUID.test(intent.familyId || '') ||
      !UUID.test(intent.authUserId || '') ||
      typeof intent.redirectUri !== 'string' ||
      intent.redirectUri !== redirectUri ||
      !HEX64.test(intent.stateDigest)) {
    throw new Error('oauth_state_rejected');
  }

  const familySession = {
    kind: 'family-session',
    verifiedByServer: true,
    authUserId: intent.authUserId,
    familyId: intent.familyId,
    sessionId: nonce
  };
  let consumed = false;
  return completePilotOAuth({
    familySession,
    callback: { state, code, error },
    clientId, clientSecret, redirectUri,
    takeIntent: async (hash, identity) => {
      if (consumed || hash !== stateDigest ||
          identity.authUserId !== intent.authUserId ||
          identity.familyId !== intent.familyId ||
          identity.sessionBinding !== sessionBinding) return null;
      consumed = true;
      return intent;
    },
    hasCurrentConsent: async familyId =>
      checkCurrentFamilyConsent({ familyId, authUserId: intent.authUserId }),
    onAuthorized: (authorized) =>
      onAuthorized({ ...authorized, familySession }),
    fetchImpl,
    clock
  });
}
module.exports = {
  COOKIE_NAME, beginBrowserOAuth, completeBrowserOAuth,
  validateRedirectUri, setStateCookie, clearStateCookie, getStateCookie
};
