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

      const revoked = await a.claim(3);
      await db.query('UPDATE nex_whatsapp_sender_authorizations SET revoked_at=now()');
      assert.equal(await a.beginDispatch(revoked), false);
    } finally {
      first.release();
      second.release();
    }
  } finally {
    await db.end();
  }
});
