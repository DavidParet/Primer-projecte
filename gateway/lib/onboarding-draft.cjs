'use strict';

/**
 * Prepares a server-side, consent-gated pilot alias DRAFT.
 *
 * This module has no network calls, database writes, Gmail or Resend access.
 * loadVerifiedConsent MUST be a trusted, authenticated backend lookup (not
 * a consent boolean, a browser field, or an email header). It must check
 * that the operator is allowed to manage the selected family.
 *
 * A prepared alias is NOT a live mailbox. Activation requires a separate,
 * audited, authorized transaction and Gmail forwarding verification.
 */
const { randomBytes, createHash } = require('node:crypto');

const FAMILY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS = /^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/;

function allowedConsent(record, familyId, time) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.familyId !== 'string' ||
      record.familyId.toLowerCase() !== familyId.toLowerCase()) return false;
  if (!['pilot', 'active'].includes(record.familyStatus) ||
      record.sourceKind !== 'resend_forward' ||
      record.permissionScope !== 'read_school_mail' ||
      record.aliasManagementAuthorized !== true ||
      record.revokedAt !== null) return false;
  const approved = Date.parse(record.approvedAt);
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(approved) && Number.isFinite(expires) &&
    approved <= time && expires > time && expires > approved;
}

async function preparePilotOnboarding({
  familyId, loadVerifiedConsent, randomBytesFn = randomBytes,
  now = new Date()
} = {}) {
  if (typeof familyId !== 'string' || !FAMILY_ID.test(familyId) ||
      typeof loadVerifiedConsent !== 'function' ||
      typeof randomBytesFn !== 'function' ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('pilot_onboarding_not_configured');
  }

  // Authentication and family membership must be verified inside this
  // server-only lookup; this module never accepts client-side consent flags.
  const record = await loadVerifiedConsent(familyId);
  if (!allowedConsent(record, familyId, now.getTime())) {
    return Object.freeze({ status: 'verified_consent_required', persisted: false,
      forwardingEnabled: false, emailRead: false });
  }

  const bytes = randomBytesFn(16);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16)
    throw new Error('pilot_alias_entropy_unavailable');
  const address = 'in-' + bytes.toString('hex') + '@entrada.nexlupa.app';
  if (!ALIAS.test(address))
    throw new Error('pilot_alias_invalid');
  const digest = createHash('sha256').update(address, 'utf8').digest('hex');

  // The address is intentionally visible ONLY to the trusted operator.
  // Persist only the digest in the isolated database on later approval.
  return Object.freeze({
    status: 'draft_only', familyId: familyId.toLowerCase(), address, aliasDigest: digest,
    persisted: false, forwardingEnabled: false, emailRead: false,
    nextStep: 'separate_authorized_atomic_activation'
  });
}

module.exports = { preparePilotOnboarding, allowedConsent };
