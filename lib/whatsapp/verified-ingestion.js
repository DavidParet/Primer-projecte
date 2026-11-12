'use strict';
/**
 * Internal bridge only: never expose as an HTTP route without separately
 * reviewing acknowledgements, sender enrollment, retries and DB privileges.
 * Signature MUST be checked against the exact original request bytes.
 */
const { verifyMetaSignature } = require('./webhook-security');
const { TextDecoder } = require('node:util');
const utf8 = new TextDecoder('utf-8', { fatal: true });
function createVerifiedIngestion({ inbox, appSecret }) {
  if (!inbox || typeof inbox.persistVerifiedBatch !== 'function') throw new TypeError('Durable inbox required');
  if (typeof appSecret !== 'string' || !appSecret) throw new TypeError('Meta application secret required');
  return async function ingest(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) || !verifyMetaSignature(rawBody, signature, appSecret)) {
      return { outcome: 'rejected', reason: 'invalid_signature' };
    }
    let payload;
    try { payload = JSON.parse(utf8.decode(rawBody)); }
    catch { return { outcome: 'rejected', reason: 'invalid_json' }; }
    if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      return { outcome: 'rejected', reason: 'invalid_envelope' };
    }
    // SQL failures must propagate: do not acknowledge an unpersisted delivery.
    const counts = await inbox.persistVerifiedBatch(payload);
    const keys = ['stored','duplicate','unlinked','unsupported'];
    if (!counts || keys.some(k => !Number.isSafeInteger(counts[k]) || counts[k] < 0)) {
      throw new Error('Unrecognized persistence result');
    }
    // Never signal accepted for deliveries without consent or unsupported media.
    if (counts.unlinked || counts.unsupported) return { outcome: 'needs_review', counts };
    return { outcome: 'durable', counts };
  };
}
module.exports = { createVerifiedIngestion };
