'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {createDurableInbox} = require('../lib/whatsapp/durable-inbox');
const {createVerifiedIngestion} = require('../lib/whatsapp/verified-ingestion');
const {createVerifiedReplyDeliveryReader} = require('../lib/whatsapp/pilot-verified-reply-delivery');

test('binds a signed sender to the encrypted inbox row and refuses mismatches', async () => {
  const appSecret = 'ci-fixture';
  const senderHmacKey = Buffer.alloc(32, 1).toString('base64');
  const contentEncryptionKey = Buffer.alloc(32, 2).toString('base64');
  const sender = '34000000000';
  const delivery = {from: sender, id: 'wamid.fixture', timestamp: '1794630000',
    type: 'text', text: {body: 'Sortida demà'}};
  const raw = Buffer.from(JSON.stringify({object: 'whatsapp_business_account',
    entry: [{id: '123456', changes: [{field: 'messages', value: {
      metadata: {phone_number_id: '654321'}, messages: [delivery]
    }}]}]}));
  const signature = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  let row;
  const inbox = createDurableInbox({senderHmacKey, contentEncryptionKey, db: {
    query: async (_sql, values) => {
      const [business_account_id, phone_number_id, sender_digest, provider_message_id,
        nonce, authentication_tag, ciphertext, timestamp] = values;
      row = {inbound_id: '7', business_account_id, phone_number_id, sender_digest,
        provider_message_id, nonce, authentication_tag, ciphertext,
        provider_sent_at: new Date(Number(timestamp) * 1000),
        expires_at: new Date(Date.now() + 60000)};
      return {rows: [{state: 'stored'}]};
    }
  }});
  await createVerifiedIngestion({inbox, appSecret})(raw, signature);
  const reader = createVerifiedReplyDeliveryReader({appSecret, senderHmacKey,
    contentEncryptionKey, readAuthorizedInboxRow: async () => row});
  assert.throws(() => reader(raw, 'invalid'), /Unverified/);
  const load = reader(raw, signature);
  assert.deepEqual(await load(7), {phoneNumberId: '654321', senderWaId: sender,
    providerMessageId: 'wamid.fixture', text: 'Sortida demà'});
  assert.equal(await load(8), null);
  row.sender_digest = Buffer.alloc(32);
  assert.equal(await load(7), null);
});
