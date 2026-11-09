-- NexLupa TTP239: read-only go/no-go check for the proposed WhatsApp
-- pilot schema. No private rows, phone numbers, secrets or tokens are read.
-- Run on an explicitly selected NON-PRODUCTION Neon branch, NEVER silently
-- rely on the default branch. This is a database-only gate, NOT full go-live.
--
-- The proposed production runtime role/table names below are intentionally
-- not the disposable "nex_ci_*" test fixtures. Changing names requires
-- reviewing the actual approved Neon migration and the gate together.
WITH required_tables(table_name) AS (
  VALUES ('nex_whatsapp_inbound'::text),
         ('nex_whatsapp_sender_authorizations'::text)
),
flags AS (
 SELECT r.table_name,
        c.oid AS table_oid,
        COALESCE(c.relrowsecurity,false) AS rls_enabled,
        COALESCE(c.relforcerowsecurity,false) AS rls_forced,
        COALESCE(owner.rolbypassrls,false) AS owner_can_bypass_rls,
        COALESCE((
          SELECT count(*) FROM pg_policies p
          WHERE p.schemaname='public' AND p.tablename=r.table_name
        ),0) AS policy_count
 FROM required_tables AS r
 LEFT JOIN pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid
  AND c.relname=r.table_name AND c.relkind='r'
 LEFT JOIN pg_roles owner ON owner.oid=c.relowner
),
rollup AS (
 SELECT count(*) FILTER (WHERE table_oid IS NOT NULL) AS present_count,
        bool_and(rls_enabled) AS all_rls_enabled,
        bool_and(rls_forced) AS all_rls_forced,
        bool_and(policy_count>0) AS all_have_policies,
        bool_or(owner_can_bypass_rls) AS any_owner_can_bypass
 FROM flags
),
role_checks AS (
 SELECT
  EXISTS(
   SELECT 1 FROM pg_roles
   WHERE rolname='nexlupa_whatsapp_ingest'
     AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
  ) AS dedicated_runtime_role_exists,
  to_regclass('public.nex_family_memberships') IS NOT NULL
    AS canonical_membership_table_exists
)
SELECT
  r.present_count=2 AS both_whatsapp_tables_present,
  r.all_rls_enabled AS both_rls_enabled,
  r.all_rls_forced AS both_force_rls,
  r.all_have_policies AS both_have_policies,
  r.any_owner_can_bypass AS owner_bypass_warning,
  c.dedicated_runtime_role_exists,
  c.canonical_membership_table_exists,
  (
   r.present_count=2 AND
   r.all_rls_enabled AND r.all_rls_forced AND r.all_have_policies AND
   c.dedicated_runtime_role_exists AND
   c.canonical_membership_table_exists
  ) AS db_prerequisites_met
FROM rollup AS r CROSS JOIN role_checks AS c;
