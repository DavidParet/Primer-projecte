'use strict';

/**
 * Shared private dependencies for the Gmail preview pilot. Only preview builds
 * may enable this module. No Google credentials or access tokens are returned
 * to the browser or written to database/logs.
 */
const { Pool } = require('pg');
const { strictPilotConnectionString } = require('./strict-neon-connection.cjs');
const { createVerifiedFamilyResolver } = require('./verified-family.cjs');
const { validateRedirectUri } = require('./browser-oauth.cjs');
const { makeNeonIntentStore } = require('./neon-intent-store.cjs');
const { makeBrowserIntentReader } = require('./browser-intent-store.cjs');

let pool;
let resolverPromise;
const CLIENT_ID = /^[A-Za-z0-9._-]{12,250}\.apps\.googleusercontent\.com$/;

function config() {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.GMAIL_PILOT_ENABLED !== 'true') throw new Error('gmail_pilot_disabled');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = validateRedirectUri(process.env.GMAIL_PILOT_REDIRECT_URI);
  if (!CLIENT_ID.test(clientId || '') || typeof clientSecret !== 'string' ||
      clientSecret.length < 10 || clientSecret.length > 4096) {
    throw new Error('google_oauth_credentials_missing');
  }
  return { clientId, clientSecret, redirectUri, origin: new URL(redirectUri).origin };
}
function dbQuery(sql, params) {
  const uri = process.env.GMAIL_PILOT_DATABASE_URL;
  if (typeof uri !== 'string' || !/^postgres(?:ql)?:\/\//.test(uri)) {
    throw new Error('gmail_pilot_db_missing');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: strictPilotConnectionString(uri),
      ssl: { rejectUnauthorized: true },
      max: 2, connectionTimeoutMillis: 4000, statement_timeout: 5000,
      idleTimeoutMillis: 1000
    });
  }
  return pool.query(sql, params);
}
async function verifiedFamily() {
  if (!resolverPromise) {
    resolverPromise = createVerifiedFamilyResolver({
      authBaseUrl: process.env.NEON_AUTH_BASE_URL,
      jwksUrl: process.env.NEON_AUTH_JWKS_URL,
      pgQuery: dbQuery
    }).catch(err => { resolverPromise = null; throw err; });
  }
  return resolverPromise;
}
async function currentFamilyConsent({ familyId, authUserId }) {
  const result = await dbQuery(
    'SELECT nexlupa_worker_rpc.is_verified_gmail_family($1::uuid,$2::uuid) AS allowed',
    [authUserId, familyId]
  );
  return result?.rows?.length === 1 && result.rows[0].allowed === true;
}
function saveIntent(intent) {
  return makeNeonIntentStore(dbQuery).saveIntent(intent);
}
function takeBrowserIntent(input) {
  return makeBrowserIntentReader(dbQuery)(input);
}
module.exports = { config, dbQuery, verifiedFamily, currentFamilyConsent, saveIntent, takeBrowserIntent };
