'use strict';
/**
 * Stage-3 prototype only. Must be called AFTER verifying Meta's RAW HMAC.
 * No public route, provider credentials, sender enrollment, or database connection.
 * Neither raw sender phone numbers nor plaintext are sent to PostgreSQL.
 */
const { createHmac, randomBytes, createCipheriv } = require('node:crypto');
const { normalizeMetaDeliveries } = require('./delivery-normalizer');

const MAX_TEXT_CHARS = 16000;
const INSERT_SQL = `
WITH permitted AS (
  SELECT family_id
  FROM nex_whatsapp_sender_authorizations
  WHERE business_account_id = $1 AND phone_number_id = $2
    AND sender_digest = $3 AND scope = 'incoming_text'
    AND consent_at <= NOW() AND revoked_at IS NULL
    AND (valid_until IS NULL OR valid_until > NOW())
  ORDER BY authorization_id DESC
  LIMIT 1
  FOR SHARE
), saved AS (
  INSERT INTO nex_whatsapp_inbound (
    business_account_id, phone_number_id, provider_message_id,
    family_id, sender_digest, provider_sent_at,
    nonce, authentication_tag, ciphertext, expires_at
  )
  SELECT $1, $2, $4, permitted.family_id, $3,
         TO_TIMESTAMP($8::bigint), $5, $6, $7, NOW() + INTERVAL '7 days'
  FROM permitted
  WHERE TRUE
  ON CONFLICT (business_account_id, provider_message_id) DO NOTHING
  RETURNING family_id
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM saved) THEN 'stored'
  WHEN EXISTS (SELECT 1 FROM permitted) THEN 'duplicate'
  ELSE 'unlinked'
END AS state;
`;
const PURGE_SQL = 'DELETE FROM nex_whatsapp_inbound WHERE expires_at <= NOW()';

function parseBase64Key(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new TypeError(name + ' must be a separate 32-byte base64 secret');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new TypeError(name + ' is invalid');
  }
  return key;
}

function validateDelivery(d) {
  if (!d || typeof d !== 'object' || d.provider !== 'whatsapp' ||
      !/^\d{5,30}$/.test(d.businessAccountId || '') ||
      !/^\d{5,30}$/.test(d.phoneNumberId || '') ||
      !/^wamid\.[A-Za-z0-9._=-]{1,256}$/.test(d.providerMessageId || '') ||
      !/^\d{7,15}$/.test(d.senderWaId || '') ||
      !/^\d{9,12}$/.test(d.providerTimestamp || '')) {
    throw new TypeError('Invalid authenticated Meta delivery');
  }
  if (d.type !== 'text' || d.contentPending || typeof d.text !== 'string') {
    return 'unsupported';
  }
  if (!d.text.trim() || d.text.length > MAX_TEXT_CHARS) {
    throw new RangeError('Empty or oversized inbound text');
  }
  return 'text';
}

function createDurableInbox({ db, senderHmacKey, contentEncryptionKey }) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('A PostgreSQL query adapter is required');
  }
  const senderKey = parseBase64Key(senderHmacKey, 'senderHmacKey');
  const contentKey = parseBase64Key(contentEncryptionKey, 'contentEncryptionKey');
  if (senderKey.equals(contentKey)) throw new TypeError('Use independent encryption and HMAC keys');

  async function persistDelivery(d, queryAdapter = db) {
    const kind = validateDelivery(d);
    if (kind === 'unsupported') return { state: 'unsupported' };
    const senderDigest = createHmac('sha256', senderKey).update(d.senderWaId, 'utf8').digest();
    const aad = Buffer.from(JSON.stringify([
      d.businessAccountId, d.phoneNumberId, d.providerMessageId,
      senderDigest.toString('hex')
    ]), 'utf8');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', contentKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(d.text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const values = [
      d.businessAccountId, d.phoneNumberId, senderDigest, d.providerMessageId,
      nonce, tag, ciphertext, d.providerTimestamp
    ];
    const result = await queryAdapter.query(INSERT_SQL, values);
    const state = result && result.rows && result.rows[0] && result.rows[0].state;
    if (!['stored', 'duplicate', 'unlinked'].includes(state)) {
      throw new Error('Persistence did not return a known state');
    }
    return { state }; // Do not return sender, content or family.
  }

  async function persistVerifiedBatch(payload) {
    // Caller MUST have already verified RAW X-Hub-Signature-256.
    const { deliveries, meta } = normalizeMetaDeliveries(payload);
    if (meta.skipped || meta.truncated) {
      throw new Error('Inbound payload requires review; do not acknowledge');
    }
    // Validate the entire envelope before the first database write.
    // A later invalid delivery must not cause avoidable partial persistence.
    for (const d of deliveries) validateDelivery(d);
    const counts = { stored: 0, duplicate: 0, unlinked: 0, unsupported: 0 };
    // Single-message writes are atomic by SQL statement. Multi-message batches
    // require one dedicated PostgreSQL connection, never pool.query() per step.
    if (deliveries.length <= 1) {
      for (const d of deliveries) {
        const r = await persistDelivery(d);
        counts[r.state]++;
      }
      return counts;
    }
    if (typeof db.connect !== 'function') {
      throw new Error('Multi-delivery batch requires a transactional PostgreSQL connection');
    }
    const client = await db.connect();
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
      throw new Error('Invalid transactional PostgreSQL connection');
    }
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      for (const d of deliveries) {
        const r = await persistDelivery(d, client);
        counts[r.state]++;
        // A mixed authorized/unlinked or unsupported batch must not persist
        // some family messages while returning a retryable HTTP error for all.
        // Fail closed and roll back the entire batch before COMMIT.
        if (r.state === 'unlinked' || r.state === 'unsupported') {
          throw new Error('Inbound batch requires authorization review');
        }
      }
      await client.query('COMMIT');
      return counts; // HTTP acknowledgements are NOT implemented.
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); }
        catch (rollbackError) { error.cause = rollbackError; }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function purgeExpired() {
    const result = await db.query(PURGE_SQL);
    return { deleted: Number(result.rowCount || 0) };
  }

  return { persistDelivery, persistVerifiedBatch, purgeExpired };
}

module.exports = { createDurableInbox, INSERT_SQL, PURGE_SQL, MAX_TEXT_CHARS };
