'use strict';

const { createNeonAuthSessionVerifier } = require('./neon-auth-server-session');
const {
  validatePilotConfig, localCookieValue, decodePilotSession, requestHostMatches,
} = require('./pilot-auth-bff');

const FREE_LIMIT = 3;
const PILOT_BRANCH = 'feat/free-quota-server-pilot';
const MADRID_DAY = "(statement_timestamp() AT TIME ZONE 'Europe/Madrid')::date";

function isFreeUsagePilot(env = process.env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === PILOT_BRANCH;
}

// Counts requests admitted to the AI, including provider failures. A rejected
// request does not consume quota. Each statement uses the database's Madrid date.
function createFreeUsageStore(db) {
  return {
    async read({ issuer, subject }) {
      const { rows } = await db.query(
        `SELECT used FROM nexlupa_quota.daily_text_usage
         WHERE issuer = $1 AND subject = $2 AND usage_date = ${MADRID_DAY}`,
        [issuer, subject],
      );
      return rows[0]?.used ?? 0;
    },
    async reserve({ issuer, subject }) {
      const { rows } = await db.query(
        `INSERT INTO nexlupa_quota.daily_text_usage AS usage (issuer, subject, usage_date, used)
         VALUES ($1, $2, ${MADRID_DAY}, 1)
         ON CONFLICT (issuer, subject, usage_date) DO UPDATE SET used = usage.used + 1
         WHERE usage.used < $3
         RETURNING used`,
        [issuer, subject, FREE_LIMIT],
      );
      return rows[0]?.used ?? null;
    },
  };
}

let pool;
function pilotDb(connectionString) {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000,
      statement_timeout: 5000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.warn('Free quota: idle database connection failed.'));
  }
  return pool;
}

function quotaReply(status, fields) {
  return { status, body: { pilot: true, limit: FREE_LIMIT, ...fields } };
}

async function checkFreeUsage(req, { reserve = false, env = process.env, fetchImpl = fetch, db } = {}) {
  const config = validatePilotConfig(env);
  if (!config || (!db && !env.NEXLUPA_FREE_QUOTA_DB_URL)) {
    return quotaReply(503, { code: 'QUOTA_UNAVAILABLE', error: 'No podem consultar la quota de proves ara mateix.' });
  }
  if (!requestHostMatches(req, config.origin) ||
      (reserve && (req.headers.origin !== config.origin ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')))) {
    return quotaReply(403, { code: 'QUOTA_FORBIDDEN', error: 'L’accés a la prova està restringit.' });
  }
  try {
    const cookie = decodePilotSession(localCookieValue(req.headers.cookie));
    const verify = createNeonAuthSessionVerifier({
      sessionUrl: config.authBase, issuer: config.authBase, audience: 'nexlupa-pilot', fetchImpl,
    });
    const session = cookie && await verify({ headers: { cookie } });
    if (!session || !config.allowedSubjects.has(session.subject)) {
      return quotaReply(401, { code: 'SIGN_IN_REQUIRED', error: 'Inicia sessió amb un compte de prova per analitzar.' });
    }

    const store = createFreeUsageStore(db ?? pilotDb(env.NEXLUPA_FREE_QUOTA_DB_URL));
    const used = reserve ? await store.reserve(session) : await store.read(session);
    if (used === null) {
      return quotaReply(429, { used: FREE_LIMIT, code: 'FREE_DAILY_LIMIT',
        error: 'Has arribat a les 3 anàlisis d’avui. Demà en tindràs 3 més.' });
    }
    return quotaReply(200, { used });
  } catch {
    return quotaReply(503, { code: 'QUOTA_UNAVAILABLE', error: 'No podem consultar la quota de proves ara mateix.' });
  }
}

module.exports = { isFreeUsagePilot, checkFreeUsage, createFreeUsageStore };
