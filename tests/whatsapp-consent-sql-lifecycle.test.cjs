'use strict';
// TTP integration regression: synthetic-only, ephemeral PostgreSQL CI.
// Exercises the REAL SQL consent receipt migration and backend policy together
// with the encrypted durable inbox, without Meta, Neon or live family accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {randomBytes} = require('node:crypto');
const {Pool} = require('pg');
const {makeConsentPolicy} = require('../lib/whatsapp/consent-policy');
const {createDurableInbox} = require('../lib/whatsapp/durable-inbox');

const dbUrl = process.env.WHATSAPP_TEST_DATABASE_URL;
const ACCOUNT = '9999901111'; // CI-only synthetic business ID
const NUMBER = '8888801111';  // CI-only synthetic business phone ID
const FAMILY_A = 'a0000000-0000-4000-8000-000000000111';
const FAMILY_B = 'b0000000-0000-4000-8000-000000000222';
const SENDER_A = '34999900111'; // No real Meta traffic is sent.
const SENDER_B = '34999900222';
const SENDER_C = '34999900333';
const senderHmacKey = randomBytes(32).toString('base64');
const contentEncryptionKey = randomBytes(32).toString('base64');

function policy(db, familyId, senderWaId, overrides={}) {
  return makeConsentPolicy({
    db, senderHmacKey, currentConsentVersion: 'ci-consent-v1',
    // Synthetic trusted-server adapters: not a production IdP/phone service.
    resolveAuthenticatedFamily: async () => familyId,
    authorizeFamily: async () => true, // CI-only trusted synthetic administrator
    authorizeFamilyTransaction: async () => true, // CI-only; not an IdP
    verifyEnrollment: async ctx => ({
      verified: true, familyId: ctx.familyId,
      challengeId: ctx.challengeId,
      businessAccountId: ctx.businessAccountId,
      phoneNumberId: ctx.phoneNumberId,
      senderWaId, singleUseConsumed: true,
      expiresAt: Date.now() + 60_000
    }),
    verifyExplicitConsent: async ctx => ({
      verified: true, receiptId: ctx.receiptId,
      challengeId: ctx.challengeId,
      familyId: ctx.familyId,
      businessAccountId: ctx.businessAccountId,
      phoneNumberId: ctx.phoneNumberId,
      senderWaId, scope: ctx.scope, version: ctx.version,
      source: 'account-web-consent',
      singleUseConsumed: true, acceptedAt: Date.now() - 1000
    }),
    ...overrides
  });
}
function enrollment(suffix) {
  return {
    session: {familyId: FAMILY_B, forged: true}, // must not choose target family
    businessAccountId: ACCOUNT,
    phoneNumberId: NUMBER,
    challengeId: 'ci_challenge_20261110_' + suffix,
    consentReceiptId: 'ci_receipt_20261110_' + suffix
  };
}
function delivery(senderWaId, providerMessageId) {
  return {
    provider: 'whatsapp', businessAccountId: ACCOUNT,
    phoneNumberId: NUMBER, senderWaId, providerMessageId,
    providerTimestamp: '1794150000', type: 'text',
    text: 'Missatge sintetic de prova; sense dades de cap familia real',
    contentPending: false
  };
}

test('PostgreSQL: explicit receipt, dedup, per-family isolation, purge and fresh opt-in', {
  skip: !dbUrl, timeout: 40_000
}, async () => {
  const db = new Pool({connectionString: dbUrl, max: 6,
    connectionTimeoutMillis: 6000, statement_timeout: 15000});
  try {
    await db.query(readFileSync(join(__dirname,
      '../db/migrations/20261108_whatsapp_durable_inbox.sql'), 'utf8'));
    await db.query(readFileSync(join(__dirname,
      '../db/migrations/20261109_whatsapp_explicit_consent_receipt.sql'), 'utf8'));

    const a = policy(db, FAMILY_A, SENDER_A);
    const b = policy(db, FAMILY_B, SENDER_B);
    const c = policy(db, FAMILY_A, SENDER_C);
    const inbox = createDurableInbox({
      db, senderHmacKey, contentEncryptionKey
    });

    assert.deepEqual(await a.enroll(enrollment('familyA_initial')),
      {state: 'enrolled'});
    assert.deepEqual(await b.enroll(enrollment('familyB_initial')),
      {state: 'enrolled'});
    // A receipt is one use across ALL senders/families, enforced by PG index.
    assert.deepEqual(await c.enroll(enrollment('familyA_initial')),
      {state: 'already_active_or_receipt_used'});

    const consents = await db.query(
      'SELECT family_id, consent_receipt_digest, revoked_at ' +
      'FROM nex_whatsapp_sender_authorizations WHERE business_account_id=$1',
      [ACCOUNT]
    );
    assert.equal(consents.rowCount, 2);
    assert.deepEqual(new Set(consents.rows.map(r => r.family_id)),
      new Set([FAMILY_A, FAMILY_B]));
    for (const row of consents.rows) {
      assert.equal(row.consent_receipt_digest.length, 32);
      assert.equal(row.revoked_at, null);
    }

    const msgA1 = delivery(SENDER_A, 'wamid.ci-family-a-1');
    const msgA2 = delivery(SENDER_A, 'wamid.ci-family-a-2');
    const msgB1 = delivery(SENDER_B, 'wamid.ci-family-b-1');
    assert.deepEqual(await inbox.persistDelivery(msgA1), {state: 'stored'});
    assert.deepEqual(await inbox.persistDelivery(msgA1), {state: 'duplicate'});
    assert.deepEqual(await inbox.persistDelivery(msgA2), {state: 'stored'});
    assert.deepEqual(await inbox.persistDelivery(msgB1), {state: 'stored'});
    assert.deepEqual(await inbox.persistDelivery(
      delivery(SENDER_C, 'wamid.ci-no-reused-receipt')),
      {state: 'unlinked'});

    const saved = await db.query(
      'SELECT family_id, ciphertext FROM nex_whatsapp_inbound ' +
      'WHERE business_account_id=$1', [ACCOUNT]
    );
    assert.equal(saved.rowCount, 3);
    assert.equal(saved.rows.some(r => r.ciphertext.toString('utf8') === msgA1.text), false);

    assert.deepEqual(await a.revoke({
      session: {forged: true, familyId: FAMILY_B},
      businessAccountId: ACCOUNT, phoneNumberId: NUMBER,
      senderWaId: SENDER_A
    }), {state: 'revoked', deletedMessages: 2});

    const remaining = await db.query(
      'SELECT family_id, provider_message_id FROM nex_whatsapp_inbound ' +
      'WHERE business_account_id=$1', [ACCOUNT]
    );
    assert.deepEqual(remaining.rows.map(row => row.family_id), [FAMILY_B]);
    assert.deepEqual(remaining.rows.map(row => row.provider_message_id),
      [msgB1.providerMessageId]);
    assert.deepEqual(await inbox.persistDelivery(
      delivery(SENDER_A, 'wamid.ci-after-revoke')),
      {state: 'unlinked'});

    // Re-enrollment requires a new, distinct one-time receipt; old receipt fails.
    assert.deepEqual(await a.enroll(enrollment('familyA_initial')),
      {state: 'already_active_or_receipt_used'});
    assert.deepEqual(await a.enroll(enrollment('familyA_fresh')),
      {state: 'enrolled'});
    assert.deepEqual(await inbox.persistDelivery(
      delivery(SENDER_A, 'wamid.ci-after-new-opt-in')),
      {state: 'stored'});
    assert.deepEqual(await inbox.persistDelivery(msgB1), {state: 'duplicate'});
  } finally {
    try {
      await db.query('DELETE FROM nex_whatsapp_inbound WHERE business_account_id=$1',
        [ACCOUNT]);
      await db.query('DELETE FROM nex_whatsapp_sender_authorizations ' +
        'WHERE business_account_id=$1', [ACCOUNT]);
    } finally {
      await db.end();
    }
  }
});


