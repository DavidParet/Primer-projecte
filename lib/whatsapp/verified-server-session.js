'use strict';

/**
 * Protocol adapter only. NOT an identity provider or a token verifier.
 * The caller supplies verifyRequestSession, a trusted SERVER-SIDE verifier
 * bound to one immutable request context, backed by the actual IdP.
 *
 * It must independently authenticate the session on every call; untrusted
 * request body identity, unsigned JWT payloads, and identity headers are
 * not acceptable implementations of verifyRequestSession.
 */
function createVerifiedServerSessionResolver({
  verifyRequestSession, requestContext, issuer, audience, now = Date.now
} = {}) {
  if (typeof verifyRequestSession !== 'function' ||
      requestContext === null || requestContext === undefined ||
      typeof issuer !== 'string' || !issuer.trim() ||
      typeof audience !== 'string' || !audience.trim() ||
      typeof now !== 'function') {
    throw new TypeError('Trusted request-bound IdP verifier and expected issuer/audience required');
  }

  return async function getAuthenticatedSession() {
    // No client-provided user ID or requested family is supplied to verifier.
    // No result is cached: session revocation/expiration must be rechecked.
    const identity = await verifyRequestSession(requestContext);
    const currentTime = now();
    if (!identity || identity.verified !== true ||
        identity.issuer !== issuer || identity.audience !== audience ||
        identity.revoked === true || identity.disabled === true ||
        typeof identity.subject !== 'string' || !identity.subject.trim() ||
        identity.subject.length > 256 ||
        typeof identity.sessionId !== 'string' || !identity.sessionId.trim() ||
        identity.sessionId.length > 256 ||
        !Number.isSafeInteger(currentTime) ||
        !Number.isSafeInteger(identity.expiresAtMs) ||
        identity.expiresAtMs <= currentTime ||
        !Number.isSafeInteger(identity.issuedAtMs) ||
        identity.issuedAtMs > currentTime ||
        identity.issuedAtMs >= identity.expiresAtMs) {
      return null;
    }

    return Object.freeze({
      authenticated: true,
      userId: identity.subject,
      sessionId: identity.sessionId,
      expiresAtMs: identity.expiresAtMs,
      revoked: false
    });
  };
}

module.exports = { createVerifiedServerSessionResolver };
