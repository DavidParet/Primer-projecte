'use strict';

/**
 * TTP 235: internal, injected Meta WhatsApp HTTP POST bridge.
 *
 * THIS MODULE IS NOT A PUBLIC ROUTE. The deployed api/whatsapp-webhook.js
 * remains disabled / verify-only. Activation requires a reviewed, dedicated
 * DB service identity, real IdP/consent schema, signed webhook credentials,
 * bounded retry/dead-letter handling and explicit operator authorization.
 *
 * Only acknowledge a verified event AFTER durable persistence of at least
 * one supported message (or a previously persisted duplicate). Signed
 * status-only callbacks can be ignored with a 200 because they contain
 * no inbound user message that NexLupa is meant to retain.
 */
const { BodyTooLargeError, readRawBody } = require('./webhook-security');
const { createVerifiedIngestion } = require('./verified-ingestion');
const { normalizeMetaDeliveries } = require('./delivery-normalizer');

function pureStatusOnlyEvent(body) {
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { return false; }
  if (!payload || payload.object !== 'whatsapp_business_account' ||
      !Array.isArray(payload.entry) || payload.entry.length === 0) return false;
  return payload.entry.every(entry =>
    entry && /^\d{5,30}$/.test(String(entry.id || '')) &&
    Array.isArray(entry.changes) && entry.changes.length > 0 &&
    entry.changes.every(change => {
      const value = change && change.value;
      return change.field === 'messages' && value &&
        Array.isArray(value.statuses) && value.statuses.length > 0 &&
        value.statuses.every(s => s && typeof s.id === 'string' && !!s.id) &&
        (value.messages === undefined ||
          (Array.isArray(value.messages) && value.messages.length === 0));
    })
  );
}

function send(res, status, message, retry=false) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (retry) res.setHeader('Retry-After','60');
  return res.status(status).json({ status:message });
}

function createMetaDurablePostBridge({
  enabled=false, appSecret, inbox
}={}) {
  if (enabled !== true) {
    // NEVER acquire a DB connection or inspect any secrets when disabled.
    return async function disabledWebhook(_req,res) {
      return send(res,503,'disabled');
    };
  }
  const ingest=createVerifiedIngestion({appSecret,inbox});
  return async function receiveMetaPost(req,res) {
    if (!req || req.method !== 'POST') {
      if(res&&typeof res.setHeader==='function')res.setHeader('Allow','POST');
      return send(res,405,'method_not_allowed');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(
      String(req.headers?.['content-type'] || ''))) {
      return send(res,415,'unsupported_content_type');
    }
    let bytes;
    try { bytes=await readRawBody(req); }
    catch(error) {
      if (error instanceof BodyTooLargeError) {
        return send(res,413,'payload_too_large');
      }
      return send(res,400,'unreadable_body');
    }
    let result;
    try {
      result=await ingest(bytes,req.headers?.['x-hub-signature-256']);
    } catch {
      // Never leak SQL errors or the inbound message in an HTTP response.
      return send(res,503,'storage_unavailable',true);
    }
    if(result?.outcome==='rejected') {
      return send(res,
        result.reason==='invalid_signature'?403:400,
        'rejected');
    }
    const counts=result?.counts;
    // Never ACK a partially persisted batch: one successful write is not
    // evidence that every inbound message has been stored or deduplicated.
    // Parse only after raw HMAC verification by ingest().
    let expected;
    try {
      expected=normalizeMetaDeliveries(JSON.parse(bytes.toString('utf8')));
    } catch {
      return send(res,503,'not_durably_processed',true);
    }
    const fullyCounted=expected.meta.skipped===0 &&
      expected.meta.truncated===false &&
      counts && counts.unlinked===0 && counts.unsupported===0 &&
      counts.stored+counts.duplicate===expected.deliveries.length;
    if(result?.outcome==='durable' && fullyCounted &&
       (expected.deliveries.length>0 || pureStatusOnlyEvent(bytes))) {
      return send(res,200,'accepted');
    }
    // No successful ACK for unaffiliated senders, unsupported media, unhandled
    // message types, truncated batches, or empty/ambiguous event envelopes.
    // Retries need an approved quarantine/dead-letter design before launch.
    return send(res,503,'not_durably_processed',true);
  };
}
module.exports={createMetaDurablePostBridge,pureStatusOnlyEvent};
