'use strict';

/**
 * PostgreSQL transaction-scoped advisory lock for a future maintenance runner.
 * Must execute all work on the SAME dedicated connection and within one
 * transaction; do not call pool.query() inside the callback.
 * This primitive does NOT activate any cron, Neon credentials or public API.
 */
const LOCK_SQL = 'SELECT pg_try_advisory_xact_lock(716200, 1) AS acquired';

async function withRetentionLock(pool, work) {
  if (!pool || typeof pool.connect !== 'function' || typeof work !== 'function') {
    throw new TypeError('Dedicated PostgreSQL pool and work callback are required');
  }
  const client = await pool.connect();
  if (!client || typeof client.query !== 'function' ||
      typeof client.release !== 'function') {
    throw new TypeError('Invalid dedicated PostgreSQL client');
  }
  let began = false;
  let committed = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await client.query(LOCK_SQL);
    const acquired = result && result.rows && result.rows[0] &&
      result.rows[0].acquired;
    if (acquired !== true && acquired !== false) {
      throw new Error('Unknown retention lock result');
    }
    if (!acquired) {
      await client.query('ROLLBACK');
      began = false;
      return Object.freeze({ status: 'busy' });
    }
    const value = await work(client);
    await client.query('COMMIT');
    committed = true;
    return Object.freeze({ status: 'completed', value });
  } catch (error) {
    if (began && !committed) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { error.cause = rollbackError; }
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withRetentionLock, LOCK_SQL };
