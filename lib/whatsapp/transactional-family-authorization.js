'use strict';

/**
 * Prototype transactional authorization; not connected to real IdP/schema.
 * Requires the same dedicated PostgreSQL client as the consent mutation.
 * Membership SELECT ... FOR SHARE serializes with membership UPDATE/DELETE.
 */
const { FAMILY_UUID, ACTION_ROLES } = require('./family-authorization');

const LOCK_MEMBERSHIP_SQL = `
SELECT role, status, revoked_at
FROM public.nex_family_memberships
WHERE user_id = $1 AND family_id = $2
FOR SHARE
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
    // Caller cannot assert its own identity or role. This must be a
    // previously verified server-side session, never a client-provided JWT.
    const session = await getAuthenticatedSession();
    if (!session || session.authenticated !== true || session.revoked === true ||
        typeof session.userId !== 'string' || !session.userId.trim()) {
      return false;
    }
    const result = await client.query(LOCK_MEMBERSHIP_SQL,[session.userId,familyId]);
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
      return false;
    }
    const member=result.rows[0];
    return member.status === 'active' &&
      member.revoked_at === null &&
      ACTION_ROLES[action].includes(member.role);
  };
}

module.exports = { createTransactionalFamilyAuthorizer, LOCK_MEMBERSHIP_SQL };
