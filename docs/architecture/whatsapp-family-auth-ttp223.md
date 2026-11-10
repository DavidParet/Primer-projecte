# NexLupa — TTP 223: authenticated family membership boundary

## Added to PR #7

`lib/whatsapp/family-authorization.js` exports `createFamilyAuthorizer`. It is a server-only adapter for the existing consent-revocation callback and future enrollment/message-read services.

The adapter requires **two independently trusted server dependencies**:

- `getAuthenticatedSession()` reads the verified session directly from the server's authentication system. The request body cannot supply or overwrite the user ID, role or authenticated flag.
- `getMembership({ userId, familyId })` checks **current** membership in a trusted backing store, returning matching user/family IDs, an active state and an allowed role. Values from WhatsApp message text, the client or URL are not authoritative.

The check fails closed for missing sessions, expired/revoked memberships, forged tenant IDs, unknown actions, and inactive members. Only a family owner or administrator may enroll a WhatsApp sender or revoke consent. A member may be allowed to read only once a separate tenant-isolated message API has been implemented.

## Required next integration

1. Choose and verify NexLupa's actual identity provider and server session API, rather than trusting client-supplied `userId` or `familyId`.
2. Determine the authoritative `families` / `family_memberships` data model. No such production schema is assumed by this module.
3. Implement a trusted membership lookup and transaction-safety strategy (membership revocation between check and mutation), with appropriate DB grants and tenant RLS.
4. Inject the adapter into `createConsentRevoker({ authorizeFamily })` and future enrollment code within an authenticated server route.
5. Run end-to-end tests with two accounts, two distinct families, concurrent membership revocation, tenant isolation, and actual role restricted database sessions.
6. Review privacy notices, number proof and consent enrollment before any Meta webhook activation.

**No login provider, public HTTP route, credentials, new database schema, Neon role, or live WhatsApp message handling was enabled by TTP 223.**
