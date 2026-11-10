'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkScopes, exchangeCode, GMAIL_READONLY_SCOPE } = require('../lib/gmail/pilot.cjs');

test('pilot accepts only requested Gmail read-only and identity scopes', () => {
  assert.equal(checkScopes(GMAIL_READONLY_SCOPE), true);
  assert.equal(checkScopes('openid email ' + GMAIL_READONLY_SCOPE), true);
  for (const scopes of [
    '', 'openid email', GMAIL_READONLY_SCOPE + ' https://www.googleapis.com/auth/gmail.modify',
    GMAIL_READONLY_SCOPE + ' https://mail.google.com/',
    GMAIL_READONLY_SCOPE + ' https://www.googleapis.com/auth/gmail.send',
    GMAIL_READONLY_SCOPE + ' profile', GMAIL_READONLY_SCOPE + ' gmail.readonly'
  ]) assert.equal(checkScopes(scopes), false, scopes);
});

test('OAuth exchange refuses broader grants without exposing token', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({
      access_token: 'synthetic-token-not-real',
      expires_in: 3600,
      scope: GMAIL_READONLY_SCOPE + ' https://www.googleapis.com/auth/gmail.modify'
    }) };
  };
  await assert.rejects(
    exchangeCode({
      clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
      redirectUri: 'https://example.test/oauth/callback',
      code: 'synthetic-code', verifier: 'a'.repeat(43), fetchImpl
    }),
    { message: 'invalid_google_token_response' }
  );
  assert.equal(calls, 1);
});
