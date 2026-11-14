'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPilotReplyJobStore} = require('../lib/whatsapp/pilot-reply-job-store');

test('keeps the claim token on each storage transition and checks update counts', async () => {
  const calls = [];
  let rows = 1;
  const store = createPilotReplyJobStore({
    db: {query: async (sql, values) => {
      calls.push({sql, values});
      return {rowCount: rows};
    }},
    loadAuthorizedDelivery: async id => id === 7 ? {text: 'Avís de prova'} : null
  });
  assert.equal(await store.claim(8), null);
  assert.equal(calls.length, 0);
  const job = await store.claim(7);
  assert.equal(job.text, 'Avís de prova');
  assert.match(job.claimToken, /^[a-f0-9-]{36}$/);
  assert.equal(await store.beginDispatch(job), true);
  await store.markSent(job, 'wamid.sent');
  await store.releaseForRetry(job);
  assert.deepEqual(calls.map(call => call.values), [
    [7, job.claimToken], [7, job.claimToken], [7, job.claimToken, 'wamid.sent'],
    [7, job.claimToken]
  ]);
  rows = 0;
  assert.equal(await store.claim(7), null);
  assert.equal(await store.beginDispatch(job), false);
  await assert.rejects(store.markSent(job, 'wamid.sent'), /not recorded/);
});
