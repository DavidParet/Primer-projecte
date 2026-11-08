# WhatsApp TTP 222 — RLS integration tests on real prototype tables

The CI test `tests/sql/whatsapp-real-tables-rls-isolation.sql` runs **only** in the disposable GitHub Actions PostgreSQL 17 service after the real WhatsApp schema migration and restricted-retention smoke test.

## Tested properties

- `FORCE ROW LEVEL SECURITY` is applied to both WhatsApp prototype tables in CI.
- Family Alpha and Family Beta use distinct non-superuser, `NOBYPASSRLS` roles and narrow `SELECT` policies on actual `nex_whatsapp_inbound` records.
- Each can see its own unexpired encrypted row, not the other family's row or expired data.
- An unauthorized third role sees no rows.
- Family read roles have no consent-table `SELECT` access and no WhatsApp message `INSERT` or `DELETE` grants.
- The retention role retains its prior expired-only view even after family policies are added.
- The consent table remains policy-default-deny to these roles.

## Non-production design boundary

The per-family PostgreSQL roles and fixed UUID policies are **test fixtures**, NOT a proposal to create one database login per customer. NexLupa still needs a secure authenticated membership service, a way to establish tenant identity that an untrusted client cannot forge, and separate ingestion and revocation privileges. A client-settable `app.family_id` session variable is not an authorization boundary.

The database owner currently has `BYPASSRLS`; never use it for runtime family reads. Real WhatsApp webhook ingestion, consent enrollment, Meta group support, safe service roles, RLS policies, and purge activation are all **not production-ready**. No DDL was applied to Neon.

## Release gate

A later reviewed Neon migration must explicitly define distinct roles and policies for intake, consent-revocation, family reads and retention. Test them together with real PostgreSQL sessions **on a separate Neon testing branch** before any production authorization. Do not silently turn on FORCE RLS on the existing live owner tables; that can break existing writes or mask improper privileged connections.
