'use strict';

/**
 * Internal read-only adapter. The TTP240 canonical identity migration and
 * function exist ONLY in disposable PostgreSQL CI, not live Neon.
 * The server role must only have EXECUTE on the reviewed membership lookup;
 * NEVER take user_id from HTTP fields as authentication.
 */
const MEMBERSHIP_SQL = `
SELECT user_id, family_id, role, active, revoked
FROM public.nex_ci_active_family_membership($1,$2::uuid)
LIMIT 2
`;

function createMembershipLookup({db}) {
  if (!db || typeof db.query !== 'function')
    throw new TypeError('Restricted membership database adapter required');

  return async function getMembership({userId,familyId}={}) {
    if (typeof userId !== 'string' || !userId.trim() ||
        typeof familyId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId)) {
      return null;
    }

    const result=await db.query(MEMBERSHIP_SQL,[userId,familyId]);
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
      throw new Error('Ambiguous or unavailable family membership');
    }
    const row=result.rows[0];
    if (!row || row.user_id !== userId || row.family_id !== familyId ||
        row.active !== true || row.revoked !== false ||
        !['owner','admin','member'].includes(row.role)) {
      return null;
    }
    return {
      userId:row.user_id,
      familyId:row.family_id,
      role:row.role,
      active:true,
      revoked:false
    };
  };
}

module.exports={createMembershipLookup,MEMBERSHIP_SQL};
