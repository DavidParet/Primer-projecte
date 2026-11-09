'use strict';

/**
 * Server-only request identity pinning for the experimental WhatsApp consent
 * revocation flow. The resolver MUST verify session integrity independently
 * (e.g. through a production IdP). A client-supplied "session" is NOT trusted.
 *
 * Binds a request to exactly one authenticated account AND one server session.
 * The same identity is rechecked both before and inside the DB transaction.
 * This is not a replacement for DB grants, RLS or an identity provider.
 */
const { FAMILY_UUID, ACTION_ROLES } = require('./family-authorization');
const { LOCK_MEMBERSHIP_SQL } = require('./transactional-family-authorization');

function validSession(session, now) {
  return session && session.authenticated === true &&
    session.revoked !== true &&
    typeof session.userId === 'string' && session.userId.trim() !== '' &&
    typeof session.sessionId === 'string' && session.sessionId.trim() !== '' &&
    Number.isSafeInteger(session.expiresAtMs) &&
    session.expiresAtMs > now;
}

function createRequestIdentityBinder({ getAuthenticatedSession, getMembership, now = Date.now }) {
  if (typeof getAuthenticatedSession !== 'function' ||
      typeof getMembership !== 'function' || typeof now !== 'function') {
    throw new TypeError('Trusted server session, membership, and clock resolvers required');
  }
  return async function bindRequest() {
    const initial = await getAuthenticatedSession();
    if (!validSession(initial, now())) {
      throw new Error('Verified active server session required');
    }
    const pinned = Object.freeze({
      userId: initial.userId,
      sessionId: initial.sessionId
    });

    async function sameActiveSession() {
      const live = await getAuthenticatedSession();
      return validSession(live, now()) &&
        live.userId === pinned.userId &&
        live.sessionId === pinned.sessionId;
    }

    function validAction(familyId, action) {
      return typeof familyId === 'string' && FAMILY_UUID.test(familyId) &&
        Object.prototype.hasOwnProperty.call(ACTION_ROLES, action);
    }

    return Object.freeze({
      async getVerifiedPrincipal() {
        if (!(await sameActiveSession())) return null;
        return Object.freeze({userId:pinned.userId, sessionId:pinned.sessionId});
      },

      async authorizeFamily({ familyId, action } = {}) {
        if (!validAction(familyId, action) || !(await sameActiveSession())) return false;
        const membership = await getMembership({userId:pinned.userId, familyId});
        return Boolean(membership &&
          membership.userId === pinned.userId &&
          membership.familyId === familyId &&
          membership.active === true &&
          membership.revoked !== true &&
          ACTION_ROLES[action].includes(membership.role));
      },

      async authorizeFamilyTransaction({ client, familyId, action } = {}) {
        if (!client || typeof client.query !== 'function' ||
            !validAction(familyId, action) ||
            !(await sameActiveSession())) return false;
        const response = await client.query(
          LOCK_MEMBERSHIP_SQL,[pinned.userId,familyId,action]
        );
        return response && Array.isArray(response.rows) &&
          response.rows.length === 1 && response.rows[0].allowed === true;
      }
    });
  };
}

module.exports = { createRequestIdentityBinder };
