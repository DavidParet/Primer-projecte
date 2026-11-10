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

test('discovers the exact dedicated user label without reading any messages', async () => {
  const calls = [];
  const id = await lib.findPilotLabelId({ accessToken: token, fetchImpl: async (url, opts) => {
    calls.push({url,opts});
    return {ok:true,json:async()=>({labels:[
      {id:'INBOX',name:'INBOX',type:'system'},
      {id:'Label_a1',name:'NEXLUPA_PILOT',type:'user'}
    ]})};
  }});
  assert.equal(id,'Label_a1');
  assert.equal(calls.length,1);
  assert.equal(calls[0].opts.method,'GET');
  assert.ok(calls[0].url.includes('/users/me/labels'));
});
test('missing, duplicated, or forged pilot label cannot grant mailbox access', async () => {
  for (const labels of [
    [],
    [{id:'Label_a1',name:'Other Label',type:'user'}],
    [{id:'Label_a1',name:'NEXLUPA_PILOT',type:'system'}],
    [{id:'Label_a1',name:'NEXLUPA_PILOT',type:'user'},{id:'Label_a2',name:'NEXLUPA_PILOT',type:'user'}]
  ]) {
    await assert.rejects(lib.findPilotLabelId({
      accessToken:token,
      fetchImpl:async()=>({ok:true,json:async()=>({labels})})
    }),/pilot_label_missing/);
  }
});

test('rejects a MIME message with plain text plus a sibling attachment',async()=>{
  const mail={
    id:'abc1',labelIds:['Label_123'],sizeEstimate:150,
    payload:{mimeType:'multipart/mixed',parts:[
      {mimeType:'text/plain',body:{data:Buffer.from('visible').toString('base64url')}},
      {mimeType:'application/pdf',filename:'private.pdf',body:{attachmentId:'attachment_123'}}
    ]}
  };
  await assert.rejects(lib.readTextMessage({
    accessToken:token,messageId:'abc1',labelId:'Label_123',fetchImpl:mock(mail)
  }),/message_not_eligible/);
});
test('rejects hidden attachment in deeply nested MIME sibling',async()=>{
  const mail={
    id:'abc1',labelIds:['Label_123'],sizeEstimate:150,
    payload:{mimeType:'multipart/mixed',parts:[
      {mimeType:'multipart/alternative',parts:[
        {mimeType:'text/plain',body:{data:Buffer.from('visible').toString('base64url')}}
      ]},
      {mimeType:'multipart/related',parts:[
        {mimeType:'image/png',body:{attachmentId:'hidden-image'}}
      ]}
    ]}
  };
  await assert.rejects(lib.readTextMessage({
    accessToken:token,messageId:'abc1',labelId:'Label_123',fetchImpl:mock(mail)
  }),/message_not_eligible/);
});
test('rejects pathological MIME depth and malformed parts',async()=>{
  const deep={mimeType:'text/plain',body:{data:'aGVsbG8'}};
  let nested=deep;
  for(let i=0;i<10;i++)nested={mimeType:'multipart/mixed',parts:[nested]};
  for(const payload of [nested,{mimeType:'multipart/mixed',parts:'bad'}]){
    await assert.rejects(lib.readTextMessage({
      accessToken:token,messageId:'abc1',labelId:'Label_123',
      fetchImpl:mock({id:'abc1',labelIds:['Label_123'],sizeEstimate:50,payload})
    }),/message_not_eligible/);
  }
});

test('rejects ambiguous duplicate plain-text MIME bodies', async () => {
  const mail = {
    id:'abc1',labelIds:['Label_123'],sizeEstimate:200,
    payload:{mimeType:'multipart/alternative',parts:[
      {mimeType:'text/plain',body:{data:Buffer.from('Benign text').toString('base64url')}},
      {mimeType:'text/plain',body:{data:Buffer.from('Conflicting text').toString('base64url')}}
    ]}
  };
  await assert.rejects(lib.readTextMessage({
    accessToken:token,messageId:'abc1',labelId:'Label_123',fetchImpl:mock(mail)
  }),/message_not_eligible/);
});
test('rejects noncanonical base64url and malformed UTF-8 without replacement characters', async () => {
  for (const data of ['aGVsbG8=', 'aGVsbG8!', Buffer.from([0xc3,0x28]).toString('base64url')]) {
    await assert.rejects(lib.readTextMessage({
      accessToken:token,messageId:'abc1',labelId:'Label_123',
      fetchImpl:mock({
        id:'abc1',labelIds:['Label_123'],sizeEstimate:30,
        payload:{mimeType:'text/plain',body:{data}}
      })
    }),/invalid_plain_text|plain_text_required/);
  }
});

