# NexLupa WhatsApp — TTP 238: signed issuance and signed Meta opt-in

**Scope:** isolated GitHub PR #7 with **synthetic-only** JavaScript and disposable PostgreSQL 17 fixtures. NOT a Meta, Neon, Vercel or Resend production change.

## Threat addressed

In TTP 237, a restricted database runtime could call an approved pairing function with an arbitrary claimed administrator user ID, or call the Meta-confirmation function after inventing a sender digest and challenge code. Restricting SQL DML alone did **not** bind the call cryptographically to the independently verified server/Meta event.

TTP 238 adds two independent short-lived, purpose-bound **HMAC-signed operation permits** that the database role can present but cannot mint using its database credential alone.

- `issue`: signed **only after** an independently verified request-bound server session and a preliminary current-family administrator lookup. Signed fields: operation version, key ID, server-verified user ID, family UUID, business account ID, business number ID, 32-byte HMAC code digest, Unix expiry, one-time random UUID nonce.
- `confirm`: signed **only after** raw-body Meta app-secret signature verification, parse, normalized delivery, and the exact explicit acceptance command. Signed fields: separate operation version/key ID, business account/phone identifiers, 32-byte code and sender digests, Meta delivery ID, Unix expiry and one-time nonce.
- Both permits expire within **60 seconds**. Postgres checks the *database clock*, selected key purpose/state and exact HMAC before executing any underlying operation.
- The two signing keys are different from each other, from the phone-digest HMAC key, and from the pairing-code HMAC key. Trusted signer secrets must live in a separate server secret store and never be accessible using the restricted DB account.
- A new RLS-protected `nex_ci_pairing_operation_nonces` table prevents a single signed permit from being spent twice across both operation types. The HMAC keyring is accessible to the non-login function owner only.
- The restricted issuer/confirmer DB roles retain **EXECUTE only on their new matching signed function**. Their grants to the earlier unsigned TTP237 entrypoints are revoked.
- Existing underlying functions still perform membership row locking, exact challenge checks, one-use challenge consumption, consent insertion and unique Meta message receipt in the **same transaction**.

## Test cases

The new JavaScript tests verify signer purpose separation, session switching, forged client/family roles, raw Meta signature rejection, sender and code-digest secrecy, key reuse refusal, DB rejection/rollback and one DB operation per request.

The new SQL tests verify that the runtime cannot directly query key material or insert consent, unsigned/tampered family/sender/keys are rejected, valid signed issue/confirm operations work, and a replayed signed permit is rejected by the nonce ledger.

## Remaining risks and launch gates

**Not a live end-to-end authentication guarantee.** The callback named `getAuthenticatedSession` must still be implemented by an actual audited IdP server integration, not a client-controlled object; the raw Meta signature verifier depends on authentic Meta application-secret custody. Both signing services need independent key material and credential isolation from DB runtime access. A compromise of the signing server or private signing key still permits forgery.

The **HMAC verifier secrets are deliberately present in the disposable PostgreSQL test keyring**, not in Neon. A privileged DB administrator or function-owner compromise can see those secrets; a production design may benefit from asymmetric signatures and external KMS custody. Verify timing behavior of PostgreSQL bytea signature comparisons, secret rotation/revocation, replay ledger cleanup and audit before live use.

These functions deliberately use `nex_ci_*` names and synthetic credentials. There are no production pairing tables, no public HTTP endpoint connecting this new adapter, and no real session provider. Legacy unsigned SQL functions remain installed in disposable CI for existing tests but are no longer callable from the restricted runtime roles after the TTP238 fixture.

Before launch, select the canonical NexLupa IdP/family schema; perform Neon *isolated test branch* migrations under explicit authorization; activate a licensed business-number Meta webhook only after privacy/consent, rate-limit, retry handling, secret management and all true-role tests. Verify that the previously exposed Vercel-like credential has been revoked or rotated; it is removed from current tracked content but remains in repository history.
