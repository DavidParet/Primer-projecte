'use strict';

/**
 * Server-side composition ONLY; instantiate once per authenticated request.
 * Actual IdP / canonical family membership implementation are not wired.
 * Neither HTTP endpoints nor Meta webhooks are activated here.
 */
const { createRequestIdentityBinder } = require('./request-identity-binding');
const { createConsentRevoker } = require('./revoke-consent');

function createRequestBoundConsentRevoker({
  db, senderHmacKey, getAuthenticatedSession, getMembership, now
}) {
  const bindRequest = createRequestIdentityBinder({
    getAuthenticatedSession, getMembership, ...(now ? {now} : {})
  });
  return async function revokeFromVerifiedRequest(input) {
    // Neither input.actor nor input.userId nor input.sessionId can replace a
    // verified session. The binder is freshly pinned for each server request.
    const {authorizeFamily, authorizeFamilyTransaction} = await bindRequest();
    const revoke = createConsentRevoker({
      db, senderHmacKey, authorizeFamily, authorizeFamilyTransaction
    });
    return revoke(input);
  };
}
module.exports = {createRequestBoundConsentRevoker};
