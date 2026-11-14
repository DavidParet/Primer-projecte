'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMetaAnalysisReplySender} = require('../lib/whatsapp/meta-analysis-reply-sender');
const {createAnalysisReplyProcessor} = require('../lib/whatsapp/process-analysis-reply');

const config = {apiVersion: 'v25.0', phoneNumberId: '123456', accessToken: 'fixture'};
const reply = {phoneNumberId: '123456', to: '34000000000', replyTo: 'wamid.notice', body: 'Resum'};

test('the processor sends one quoted text reply through the Meta adapter', async () => {
  const requests = [];
  const sendReply = createMetaAnalysisReplySender({...config, fetchImpl: async (url, options) => {
    requests.push({url, options});
    return Response.json({messages: [{id: 'wamid.response'}]});
  }});
  let claimed = false;
  let recorded;
  const process = createAnalysisReplyProcessor({
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return {phoneNumberId: reply.phoneNumberId, senderWaId: reply.to,
        providerMessageId: reply.replyTo, text: 'Avís de prova'};
    },
    analyzeText: async () => ({resum: 'Resum', accions: []}),
    beginDispatch: async () => true,
    sendReply,
    markSent: async (_job, id) => { recorded = id; },
    releaseForRetry: async () => assert.fail('unexpected retry')
  });
  assert.deepEqual(await process('notice'), {state: 'sent'});
  assert.deepEqual(await process('notice'), {state: 'unavailable'});
  assert.equal(recorded, 'wamid.response');
  assert.equal(requests.length, 1);
  const [{url, options}] = requests;
  assert.equal(url, 'https://graph.facebook.com/v25.0/123456/messages');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer fixture');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: reply.to,
    context: {message_id: reply.replyTo}, type: 'text',
    text: {body: '🔍 NexLupa\n\nResum', preview_url: false}
  });
});

test('rejects a foreign sender number and invalid replies before making a request', async () => {
  const send = createMetaAnalysisReplySender({...config, fetchImpl: async () => {
    assert.fail('unexpected request');
  }});
  for (const change of [{phoneNumberId: '654321'}, {to: '+34000000000'},
    {replyTo: 'notice'}, {body: 'x'.repeat(4097)}]) {
    await assert.rejects(send({...reply, ...change}), TypeError);
  }
});

test('does not resend when Meta fails, times out, or omits an outgoing message ID', async () => {
  for (const fetchImpl of [
    async () => new Response('provider details', {status: 429}),
    async () => { throw new Error('timeout'); },
    async () => Response.json({messages: []})
  ]) {
    let calls = 0;
    const send = createMetaAnalysisReplySender({...config, fetchImpl: (...args) => {
      calls++;
      return fetchImpl(...args);
    }});
    await assert.rejects(send(reply), {message: 'WhatsApp reply dispatch not confirmed'});
    assert.equal(calls, 1);
  }
});
