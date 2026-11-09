# WhatsApp — TTP 231: two-family integration contract

## Scope and evidence

The PR now includes two complementary automated security test suites:

1. `tests/whatsapp-two-family-authenticated-flow.test.js` exercises a **simulated** verified-server-session adapter and request-bound WhatsApp consent revoker for two separate synthetic administrators and one ordinary family member. This verifies that user-supplied `actor`, `sessionId`, `userId`, or `familyId` cannot replace the server-resolved account; the wrong administrator or ordinary member cannot revoke another family's consent; and a successful family A revocation leaves B's state untouched.
2. `tests/sql/whatsapp-two-family-authorized-revocation.sql` uses actual disposable PostgreSQL 17 sessions, tables, grants, policies, and the locked-membership `SECURITY DEFINER` function. Both families see only their own unexpired message in family-read roles, neither can directly revoke consent, and the synthetic service can independently perform family A and family B revocations after an explicit locked membership check in each transaction. The SQL test confirms an A revocation does not delete B's message or revoke B's consent.

Both tests are triggered by the existing WhatsApp GitHub Actions CI. All identities, phones, message payloads and authorization entries in the tests are fictitious.

## Critical security boundary

**This is NOT yet production end-to-end authentication.** The JavaScript IdP verifier is a test double, not a connected NexLupa identity provider. The SQL flow uses an explicitly selected synthetic user ID and `SET ROLE` under CI's privileged connection, not a server-bound cryptographic account assertion.

The current prototype revocation runtime still has broad SQL UPDATE/DELETE privileges on WhatsApp rows and can pass an arbitrary `user_id` to `nex_authorize_family_locked` if the runtime itself is compromised. Safe application-level checks have passed tests, but the underlying database does not yet cryptographically enforce which user is speaking. Production must harden the service permission boundary (for example, a narrowly reviewed transactional, identity-bound service operation and independent audit) and test compromise scenarios.

There is no authoritative production family membership table or real IdP integration selected. The Meta webhook is not enabled; no Neon permissions/schema were modified; Resend production remains unchanged.

## Remaining gates

- Select and integrate a real server-side identity provider and authoritative family membership schema.
- Verify session signatures/server cookies, issuer/audience, rotation, revocation and exact per-request trusted session context.
- Verify actual restricted DB credentials and remove unnecessary broad direct consent/message mutation grants.
- Run equivalent two-family tests on a separately authorized disposable Neon branch with nonpersonal fixtures before any live changes.
- Resolve the possible exposed historical Vercel token independently, including revocation/rotation and repository history review.
