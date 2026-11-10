# NexLupa — TTP 239: actual hosting inventory and pilot activation gates
Date of read-only inspection: **2026-11-09**

This is an operational inventory of **observed** settings and a fail-closed preflight, not proof that the WhatsApp Cloud API pilot is live. Read-only inspection performed against the connected GitHub, Neon and Vercel accounts; no database rows, credentials or configuration values were collected.

## Confirmed platform inventory (as observed)

### GitHub
- Source repository: `DavidParet/Primer-projecte`, **public**.
- Primary working branch: `feat/whatsapp-durable-inbox-v1`, review via PR #7.
- Existing public code route: `api/whatsapp-webhook.js`. Its only supported states are `disabled` (default) and `verify-only`. It deliberately **never** acknowledges real WhatsApp POST delivery as successfully stored; a signed POST still receives 503.
- The internal durable delivery bridge and signed pairing/consent code are staged separately under `lib/whatsapp`, **not wired to the public route**.
- The deployed static front-end is not equipped with a verified family login/session integration. Existing `api/analyze.js` is a text/image analysis endpoint using the OpenAI API, not an identity service.
- A prior potentially sensitive local Vercel credential configuration file has been removed from currently tracked default/feature branch content and ignored. **Historical Git revisions may still contain it; token revocation and history review remain outstanding.**

### Neon
- Observed project: `nexlupa-resend-pilot`, PostgreSQL 17.
- Current default branch `pilot`: only `nexlupa_pilot.resend_inbox_queue` was visible in the table inventory.
- Separate existing branch `whatsapp-schema-validation-20261108`: prototype `public.nex_whatsapp_inbound` and `public.nex_whatsapp_sender_authorizations` exist, as well as the pilot email queue. **It is not the default branch and is not a completed consent/pairing production migration**.
- An additional branch `resend-worker-consent-validation-20261108` exists for earlier validation activity.
- Neon Auth was reported as **not enabled** for the default branch. This does not prove that no other IdP exists elsewhere; no server-side provider was demonstrated in the inspected application.
- No database migration or new Neon branch was created during TTP239.

### Vercel
- App `primer-projecte` is the public NexLupa frontend. The inventory of defined environment variable **names**, without retrieving values, showed `OPENAI_API_KEY`; no Meta app secret, WABA, WhatsApp phone, or dedicated WhatsApp restricted connection variable was listed.
- Separate `nexlupa-resend-pilot` project has its own Resend webhook, encryption key, database and recipient variables. It is a **mail pilot**, not a verified WhatsApp configuration.
- Separate `nexlupa-worker-validation` project has database worker/RPC-related variables. This should not be confused with an approved WhatsApp sender or authenticated family membership service.
- Production domains attached to the frontend include `app.nexlupa.app`, `www.nexlupa.app`, `nexlupa.app`. A valid domain by itself proves neither WhatsApp Meta subscription nor webhook readiness.
- The PR preview's previously reported rate/build limit is not resolved by this code. CI tests are separate from a Vercel preview deployment.

## New read-only preflight

The new `lib/whatsapp/pilot-preflight.js` audits the names of required server configuration inputs. The CLI `scripts/whatsapp-pilot-preflight.js` prints only configuration **names**, their presence/absence, and the remaining independent verification tasks. It **never prints secrets** or attempts network/database access.

It recognizes `WHATSAPP_WEBHOOK_MODE=disabled` (default) and `verify-only`. Other values are deemed invalid and fail CI. **Even if every environment variable is present, the preflight can never claim real traffic is approved.** Actual cryptographic verification, account ownership, roles, privacy, migration and end-to-end delivery must be checked externally and approved separately.

Required configuration name groups:
- Meta webhook verification and app credentials: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
- Official Meta routing identity: `WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID`
- Dedicated least-privilege database and sender/pairing secrets: `WHATSAPP_DATABASE_URL`, `WHATSAPP_SENDER_HMAC_KEY`, `WHATSAPP_PAIRING_HMAC_KEY`
- Separate approved signed-operation keys: `WHATSAPP_ISSUE_SIGNING_KEY`, `WHATSAPP_CONFIRM_SIGNING_KEY`

These names are a **proposed interface for the future runtime**. Their mere presence does not create an implementation or a secure key store, and some may need replacing with an authenticated secret-manager lookup before deployment. Production passwords or access tokens must not be pasted into chat or committed.

## Prioritized path to a small real-world pilot

1. **IdP and families first:** implement authoritative login/session verification and family membership administration, using provider-issued session integrity rather than untrusted request fields.
2. **Neon permissions:** review/prepare an isolated and explicitly authorized pilot schema/role migration from the already staged prototypes. Pairing/consent access must use separately restricted SQL roles and signed server assertions.
3. **Meta credentials and WhatsApp business number:** confirm the business owns the official Meta app, WABA, phone number, appropriate access rights and subscribed messaging webhook. Prepare verify token/app secret securely. No code here registers a Meta app automatically.
4. **Server flow:** wire verified pairing command processing and durable encrypted message storage to an enabled server route **only after** stable idempotency, finite retry/quarantine handling, sender opt-in, revocation and deletion controls.
5. **Pilot test:** two independently authenticated families, real Meta-signed sample deliveries, unknown sender, wrong-family attempt, duplicates, revoked consent, database outage, sign-key rotation, alerting and retention review.
6. **Credentials and privacy:** confirm the previously exposed Vercel token is revoked/rotated; complete a clear data protection/parental consent/legal review.

## Safety state

No WhatsApp webhook was switched to live, no Meta application was connected, no new Neon table/role created, no existing data was modified, no Vercel environment variables were set, no Resend webhook was changed, and no production deployment was performed during this milestone.

The next work should prioritize a **genuine server-side identity provider and schema alignment**, not adding unlimited isolated prototypes that do not yet run in the app.
