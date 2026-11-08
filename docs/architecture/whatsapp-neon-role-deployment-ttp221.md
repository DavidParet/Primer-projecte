# NexLupa WhatsApp — TTP 221 Neon role deployment plan (not applied)

## Evidence from the isolated Neon validation branch

Project: `nexlupa-resend-pilot`, branch `whatsapp-schema-validation-20261108` (not the `pilot` primary branch). Read-only SQL on 2026-11-08 found:

| Item | Actual state | Release gate |
|---|---|---|
| Dedicated retention role `nexlupa_whatsapp_retention` | ABSENT | BLOCKED |
| `nex_whatsapp_inbound` RLS | OFF | BLOCKED |
| `nex_whatsapp_sender_authorizations` RLS | OFF | BLOCKED |
| Policies for either WhatsApp table | NONE | BLOCKED |
| Active connection `nexlupa_pilot_owner` | table owner, BYPASSRLS | NEVER use as retention runtime |

These findings are **not** a failure of the disposable PostgreSQL CI tests; they are a separate deployment gate.

## Deployment approach

1. On a **dedicated disposable branch** cloned for WhatsApp-only testing, provision a managed, login-capable `nexlupa_whatsapp_retention` role through Neon. Set `NOSUPERUSER NOBYPASSRLS NOINHERIT`; credentials only in a protected secret store.
2. Limit access to `USAGE` on the schema plus `SELECT` and `DELETE` on `public.nex_whatsapp_inbound`. No `INSERT`, `UPDATE`, or authorization-table read; no grants on unrelated Resend tables. Audit inherited role memberships, default privileges, `PUBLIC` grants, and membership in owner roles.
3. Enable and **FORCE** row level security on inbound messages after verifying existing ingestion and revocation flows. For the retention role, permit only `expires_at <= now()` on `SELECT` and `DELETE`, and deny all reads of unexpired rows. Existing separate ingestion, revocation, and family-read policies need explicit review before this change.
4. Validate the retention scheduler's read-only role preflight **as the restricted role**. Run the actual bounded purge on synthetic data only, including two concurrent sessions, rollback, duplicate scheduling, and failure-monitoring tests.
5. Do not use the privileged database owner as the runtime connection. Do not broaden RLS policies to `PUBLIC`, `USING (true)`, or user-settable family GUC without authenticated identity.
6. Review privacy retention duration, operational incident alerting, and key lifecycle before enabling actual daily scheduled cleanup.

### Rollout decision

**No SQL to grant privileges or enable RLS was applied to Neon in TTP 221.** The next change requiring Neon role creation and DDL should be separately authorized after this review. The Resend project and main branch must remain unchanged.

For reproducible catalog inspection, use `db/checks/whatsapp-retention-neon-readonly.sql`; do not run it against the primary branch by default.
