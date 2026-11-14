'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createAnalysisReplyProcessor} = require('../lib/whatsapp/process-analysis-reply');

function setup(overrides = {}) {
  let state = 'pending';
  const sent = [];
  const process = createAnalysisReplyProcessor({
    claim: async key => {
      assert.equal(key, 'notice-1');
      if (state !== 'pending') return null;
      state = 'claimed';
      return {phoneNumberId: '123456', senderWaId: '34000000000',
        providerMessageId: 'wamid.notice', text: 'Porteu aliments al punt de recollida.'};
    },
    analyzeText: async text => {
      assert.equal(text, 'Porteu aliments al punt de recollida.');
      return {resum: 'Recollida d’aliments.', accions: [{accio: 'Portar aliments'}]};
    },
    beginDispatch: async () => { state = 'dispatching'; return true; },
    sendReply: async reply => { sent.push(reply); return 'wamid.reply'; },
    markSent: async (_job, id) => { assert.equal(id, 'wamid.reply'); state = 'sent'; },
    releaseForRetry: async () => { state = 'pending'; },
    ...overrides
  });
  return {run: () => process('notice-1'), sent};
}

test('a concurrent duplicate yields one reply in the originating chat', async () => {
  const {run, sent} = setup();
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map(result => result.state).sort(), ['sent', 'unavailable']);
  assert.deepEqual(sent, [{phoneNumberId: '123456', to: '34000000000',
    replyTo: 'wamid.notice', body: '🔍 NexLupa\n\nRecollida d’aliments.\n\nAccions\n• Portar aliments'}]);
});

test('revocation before dispatch suppresses the outgoing reply', async () => {
  const {run, sent} = setup({beginDispatch: async () => false});
  assert.deepEqual(await run(), {state: 'not_dispatched'});
  assert.equal(sent.length, 0);
});

test('a failed analysis can be retried before any send has started', async () => {
  let calls = 0;
  const {run, sent} = setup({analyzeText: async () => {
    if (++calls === 1) throw new Error('engine unavailable');
    return {resum: 'Recollida d’aliments.', accions: []};
  }});
  assert.deepEqual(await run(), {state: 'analysis_failed'});
  assert.equal(sent.length, 0);
  assert.deepEqual(await run(), {state: 'sent'});
});

test('a timeout or failed recording after dispatch does not retry the send', async () => {
  for (const overrides of [
    {sendReply: async () => { throw new Error('timeout'); }},
    {markSent: async () => { throw new Error('database unavailable'); }}
  ]) {
    const {run} = setup(overrides);
    assert.deepEqual(await run(), {state: 'delivery_unknown'});
    assert.deepEqual(await run(), {state: 'unavailable'});
  }
});
