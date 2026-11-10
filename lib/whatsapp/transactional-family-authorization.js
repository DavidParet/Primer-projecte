'use strict';

/**
 * Prototype ONLY. Membership row locking is performed by a reviewed
 * SECURITY DEFINER function under a separate restricted DB function owner.
 * The calling service must not have direct UPDATE privileges on memberships.
 * Call on the SAME transaction client that later revokes consent.
 */
const { FAMILY_UUID, ACTION_ROLES } = require('./family-authorization');

const LOCK_MEMBERSHIP_SQL = `
SELECT public.nex_authorize_family_locked($1, $2::uuid, $3) AS allowed
`;

function createTransactionalFamilyAuthorizer({ getAuthenticatedSession }) {
  if (typeof getAuthenticatedSession !== 'function') {
    throw new TypeError('Trusted authenticated server session resolver required');
  }
  return async function authorizeFamilyTransaction({ client, familyId, action } = {}) {
    if (!client || typeof client.query !== 'function' ||
        typeof familyId !== 'string' || !FAMILY_UUID.test(familyId) ||
        !Object.prototype.hasOwnProperty.call(ACTION_ROLES, action)) {
      return false;
    }
    // Identity must come from verified server-side session, never input.actor.
    const session = await getAuthenticatedSession();
    if (!session || session.authenticated !== true || session.revoked === true ||
        typeof session.userId !== 'string' || !session.userId.trim()) {
      return false;
    }
    const result = await client.query(LOCK_MEMBERSHIP_SQL,[session.userId,familyId,action]);
    // Strict boolean result; malformed answers always deny.
    return result && Array.isArray(result.rows) && result.rows.length === 1 &&
      result.rows[0].allowed === true;
  };
}

module.exports = { createTransactionalFamilyAuthorizer, LOCK_MEMBERSHIP_SQL };
