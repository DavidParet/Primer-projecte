'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPilotAnalysisReply} = require('../lib/whatsapp/pilot-analysis-reply');

function setup(analysisHandler) {
  let claimed = false;
  const effects = [];
  const run = createPilotAnalysisReply({
    analysisHandler,
    jobs: {
      claim: async () => {
        if (claimed) return null;
        claimed = true;
        return {phoneNumberId: '123456', senderWaId: '34000000000',
          providerMessageId: 'wamid.notice', text: 'Demà hi ha sortida.'};
      },
      beginDispatch: async () => true,
      markSent: async (_job, id) => effects.push(id),
      releaseForRetry: async () => { effects.push('retry'); claimed = false; }
    },
    meta: {
      apiVersion: 'v25.0', phoneNumberId: '123456', accessToken: 'fixture',
      fetchImpl: async (_url, options) => {
        effects.push(JSON.parse(options.body));
        return Response.json({messages: [{id: 'wamid.reply'}]});
      }
    }
  });
  return {run, effects};
}

test('passes only the forwarded text to the engine and replies once to the notice', async () => {
  let request;
  const {run, effects} = setup(async (req, res) => {
    request = req;
    return res.status(200).json({resum: 'Sortida prevista.', accions: []});
  });
  assert.deepEqual(await run('notice'), {state: 'sent'});
  assert.deepEqual(await run('notice'), {state: 'unavailable'});
  assert.deepEqual(request, {method: 'POST', headers: {}, body: {text: 'Demà hi ha sortida.'}});
  assert.equal(effects.length, 2);
  assert.equal(effects[0].to, '34000000000');
  assert.equal(effects[0].context.message_id, 'wamid.notice');
  assert.match(effects[0].text.body, /Sortida prevista/);
  assert.equal(effects[1], 'wamid.reply');
});

test('an engine error releases the job without sending a WhatsApp reply', async () => {
  const {run, effects} = setup(async (_req, res) => res.status(503).json({error: 'offline'}));
  assert.deepEqual(await run('notice'), {state: 'analysis_failed'});
  assert.deepEqual(effects, ['retry']);
});
