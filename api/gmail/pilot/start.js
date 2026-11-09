'use strict';

/** Initiates one voluntary Gmail OAuth flow for a server-verified family. */
const { beginBrowserOAuth } = require('../../../lib/gmail/browser-oauth.cjs');
const server = require('../../../lib/gmail/private-server.cjs');
const { validatePilotStartRequest }=require('../../../lib/gmail/http-guards.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error:'method_not_allowed' });
  }
  try {
    const { clientId, redirectUri, origin } = server.config();
    const guarded=validatePilotStartRequest(req,origin);
    if (!guarded.ok) return res.status(guarded.status).json({error:guarded.error});
    const verify = await server.verifiedFamily();
    const familySession = await verify({
      authorization: req.headers?.authorization,
      requestedFamilyId: guarded.familyId
    });
    const started = await beginBrowserOAuth({
      familySession, clientId, redirectUri,
      hasCurrentConsent: familyId =>
        server.currentFamilyConsent({ familyId, authUserId:familySession.authUserId }),
      saveIntent: server.saveIntent
    });
    res.setHeader('Set-Cookie', started.setCookie);
    return res.status(200).json({
      authorizationUrl: started.authorizationUrl,
      expiresInSeconds: started.expiresInSeconds,
      mode:'read_only_label_pilot',
      note:'Only mail in NEXLUPA_PILOT will be read after approval'
    });
  } catch (error) {
    const message = error?.message;
    const status = message === 'authentication_required' || message === 'family_auth_required' ? 401 :
      ['family_not_authorized','gmail_consent_required'].includes(message) ? 403 :
      message === 'invalid_family_selection' ? 400 : 503;
    return res.status(status).json({
      error: status === 503 ? 'gmail_pilot_unavailable' : message
    });
  }
};
