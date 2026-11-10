# NexLupa WhatsApp — TTP 243: preview-only Neon Auth login

**Status: code + synthetic CI; NOT activated in Vercel.** The real Neon Auth test branch was created in TTP242, but no user accounts, sign-ins or real family memberships have yet been created.

## Preview architecture

The current NexLupa site is a static HTML/JS app built by `scripts/build-static.js`, with Node.js serverless functions under `api/`. No Next.js conversion is necessary for the pilot.

- `pilot-auth/index.html` and `pilot-auth/script.js`: standalone Catalan sign-in and sign-out interface; no signup, no WhatsApp access, no localStorage token. Not linked from the production app.
- `scripts/build-static.js`: builds those assets **only** if `VERCEL_ENV=preview`, `NEXLUPA_AUTH_PILOT=enabled` and a syntactically valid explicit HTTPS `NEXLUPA_AUTH_PILOT_ORIGIN` ending in `.vercel.app` are supplied. Production builds exclude them even if someone copies pilot variables.
- `api/pilot-auth.js`: Vercel endpoint, **404 by default**. It never accepts an origin on `nexlupa.app`; a preview deployment must supply its exact host and origin. Cross-origin POSTs, forged Host and non-JSON requests are rejected before contacting the provider.
- `lib/whatsapp/pilot-auth-bff.js`: a small backend-for-frontend. It forwards email/password login to the **configured, branch-specific managed Neon Auth HTTPS endpoint**, reads the Better Auth session cookie returned by the provider, and **revalidates the session with Neon Auth** before issuing a host-only `__Host-nexlupa_pilot` cookie. The cookie uses `Secure; HttpOnly; SameSite=Strict; Path=/`, has no Domain attribute and a one-hour maximum age. The provider cookie's exact secure-prefix identity is preserved, but the browser never receives raw provider cookies in JSON.
- Subsequent GET session checks contact Neon Auth again (not cached). POST sign-out attempts remote revocation and clears the local app cookie. A remote sign-out failure is shown as unconfirmed rather than misreported as successful.

The pilot API returns minimal states like `signed_out` or `authenticated` and **never returns provider user details, passwords, tokens or family data**. It does not authorize a WhatsApp operation on the strength of login alone.

## Explicit settings needed for an authorized preview

All of these must be configured only on the **preview deployment**, not in GitHub or a production environment:

| Name | Example or meaning |
|---|---|
| `VERCEL_ENV` | Platform-provided `preview`, not configurable by the page |
| `NEXLUPA_AUTH_PILOT` | Explicit opt-in `enabled` |
| `NEXLUPA_AUTH_PILOT_ORIGIN` | The **exact, verified** `https://<unique-preview>.vercel.app` URL |
| `NEXLUPA_AUTH_BASE_URL` | Base URL of the isolated, already-provisioned Neon Auth test branch ending in `/nexlupa_pilot/auth`, without `/get-session` |

**No environment settings have been installed by TTP243.** The precise preview deployment origin cannot be safely inferred from the repository URL or guessed. Review the actual Vercel preview deployment once build access/rate limits permit. A real HTTPS preview origin must also be whitelisted in the Neon Auth branch's trusted origins before a real sign-in test.

The current Neon test-branch Auth policy has **public signup disabled**, email verification required, no Google OAuth, no organization plugin, localhost disabled and no trusted origins configured. Consequently an arbitrary person cannot self-register a new test account through the page.

## Tests and security boundaries

`tests/whatsapp-pilot-auth-bff.test.js` validates:
- A production or incorrectly configured preview returns 404 without contacting Neon Auth.
- An incorrect Host, wrong Origin or cross-site POST receives 403.
- Email/password handling and a required second server-side session verification.
- Cookies are `__Host`-scoped, `HttpOnly`, `Secure` and `SameSite=Strict`; Better Auth secure cookie prefixes survive proxying; session tokens are not returned in JSON.
- Invalid credentials, missing/expired session responses, provider outages and malformed input are rejected.
- Sign-out attempts remote session revocation and deletes the browser cookie.
- **A production static build omits both login assets**, while a deliberately gated preview build includes them.

Both Node.js and PostgreSQL CI jobs run against synthetic tests only; they do not exercise a real Neon login or an actual Vercel preview.

## Blockers before first real login

1. Confirm a working preview URL and Vercel build quota; review and add the exact preview Origin to **Neon Auth's test branch only**.
2. Provision only deliberately approved test accounts, not fabricated family emails or production credentials. Validate email verification, sign-in, session, remote logout and revocation through a real browser.
3. Put **rate limiting / brute-force mitigation** and incident logs that exclude password, email content, session tokens and raw cookies in place before enabling a password endpoint accessible online.
4. Review the Better Auth provider's real sign-in, `Set-Cookie`, CORS, CSRF and GET session response shapes; the CI currently uses injected synthetic provider responses. The proxy requires a single approved session cookie; if the provider differs, **fail closed** until reviewed, not by broadening cookie acceptance.
5. Migrate the staged canonical users/families/identity-links schema **only on an explicitly approved isolated Neon branch** with reviewed DB roles. TTP243 neither creates users nor links families.
6. Audit that Vercel production still returns 404 for `/api/pilot-auth` and does not publish `/pilot-auth/`. Historical Vercel-like credential revocation/rotation remains unverified.
7. Only after actual independent logins and canonical memberships work should a limited WhatsApp Meta pairing pilot begin.

**No changes to the Neon database during TTP243, Meta subscriptions, the existing Resend webhook, or the NexLupa production site.**
