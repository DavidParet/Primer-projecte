# NexLupa — TTP 241: server-side Neon Auth session validation for static Vercel app
Date: 2026-11-09. Development: PR #7 only. **Not live.**

## Decision: use managed Neon Auth for the pilot (pending provision/approval)

NexLupa currently uses a **static HTML/JavaScript frontend** and Vercel `api/*.js` functions. It is not a Next.js App Router application. Therefore, adding `@neondatabase/auth/next` routes is not appropriate without a larger framework migration.

Neon Auth is a plausible identity provider because it stores Better Auth user/session data in an isolated Neon branch, offers managed sign-in, and exposes server-verified cookie sessions. Official documentation:
- Neon Auth architecture: https://neon.com/blog/neon-auth-branchable-identity-in-your-database
- Better Auth server-side sessions: https://better-auth.com/docs/concepts/session-management
- Better Auth `getSession` and server APIs: https://better-auth.com/docs/basic-usage
- Official Neon framework adapter guidance: https://github.com/neondatabase/neon-js/blob/main/packages/auth/BUILDING-AN-ADAPTER.md

## New actual server-to-provider integration code

`lib/whatsapp/neon-auth-server-session.js` includes:
- `createNeonAuthSessionVerifier`: calls a **fixed server-configured HTTPS** `/api/auth/get-session?disableCookieCache=true` URL. It forwards **only one explicitly allowlisted Better Auth session cookie**, not arbitrary request headers or a browser-provided user ID. It sets `cache: no-store`, disables redirects and never returns provider session tokens to the caller.
- It validates the provider's server-side response: HTTP status/content type, bounded JSON, exact session-to-user link, opaque user/session IDs, issued/expiry timestamps and non-expiration. It rejects missing, expired or malformed sessions; provider failures are not converted into anonymous-but-authorized access.
- `createNeonAuthFamilyBinderFactory`: composes that verified provider response with the TTP240 internal `(issuer,subject)` → stable NexLupa user mapping and the canonical active-family membership function. The per-request binder revalidates the provider on subsequent authorization checks; a different browser-supplied `actor`, `familyId` or `x-user-id` never becomes trusted identity.
- No login passwords, tokens, session cookies or phone numbers are persisted or printed by the module.

This performs real *server-side session introspection* when pointed at a properly configured, reachable Neon Auth service. **However, TTP241's automated tests inject a synthetic HTTP responder:** they are not proof of a live Neon Auth connection.

## Important architecture limitations before using this code

1. Neon Auth has **NOT been provisioned or activated** in the connected NexLupa pilot Neon branch by this work. No auth configuration, DNS, Vercel variables or production login routes have been modified.
2. The frontend currently has no actual sign-in/sign-up or callback UI. The browser must receive a secure, `HttpOnly`, `Secure`, `SameSite` session cookie scoped to the correct NexLupa host through a **reviewed auth proxy** or same-site arrangement. An auth server on a foreign host may be blocked by third-party cookie restrictions.
3. The literal approved cookie name may depend on the Neon Auth server's deployment and secure-cookie settings. The adapter accepts an explicit allowlist. **Never** accept arbitrary cookie names or use request headers to claim user identity.
4. This is a Better Auth session-introspection model, **not JWT verification locally**. The HTTPS auth service is responsible for validating and revoking the opaque session cookie. The configured `audience` value is an *application policy label*, not an independently verified JWT `aud` claim. The app server must validate provider configuration and trusted host, and use uncached session reads for high-risk operations.
5. A valid session alone is not enough to create families, edit memberships, or enroll WhatsApp senders. The user still needs an existing **trusted canonical IdP identity link and active family membership**. No automatic `INSERT` mapping or unsafe self-registration fallback has been added.
6. The TTP240 identity migration has been staged and tested only on disposable PostgreSQL, **not on Neon**. The exact restricted Neon roles, function ownership, RLS and true credentials need approval and tests on a dedicated branch.
7. A public pairing action needs verified CSRF/origin protection, bounded rate limits, explicit consent, secure cookie configuration, auditing and a validated signer-side identity. This module is internal and opens **no public HTTP endpoint**.

## Next release-critical work — TTP242

- Provision Neon Auth on an **explicitly approved non-production branch** with restricted sign-up and secure cookie/origin policy, verifying the exact endpoint, cookie name and session shape rather than guessing.
- Implement auth callback/session route and login interface using an official managed provider or reviewed proxy integration.
- Prepare identity/family onboarding and connect the staged canonical schema under reviewed Neon roles.
- Run a real two-account end-to-end session test with isolated credentials, then connect explicit WhatsApp consent and Meta's official webhook.
- Separately verify revocation/rotation of the previously potentially exposed Vercel credential; removing it from Git's current tree does not invalidate historical tokens.

**No real Neon auth session, family, WhatsApp message or end-user data was processed in TTP241.**
