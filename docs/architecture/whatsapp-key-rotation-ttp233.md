# NexLupa WhatsApp — TTP 233: rotation and emergency revocation of permit-signing keys

**Scope:** isolated PR #7 proof of concept. The key registry, signing credentials, roles, procedures and all messages in CI are **synthetic**. Nothing in this TTP deploys to Neon, Meta, Resend or a production Vercel environment.

## Key model

Each revocation permit now includes an explicit `keyId` in the canonical **version 2** signature payload, ahead of the verified principal and tightly bound authorization, family, number, 32-byte sender digest, expiration and one-use nonce. Maximum permit lifetime remains 90 seconds. A different signing key must be used from the sender-digest HMAC key and all database credentials.

- `active`: may sign new permits from the trusted server-side key resolver; database verification accepts valid unexpired signatures.
- `verify_only`: must NOT sign new permits. The database accepts already issued permits only until a bounded `accept_until` deadline and their individual expiration.
- `revoked`: database rejects the key regardless of the validity of any outstanding signature.

The disposable PostgreSQL test enforces **at most one active key** with a partial unique index, keeps the key registry out of reach of the runtime service role, and verifies key status using a restricted `SECURITY DEFINER` operation.

## Planned rotation protocol

1. Provision a freshly generated secret in an approved secret manager under a **new key ID**. Never put the secret in source control, build logs, messages or CI configuration.
2. Coordinate signer and database verifier availability. There must be no gap where the signer generates permits with an unknown key; mismatched deployment should fail closed.
3. In an authorized administrative database transaction, change the old key to `verify_only` with a grace period **no longer than the permit lifetime**, and mark the new key `active`. The database prohibits multiple active keys.
4. Switch the trusted signer resolver to retrieve only the new active key ID; retrieve fresh key state for every signing operation, with no stale cached fallback.
5. Verify new-key signatures, and that already-issued old-key permits can complete only within the brief overlap. Do not grant ongoing signing access to `verify_only` keys.
6. After the overlap, mark the old key `revoked`, securely retire the old signing secret and audit key usage. Nonce records must not be purged before all associated permits expire.

## Emergency compromised-key response

1. Immediately block further signing with the compromised key in the trusted secret-store/signer environment, and revoke its verifier registry entry.
2. **Do not** grant an overlap/grace period when the key is known compromised; outstanding permits for that key are intentionally rejected after registry revocation commits. In-flight operations that already passed key verification cannot be retroactively cancelled.
3. If no other trustworthy key is active, fail closed on revocation requests until a new independently provisioned key is available. Do not silently fall back to the revoked key or the legacy v1 function.
4. Audit permitted operations, nonce usage, related family consent changes and service credentials; rotate any other secrets potentially exposed by the same incident, with human/security review.

## Tests added

- A v2 signer with a fresh trusted key resolver, signed key IDs and a nonce per permit, negative tests for stale/retired keys, wrong family, swapped sessions, separate signing/sender secrets and database rejection.
- A disposable PostgreSQL fixture that tests a valid **pre-rotation** old-key permit during `verify_only`, a valid new-key permit, a tampered key ID, an emergency-revoked key with a still-valid unused permit, an expired old-key grace period with an unused valid permit, and preservation of another family's data.
- The runtime service role is denied direct key-table access and execution of the old v1 signed function. Only the v2 restricted operation is executable.

## Security / deployment limitations

- **The verifier's HMAC secret exists in this synthetic PostgreSQL key table**, which is intentionally inaccessible to the runtime. A compromised privileged database owner or the signer-side secret manager could still obtain it. An independently secured asymmetric signature / external KMS verification design is worth reviewing before live deployment to minimize database-side key exposure.
- Database key revocation takes effect for **subsequent verifier checks** after the administrative transaction commits. It is not an atomic cancellation of already in-flight SQL or external IdP sessions.
- Protect administrative rotation privileges, review key ownership and RLS, use audit records excluding secret bytes, and verify clock skew and request timeouts.
- Do not copy the hard-coded **synthetic test keys** to any real environment.
- The v1 signed revocation function still exists in the CI schema for backward test coverage, but the CI runtime's EXECUTE grant is revoked. The legacy direct-SQL revoker also remains in the repository as test-only code; no live route may use it.
- A bounded, audited cleanup policy for expired nonces and key records is still required. Never clear nonce entries early or reuse an old key ID.
- No canonical IdP, production family memberships or restricted Neon service role is connected. The previously identified possible exposed Vercel credential remains a separate incident until revocation is verified by its owner.

**No database schema or permission changes on the user's Neon project have been made.**
