# NexLupa — TTP 242: isolated Neon Auth pilot provisioning

Date: 2026-11-09. **An actual Neon Auth instance was provisioned on a separate test branch. No NexLupa production sign-in was activated.**

## Confirmed live account state (read-only inventory + restricted test-branch setup)

- Neon project: `silent-sound-81074119` (NexLupa Resend pilot infrastructure).
- **NEW isolated branch:** `whatsapp-auth-pilot-validation-20261109`, ID `br-patient-bar-b998nff9`, forked from the earlier WhatsApp schema-validation branch `br-sweet-truth-b9isiiq4`. The default `pilot` branch was **not changed**.
- Neon Auth provisioned with provider `better_auth` on the new branch, using `nexlupa_pilot` database. The resulting **branch-specific** Auth base URL has the form `https://<branch-host>.neonauth.<region>.aws.neon.tech/nexlupa_pilot/auth`; Neon returned a dedicated JWKS address. The full hostname is intentionally omitted from the public repository.
- Configured test-branch safety: email/password enabled but **public signup disabled**, email verification required, verification emails on sign-in/sign-up, session revocation on password reset.
- **Disabled** localhost origins and the separate Neon Auth organization plugin, because NexLupa has its own independent family membership model. Removed the test branch's default shared Google OAuth login.
- Trusted origins remain **empty**, magic-link and SMS sign-in disabled, Neon Auth webhook disabled. Do not whitelist a production hostname until the login/proxy implementation and origin policy have been reviewed.
- Read-only aggregate count immediately after provisioning: **0 Auth users, 0 sessions, 0 canonical `public.nex_family_memberships` tables** on the new branch. This means the canonical identity migration is still only staged in GitHub/CI, and no two real family accounts have been authenticated. The prior WhatsApp inbound/authorization prototype tables remain present from the parent branch.
- The branch is a **real Neon test resource**, not just a local mock. Its compute may incur Neon resource usage; monitor in the project dashboard. No branch deletion is scheduled.

## Important correction to TTP 241

The earlier TTP241 session verifier supported a generic Better Auth `/api/auth/get-session` URL, but the **actual managed Neon Auth base URL** returned by provisioning ends in `/<database>/auth`. The new code accepts the exact branch base URL and derives `/<database>/auth/get-session?disableCookieCache=true`, while keeping existing self-hosted Better Auth testing compatibility.

For a managed URL, it also requires the configured IdP issuer to match the **entire branch auth base URL**, not merely its origin, to avoid confusing two database paths. Tests cover this routing with a synthetic HTTPS responder.

Official references:
- https://neon.com/blog/handling-auth-in-a-staging-environment
- https://github.com/neondatabase/neon-js/blob/main/packages/auth/README.md
- https://better-auth.com/docs/concepts/session-management

## Why real two-family login is not verified yet

The production website uses static JavaScript and Vercel serverless functions. It has no dedicated Neon Auth callback/login screen and no origin-reviewed auth proxy. A browser cannot safely share Neon-hosted HttpOnly session cookies with `app.nexlupa.app` merely because the two services exchange JSON; use the official Neon Auth client and a reviewed same-site/proxy design or verified bearer-token method.

A real login pilot additionally requires **explicitly authorized test users and verified email accounts**. Do not fabricate addresses, generate real family accounts without permission, or place passwords/tokens in GitHub. Canonical family memberships and restricted Neon database roles still need a reviewed and branch-scoped migration.

## Next executable steps

1. Implement and test the preview-only login/callback integration using an official supported Neon Auth client for static Vercel or a reviewed backend-for-frontend. Bind to the exact new test-branch Auth base URL, not the default branch.
2. Design CSRF/origin protections, secure cookie scope, session revocation and error handling. Keep the public WhatsApp webhook disabled.
3. Review and adapt the canonical family schema/role migrations for this explicit test branch; verify RLS and provider identity links under restricted credentials.
4. With authorized test accounts, validate two genuinely independent signed-in users and their family memberships before any WhatsApp sender pairing.
5. Confirm the historical potentially exposed Vercel access token is revoked/rotated. A Git tree cleanup is **not** proof of revocation.
6. Only then consider a Meta Cloud API test app/phone and supervised end-to-end forwarding/consent workflow.

**Safety:** No real user data, passwords or live messages were created, read or sent. No default Neon branch, production Vercel environment, Meta webhook or Resend setting was modified.
