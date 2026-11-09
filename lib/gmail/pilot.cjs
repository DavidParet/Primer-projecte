'use strict';

/** Gmail-only, read-only transport adapter. No OAuth callback, persistence or automatic actions. */
const crypto = require('node:crypto');
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

function nonempty(value, max = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\u0000]/.test(value);
}
function validRedirectUri(input) {
  try {
    const uri = new URL(input);
    return !uri.username && !uri.password && !uri.hash && !uri.search &&
      (uri.protocol === 'https:' || (uri.protocol === 'http:' && uri.hostname === 'localhost'));
  } catch { return false; }
}
function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}
function makeState() { return crypto.randomBytes(32).toString('base64url'); }
function verifyState(submitted, stored) {
  if (!nonempty(submitted, 200) || !nonempty(stored, 200)) return false;
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function authorizationUrl({ clientId, redirectUri, state, challenge }) {
  if (!nonempty(clientId, 512) || !validRedirectUri(redirectUri) ||
      !nonempty(state, 200) || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge || '')) {
    throw new Error('invalid_oauth_configuration');
  }
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email ' + GMAIL_READONLY_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'online'); // no long-lived refresh token in pilot
  return url.toString();
}
async function fetchJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response || !response.ok) throw new Error('upstream_request_failed');
  return response.json();
}
function bearer(token) {
  if (!nonempty(token, 8192)) throw new Error('invalid_access_token');
  return { Authorization: 'Bearer ' + token };
}
function checkScopes(granted) {
  if (!nonempty(granted, 2048)) return false;
  return granted.split(/\s+/).includes(GMAIL_READONLY_SCOPE);
}
async function exchangeCode({ clientId, clientSecret, redirectUri, code, verifier, fetchImpl = fetch }) {
  if (!nonempty(clientId, 512) || !nonempty(clientSecret, 4096) || !validRedirectUri(redirectUri) ||
      !nonempty(code, 4096) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier || '')) {
    throw new Error('invalid_oauth_configuration');
  }
  const form = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    code, code_verifier: verifier, redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  const data = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
  }, fetchImpl);
  if (!data || !nonempty(data.access_token, 8192) || !checkScopes(data.scope) ||
      !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) {
    throw new Error('invalid_google_token_response');
  }
  // Do not return, persist or log any refresh token received unexpectedly.
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
async function listLabelMessageIds({ accessToken, labelId, maxResults = 5, fetchImpl = fetch }) {
  bearer(accessToken);
  // Pilot must only process mail deliberately placed in a configured, custom label.
  if (typeof labelId !== 'string' || !/^Label_[A-Za-z0-9_-]{1,80}$/.test(labelId) ||
      !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
    throw new Error('invalid_pilot_label_or_limit');
  }
  const url = new URL(GMAIL_URL);
  url.searchParams.set('labelIds', labelId);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('fields', 'messages(id,threadId)');
  const result = await fetchJson(url.toString(), { method: 'GET', headers: bearer(accessToken) }, fetchImpl);
  if (!result || (result.messages !== undefined && !Array.isArray(result.messages))) throw new Error('invalid_gmail_list');
  return (result.messages || []).slice(0, maxResults).filter(x => /^[A-Za-z0-9_-]{1,100}$/.test(x?.id || ''))
    .map(x => ({ id: x.id, threadId: typeof x.threadId === 'string' ? x.threadId : null }));
}
async function findPilotLabelId({ accessToken, fetchImpl = fetch }) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/labels');
  url.searchParams.set('fields', 'labels(id,name,type)');
  const response = await fetchJson(url.toString(), {
    method: 'GET', headers: bearer(accessToken)
  }, fetchImpl);
  if (!Array.isArray(response?.labels) || response.labels.length > 500) {
    throw new Error('invalid_gmail_labels');
  }
  // Only a user-created label with this exact name is eligible.
  const matches = response.labels.filter(label =>
    label?.name === 'NEXLUPA_PILOT' && label?.type === 'user' &&
    /^Label_[A-Za-z0-9_-]{1,80}$/.test(label?.id || ''));
  if (matches.length !== 1) throw new Error('pilot_label_missing');
  return matches[0].id;
}

function textPart(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.mimeType === 'text/plain' && !payload.filename && !payload.body?.attachmentId &&
      typeof payload.body?.data === 'string') return payload.body.data;
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts.slice(0, 25)) {
      const found = textPart(part);
      if (found) return found;
    }
  }
  return null;
}
function header(headers, name) {
  if (!Array.isArray(headers)) return '';
  const value = headers.find(h => h?.name?.toLowerCase() === name)?.value;
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300) : '';
}
async function readTextMessage({ accessToken, messageId, labelId, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(messageId || '')) throw new Error('invalid_message_id');
  if (typeof labelId !== 'string' || !/^Label_[A-Za-z0-9_-]{1,80}$/.test(labelId)) throw new Error('invalid_pilot_label');
  const url = new URL(GMAIL_URL + '/' + encodeURIComponent(messageId));
  url.searchParams.set('format', 'full');
  url.searchParams.set('fields', 'id,threadId,labelIds,sizeEstimate,payload(mimeType,filename,headers,body,parts)');
  const message = await fetchJson(url.toString(), { method: 'GET', headers: bearer(accessToken) }, fetchImpl);
  if (!Array.isArray(message?.labelIds) || !message.labelIds.includes(labelId)) throw new Error('message_outside_pilot_label');
  if (message?.id !== messageId || !Number.isFinite(message.sizeEstimate) || message.sizeEstimate > 100000) {
    throw new Error('message_not_eligible');
  }
  const part = textPart(message.payload);
  if (!part || part.length > 30000 || !/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('plain_text_required');
  const body = Buffer.from(part, 'base64url');
  if (body.length > 15000) throw new Error('message_too_long');
  const text = body.toString('utf8').replace(/\u0000/g, '').trim();
  if (!text || text.length > 15000) throw new Error('invalid_plain_text');
  return {
    id: messageId,
    threadId: typeof message.threadId === 'string' ? message.threadId : null,
    subject: header(message.payload?.headers, 'subject').slice(0, 300),
    from: header(message.payload?.headers, 'from').slice(0, 254),
    text
  };
}
module.exports = { GMAIL_READONLY_SCOPE, makePkce, makeState, verifyState,
  authorizationUrl, checkScopes, exchangeCode, findPilotLabelId, listLabelMessageIds, readTextMessage };
