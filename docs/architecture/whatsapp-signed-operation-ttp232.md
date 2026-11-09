# NexLupa WhatsApp — TTP 232: signed, one-use consent revocation

**Status:** proof of concept on the isolated PR #7 branch. **Never run the CI SQL file on Neon or production.**

## Security objective

A stolen WhatsApp database runtime credential should **not, by itself**, allow direct SQL `UPDATE` of consents, `DELETE` of messages, or arbitrary calls pretending to be a different family administrator.

### Design exercised by TTP 232

1. The server verifies the request identity through a **trusted** IdP session resolver and checks current membership. No user-supplied `actor`, `role`, `userId` or `familyId` is accepted as proof.
2. On the same request, the server rechecks its pinned session before preparing a one-use revocation permit. A dedicated **permit HMAC key** (independent of the WhatsApp sender-digest HMAC key and the DB password) signs a canonical payload:
   - operation/version discriminator
   - verified internal user subject (ASCII ID with no delimiter)
   - target family UUID, exact authorization identifier, business account, phone number, 32-byte sender digest
   - expiration (no more than 90 seconds) and random UUID nonce
3. The restricted runtime role only executes `public.nex_ci_revoke_whatsapp_with_permit`. It has **no direct SELECT/UPDATE/DELETE grants** on the WhatsApp consent/message tables, membership table, signing-key table or nonce ledger. The previous broad grants and the prior unrestricted family-check EXECUTE grant are explicitly revoked in the disposable SQL test.
4. The security-definer function uses its own narrowly granted owner. It rejects expired, malformed and tampered permits using the private signing key, then performs a current-membership check under a row lock, consumes the nonce in a uniqueness-constrained ledger and revokes the exact authorization/deletes matching encrypted messages in the **same PostgreSQL transaction**.
5. Tests exercise forged family identifiers, modified signatures, direct SQL mutation attempts, nonce replay and cross-family data preservation.

### Limitations / blockers

- **Neither the signing key nor the IdP are deployed in the real NexLupa system.** The SQL tests use a deliberately public, disposable *synthetic* key and fake families. Do not copy that key into a production environment.
- A stolen DB credential alone is constrained by these test grants and an independent permit key. **An attacker who also obtains the permit signing key, compromises the signing server, steals a fresh valid permit before use, or gains function-owner/table-owner access may still cause harm.** This is defense in depth, not a blanket guarantee against credential compromise.
- The SQL HMAC comparison relies on normal PostgreSQL `bytea` equality; the prototype does not establish a constant-time comparison guarantee. The function/role topology, schema integrity, search_path, extension location and permission escalation must undergo independent production security review.
- Issuer session revocation in an external IdP cannot be made atomic with a PostgreSQL transaction. The current DB membership lock protects against concurrent **membership updates**, not instantaneous external IdP session revocations.
- Canonical user IDs are restricted to `[A-Za-z0-9_-]` up to 128 characters. Actual IdP subject IDs may need a trusted internal mapping. Do not silently transform arbitrary IdP subjects.
- The nonce ledger needs a bounded, monitored retention/purge strategy. Do not delete nonce records before their corresponding permits have expired; operations must remain idempotent.
- The actual Neon database schema, credentials and roles are **not** changed by this work. Legacy direct-DML revocation is still in the feature branch for compatibility testing and must not be selected for launch.
- No public HTTP endpoint, WhatsApp/Meta callback, schedule, Resend webhook or production Vercel deployment was enabled.

### Release gates

1. Choose and integrate NexLupa's authoritative IdP and canonical family membership model.
2. Design secure dual-custody provisioning and rotation of the independent signing key, with limited visibility and no secret leakage into logs or CI.
3. Eliminate or make unreachable the legacy direct-SQL revoker before deployment; review every runtime DB grant.
4. Test with real separately authenticated accounts using scoped DB credentials on an explicitly authorized isolated Neon branch.
5. Threat-model expired permits, replay, token theft, concurrent requests, database clock skew, external session revocation, function privilege escalation and auditing.
6. Resolve the previously identified potentially exposed Vercel token (confirm revocation/rotation and assess Git history).

**This PR is still a non-production security prototype, not a connected live WhatsApp integration.**
