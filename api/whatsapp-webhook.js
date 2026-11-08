'use strict';

/**
 * Meta WhatsApp Business webhook — safe preparation only.
 * Modes: disabled (default), verify-only (GET challenge, POST signed but 503).
 * A signed POST is deliberately NOT acknowledged until a durable, authenticated
 * queue and per-family routing are implemented. No messages are stored or logged.
 */
const {
  BodyTooLargeError,
  verifyToken,
  verifyMetaSignature,
  readRawBody
} = require('../lib/whatsapp/webhook-security');

function queryValue(req, name) {
  const value = req.query && req.query[name];
  if (typeof value === 'string') return value;
  if (value !== undefined) return null;
  const rawUrl = typeof req.url === 'string' ? req.url : '/';
  try {
    return new URL(rawUrl, 'https://nexlupa.invalid').searchParams.get(name);
  } catch {
    return null;
  }
}

function json(res, status, message) {
  return res.status(status).json({ error: message });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, 'Method not allowed');
  }

  // No deployment is activated by adding this route to GitHub.
  // Even on a preview deployment, it remains closed without explicit configuration.
  if (process.env.WHATSAPP_WEBHOOK_MODE !== 'verify-only') {
    return json(res, 503, 'WhatsApp webhook disabled');
  }

  if (req.method === 'GET') {
    const secret = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!secret) return json(res, 503, 'Webhook verification not configured');

    const mode = queryValue(req, 'hub.mode');
    const token = queryValue(req, 'hub.verify_token');
    const challenge = queryValue(req, 'hub.challenge');

    if (mode !== 'subscribe' || !verifyToken(token, secret)) {
      return json(res, 403, 'Verification failed');
    }
    if (typeof challenge !== 'string' || !/^[\x21-\x7E]{1,256}$/.test(challenge)) {
      return json(res, 400, 'Invalid challenge');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(challenge);
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return json(res, 503, 'Webhook signature verification not configured');

  const contentType = String(req.headers && req.headers['content-type'] || '');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return json(res, 415, 'Unsupported content type');
  }

  let bytes;
  try {
    bytes = await readRawBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(res, 413, 'Payload too large');
    return json(res, 400, 'Unreadable request body');
  }

  const signature = req.headers && req.headers['x-hub-signature-256'];
  if (!verifyMetaSignature(bytes, signature, appSecret)) {
    return json(res, 403, 'Invalid webhook signature');
  }

  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return json(res, 400, 'Invalid JSON');
  }

  if (!payload || payload.object !== 'whatsapp_business_account' ||
      !Array.isArray(payload.entry)) {
    return json(res, 400, 'Unexpected webhook event');
  }

  // Never return 200 for a real delivery before durable persistence + idempotency.
  // Meta can retry an unacknowledged webhook. No data is processed in this phase.
  res.setHeader('Retry-After', '60');
  return json(res, 503, 'Webhook delivery not activated');
}

module.exports = handler;
