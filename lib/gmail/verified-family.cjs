'use strict';

/**
 * Server-side family authorization for Neon Auth JWTs.
 *
 * A caller supplies a JWT in Authorization and selects a family UUID, but
 * the family binding is granted only if a privileged Neon SQL function
 * confirms an ACTIVE membership, a verified user, and current Gmail consent.
 *
 * No session, family ID, or verifiedByServer flag may be trusted from request JSON.
 */
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verifyConfig({ authBaseUrl, jwksUrl }) {
  let base, jwks;
  try {
    base = new URL(authBaseUrl);
    jwks = new URL(jwksUrl);
  } catch { throw new Error('neon_auth_configuration_missing'); }
  if (base.protocol !== 'https:' || jwks.protocol !== 'https:' ||
      !base.hostname.endsWith('.neon.tech') || jwks.hostname !== base.hostname ||
      !jwks.pathname.endsWith('/.well-known/jwks.json') ||
      base.username || base.password || base.search || base.hash ||
      jwks.username || jwks.password || jwks.search || jwks.hash) {
    throw new Error('neon_auth_configuration_invalid');
  }
  return { issuer: base.origin, jwksUrl: jwks };
}
function bearerToken(authorization) {
  if (typeof authorization !== 'string' || authorization.length > 8192) throw new Error('authentication_required');
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) throw new Error('authentication_required');
  return match[1];
}
async function createVerifiedFamilyResolver({ authBaseUrl, jwksUrl, pgQuery, keySet }) {
  const config = verifyConfig({ authBaseUrl, jwksUrl });
  if (typeof pgQuery !== 'function') throw new Error('missing_private_membership_database');
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const keys = keySet || createRemoteJWKSet(config.jwksUrl, {
    timeoutDuration: 4000, cooldownDuration: 30000, cacheMaxAge: 300000
  });
  return async function verifyFamily({ authorization, requestedFamilyId }) {
    const token = bearerToken(authorization);
    if (typeof requestedFamilyId !== 'string' || !UUID.test(requestedFamilyId)) {
      throw new Error('invalid_family_selection');
    }
    let claims;
    try {
      const result = await jwtVerify(token, keys, {
        issuer: config.issuer,
        algorithms: ['EdDSA'],
        maxTokenAge: '20m',
        clockTolerance: '10s'
      });
      claims = result.payload;
    } catch { throw new Error('authentication_required'); }
    if (!UUID.test(claims.sub || '') || claims.role !== 'authenticated') {
      throw new Error('authentication_required');
    }
    const familyId = requestedFamilyId.toLowerCase();
    const userId = claims.sub.toLowerCase();
    const db = await pgQuery(
      'SELECT nexlupa_worker_rpc.is_verified_gmail_family($1::uuid,$2::uuid) AS allowed',
      [userId, familyId]
    );
    if (db?.rows?.length !== 1 || db.rows[0].allowed !== true) {
      throw new Error('family_not_authorized');
    }
    // Bind the 5-minute OAuth intent to THIS actual short-lived access token.
    // If the client rotates the token during redirect, fail safely and restart.
    return {
      kind: 'family-session',
      verifiedByServer: true,
      familyId,
      authUserId: userId,
      sessionId: crypto.createHash('sha256').update(token, 'utf8').digest('hex')
    };
  };
}
module.exports = { createVerifiedFamilyResolver, verifyConfig, bearerToken };
