# NexLupa — TTP 228: eliminate direct membership-update grants

## What changed in the isolated WhatsApp PR

The earlier TTP 227 test required a restricted revocation service role to have `UPDATE(updated_at)` on membership records merely to execute PostgreSQL `SELECT ... FOR SHARE`. That gave the runtime an unwanted metadata mutation capability.

TTP 228 stages a safer **database function boundary**, tested only in disposable PostgreSQL:

- `lib/whatsapp/transactional-family-authorization.js` now calls `public.nex_authorize_family_locked(user_id,family_id,action)` using bound parameters on the **same transaction client** as the subsequent consent revocation.
- `tests/sql/whatsapp-locked-membership-function-smoke.sql` revokes all direct membership `SELECT` and `UPDATE` grants from the test revocation runtime. It verifies actual `has_table_privilege` / `has_column_privilege` checks and rejects an attempted direct membership update.
- A **separate non-login, non-superuser, non-BYPASSRLS function owner** has precisely the SQL permissions needed to lock a membership row. A `SECURITY DEFINER` function with a fixed search path and fully qualified membership relation checks current member status and role and returns **only a boolean**.
- `EXECUTE` is explicitly revoked from `PUBLIC` and granted to the revocation backend role. A separate unauthorized role is tested and denied.
- The role-locked membership check and consent modification must execute inside one PostgreSQL transaction; row locks release only on commit or rollback.

## Important boundaries (NOT production-ready)

The function's `user_id` argument is **not proof of authentication**. Only a trusted server-side identity provider and tightly held database credentials can assert user identity. The function is deliberately **not exposed** to browsers or untrusted API clients. If the service role can be used by an attacker, this helper alone does not stop them from selecting another user ID.

The function owner still requires narrow `UPDATE(updated_at)` privileges to obtain PostgreSQL row locks. The improvement is that the application runtime no longer has them. A future production function review must examine definer ownership, immutable schema/search path, grants, membership-update coordination, logging and audit, race behavior, privilege escalation, SQL injection and identity verification.

**Nothing in this task creates the function or roles on Neon.** The concrete role, RLS policies, canonical family schema and real identity service remain unapproved. The earlier potentially exposed Vercel token also requires a separate human-confirmed rotation/revocation review before production launch.

## Follow-up release gates

1. Verify the true `families` / `family_memberships` schema and session authority.
2. Review the SECURITY DEFINER function against production role grants and any row-level policies; remove all unused privilege from caller.
3. Test safe identity binding and actual concurrent membership revocation with two independently authenticated accounts.
4. Perform explicit permission review before applying any schema or role modification to a dedicated Neon test branch.
5. Keep the WhatsApp ingestion endpoint and retention schedule inactive until the end-to-end system has passed privacy and security review.
