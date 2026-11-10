# NexLupa — TTP 239: real infrastructure preflight and launch gate

**Observed 2026-11-09. Current pilot status: BLOCKED.** Read-only inspection of connected GitHub, Neon and Vercel. No migration, role creation, endpoint activation, external message delivery or secret retrieval was performed.

## Confirmed infrastructure (not inferred from the synthetic CI)

| Component | Verified result | Operational meaning |
| --- | --- | --- |
| GitHub default branch | `main` has `api/analyze.js`, but no `api/whatsapp-webhook.js` | The feature WhatsApp route is not deployed by the default branch |
| GitHub WhatsApp branch | `feat/whatsapp-durable-inbox-v1`, PR #7 | Many synthetic tests; existing public route is verify-only/fail-closed |
| Neon | Project `silent-sound-81074119`, PostgreSQL 17 | Existing connected project, originally used for Resend pilot |
| Neon primary branch | `pilot` (`br-cold-pine-b9tm9zun`) | Has `nexlupa_pilot.resend_inbox_queue`; deliberately not modified |
| Neon WhatsApp validation | `whatsapp-schema-validation-20261108` (`br-sweet-truth-b9isiiq4`) | **Both** prototype WhatsApp tables exist, separate from the primary branch |
| `public.nex_whatsapp_inbound` | RLS disabled, FORCE RLS disabled, zero policies | **Not safe for live family access** |
| `public.nex_whatsapp_sender_authorizations` | RLS disabled, FORCE RLS disabled, zero policies | **Not safe for live family access** |
| Owner role | `nexlupa_pilot_owner`, `BYPASSRLS=true` | Must **never** be the live family-facing WhatsApp service login |
| Dedicated runtime role | Expected `nexlupa_whatsapp_ingest` **absent** | Narrow independent ingestion role must be provisioned and verified |
| Canonical membership model | Proposed `public.nex_family_memberships` **absent** | Cannot trust synthetic `nex_ci_family_memberships` as production family authority |
| Vercel | Projects `primer-projecte` and `nexlupa-resend-pilot` exist; latest deployments show READY metadata | Does **not** demonstrate a live WhatsApp integration |

**Read-only catalog gate:** `db/checks/whatsapp-pilot-release-gate-readonly.sql`. Executed against the explicitly selected nonproduction WhatsApp validation branch and returned:

```json
{
  "both_whatsapp_tables_present": true,
  "both_rls_enabled": false,
  "both_force_rls": false,
  "both_have_policies": false,
  "owner_bypass_warning": true,
  "dedicated_runtime_role_exists": false,
  "canonical_membership_table_exists": false,
  "db_prerequisites_met": false
}
```

This SQL deliberately queries PostgreSQL **catalog metadata only**; it never reads phone numbers, messages, tokens, HMAC material, or other personal data. The check is a **proposed schema gate**, not sufficient proof of real credentials, server identity or Meta linkage even if all flags later become true. The proposed role and table names must be reconciled with approved real migrations.

## Decision and implementation sequence

1. **Identity first:** select the authoritative NexLupa server login/session provider, map users to families with real membership state, implement session revocation, and test at least two separately authenticated families.
2. **Least-privilege data boundary:** plan a final Neon schema and dedicated WhatsApp runtime, pairing, revocation and retention roles on an **isolated test branch only**, subject to separate approval. Require `NOBYPASSRLS`, not table owner, and explicit RLS policies. Do not reuse the Resend role.
3. **Signed enrollment proof:** evaluate the experimental TTP 238 short-lived signed pairing protocol and implement actual separated signing-key custody, rotation, replay logs, rate limits and exception handling.
4. **Meta Cloud API:** establish the official WhatsApp Business app, business number and webhook verification. The first pilot is voluntary forwarding to the business number, **not** unrestricted reading of pre-existing school/family group chats.
5. **Durable ingress and privacy:** wire the Meta-signed webhook to an explicitly authorized restricted test DB role, enforce consent/retention/tenant isolation, dedupe, retries, dead letters, and then perform supervised synthetic end-to-end testing.
6. **Release controls:** validate privacy notice, data deletion, parent controls, alerting, key and token hygiene. **Verify rotation/revocation of the previously exposed Vercel-like bearer token**; it was removed from current GitHub branches but may persist in Git history. No live-family-data deployment before explicit approval.

## Tracked action

GitHub issue [#10 — WhatsApp pilot release blockers](https://github.com/DavidParet/Primer-projecte/issues/10) now centralizes the real go/no-go checklist and links to PR #7. Do not close it based only on GitHub Actions passing.

**No production, Neon schema, Vercel deployment, Meta or Resend changes were made by TTP 239.**
