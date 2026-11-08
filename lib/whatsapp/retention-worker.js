'use strict';

/**
 * Internal retention worker, not an HTTP endpoint or scheduler.
 * Run ONLY under a dedicated authorized maintenance role after
 * review of database grants, alerting and operations. Logs no content.
 */
const PURGE_BATCH_SQL = `
WITH expired AS (
  SELECT inbound_id FROM nex_whatsapp_inbound
  WHERE expires_at <= NOW()
  ORDER BY expires_at, inbound_id
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
DELETE FROM nex_whatsapp_inbound AS inbox
USING expired
WHERE inbox.inbound_id = expired.inbound_id
`;

function createRetentionWorker({ db, report, batchSize = 250, maxBatches = 20 }) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Dedicated PostgreSQL maintenance adapter required');
  }
  if (typeof report !== 'function') {
    throw new TypeError('Trusted retention monitor is required');
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000 ||
      !Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new RangeError('Retention limits out of bounds');
  }

  return async function purgeExpiredMessages() {
    let deleted = 0;
    let batches = 0;
    let lastBatchFull = false;
    try {
      while (batches < maxBatches) {
        const result = await db.query(PURGE_BATCH_SQL, [batchSize]);
        const count = result && result.rowCount;
        if (!Number.isSafeInteger(count) || count < 0 || count > batchSize) {
          throw new Error('Invalid retention deletion result');
        }
        batches++;
        deleted += count;
        lastBatchFull = count === batchSize;
        if (!lastBatchFull) break;
      }
      const outcome = Object.freeze({
        status: 'completed',
        deleted,
        batches,
        // This is a conservative signal: it does not prove rows remain.
        mayHaveMore: lastBatchFull
      });
      await report(outcome);
      return outcome;
    } catch (error) {
      // Report only coarse operational metadata; never pass DB error text,
      // phone numbers, row data or tokens to telemetry.
      try {
        await report(Object.freeze({ status: 'failed', deleted, batches }));
      } catch (monitorError) {
        error.cause = monitorError;
      }
      throw error; // The caller must retry/alert; never report false success.
    }
  };
}

module.exports = { createRetentionWorker, PURGE_BATCH_SQL };
