# NexLupa WhatsApp — TTP245: preview login to canonical family pairing

**Scope:** GitHub feature PR #7 only. No production changes, no Neon migrations, no real WhatsApp registrations, and no enrollment of families or senders.

## What is now wired together (under synthetic tests)

The new internal `lib/whatsapp/pilot-pairing-issuer.js` connects these existing layers without creating a public route:

1. An explicitly enabled **Vercel preview-only** pilot login with a host-only, HttpOnly cookie.
2. A server-side Neon Auth (Better Auth) session verifier that asks the provider for a fresh session, requires its exact configured issuer and session validity, and checks the pilot's explicit user allowlist.
3. The canonical NexLupa user lookup, which independently maps the **verified provider subject** to an internal user ID. Unlinked or disabled accounts fail closed.
4. The canonical family membership lookup, which authorizes `enroll_whatsapp_sender` only for an active owner or administrator of the requested family.
5. A **separate one-use 60-second signed pairing permit** for the restricted DB function, passing no browser-claimed roles, usernames or code plaintext into SQL.

`createSignedFamilyPairingIssuer` can now reuse exactly one trusted, request-bound family authorization binder instead of redundantly reimplementing session verification. Combining an injected binder with an additional session/membership provider is rejected. Neither the binder nor the pairing factory is exposed as an HTTP endpoint.

## Canonical PostgreSQL authorization integration

Previously, the staged signed WhatsApp pairing functions rechecked permission only in the disposable `nex_ci_family_memberships` fixture, while newer authenticators used the proposed `nex_family_memberships` model.

The **CI-only staged canonical migration** now defines `nex_ci_authorize_canonical_family_locked`, which checks the real canonical tables for active account, active family, active membership and role, acquiring a PostgreSQL row lock during authorization. Its non-login, non-bypass-RLS function owner has narrow permissions. The ordinary identity lookup role **cannot execute** the locking function or write memberships.

A final disposable PostgreSQL integration script `tests/sql/whatsapp-canonical-pairing-bridge-smoke.sql` replaces the earlier synthetic authorization implementation for **that CI run only**, preserving restricted grants. It exercises:

- A previously valid legacy synthetic administrator rejected by canonical identity authorization.
- A legitimate owner/admin of canonical Family B successfully issuing a signed pairing invitation.
- A signed, one-use Meta-derived confirmation creating consent **only for Family B**.
- A revoked canonical admin unable to issue a new invitation, despite a correctly signed permit.
- A **previously issued but unspent pairing challenge** becoming unusable after its issuing administrator loses family permissions.
- Continued prohibition of raw identity-table reads by the pairing runtime.

This tests the actual dependency between the two models; it **does not migrate or activate** either model in Neon.

## Further work and approvals

- **Provider prerequisite:** Neon Auth remains disabled on the inspected Neon branches. Activating an IdP, setting login and issuing real family invitations require explicit operator approval and careful security configuration.
- **DB prerequisite:** prepare the approved Neon family and WhatsApp schema, roles and secret isolation, then apply to a deliberately chosen test branch; the CI-only `nex_ci_*` objects are not production migrations.
- **Meta prerequisite:** actual business app, phone, verified webhook, signature verification and consent/retention disclosure; do not read private WhatsApp groups or transmit real family data without opt-in.
- **Credentials:** confirm previous Vercel-looking token was revoked despite historical Git exposure.
- **Runtime:** wire a narrow preview-only endpoint only after real IdP credentials, rate limits, operational retry/quarantine, key rotation and end-to-end security review.

**Safety:** the public `api/whatsapp-webhook.js` remains disabled for real POST ingestion; it was not changed by this milestone.
