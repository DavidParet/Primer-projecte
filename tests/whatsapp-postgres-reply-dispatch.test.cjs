'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createPilotReplyJobStore} = require('../lib/whatsapp/pilot-reply-job-store');

const url = process.env.WHATSAPP_REPLY_TEST_DATABASE_URL;
test('PostgreSQL serializes reply claims and fences retries, dispatch and revocation', {skip: !url}, async () => {
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/whatsapp_reply_ci');
  const {Pool} = require('pg');
  const db = new Pool({connectionString: url, statement_timeout: 5000});
  try {
    for (const name of ['20261108_whatsapp_durable_inbox.sql', '20261114_whatsapp_reply_dispatch_ci.sql']) {
      await db.query(readFileSync(join(__dirname, '../db/migrations', name), 'utf8'));
    }
    await db.query(`
      INSERT INTO nex_whatsapp_sender_authorizations
        (business_account_id,phone_number_id,sender_digest,family_id,scope,consent_version,consent_at,consent_source)
      VALUES ('123456','654321',decode(repeat('ab',32),'hex'),'11111111-1111-4111-8111-111111111111',
        'incoming_text','ci',now()-interval '1 minute','ci');
      INSERT INTO nex_whatsapp_inbound
        (business_account_id,phone_number_id,provider_message_id,sender_digest,family_id,
         provider_sent_at,expires_at,nonce,authentication_tag,ciphertext)
      SELECT business_account_id,phone_number_id,'wamid.ci-'||n,sender_digest,family_id,
        now(),now()+interval '1 day',decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),'fixture'
      FROM nex_whatsapp_sender_authorizations CROSS JOIN generate_series(1,3) n;
    `);
    const first = await db.connect();
    const second = await db.connect();
    try {
      const loadAuthorizedDelivery = async () => ({text: 'Avís fictici'});
      const a = createPilotReplyJobStore({db: first, loadAuthorizedDelivery});
      const b = createPilotReplyJobStore({db: second, loadAuthorizedDelivery});
      const jobs = await Promise.all([a.claim(1), b.claim(1)]);
      assert.equal(jobs.filter(Boolean).length, 1);
      const job = jobs.find(Boolean);
      assert.deepEqual((await Promise.all([a.beginDispatch(job), b.beginDispatch(job)])).sort(), [false, true]);
      await a.releaseForRetry(job);
      assert.equal(await b.claim(1), null);
      await b.markSent(job, 'wamid.reply');

      const stale = await a.claim(2);
      await db.query("UPDATE nex_whatsapp_reply_dispatch SET claimed_at=now()-interval '6 minutes' WHERE inbound_id=2");
      const replacement = await b.claim(2);
      assert.ok(replacement);
      await a.releaseForRetry(stale);
      assert.equal(await a.beginDispatch(stale), false);
      assert.equal(await b.beginDispatch(replacement), true);

      const {createHmac} = require('node:crypto');
      const {createDurableInbox} = require('../lib/whatsapp/durable-inbox');
      const {createVerifiedIngestion} = require('../lib/whatsapp/verified-ingestion');
      const {createVerifiedReplyDeliveryReader} = require('../lib/whatsapp/pilot-verified-reply-delivery');
      const {createPilotAnalysisReply} = require('../lib/whatsapp/pilot-analysis-reply');
      const appSecret = 'local-signing-fixture';
      const senderKey = Buffer.alloc(32, 1);
      const senderHmacKey = senderKey.toString('base64');
      const contentEncryptionKey = Buffer.alloc(32, 2).toString('base64');
      const sender = '34000000000';
      const digest = createHmac('sha256', senderKey).update(sender).digest();
      await db.query('UPDATE nex_whatsapp_sender_authorizations SET sender_digest=$1', [digest]);
      await db.query('UPDATE nex_whatsapp_inbound SET sender_digest=$1 WHERE inbound_id=3', [digest]);
      const raw = Buffer.from(JSON.stringify({object: 'whatsapp_business_account',
        entry: [{id: '123456', changes: [{field: 'messages', value: {
          metadata: {phone_number_id: '654321'},
          messages: [{id: 'wamid.integration', from: sender,
            timestamp: String(Math.floor(Date.now() / 1000)), type: 'text',
            text: {body: 'Sortida amb el grup de bàsquet'}}]
        }}]}]}));
      const signature = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
      const inbox = createDurableInbox({db, senderHmacKey, contentEncryptionKey});
      const ingest = createVerifiedIngestion({inbox, appSecret});
      assert.equal((await ingest(raw, signature)).counts.stored, 1);
      assert.equal((await ingest(raw, signature)).counts.duplicate, 1);
      const {rows: [{inbound_id: id}]} = await db.query(
        "SELECT inbound_id FROM nex_whatsapp_inbound WHERE provider_message_id='wamid.integration'"
      );
      const load = createVerifiedReplyDeliveryReader({appSecret, senderHmacKey, contentEncryptionKey,
        readAuthorizedInboxRow: async ({inboundId, senderDigest}) => {
          const {rows} = await db.query(`
            SELECT i.* FROM nex_whatsapp_inbound i
            JOIN nex_whatsapp_sender_authorizations a
              USING (business_account_id,phone_number_id,sender_digest,family_id)
            WHERE i.inbound_id=$1 AND i.sender_digest=$2
              AND i.expires_at>now() AND a.revoked_at IS NULL
              AND a.scope='incoming_text' AND a.consent_at<=i.received_at
              AND (a.valid_until IS NULL OR a.valid_until>now())`, [inboundId, senderDigest]);
          return rows[0];
        }
      })(raw, signature);
      const requests = [];
      const reply = createPilotAnalysisReply({
        jobs: createPilotReplyJobStore({db, loadAuthorizedDelivery: load}),
        analysisHandler: async (req, res) => {
          assert.equal(req.body.text, 'Sortida amb el grup de bàsquet');
          return res.json({resum: 'Sortida de bàsquet.', accions: []});
        },
        meta: {apiVersion: 'v25.0', phoneNumberId: '654321', accessToken: 'fixture',
          fetchImpl: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            return Response.json({messages: [{id: 'wamid.integration-reply'}]});
          }}
      });
      assert.deepEqual((await Promise.all([reply(Number(id)), reply(Number(id))]))
        .map(result => result.state).sort(), ['sent', 'unavailable']);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].to, sender);
      assert.equal(requests[0].context.message_id, 'wamid.integration');
      assert.match(requests[0].text.body, /Sortida de bàsquet/);
      assert.equal((await db.query('SELECT outgoing_message_id FROM nex_whatsapp_reply_dispatch WHERE inbound_id=$1', [id]))
        .rows[0].outgoing_message_id, 'wamid.integration-reply');

      const revoked = await a.claim(3);
      await db.query('UPDATE nex_whatsapp_sender_authorizations SET revoked_at=now()');
      assert.equal(await a.beginDispatch(revoked), false);
      assert.equal(await load(Number(id)), null);
    } finally {
      first.release();
      second.release();
    }
  } finally {
    await db.end();
  }
});
