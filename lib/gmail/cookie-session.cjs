'use strict';

// Ephemeral, encrypted, browser-bound state for a one-off Google OAuth redirect.
// It is NOT a login session and cannot be used to request any other resource.
const { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } = require('node:crypto');
const COOKIE_NAME = '__Host-nexlupa-gmail-pilot';
const CONTEXT = Buffer.from('nexlupa.gmail.pilot.redirect.v1', 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const TTL_MS = 4 * 60 * 1000;

function keyFromConfig(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('invalid_pilot_cookie_key');
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw new Error('invalid_pilot_cookie_key');
  }
  return key;
}
function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function newBrowserNonce() {
  return randomBytes(32).toString('base64url');
}
function makeCookie({key, familyId, authUserId, nonce, state, clock = Date.now}) {
  if (!UUID.test(familyId || '') || !UUID.test(authUserId || '') ||
      !NONCE.test(nonce || '') || !STATE.test(state || '')) throw new Error('invalid_oauth_cookie_data');
  const now = clock();
  if (!Number.isSafeInteger(now)) throw new Error('invalid_clock');
  const plaintext = Buffer.from(JSON.stringify({
    v: 1, familyId:familyId.toLowerCase(), authUserId:authUserId.toLowerCase(),
    nonce, state, exp:now + TTL_MS
  }), 'utf8');
  const iv = randomBytes(12);
  const encrypt = createCipheriv('aes-256-gcm', keyFromConfig(key), iv);
  encrypt.setAAD(CONTEXT);
  const ciphertext = Buffer.concat([encrypt.update(plaintext), encrypt.final()]);
  const cookie = [iv.toString('base64url'), ciphertext.toString('base64url'),
    encrypt.getAuthTag().toString('base64url')].join('.');
  return COOKIE_NAME + '=' + cookie +
    '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=240';
}
function clearCookie() {
  return COOKIE_NAME + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
}
function cookieValue(header) {
  if (typeof header !== 'string' || header.length > 8192) throw new Error('oauth_cookie_missing');
  const entries = header.split(';').map(s=>s.trim());
  const matches = entries.filter(s=>s.startsWith(COOKIE_NAME+'='));
  if (matches.length !== 1) throw new Error('oauth_cookie_missing');
  const value = matches[0].slice(COOKIE_NAME.length+1);
  if (value.length > 1024 || !/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('oauth_cookie_invalid');
  return value;
}
function readCookie({key, header, returnedState, clock = Date.now}) {
  if (!STATE.test(returnedState || '')) throw new Error('oauth_state_rejected');
  const raw = cookieValue(header);
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some(p=>!p || !/^[A-Za-z0-9_-]+$/.test(p))) {
    throw new Error('oauth_cookie_invalid');
  }
  try {
    const [iv, payload, tag] = parts.map(v=>Buffer.from(v,'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || payload.length > 400) throw new Error('invalid_encryption_shape');
    const decrypt = createDecipheriv('aes-256-gcm', keyFromConfig(key), iv);
    decrypt.setAAD(CONTEXT); decrypt.setAuthTag(tag);
    const data = Buffer.concat([decrypt.update(payload), decrypt.final()]);
    const value = JSON.parse(data.toString('utf8'));
    if (value?.v !== 1 || !UUID.test(value.familyId || '') ||
        !UUID.test(value.authUserId || '') || !NONCE.test(value.nonce || '') ||
        !STATE.test(value.state || '') || !secureEqual(value.state,returnedState) ||
        !Number.isSafeInteger(value.exp) || value.exp <= clock() ||
        value.exp > clock()+TTL_MS+10000) throw new Error('invalid_cookie_binding');
    return {familyId:value.familyId, authUserId:value.authUserId, nonce:value.nonce, state:value.state};
  } catch { throw new Error('oauth_cookie_invalid'); }
}
module.exports = {COOKIE_NAME, TTL_MS, newBrowserNonce, makeCookie, readCookie, clearCookie};
