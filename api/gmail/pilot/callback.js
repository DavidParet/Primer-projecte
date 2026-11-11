'use strict';

/**
 * Google redirects the browser here after voluntary OAuth consent. A valid
 * state plus HttpOnly browser cookie must match an atomically consumed Neon
 * intent. No message modifications, persistence, AI or Calendar side effects.
 */
const { completeBrowserOAuth, clearStateCookie } = require('../../../lib/gmail/browser-oauth.cjs');
const { previewLabeledMail } = require('../../../lib/gmail/preview-import.cjs');
const server = require('../../../lib/gmail/private-server.cjs');

function scalar(value) {
  return typeof value === 'string' ? value : null;
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Set-Cookie', clearStateCookie());
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error:'method_not_allowed' });
  }
  try {
    const { clientId, clientSecret, redirectUri, origin } = server.config();
    if (req.headers?.host?.toLowerCase() !== new URL(origin).host.toLowerCase()) {
      return res.status(403).json({ error:'origin_not_allowed' });
    }
    const state = scalar(req.query?.state), code = scalar(req.query?.code);
    const error = scalar(req.query?.error);
    if (!state || (!error && !code) ||
        (code && code.length > 4096) || (error && error.length > 200)) {
      return res.status(400).json({ error:'invalid_oauth_return' });
    }
    let preview = null;
    const outcome = await completeBrowserOAuth({
      state, code, error,
      cookieHeader: req.headers?.cookie,
      clientId, clientSecret, redirectUri,
      takeBrowserIntent: server.takeBrowserIntent,
      checkCurrentFamilyConsent: server.currentFamilyConsent,
      onAuthorized: async ({ familySession, googleAccount, accessToken }) => {
        preview = await previewLabeledMail({
          familySession, googleAccount, accessToken,
          checkCurrentFamilyConsent: server.currentFamilyConsent
        });
      }
    });
    if (!preview || outcome.status !== 'authorized_for_single_pilot_action') {
      return res.status(503).json({ error:'pilot_preview_unavailable' });
    }
    // The preview is not stored, logged, forwarded to AI, or synchronized.
    return res.status(200).json(preview);
  } catch (error) {
    const msg = error?.message;
    const denied = ['oauth_state_rejected','invalid_browser_state','invalid_oauth_state',
      'invalid_browser_nonce','oauth_consent_declined','gmail_consent_required',
      'gmail_consent_revoked','pilot_label_missing'];
    const status = denied.includes(msg) ? 403 : 503;
    return res.status(status).json({
      error: msg === 'pilot_label_missing' ? 'create_NEXLUPA_PILOT_label_first' :
        msg === 'oauth_consent_declined' ? 'oauth_declined' :
        status === 403 ? 'oauth_denied_or_expired' : 'gmail_pilot_unavailable'
    });
  }
};
