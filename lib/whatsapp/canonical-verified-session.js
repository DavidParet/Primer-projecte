'use strict';

/**
 * TTP240: resolve an IdP-verified issuer+subject to a stable internal user ID.
 *
 * This is NOT an IdP, token validator, identity-link editor, or public route.
 * verifyRequestSession must be a real server-side IdP session verifier, not
 * client-supplied JSON / JWT decoding without signature verification.
 * DB account needs EXECUTE on the single canonical identity lookup function.
 */
const {createVerifiedServerSessionResolver}=
  require('./verified-server-session');

const CANONICAL_ID=/^[A-Za-z0-9_-]{1,128}$/;
const RESOLVE_CANONICAL_USER_SQL=`
SELECT user_id
FROM public.nex_ci_resolve_verified_identity($1,$2)
`;

function createCanonicalVerifiedSessionResolver({
  db,verifyRequestSession,requestContext,issuer,audience,now=Date.now
}={}){
  if(!db||typeof db.query!=='function')
    throw new TypeError('Restricted canonical identity database adapter required');
  const getProviderSession=createVerifiedServerSessionResolver({
    verifyRequestSession,requestContext,issuer,audience,now
  });
  return async function getAuthenticatedSession(){
    // Revalidate on every invocation. No mapping or IdP session cache.
    const source=await getProviderSession();
    if(!source)return null;

    // The server-verified subject is an opaque external IdP identifier.
    // It must NEVER be directly treated as an internal family user ID.
    const response=await db.query(RESOLVE_CANONICAL_USER_SQL,[
      issuer,source.userId
    ]);
    if(!response||!Array.isArray(response.rows)||
       response.rows.length>1)
      throw new Error('Ambiguous or unavailable verified user mapping');
    const row=response.rows[0];
    if(!row||typeof row.user_id!=='string'||
       !CANONICAL_ID.test(row.user_id))return null;
    const canonical=Object.freeze({
      authenticated:true,
      userId:row.user_id,
      // Namespace IdP sessions to prevent unrelated providers colliding.
      sessionId:issuer+'\u001f'+source.sessionId,
      expiresAtMs:source.expiresAtMs,
      revoked:false
    });
    return canonical;
  };
}
module.exports={
  createCanonicalVerifiedSessionResolver,RESOLVE_CANONICAL_USER_SQL
};
