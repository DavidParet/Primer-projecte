# NexLupa WhatsApp — TTP 240: canonical identity and family model

**Scope:** code and PostgreSQL 17 CI in the isolated WhatsApp PR #7. This is a staged model, **not a real login system** and **not a Neon migration**. No real user identifiers, family names, passwords, or session cookies were read or written.

## Verified current Neon gap

Read-only schema inspection on 2026-11-09 confirmed that the existing `whatsapp-schema-validation-20261108` branch in Neon has:
- `public.nex_whatsapp_inbound`: message identifiers, family UUID, authenticated encrypted payload fields, expiration, and state.
- `public.nex_whatsapp_sender_authorizations`: business/phone IDs, sender HMAC digest, family UUID, scope and consent timestamps, active-sender unique index.

The inspected branch did **not** have a canonical NexLupa user, family, IdP identity link or membership schema. The default `pilot` branch remains a separate Resend pilot. Neon Auth was not enabled on that default branch. Production/Neon remained read-only throughout TTP240.

## Staged canonical model

`db/migrations/20261109_nexlupa_canonical_identity_staged.sql` now declares four proposed tables:

1. `public.nex_users` — stable internal opaque `user_id`, creation timestamp, account disable timestamp.
2. `public.nex_idp_identity_links` — exact `(issuer,subject)` mapping to that internal ID, with independent revocation. The same external `subject` from two distinct issuers does **not** identify the same user.
3. `public.nex_families` — UUID, family label, creation/archive state.
4. `public.nex_family_memberships` — unique internal user/family pair, `owner|admin|member` role, suspended/revoked state and updated timestamp.

All tables use `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`. The **CI-only** runtime has no direct SELECT/INSERT/UPDATE/DELETE access to identity, family or membership tables. It can only execute two narrow, database-owned functions with fixed `search_path`, owned by a non-login, non-superuser, non-BYPASSRLS role:

- `public.nex_ci_resolve_verified_identity(issuer,subject)` returns an internal user only when the identity link and user are currently active.
- `public.nex_ci_active_family_membership(user_id,family_id)` returns a role only for an active membership belonging to a non-disabled user and non-archived family.

Existing internal app `lib/whatsapp/membership-store.js` now queries the narrow membership function instead of reading the table directly.

## Verified IdP principal adapter

`lib/whatsapp/canonical-verified-session.js` composes the existing request-bound, server-side IdP contract with the canonical mapping:

1. The injected IdP verifier independently authenticates each request's server-side session, including issuer, expected audience, session ID, expiry and revocation.
2. The code uses only the **verified external IdP subject**, never request JSON, to query the canonical identity function with the **expected exact issuer**.
3. The response maps to a trusted internal `userId` consumed by the existing family-authorization binder. It remains pinned to the verified IdP session ID, and is re-resolved on each check, so identity unlinking, account disablement and session swaps fail closed.
4. A missing, revoked, invalid or ambiguous mapping never creates an account or silently grants family permissions.

Tests use synthetic accounts and two distinct mock issuers with the same subject, disabled/unlinked identities, user/family role separation, session swaps, and database failure cases. The SQL test separately verifies the PostgreSQL functions, restrictions, account disable/revocation and archived/suspended families.

## Important unfinished work

**A real identity provider is still not connected.** The `verified: true` flag must come from a real server-side session verifier with correct issuer, audience, token/session signature checking, key rotation, callback validation, secure cookies, origin controls and revocation. Merely returning that flag from browser data would defeat this design.

The CI role can call a lookup function with arbitrary issuer/subject if its credential is stolen. This is **not** proof of identity at the database layer: a production system requires additional defense-in-depth, strict server-side verification and scoped keys/roles. Signed, one-use WhatsApp pairing operations (TTP238) must still be reviewed against this trust boundary.

**No user self-registration, family membership enrollment, invitation acceptance UI, external identity linking or family sharing workflows have been implemented.** Linking real accounts requires a controlled identity migration and user consent / privacy design. Do not seed fake CI users or test secret data into Neon.

The SQL file is staged for review only. It must be adapted to real Neon branch identities, schema ownership, privileges, migration rollback and provider configuration before it can be approved. Directly running the file in an existing production database is not permitted.

## Next actual pilot milestones

- Decide the verified server-side IdP and connect real authentication to NexLupa's Vercel backend.
- Design trusted family creation, user invitation acceptance, role updates and identity-link revocation; audit all operations with constrained write permissions.
- Prepare the actual restricted Neon branch migration, review data handling and test it explicitly under isolated credentials and a separate test URL.
- Pair a Meta WhatsApp business sender only after real authentication, explicit opt-in and privacy review.
- Resolve historical possible Vercel credential exposure by verifying revocation/rotation and reviewing Git history.
