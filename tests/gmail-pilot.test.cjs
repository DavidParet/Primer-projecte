'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../lib/gmail/pilot.cjs');
const good = { clientId: 'test.apps.googleusercontent.com', redirectUri: 'https://pilot.example.com/api/gmail/callback' };
function mock(value, ok = true) { return async (_url, request) => ({ ok, json: async () => value, request }); }
const token = 'opaque-short-lived-token';

test('PKCE verifier and challenge have valid independent randomness', () => {
  const a = lib.makePkce(), b = lib.makePkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});
test('state compare rejects mismatch and malformed values', () => {
  const state = lib.makeState();
  assert.equal(lib.verifyState(state, state), true);
  assert.equal(lib.verifyState(state, lib.makeState()), false);
  assert.equal(lib.verifyState('broken\nstate', state), false);
});
test('consent URL requires exact read-only access and PKCE', () => {
  const auth = new URL(lib.authorizationUrl({ ...good, state: lib.makeState(), challenge: lib.makePkce().challenge }));
  assert.equal(auth.origin, 'https://accounts.google.com');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('access_type'), 'online');
  assert.match(auth.searchParams.get('scope'), /gmail\.readonly/);
  assert.doesNotMatch(auth.searchParams.get('scope'), /gmail\.modify|gmail\.send/);
});
test('redirect rejects insecure and attacker-controlled URLs', () => {
  for (const redirectUri of ['http://not-local.example/callback', 'https://evil.example/?a=1',
    'https://user@pilot.example.com/callback', 'javascript:alert(1)']) {
    assert.throws(() => lib.authorizationUrl({ ...good, redirectUri, state: lib.makeState(), challenge: lib.makePkce().challenge }));
  }
});
test('token exchange validates authorized scope and refuses to preserve refresh token', async () => {
  const a = await lib.exchangeCode({ ...good, clientSecret: 'dummy', code: 'dummy', verifier: lib.makePkce().verifier,
    fetchImpl: mock({ access_token: token, scope: 'openid email ' + lib.GMAIL_READONLY_SCOPE, expires_in: 3599, refresh_token: 'NEVER_RETURN' }) });
  assert.deepEqual(a, { accessToken: token, expiresIn: 3599 });
});
test('token exchange fails closed without Gmail scope', async () => {
  await assert.rejects(lib.exchangeCode({ ...good, clientSecret: 'dummy', code: 'dummy', verifier: lib.makePkce().verifier,
    fetchImpl: mock({ access_token: token, scope: 'openid email', expires_in: 3599 }) }), /invalid_google_token_response/);
});
test('token exchange fails closed on upstream error', async () => {
  await assert.rejects(lib.exchangeCode({ ...good, clientSecret: 'dummy', code: 'dummy', verifier: lib.makePkce().verifier,
    fetchImpl: mock({}, false) }), /upstream_request_failed/);
});
test('list only requests messages from one explicit custom label and max 10', async () => {
  let seen;
  const fetchImpl = async (url, request) => { seen = { url, request }; return { ok: true, json: async () => ({ messages: [{ id: 'abc1' }] }) }; };
  const messages = await lib.listLabelMessageIds({ accessToken: token, labelId: 'Label_123', maxResults: 5, fetchImpl });
  assert.equal(messages[0].id, 'abc1');
  assert.equal(new URL(seen.url).searchParams.get('labelIds'), 'Label_123');
  assert.equal(new URL(seen.url).searchParams.get('maxResults'), '5');
  assert.equal(seen.request.method, 'GET');
});
test('rejects mailbox-wide listing', async () => {
  for (const labelId of ['', 'INBOX', 'Label_1&labelIds=INBOX']) {
    await assert.rejects(lib.listLabelMessageIds({ accessToken: token, labelId, fetchImpl: mock({ messages: [] }) }), /invalid_pilot_label_or_limit/);
  }
});
test('rejects excessive list count and newline access token', async () => {
  await assert.rejects(lib.listLabelMessageIds({ accessToken: token, labelId: 'Label_1', maxResults: 100 }), /invalid_pilot_label_or_limit/);
  await assert.rejects(lib.listLabelMessageIds({ accessToken: 'bad\r\ntoken', labelId: 'Label_1' }), /invalid_access_token/);
});
test('reads only plain text message with bounded content', async () => {
  const mail = await lib.readTextMessage({ accessToken: token, messageId: 'abc1', labelId: 'Label_123',
    fetchImpl: mock({ id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 99, threadId: 'thread1', payload: { mimeType: 'multipart/alternative', headers: [
      { name: 'Subject', value: 'Sortida escolar' }, { name: 'From', value: 'Escola <school@example.com>' }],
      parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<b>html</b>').toString('base64url') } },
        { mimeType: 'text/plain', body: { data: Buffer.from('Excursió el 15 de març').toString('base64url') } }] } }) });
  assert.equal(mail.subject, 'Sortida escolar');
  assert.match(mail.text, /Excursió/);
  assert.equal(mail.threadId, 'thread1');
});
test('rejects HTML-only body', async () => {
  await assert.rejects(lib.readTextMessage({ accessToken: token, messageId: 'abc1', labelId: 'Label_123',
    fetchImpl: mock({ id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 30, payload: { mimeType: 'text/html', body: { data: 'aGVsbG8' } } }) }), /plain_text_required/);
});
test('rejects large email, attachments and mismatched identifiers', async () => {
  for (const data of [
    { id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 101000, payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } } },
    { id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 30, payload: { mimeType: 'text/plain', filename: 's.txt', body: { data: 'aGVsbG8' } } },
    { id: 'other', labelIds: ['Label_123'], sizeEstimate: 30, payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } } },
  ]) {
    await assert.rejects(lib.readTextMessage({ accessToken: token, messageId: 'abc1', labelId: 'Label_123', fetchImpl: mock(data) }));
  }
});
test('read endpoint never uses write verbs', async () => {
  let method;
  await lib.readTextMessage({ accessToken: token, messageId: 'abc1', labelId: 'Label_123', fetchImpl: async (_url, options) => {
    method = options.method;
    return { ok: true, json: async () => ({ id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 30, payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } } }) };
  } });
  assert.equal(method, 'GET');
});

test('rejects a message not carrying the required pilot label', async () => {
  await assert.rejects(lib.readTextMessage({ accessToken: token, messageId: 'abc1', labelId: 'Label_123',
    fetchImpl: mock({ id: 'abc1', labelIds: ['INBOX'], sizeEstimate: 30, payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } } }) }), /message_outside_pilot_label/);
});
