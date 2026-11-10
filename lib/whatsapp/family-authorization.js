'use strict';

/**
 * Internal authorization adapter for WhatsApp family consent operations.
 *
 * Trusted dependencies MUST be injected from the server, not from request
 * JSON, headers supplied by the caller, or a client-selected family ID.
 *
 * getAuthenticatedSession() resolves the verified server session.
 * getMembership({userId, familyId}) looks up live membership server-side.
 * No production identity provider or membership store is wired here.
 */
const FAMILY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_ROLES = Object.freeze({
  revoke_whatsapp_consent: Object.freeze(['owner','admin']),
  enroll_whatsapp_sender: Object.freeze(['owner','admin']),
  read_whatsapp_messages: Object.freeze(['owner','admin','member'])
});

function createFamilyAuthorizer({getAuthenticatedSession, getMembership}) {
  if (typeof getAuthenticatedSession !== 'function' ||
      typeof getMembership !== 'function') {
    throw new TypeError('Trusted session and membership resolvers are required');
  }
  return async function authorizeFamily({familyId, action} = {}) {
    if (typeof familyId !== 'string' || !FAMILY_UUID.test(familyId) ||
        !Object.prototype.hasOwnProperty.call(ACTION_ROLES, action)) {
      return false;
    }
    // Capture identity from a trusted session source on EVERY request.
    const session = await getAuthenticatedSession();
    if (!session || session.authenticated !== true ||
        typeof session.userId !== 'string' || !session.userId.trim() ||
        session.revoked === true) {
      return false;
    }
    const membership = await getMembership({
      userId:session.userId,
      familyId
    });
    // Fail closed: never accept truthy objects or unverified membership flags.
    if (!membership || membership.userId !== session.userId ||
        membership.familyId !== familyId ||
        membership.active !== true || membership.revoked === true ||
        !ACTION_ROLES[action].includes(membership.role)) {
      return false;
    }
    return true;
  };
}

module.exports = {createFamilyAuthorizer, FAMILY_UUID, ACTION_ROLES};
