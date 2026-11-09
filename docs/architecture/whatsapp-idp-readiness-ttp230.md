# NexLupa — TTP 230: identity provider integration boundary and leaked-token prevention

## Current integration status

The inspected GitHub project contains a minimal `package.json` (no identified server-side authentication package). A native NexLupa server IdP and canonical production family membership store have **not** been identified; no live login, membership roles, or WhatsApp consent route is claimed.

### New staged adapter (no external login enabled)

`lib/whatsapp/verified-server-session.js` defines `createVerifiedServerSessionResolver`, which requires a trusted **request-bound** `verifyRequestSession(requestContext)` callback implemented by the actual IdP backend. It checks: independent verification flag, configured exact issuer and audience, nonempty subject and session ID, session expiration and issuance timestamp, and disabled/revoked states. It returns only the shape required by the existing per-request identity binder.

The adapter explicitly does **not** validate an IdP signature itself. A caller returning `verified: true` from request body data would be insecure, and MUST NOT be used in production. Implementations must validate token cryptography/session integrity, key rotation, token origin, audience, expiry, server-side revocation policy, and session-cookie security before returning verified claims.

The composed internal test verifies that forged `actor`, `userId`, `sessionId`, and `familyId` fields do not override the server verified subject and current family membership. Tests cover expired, disabled, revoked, wrong issuer/audience, mutable or missing session metadata, verifier errors and session reuse.

### Credential containment — feature branch only

A tracked local settings file on the PR branch contained strings matching a long Vercel-like access-token format. It has been **removed from the feature branch**, and `.gitignore` now excludes local Claude settings and secret environment files.

The PR CI calls `node scripts/security/check-tracked-credentials.js` before tests. It checks **currently tracked files** for a Vercel-like personal token pattern, reporting path and pattern category only, never matched tokens. This is a targeted regression gate, not complete secret scanning.

**Incident remains unresolved** until a Vercel owner has revoked or verified revocation of the potentially exposed token, examined related access/deploy logs, and decided whether/how to purge credentials from repository history. The default branch and prior Git commits still retain historical exposure until separately remediated. The suspicious value was never used to authenticate by this work.

### Release gates

1. Select the canonical NexLupa IdP and verify its server-side session API; never trust `identity` claims returned by an unverified browser object, unsigned JWT, headers or raw text.
2. Establish authoritative family membership and revocation policies, and align current prototypes with the real database schema.
3. Prove two independently authenticated accounts cannot read or mutate each other's family data in an end-to-end test using actual restricted database roles.
4. Review role permissions, SECURITY DEFINER function ownership/grants, proof-of-phone consent, message privacy and retention before database migration.
5. Confirm the suspected token has been revoked, then audit historical exposure and run broader secret scanning.
6. Obtain explicit authorization before any Neon role, policy or production change.

Everything above is staged on the isolated GitHub feature branch. No public WhatsApp endpoint, Meta configuration, Neon DDL, production deploy or Resend webhook was modified.
