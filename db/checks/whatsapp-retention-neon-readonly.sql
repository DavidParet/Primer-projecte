-- NexLupa WhatsApp TTP 221 — READ ONLY Neon retention-role readiness.
-- Run explicitly on non-primary validation branch only.
-- NO statements in this file create roles, alter policies or touch message rows.
WITH expected AS (
  SELECT 'nexlupa_whatsapp_retention'::text AS role_name
),
role_status AS (
 SELECT e.role_name, r.rolname IS NOT NULL AS exists,
        COALESCE(r.rolsuper,false) AS is_superuser,
        COALESCE(r.rolbypassrls,false) AS bypasses_rls,
        COALESCE(r.rolinherit,false) AS inherits_roles,
        COALESCE(r.rolcanlogin,false) AS can_login
 FROM expected e LEFT JOIN pg_roles r ON r.rolname=e.role_name
),
tables AS (
 SELECT c.relname AS name, c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        pg_get_userbyid(c.relowner) AS owner
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN
 ('nex_whatsapp_inbound','nex_whatsapp_sender_authorizations')
),
policy_status AS (
 SELECT tablename,policyname,cmd,roles,qual,with_check
 FROM pg_policies
 WHERE schemaname='public'
 AND tablename IN ('nex_whatsapp_inbound','nex_whatsapp_sender_authorizations')
)
SELECT 'role' AS category, role_name AS subject,
       CASE WHEN exists AND NOT is_superuser AND NOT bypasses_rls
                 AND NOT inherits_roles
            THEN 'PASS' ELSE 'BLOCKED' END AS status,
       jsonb_build_object('exists',exists,'superuser',is_superuser,
         'bypassrls',bypasses_rls,'inherits_roles',inherits_roles,
         'can_login',can_login) AS details
FROM role_status
UNION ALL
SELECT 'table',name,
       CASE WHEN rls_enabled AND rls_forced THEN 'PASS' ELSE 'BLOCKED' END,
       jsonb_build_object('rls_enabled',rls_enabled,'rls_forced',rls_forced,
          'owner',owner)
FROM tables
UNION ALL
SELECT 'policy',tablename||':'||policyname,'REVIEW',
       jsonb_build_object('command',cmd,'roles',roles,'qual',qual,'with_check',with_check)
FROM policy_status
ORDER BY category,subject;

-- Never infer readiness from a role existing alone: test actual restricted
-- sessions, table grants, policy behavior and production ingestion compatibility.