test('PostgreSQL: a concurrently revoked family administrator cannot register consent', {
  skip: !dbUrl, timeout: 30_000
}, async () => {
  const db = new Pool({connectionString: dbUrl,max:6,
    connectionTimeoutMillis:6000,statement_timeout:15000});
  let holder;
  let holdingTransaction=false;
  try {
    // This synthetic membership table exists only in the disposable CI DB;
    // the real canonical membership schema and restricted role need review.
    await db.query('CREATE TABLE IF NOT EXISTS public.nex_ci_membership_race (' +
      'family_id uuid PRIMARY KEY, admin_active boolean NOT NULL)');
    await db.query('INSERT INTO public.nex_ci_membership_race (family_id,admin_active) ' +
      'VALUES ($1,true) ON CONFLICT (family_id) DO UPDATE SET admin_active=true',
      [FAMILY_A]);

    const binding = policy(db,FAMILY_A,SENDER_C,{
      authorizeFamily:async()=>true,
      authorizeFamilyTransaction:async({client,familyId,action})=>{
        assert.equal(action,'enroll_whatsapp_sender');
        const result=await client.query(
          'SELECT admin_active FROM public.nex_ci_membership_race ' +
          'WHERE family_id=$1 FOR SHARE',[familyId]);
        return result.rows.length===1 && result.rows[0].admin_active===true;
      }
    });

    holder=await db.connect();
    await holder.query('BEGIN');holdingTransaction=true;
    // Start removal but leave it uncommitted, to prove enrollment really waits.
    await holder.query('UPDATE public.nex_ci_membership_race SET admin_active=false ' +
      'WHERE family_id=$1',[FAMILY_A]);
    const pending=binding.enroll(enrollment('race_admin_removed'));
    let observedLock=false;
    for(let attempt=0;attempt<100;attempt++){
      const {rows}=await db.query(
        "SELECT COUNT(*)::int AS waiting FROM pg_stat_activity "+
        "WHERE datname=current_database() AND pid<>pg_backend_pid() "+
        "AND state='active' AND wait_event_type='Lock' "+
        "AND query LIKE '%nex_ci_membership_race%'");
      if(rows[0].waiting>0){observedLock=true;break;}
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert.equal(observedLock,true,'enrollment must wait on the same membership row');
    await holder.query('COMMIT');holdingTransaction=false;
    await assert.rejects(pending,/Current locked family administrator required/);
    const denied=await db.query(
      'SELECT COUNT(*)::int AS n FROM nex_whatsapp_sender_authorizations '+
      'WHERE business_account_id=$1 AND family_id=$2',[ACCOUNT,FAMILY_A]);
    assert.equal(denied.rows[0].n,0);

    // The same request succeeds only after a fresh, actually authorized check.
    await db.query('UPDATE public.nex_ci_membership_race SET admin_active=true ' +
      'WHERE family_id=$1',[FAMILY_A]);
    assert.deepEqual(await binding.enroll(enrollment('race_admin_restored')),
      {state:'enrolled'});
  } finally {
    if(holder){
      if(holdingTransaction)await holder.query('ROLLBACK');
      holder.release();
    }
    await db.query('DELETE FROM nex_whatsapp_sender_authorizations ' +
      'WHERE business_account_id=$1 AND family_id=$2',[ACCOUNT,FAMILY_A]);
    await db.query('DELETE FROM public.nex_ci_membership_race WHERE family_id=$1',
      [FAMILY_A]);
    await db.end();
  }
});
