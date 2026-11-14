'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { preparePilotOnboarding, allowedConsent } = require('../lib/onboarding-draft.cjs');

const familyId = '11111111-2222-4333-8444-555555555555';
const now = new Date('2026-11-12T00:00:00Z');
const consent = Object.freeze({
  familyId, familyStatus: 'pilot', sourceKind: 'resend_forward',
  permissionScope: 'read_school_mail', aliasManagementAuthorized: true,
  approvedAt: '2026-11-11T00:00:00Z',
  expiresAt: '2026-12-11T00:00:00Z', revokedAt: null
});
const draft = (record = consent, opts = {}) =>
  preparePilotOnboarding({
    familyId, now,
    loadVerifiedConsent: async () => record,
    randomBytesFn: () => Buffer.alloc(16, 0xab),
    ...opts
  });

test('only a trusted, verified consent produces an offline, non-persistent 128-bit alias draft', async () => {
  let calls = 0;
  const result = await draft(consent, {
    loadVerifiedConsent: async (id) => { calls++; assert.equal(id, familyId); return consent; }
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'draft_only');
  assert.equal(result.address, 'in-' + 'ab'.repeat(16) + '@entrada.nexlupa.app');
  assert.match(result.address, /^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/);
  assert.equal(result.aliasDigest,
    createHash('sha256').update(result.address, 'utf8').digest('hex'));
  assert.equal(result.familyId, familyId);
  assert.equal(result.persisted, false);
  assert.equal(result.forwardingEnabled, false);
  assert.equal(result.emailRead, false);
  assert.equal(result.nextStep, 'separate_authorized_atomic_activation');
  assert.equal(Object.isFrozen(result), true);
  assert.ok(!('approvedAt' in result));
  assert.ok(!('secret' in result));
});

test('missing, unverifiable or revoked consent never generates an alias', async () => {
  const invalidRecords = [
    null, {}, { ...consent, familyId: '22222222-3333-4444-8555-666666666666' },
    { ...consent, familyStatus: 'suspended' },
    { ...consent, sourceKind: 'gmail_oauth' },
    { ...consent, permissionScope: 'read_calendar' },
    { ...consent, aliasManagementAuthorized: false },
    { ...consent, aliasManagementAuthorized: 'true' },
    { ...consent, revokedAt: '2026-11-11T21:00:00Z' },
    { ...consent, revokedAt: undefined },
    { ...consent, approvedAt: '2026-11-13T00:00:00Z' },
    { ...consent, expiresAt: '2026-11-11T00:00:00Z' },
    { ...consent, approvedAt: 'invalid' },
    { ...consent, expiresAt: 'invalid' }
  ];
  for (const record of invalidRecords) {
    let generated = 0;
    const result = await draft(record, {
      randomBytesFn: () => { generated++; throw Error('must_never_generate'); }
    });
    assert.deepEqual(result, {
      status: 'verified_consent_required', persisted: false,
      forwardingEnabled: false, emailRead: false
    });
    assert.equal(generated, 0);
    assert.equal(allowedConsent(record, familyId, now.getTime()), false);
  }
});

test('callback failures fail closed; there is no fallback to a client consent flag', async () => {
  await assert.rejects(draft(consent, {
    loadVerifiedConsent: async () => { throw Error('backend_unavailable'); }
  }), /backend_unavailable/);
  await assert.rejects(preparePilotOnboarding({
    familyId, now, loadVerifiedConsent: null
  }), /not_configured/);
  await assert.rejects(preparePilotOnboarding({
    familyId: 'not-a-uuid', now, loadVerifiedConsent: async () => consent
  }), /not_configured/);
  await assert.rejects(preparePilotOnboarding({
    familyId, now: new Date('invalid'), loadVerifiedConsent: async () => consent
  }), /not_configured/);
  await assert.rejects(preparePilotOnboarding({
    familyId, now, loadVerifiedConsent: async () => consent,
    randomBytesFn: () => Buffer.alloc(8)
  }), /entropy_unavailable/);
  await assert.rejects(preparePilotOnboarding({
    familyId, now, loadVerifiedConsent: async () => consent,
    randomBytesFn: () => 'ab'.repeat(16)
  }), /entropy_unavailable/);
});

test('default cryptographic RNG produces distinct 128-bit aliases for separate drafts', async () => {
  const a = await preparePilotOnboarding({ familyId, now, loadVerifiedConsent: async () => consent });
  const b = await preparePilotOnboarding({ familyId, now, loadVerifiedConsent: async () => consent });
  assert.match(a.address, /^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/);
  assert.match(b.address, /^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/);
  assert.notEqual(a.address, b.address);
  assert.notEqual(a.aliasDigest, b.aliasDigest);
  assert.equal(a.persisted, false);
  assert.equal(b.persisted, false);
});

test('valid time window is strict at exact expiry', async () => {
  const justBefore = new Date('2026-12-10T23:59:59.999Z');
  assert.equal(allowedConsent(consent, familyId, justBefore.getTime()), true);
  const expired = await draft(consent, { now: new Date('2026-12-11T00:00:00Z') });
  assert.equal(expired.status, 'verified_consent_required');
});

test('the preparation module exposes no database insert or provider integration', () => {
  const exported = require('../lib/onboarding-draft.cjs');
  assert.deepEqual(Object.keys(exported).sort(), ['allowedConsent','preparePilotOnboarding']);
});
