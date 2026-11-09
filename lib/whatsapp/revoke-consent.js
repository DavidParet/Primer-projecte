'use strict';
/**
 * Internal consent revocation operation. Caller must already have authenticated
 * the family administrator and independently authorized family access.
 * An injected trusted authorization service MUST validate the principal.
 * No HTTP route, login, phone verification or enrollment is implemented here.
 */
const { createHmac } = require('node:crypto');

const REVOKE_SQL = `
UPDATE nex_whatsapp_sender_authorizations
SET revoked_at = NOW()
WHERE authorization_id = $1 AND family_id = $2
  AND business_account_id = $3 AND phone_number_id = $4
  AND sender_digest = $5 AND revoked_at IS NULL
RETURNING authorization_id;
`;
const DELETE_SQL = `
DELETE FROM nex_whatsapp_inbound
WHERE family_id = $1 AND business_account_id = $2
  AND phone_number_id = $3 AND sender_digest = $4;
`;

function requireIdentity({ familyId, authorizationId, businessAccountId, phoneNumberId, senderWaId }) {
  if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId || '') ||
      !Number.isSafeInteger(authorizationId) || authorizationId <= 0 ||
      !/^\d{5,30}$/.test(businessAccountId || '') ||
      !/^\d{5,30}$/.test(phoneNumberId || '') ||
      !/^\d{7,15}$/.test(senderWaId || '')) {
    throw new Error('Consent revocation requires a verified family administrator and exact authorization');
  }
}

function createConsentRevoker({ db, senderHmacKey, authorizeFamily, authorizeFamilyTransaction }) {
  if (typeof authorizeFamily !== 'function') throw new TypeError('Trusted family authorization callback required');
  if (typeof authorizeFamilyTransaction !== 'function') {
    throw new TypeError('Trusted in-transaction family authorization callback required');
  }
  if (!db || typeof db.connect !== 'function') throw new TypeError('A transactional PostgreSQL pool is required');
  if (typeof senderHmacKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(senderHmacKey))
    throw new TypeError('A 32-byte base64 HMAC secret is required');
  const key = Buffer.from(senderHmacKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== senderHmacKey)
    throw new TypeError('Invalid HMAC secret');

  return async function revokeConsent(input) {
    requireIdentity(input);
    const { familyId, authorizationId, businessAccountId, phoneNumberId, senderWaId } = input;
    // Never trust actor flags supplied in input; the injected service must validate
    // the authenticated server-side request context independently.
    if (await authorizeFamily({ familyId, action: 'revoke_whatsapp_consent' }) !== true) {
      throw new Error('Consent revocation requires a verified family administrator');
    }
    const digest = createHmac('sha256', key).update(senderWaId, 'utf8').digest();
    const client = await db.connect();
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function')
      throw new Error('Invalid PostgreSQL transaction client');
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      // The earlier check is an early rejection only; membership may have
      // been revoked before BEGIN. Lock and verify it on THIS connection.
      if (await authorizeFamilyTransaction({
        client, familyId, action: 'revoke_whatsapp_consent'
      }) !== true) {
        throw new Error('Consent revocation requires current locked family authorization');
      }
      const update = await client.query(REVOKE_SQL,
        [authorizationId, familyId, businessAccountId, phoneNumberId, digest]);
      if (update.rowCount !== 1) {
        await client.query('ROLLBACK');
        started = false;
        return { state: 'not_active' };
      }
      const deletion = await client.query(DELETE_SQL,
        [familyId, businessAccountId, phoneNumberId, digest]);
      await client.query('COMMIT');
      started = false;
      return { state: 'revoked', deletedMessages: Number(deletion.rowCount || 0) };
    } catch (error) {
      if (started) {
        try { await client.query('ROLLBACK'); }
        catch (rollbackError) { error.cause = rollbackError; }
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

module.exports = { createConsentRevoker, requireIdentity, REVOKE_SQL, DELETE_SQL };
