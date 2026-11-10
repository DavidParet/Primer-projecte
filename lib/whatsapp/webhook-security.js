'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const MAX_BODY_BYTES = 256 * 1024;

class InvalidBodyLengthError extends Error {
  constructor() {
    super('Invalid webhook content length');
    this.name = 'InvalidBodyLengthError';
  }
}

class BodyTooLargeError extends Error {
  constructor() {
    super('Webhook body exceeds size limit');
    this.name = 'BodyTooLargeError';
  }
}

// Hashing both inputs ensures a fixed-length timing-safe comparison.
function verifyToken(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function verifyMetaSignature(rawBody, header, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/.test(header) ||
      typeof appSecret !== 'string' || !appSecret) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// DO NOT access req.body: Vercel exposes a lazily parsed req.body getter.
// The HMAC must cover the exact bytes delivered by Meta, not reserialized JSON.
async function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  const header = req.headers && req.headers['content-length'];
  // Reject ambiguous or forged framing; never trust Content-Length for the HMAC.
  if (header !== undefined &&
      (typeof header !== 'string' || !/^(0|[1-9][0-9]*)$/.test(header) ||
       !Number.isSafeInteger(Number(header))))
    throw new InvalidBodyLengthError();
  const length = header === undefined ? null : Number(header);
  if (length !== null && length > maxBytes) throw new BodyTooLargeError();
  const chunks = [];
  let lengthRead = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    lengthRead += bytes.length;
    if (lengthRead > maxBytes) throw new BodyTooLargeError();
    chunks.push(bytes);
  }
  if (length !== null && lengthRead !== length) throw new InvalidBodyLengthError();
  return Buffer.concat(chunks, lengthRead);
}

module.exports = { MAX_BODY_BYTES, BodyTooLargeError, InvalidBodyLengthError, verifyToken, verifyMetaSignature, readRawBody };
