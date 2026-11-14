'use strict';

const {createHmac, createDecipheriv, timingSafeEqual} = require('node:crypto');
const {TextDecoder} = require('node:util');
const {verifyMetaSignature} = require('./webhook-security');
const {normalizeMetaDeliveries} = require('./delivery-normalizer');

function keyBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new TypeError('A 32-byte WhatsApp pilot key is required');
  }
  const key = Buffer.from(value, 'base64');
  if (key.toString('base64') !== value) throw new TypeError('Invalid WhatsApp pilot key');
  return key;
}

// The restricted reader must return a single, unexpired inbox row only
// while the consent that authorized that delivery remains valid.
function createVerifiedReplyDeliveryReader({
  appSecret, senderHmacKey, contentEncryptionKey, readAuthorizedInboxRow
} = {}) {
  if (typeof appSecret !== 'string' || !appSecret || typeof readAuthorizedInboxRow !== 'function') {
    throw new TypeError('Verified WhatsApp inbox reader configuration required');
  }
  const senderKey = keyBytes(senderHmacKey);
  const contentKey = keyBytes(contentEncryptionKey);
  if (senderKey.equals(contentKey)) throw new TypeError('Independent WhatsApp keys required');

  return function forWebhook(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) || !verifyMetaSignature(rawBody, signature, appSecret)) {
      throw new Error('Unverified WhatsApp delivery');
    }
    const {deliveries, meta} = normalizeMetaDeliveries(JSON.parse(new TextDecoder('utf-8', {
      fatal: true
    }).decode(rawBody)));
    if (meta.skipped || meta.truncated || deliveries.length !== 1 || deliveries[0].type !== 'text') {
      throw new Error('Expected one verified WhatsApp text delivery');
    }
    const {businessAccountId, phoneNumberId, providerMessageId, senderWaId, providerTimestamp} = deliveries[0];
    const digest = createHmac('sha256', senderKey).update(senderWaId).digest();

    return async function loadAuthorizedDelivery(inboundId) {
      const row = await readAuthorizedInboxRow({
        inboundId, businessAccountId, phoneNumberId, providerMessageId, senderDigest: digest,
        providerTimestamp
      });
      if (!row || String(row.inbound_id) !== String(inboundId) ||
          row.business_account_id !== businessAccountId || row.phone_number_id !== phoneNumberId ||
          row.provider_message_id !== providerMessageId ||
          new Date(row.provider_sent_at).getTime() !== Number(providerTimestamp) * 1000 ||
          !(new Date(row.expires_at).getTime() > Date.now()) ||
          !Buffer.isBuffer(row.sender_digest) || row.sender_digest.length !== digest.length ||
          !timingSafeEqual(row.sender_digest, digest)) return null;

      const decipher = createDecipheriv('aes-256-gcm', contentKey, row.nonce);
      decipher.setAAD(Buffer.from(JSON.stringify([
        businessAccountId, phoneNumberId, providerMessageId, digest.toString('hex')
      ])));
      decipher.setAuthTag(row.authentication_tag);
      const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat([
        decipher.update(row.ciphertext), decipher.final()
      ]));
      return {phoneNumberId, senderWaId, providerMessageId, text};
    };
  };
}

module.exports = {createVerifiedReplyDeliveryReader};
