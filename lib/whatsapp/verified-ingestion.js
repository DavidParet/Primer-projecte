'use strict';
/**
 * Synthetic/preview-only integration boundary. No HTTP acknowledgement or
 * public webhook activation. Verify Meta's signature over the ORIGINAL bytes
 * before JSON parsing, normalizing, or writing to the inbox.
 */
const {verifyMetaSignature, MAX_BODY_BYTES} = require('./webhook-security');

function createVerifiedIngestion({appSecret, inbox}) {
  if (typeof appSecret !== 'string' || !appSecret ||
      !inbox || typeof inbox.persistVerifiedBatch !== 'function')
    throw new TypeError('Trusted signature secret and durable inbox required');

  return async function ingestRawDelivery({rawBody, signature}) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length > MAX_BODY_BYTES)
      throw new TypeError('Invalid or oversized raw delivery');
    if (!verifyMetaSignature(rawBody, signature, appSecret))
      throw new Error('Webhook signature rejected');
    // Reject malformed UTF-8 rather than silently replacing bytes with U+FFFD.
    // A valid HMAC proves origin, not that the encoded JSON is well formed.
    let payload;
    try {
      const json = new TextDecoder('utf-8', {fatal:true}).decode(rawBody);
      payload = JSON.parse(json);
    } catch { throw new Error('Malformed authenticated JSON'); }
    if (!payload || payload.object !== 'whatsapp_business_account' ||
        !Array.isArray(payload.entry))
      throw new Error('Unexpected authenticated Meta event');
    return inbox.persistVerifiedBatch(payload);
  };
}
module.exports={createVerifiedIngestion};
