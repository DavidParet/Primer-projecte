-- NexLupa WhatsApp — read-only preflight against isolated Neon validation branch.
-- Does NOT create, update or delete database objects or rows.
-- Execute on an explicitly selected non-production branch; never silently use default.
SELECT current_database() AS database_name, current_user AS executing_role;
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       has_table_privilege(current_user, c.oid, 'SELECT') AS executing_role_can_select
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
('nex_whatsapp_inbound', 'nex_whatsapp_sender_authorizations')
ORDER BY c.relname;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN
('nex_whatsapp_inbound', 'nex_whatsapp_sender_authorizations')
ORDER BY tablename, indexname;
-- Table owners and ability to bypass tenant policies:
SELECT c.relname AS table_name, owner.rolname AS table_owner,
       owner.rolbypassrls AS owner_can_bypass_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles owner ON owner.oid = c.relowner
WHERE n.nspname = 'public'
  AND c.relname IN ('nex_whatsapp_inbound','nex_whatsapp_sender_authorizations')
ORDER BY c.relname;
-- Explicit table grants and security policies:
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('nex_whatsapp_inbound','nex_whatsapp_sender_authorizations')
ORDER BY table_name,grantee,privilege_type;
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('nex_whatsapp_inbound','nex_whatsapp_sender_authorizations');
SELECT (SELECT count(*) FROM nex_whatsapp_inbound) AS inbound_rows,
       (SELECT count(*) FROM nex_whatsapp_sender_authorizations) AS consent_rows;
-- Pre-pilot failures:
--   RLS is off for both tables until separately enforced and verified.
--   Owner currently has BYPASSRLS: do not use owner for the application connection.
--   The connected owner role typically bypasses RLS; verify restricted app roles separately.
--   Server-side membership checks for family reads have not been implemented.
--   Consent enrollment / number proof is not connected.
--   Purge must run on a scheduled, monitored worker and must be tested.
-- No release until the above checks and real PostgreSQL transaction tests pass.
