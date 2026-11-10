# NexLupa / WhatsApp — Neon access-control review (2026-11-08)

## Verified, read-only in isolated Neon branch
Project: `silent-sound-81074119`; branch: `br-sweet-truth-b9isiiq4` (`whatsapp-schema-validation-20261108`). The primary `pilot` branch was **not modified**.

| Finding | Verified result |
|---|---|
| Tables | `nex_whatsapp_inbound`, `nex_whatsapp_sender_authorizations` |
| Rows | 1 inbound, 2 authorization (not evidence of any real Meta deliveries) |
| RLS enabled | No, both tables |
| RLS policies | None on either table |
| Table owner | `nexlupa_pilot_owner` |
| Owner `BYPASSRLS` | **Yes** |
| Other available role | `nexlupa_resend_ingest`: `BYPASSRLS=false` |
| Grants identified | Only owner in information_schema.role_table_grants for these two tables |
| Key indexes | Inbound (business account, provider ID) UNIQUE; one-active-family partial UNIQUE; expiration; family+time |

## Release blocker: the owner bypasses tenant policies
Do not connect Vercel WhatsApp code to `nexlupa_pilot_owner`. Enabling RLS without changing the connection role is insufficient: the observed owner has `BYPASSRLS`, which bypasses RLS even when FORCE ROW LEVEL SECURITY is applied. Do not reuse `nexlupa_resend_ingest` to grant cross-purpose permissions.

## Proposed minimum-privilege architecture (NOT deployed)
1. Provision a dedicated WhatsApp service role **without** `BYPASSRLS` and without table-owner rights or broad default privileges; separate this from Resend.
2. Use a vetted database function or narrow service layer to resolve active consent and persist encrypted inbound events. Do not expose unrestricted `SELECT` on authorization records to any family-facing role. PostgreSQL identity, tenant context, and authenticated sessions must be established server-side.
3. Restrict family-read APIs to their family's rows; prove cross-family read/write requests fail with a real non-owner role. Do not trust arbitrary `family_id` or custom session parameters submitted by the client.
4. Use independently verified service-admin identity to handle revocation, auditing, privacy deletion and expiration jobs. Keep roles separate; revocation must block concurrent ingestion.
5. Add tests on a disposable branch that exercise service-role grants, revoke/ingest races, retry deduplication, row visibility, deletion, and cross-family isolation.
6. Only after a security review apply migrations and deploy via a protected preview. No runtime secret or phone number should be committed to GitHub.

## Additional blockers
- Number proof, explicit consent enrollment and audit trail are not connected.
- No scheduled monitored purge worker; an `expires_at` column does not remove the rows.
- No Meta-to-Neon live E2E test; webhook remains fail-closed.
- No direct family decryption/read API; test with synthetic content only.
- The GitHub JavaScript tests use mocks, not a Neon database integration test.

**Status:** read-only inspection and architecture recommendation only. This document is *not* a SQL migration, and no role or RLS privileges were changed.