test('deduplicates repeated Gmail message IDs while preserving first-seen order', async () => {
  const result = await lib.listLabelMessageIds({
    accessToken: token, labelId: 'Label_123', maxResults: 5,
    fetchImpl: mock({ messages: [
      { id: 'first', threadId: 'thread1' },
      { id: 'first', threadId: 'thread1' },
      { id: 'second', threadId: 'thread3' }
    ] })
  });
  assert.deepEqual(result, [
    { id: 'first', threadId: 'thread1' },
    { id: 'second', threadId: 'thread3' }
  ]);
});
test('rejects malformed Gmail listing rather than silently skipping entries', async () => {
  for (const messages of [
    [{ id: 'valid' }, { id: 'bad id' }],
    [{ id: 'valid', threadId: 'bad thread' }],
    [null]
  ]) {
    await assert.rejects(lib.listLabelMessageIds({
      accessToken: token, labelId: 'Label_123', fetchImpl: mock({ messages })
    }), /invalid_gmail_list/);
  }
});

test('rejects negative size and malformed Gmail thread IDs', async () => {
  for (const overrides of [{ sizeEstimate: -1 }, { threadId: 'invalid thread' }, { threadId: 42 }]) {
    await assert.rejects(lib.readTextMessage({
      accessToken: token, messageId: 'abc1', labelId: 'Label_123',
      fetchImpl: mock({ id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 30,
        payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } }, ...overrides })
    }), /message_not_eligible/);
  }
});

test('fails closed if Gmail returns more IDs than requested', async () => {
  await assert.rejects(lib.listLabelMessageIds({
    accessToken: token, labelId: 'Label_123', maxResults: 2,
    fetchImpl: mock({ messages: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] })
  }), /invalid_gmail_list/);
});

test('rejects duplicate or malformed sender and subject headers', async () => {
  for (const headers of [
    [{ name: 'From', value: 'first@example.test' }, { name: 'fRoM', value: 'second@example.test' }],
    [{ name: 'Subject', value: 'safe' }, { name: 'SUBJECT', value: 'conflicting' }],
    [{ name: 'From', value: { unexpected: 'object' } }],
    [{ name: 'Subject', value: 42 }]
  ]) {
    await assert.rejects(lib.readTextMessage({
      accessToken: token, messageId: 'abc1', labelId: 'Label_123',
      fetchImpl: mock({ id: 'abc1', labelIds: ['Label_123'], sizeEstimate: 30,
        payload: { mimeType: 'text/plain', headers, body: { data: 'aGVsbG8' } } })
    }), /message_not_eligible/);
  }
});


test('rejects duplicate Gmail IDs with conflicting thread identity', async () => {
  for (const messages of [
    [{ id: 'same', threadId: 'threadA' }, { id: 'same', threadId: 'threadB' }],
    [{ id: 'same' }, { id: 'same', threadId: 'threadA' }]
  ]) {
    await assert.rejects(lib.listLabelMessageIds({
      accessToken: token, labelId: 'Label_123', maxResults: 5,
      fetchImpl: mock({ messages })
    }), /invalid_gmail_list/);
  }
});

test('rejects numeric and object IDs rather than coercing them to strings', async () => {
  for (const id of [123, { toString: () => 'valid' }]) {
    await assert.rejects(lib.listLabelMessageIds({
      accessToken: token, labelId: 'Label_123',
      fetchImpl: mock({ messages: [{ id }] })
    }), /invalid_gmail_list/);
    await assert.rejects(lib.readTextMessage({
      accessToken: token, messageId: id, labelId: 'Label_123',
      fetchImpl: mock({})
    }), /invalid_message_id/);
  }
});

test('rejects numeric thread IDs in both Gmail list and message response', async () => {
  await assert.rejects(lib.listLabelMessageIds({
    accessToken: token, labelId: 'Label_123',
    fetchImpl: mock({ messages: [{ id: 'abc1', threadId: 42 }] })
  }), /invalid_gmail_list/);
  await assert.rejects(lib.readTextMessage({
    accessToken: token, messageId: 'abc1', labelId: 'Label_123',
    fetchImpl: mock({ id: 'abc1', threadId: 42, labelIds: ['Label_123'],
      sizeEstimate: 30, payload: { mimeType: 'text/plain', body: { data: 'aGVsbG8' } } })
  }), /message_not_eligible/);
});
