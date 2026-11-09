# NexLupa WhatsApp — TTP 237: restricted pairing and Meta webhook boundary

**Status:** isolated PR #7, synthetic data on disposable PostgreSQL 17. **No production WhatsApp/Neon/Resend integration is enabled.**

## Concrete changes

The TTP236 prototype wrote directly to the pairing, consent and receipt tables from its application transaction. The new staged TTP237 adapter `lib/whatsapp/restricted-family-pairing.js` instead sends parameterized inputs to two narrowly scoped database functions:

- **`nex_ci_issue_whatsapp_pairing`:** creates a one-time, ten-minute-maximum invitation. The server must first resolve a verified family administrator session. Inside PostgreSQL the function independently checks current owner/admin family membership under a row lock, then saves only the keyed digest of the invitation, not the readable code.
- **`nex_ci_confirm_whatsapp_pairing`:** accepts only a code digest, sender digest, business/phone identifiers and the original Meta provider message ID from a server that **has already verified** the raw Meta webhook signature and exact `NEXLUPA ACCEPTA …` command. The database independently locks an unexpired unused challenge, checks that the issuing administrator is still active, creates an explicit 30-day consent (prototype duration) and records a unique receipt atomically.

The accompanying PostgreSQL test `tests/sql/whatsapp-restricted-pairing-service-smoke.sql` sets up three distinct `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS` roles:

1. Pairing issuer runtime: only `EXECUTE` on the issue function.
2. Pairing confirmer runtime: only `EXECUTE` on the confirm function.
3. Narrow function owner: privileges needed on challenges, consent records and receipts to perform the operation under **FORCE ROW LEVEL SECURITY**, but no table ownership or bypass role.

The runtime roles cannot directly `INSERT`, `UPDATE` or `SELECT` private pairing records, cannot directly insert WhatsApp sender authorizations, cannot execute each other's function, and cannot access unrelated family records. Unrelated test roles cannot execute either function. Tests also verify an ordinary family member cannot issue an invitation, an administrator cannot issue in another family, a challenge cannot be spent twice and the Meta message receipt is idempotent.

## Explicit unresolved security boundaries

**Not production safe yet.** The issue function receives a server-asserted `user_id`; the confirmer receives a server-asserted Meta signature-verification result in the form of derived digests and a provider message ID. The SQL functions do **not** independently verify the original IdP session cryptography or Meta's signature. Therefore an attacker who steals the restricted runtime credential can still call the corresponding function with forged assertions or guessed/obtained challenges. This task restricts direct SQL privileges, not the cryptographic identity-to-database boundary.

The remaining secure designs should consider separately signed, short-lived, one-use operations with a signing secret inaccessible to the DB runtime, or a reviewed secure IdP/MCP/KMS execution boundary. This security work must come **before** granting these functions to a live application account.

The TTP236 direct-DML pairing modules and CI tables remain in the feature branch for backward-compatibility tests. **Do not deploy either version as a public handler**. Their presence does not imply an authenticated NexLupa production IdP, registered Meta WhatsApp number or real consent database.

## Additional launch gates

- Select and wire the real server-side IdP and family schema, including revocation and membership lifecycle.
- Bind the issuing principal and Meta-verified sender proof to tamper-evident permissions that cannot be minted from a stolen DB credential alone.
- Validate the true Neon permissions on a separately authorized test branch.
- Add bounded pairing-code issuance and attempts, retry/dead-letter treatment, user-facing consent notice, legal/data-retention review, and code/receipt cleanup.
- Validate the WhatsApp public webhook switch separately and only after reliable durable persistence and Meta account configuration.
- Confirm the previously exposed Vercel credential was revoked. It was removed from the current default branch and ignored by Git; historical commits still require incident review.

**Production, Resend and live Meta webhook remain unchanged.**
