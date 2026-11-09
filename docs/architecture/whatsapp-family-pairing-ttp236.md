# NexLupa WhatsApp — TTP 236: consented family pairing

**Implementation location:** feature branch PR #7. **Status:** synthetic CI-only proof of concept. Nothing is connected to Meta, a live identity provider, the real Neon database, or the production Vercel webhook.

## Purpose

A parent cannot be connected to a family merely because someone typed their phone number. The parent/phone holder must participate from their own WhatsApp account; otherwise an attacker could enroll a third party and quietly associate their messages with another family.

## Proposed pilot experience

1. An authenticated **owner/admin** of a NexLupa family opens the WhatsApp pairing action and sees a clear opt-in notice, data-retention summary (currently proposed: inbound text up to 7 days, subject to review) and consent version.
2. The backend revalidates the administrator's request-bound session and **locks current family membership in the PostgreSQL transaction**. It creates an unpredictable 80-bit, one-use pairing code with a 10-minute expiration, scoped to the precise business account, destination business number and family.
3. The administrator shares the pairing instructions **privately** with the person who wants to connect their WhatsApp. Never put pairing codes in public social feeds or unrelated WhatsApp groups.
4. **From their own WhatsApp account**, after reading the notice, that person sends `NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR` to the official NexLupa business number (sample code only).
5. A Meta-signed inbound webhook, verified against original raw bytes, supplies the sender identity. The server **does not trust** a claimed phone number, sender, role or family in its own HTTP request body. It only processes an exact explicit acceptance command; ordinary forwarded texts cannot enroll a sender.
6. The DB finds a **hashed** code bound to the exact business account and business phone ID, checks it has not expired or been consumed, row-locks it, and rechecks that the original issuing administrator retains permission to enroll family senders.
7. In **one database transaction**, mark the code consumed, create an authorization scoped to `incoming_text` (proposed pilot lifetime: 30 days; user can revoke earlier), and record an idempotent Meta message receipt. Sender identity is stored only as a **keyed HMAC digest**, not the raw WhatsApp phone number.
8. If the code is expired, membership was revoked, the sender was already enrolled into another active family, the signed request is malformed, or any SQL operation fails, no new consent should be committed.

The challenge itself is *not* evidence of sender opt-in. Only the later, authenticated WhatsApp acceptance qualifies. The user-facing notice, withdrawal mechanism, retention, privacy terms, parental involvement, accessibility, consent logging and legal basis require review before the live pilot.

## Files and tests

- `lib/whatsapp/family-pairing-protocol.js`: cryptographically unpredictable printable codes, exact acceptance command, keyed code digest.
- `lib/whatsapp/family-pairing-issuer.js`: verified family admin, request-pinned session, membership row lock, DB challenge insert, no code plaintext in database.
- `lib/whatsapp/meta-pairing-confirmation.js`: signed Meta raw body verification, bounded delivery normalization, exact-code confirmation, explicit opt-in consent, unique receipt and atomic rollback.
- `tests/whatsapp-family-pairing.test.js`: real HMAC signatures with synthetic secrets; forged/unsigned messages, wrong family roles, revoked memberships, duplicate deliveries, SQL rollback, and phone privacy.
- `tests/sql/whatsapp-family-pairing-smoke.sql`: disposable PostgreSQL 17 table constraints; expired challenge, cross-business refusal, verified admin check, one-use code consumption, duplicated provider message denial and single-family sender uniqueness.

## Critical blockers before enabling

- The prototype refers to **nex_ci_*** pairing tables and privileged CI database connections, not approved Neon migrations. Runtime enrollment SQL still needs security review and **narrow, identity-bound database permissions**; a server with unchecked direct INSERT permission could bypass the pairing protocol. Do not grant ordinary app users direct access to any enrollment tables.
- A sender can be **one active family per business number** under the existing unique index. Shared devices/multi-family membership needs deliberate product policy, not an implicit guess.
- The official Meta webhook is unchanged and still disabled/verify-only. A future real endpoint must specially process signed pairing commands **before** normal consented-message ingestion; otherwise unknown/unlinked senders are correctly not stored and cannot complete the pairing.
- Meta may retry failed deliveries; introduce rate limiting, bound challenge issuance, dead-letter/quarantine policy for unsupported content, idempotent confirmation and limited provider receipt retention.
- The opt-in code is a shared secret. The server must rate-limit attempts and strictly avoid printing codes, raw WhatsApp numbers or webhook text into telemetry.
- Expired and consumed challenge rows plus receipt identifiers need a reviewed purging schedule; no new cron is installed.
- Verify real IdP subject mapping: in CI, memberships use fictitious `account-a` etc. Actual family membership store is not implemented.
- The possible exposed Vercel token has now been **removed from the current default branch** as well as the feature branch and .gitignored; it remains recoverable from Git history until managed, and its Vercel revocation/rotation remains unverified.

This code does not initiate consent or message processing for any real family.
