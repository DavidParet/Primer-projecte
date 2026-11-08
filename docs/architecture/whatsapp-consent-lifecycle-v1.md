# NexLupa — WhatsApp consent lifecycle (design, not deployed)
Date: 2026-11-08. Scope: PR #7 prototype branch only. No live user enrollment.

## Safety boundary
A Meta webhook signature authenticates the Meta delivery, **not** the family user's consent.
Do not infer consent from a forwarded message, a telephone number, group name, or text.
Do not automatically import group history. A user can manually forward messages to NexLupa; the original group provenance remains unknown.

## Enrollment: proposed state machine
1. `unregistered`: sender messages are not persisted, parsed for household information, or delivered to an agent.
2. `pending_proof`: an authenticated family administrator initiates a limited enrollment challenge. Store a time-limited, rate-limited proof request; never a reusable raw phone number in logs.
3. `pending_consent`: after proof of number control, show clear consent terms and retention details. The family/number binding is not active until explicit acceptance.
4. `active`: record family ID, independently keyed sender digest, permitted scope `incoming_text`, consent version, time, source, expiration, and audit event.
5. `revoked`: immediately block new ingestion in the DB authorization check. Trigger deletion of stored inbound content associated with the binding, according to the approved retention and audit policy.
6. `expired`: do not ingest after `valid_until`; re-consent is required.

## Required protections before implementing activation
- Authenticated family administrator and authorization to manage the target `family_id`. The revocation module now requires an injected **trusted** `authorizeFamily({familyId, action})` callback; this callback MUST be backed by the authenticated server session and trusted membership lookup, never by client-provided actor flags. The production identity adapter has not been connected.
- Verified control of sender number via short-lived one-time proof, throttling and attempt counters.
- Idempotent consent transitions; a concurrent revoke must win over an inbound insert. Use row locking or another DB-enforced mechanism after threat-model review.
- A unique active mapping of one sender to one family on each business number; migration between families requires explicit revocation and re-enrollment.
- Audit access restricted to operations; no raw phone, message text, tokens or secret values in logs or audit events.
- Encryption and HMAC keys independent, server-only, rotatable; document secure key custody and deletion.
- No tenant-readable records until row-level policy or trusted query-layer tenant scoping is verified.
- Privacy notices for adults/minors/third-party content, lawful basis, deletion rights and processor assessment reviewed before a real pilot.
- Data retention: current inbox sets seven-day expiration but the purge worker is NOT scheduled. A deletion timestamp alone is not deletion.
- Do not enable an externally reachable POST endpoint until signatures, network controls, retries, error semantics and partial-delivery handling have been reviewed.

## Acceptance tests for implementation
- Wrong family administrator cannot grant, transfer or revoke another family's authorization.
- Unverified and expired proof challenges never grant consent.
- Duplicate approvals do not produce duplicate active grants.
- Revocation stops ingestion, including race conditions with an already-running transaction.
- Attempts to re-enroll a revoked number require fresh proof and explicit consent.
- Expired messages are physically purged; failures alert and retry.
- A consent audit does not leak personal message content, telephone numbers or secrets.
- Tests run against a separate Neon branch using non-personal synthetic fixtures.

**Status:** the isolated PR contains an internal transactional revocation primitive with a required authorization callback. No real identity adapter, enrollment, consent proof, audit storage, public endpoint or tenant access controls are implemented. Test results and SQL race behavior still need verification.
