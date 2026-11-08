'use strict';

/**
 * Safe entrypoint for a future WhatsApp retention scheduler.
 * No database connections or secrets are acquired in this module.
 * Production activation requires a trusted explicit enabled flag,
 * dedicated DB maintenance adapter, and reliable operations monitor.
 */
const { createRetentionWorker } = require('./retention-worker');

async function runRetentionJob({
  enabled = false,
  createDatabase,
  report,
  batchSize = 250,
  maxBatches = 20
} = {}) {
  if (enabled !== true) {
    return Object.freeze({ status: 'disabled' });
  }
  if (typeof createDatabase !== 'function' || typeof report !== 'function') {
    throw new TypeError('Active retention requires database factory and monitor');
  }
  // Acquire a dedicated maintenance adapter only AFTER verifying enablement.
  const db = await createDatabase();
  if (!db || typeof db.query !== 'function' || typeof db.end !== 'function') {
    throw new TypeError('Dedicated maintenance database adapter requires query() and end()');
  }
  try {
    return await createRetentionWorker({ db, report, batchSize, maxBatches })();
  } finally {
    await db.end();
  }
}

module.exports = { runRetentionJob };
