# NexLupa WhatsApp — TTP 234: nonce retention and safe replay protection

**Status: disposable PostgreSQL 17 CI prototype in PR #7. Not enabled on Neon or production.**

## Why these records exist

A signed WhatsApp consent revocation permit (v1/v2) contains a random UUID nonce, authenticated fields, and an absolute Unix expiry. A successful operation stores the nonce in `nex_ci_revocation_permit_uses` with a UNIQUE/PRIMARY KEY constraint so the same permit cannot be spent twice during its validity window. An invalid signature or revoked key is refused without consuming the nonce.

The ledger does not store phone numbers, family IDs, message content, or permit signatures.

## Safe retention policy

- **Never purge an unexpired permit nonce.**
- Purge only records with `expires_at < database_clock - interval '5 minutes'`. The five-minute safety margin exceeds the maximum signed-permit lifetime's immediate boundary and provides conservative tolerance for operational timing. In production, measure and formally bound clock skew; a margin alone is not a substitute for synchronized clocks.
- The revocation verifier MUST check that the permit's expiry lies strictly in the future using the **database clock**, before consulting/inserting any nonce. This remains mandatory after the ledger deletes old records; otherwise replay protection would be bypassed.
- Remove in bounded batches (default 250, maximum 1000 per batch; maximum 20 batches by default), ordered by expiration time and nonce. Keep a supporting `(expires_at,nonce)` index.
- The maintenance account can SELECT and DELETE eligible nonce records but cannot INSERT/UPDATE, read signing keys, modify consent records, or access WhatsApp message content. PostgreSQL FORCE RLS independently enforces the eligibility cutoff, not just JavaScript WHERE conditions.
- Acquire a transaction-scoped PostgreSQL advisory lock on the SAME dedicated connection as all batches; on contention, exit as `busy`. Commit before emitting a success report. Report only counts/status; never record nonce values or secret material in telemetry.
- New legitimate signed revocations must continue to work after enabling FORCE RLS, because the separate function-owner role has an explicit INSERT policy for fresh nonce entries. SQL CI verifies this.

## Explicitly disabled by default

`lib/whatsapp/nonce-retention.js` provides `runNonceRetentionJob` but returns `{status:'disabled'}` unless a trusted server caller explicitly enables it and provides a dedicated pool and reporting callback. It does not create a schedule, production database connection, or public endpoint. The existing WhatsApp message-retention workflow remains disabled. This module is **not** wired into any production path.

## CI evidence and limitations

The synthetic tests include:

- Three long-expired nonces, one recently expired nonce, and one future nonce.
- Two deletion batches that delete only the three eligible records, retaining both protected entries.
- Denial of a direct attempt to delete a recently expired nonce under the limited database role.
- Role-grant checks and absence of signing-key access.
- Rejection of a correctly signed but already expired permit after its old nonce entry has been purged.
- A successful fresh, correctly signed revocation after ledger FORCE RLS was introduced; the fresh nonce is not visible to the retention role.
- JavaScript tests for disabled-by-default, lock contention, batch caps, strict maintenance role checks, transaction rollback on errors, and no premature success telemetry.

These controls do NOT cover a malicious database owner, compromised signer secret, entire app server compromise, or the production Neon role model. Connection and identity-provider integration are still pending. The standalone code must not be deployed with the literal `nex_ci_*` fixture names or synthetic signing keys.

## Launch gates

1. Review a real Neon schema and dedicated maintenance role under explicit permission before any migration.
2. Confirm database and signer clock synchronization and retention observability.
3. Define how often to run maintenance, alert thresholds, and idempotent crash recovery. Do not activate a cron without approved credentials and monitoring.
4. Test lock contention with overlapping production-like workers and a separate restricted database session.
5. Confirm the Vercel credential exposure incident is resolved and that the actual server IdP/family membership design is integrated.

**No real WhatsApp ingestion or Resend webhook configuration changed.**
