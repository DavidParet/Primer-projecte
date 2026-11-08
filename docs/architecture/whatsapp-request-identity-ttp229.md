# NexLupa — TTP 229: session-bound identity for WhatsApp consent revocation

## Change summary

The prototype now contains a **server-only composition layer** for WhatsApp consent revocation:

- `lib/whatsapp/request-identity-binding.js` pins `userId` **and** `sessionId` from a trusted server-side session resolver at the beginning of one request.
- Immediately before the preliminary family-membership lookup and again **inside the revocation transaction**, the adapter re-reads the authenticated session and denies a changed principal/session, an expired session or a revoked session.
- `lib/whatsapp/request-bound-consent-revoker.js` wires the pinned callbacks into the existing consent revoker for a single request, without using `input.actor`, `input.userId`, `input.sessionId` or caller-asserted roles.
- The transaction authorization still uses the restricted PostgreSQL function with bound parameters and must execute on the same transaction client as the consent mutation.
- Tests cover family forgery, session switching, same-account/new-session switching, session expiry, session revocation, missing verified identity, membership revocation between the checks and rollback before data changes.

## Security boundaries — not a claim of production authentication

This prototype **cannot verify that an identity provider really signed the session**. `getAuthenticatedSession()` MUST be implemented by a trusted, server-side IdP integration; its returned `userId`, `sessionId`, `authenticated`, `revoked` and expiration metadata must not come from untrusted request JSON or arbitrary headers. The current NexLupa identity provider has not been identified or wired.

The database function still accepts `user_id` as an argument. Consequently, if the restricted database runtime credential is stolen, an attacker able to invoke the function directly may supply another user ID. Request pinning prevents inadvertent or malicious **client input impersonation only at the properly protected server call boundary**; it does not cryptographically bind identity to PostgreSQL. Remaining release controls include privileged credential custody, authenticated service routing, server integrity, least-privilege RLS policies, isolated DB roles, auditing and optional database-enforced identity claims.

Session revocation in an external identity provider is not atomic with PostgreSQL transaction commit: an IdP change immediately after the final check cannot be reversed automatically. The retained row lock only coordinates **database membership** mutations.

The implementation is not exposed as an HTTP endpoint, the actual Neon family schema and roles are not installed, and no WhatsApp or Resend runtime/production integration was changed.

## Next gate

Confirm NexLupa's canonical IdP and membership store; verify actual session signature/rotation and expiry behavior; perform a two-family end-to-end authenticated route test; then separately review role deployment on an isolated Neon test branch. The previously identified potentially exposed Vercel credential requires independent rotation/revocation verification before production launch.
