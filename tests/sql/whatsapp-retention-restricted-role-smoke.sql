-- NEVER run on Neon or live systems. Disposable GitHub Actions postgres:17 only.
-- Execute after prototype schema migration and existing synthetic SQL tests.
\set ON_ERROR_STOP on
CREATE ROLE nexlupa_whatsapp_retention NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nexlupa_whatsapp_retention;
GRANT SELECT, DELETE ON public.nex_whatsapp_inbound TO nexlupa_whatsapp_retention;

ALTER TABLE public.nex_whatsapp_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_inbound FORCE ROW LEVEL SECURITY;
CREATE POLICY nexlupa_ci_retention_select ON public.nex_whatsapp_inbound
  FOR SELECT TO nexlupa_whatsapp_retention USING (expires_at <= NOW());
CREATE POLICY nexlupa_ci_retention_delete ON public.nex_whatsapp_inbound
  FOR DELETE TO nexlupa_whatsapp_retention USING (expires_at <= NOW());

INSERT INTO public.nex_whatsapp_inbound (
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at
)
SELECT '777777777','888888888','wamid.role-ci-'||i,
'11111111-1111-4111-8111-111111111111',decode(repeat('ab',32),'hex'),
NOW(),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
decode('03','hex'),
CASE WHEN i=3 THEN NOW()+interval '1 day' ELSE NOW()-interval '1 day' END
FROM generate_series(1,3) i;

SET ROLE nexlupa_whatsapp_retention;
DO $$
DECLARE n integer;
BEGIN
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Maintenance role bypasses RLS';
  END IF;
  IF has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'INSERT')
     OR has_table_privilege(current_user, 'public.nex_whatsapp_inbound', 'UPDATE')
     OR has_table_privilege(current_user, 'public.nex_whatsapp_sender_authorizations','SELECT')
     OR NOT has_table_privilege(current_user, 'public.nex_whatsapp_inbound','SELECT')
     OR NOT has_table_privilege(current_user, 'public.nex_whatsapp_inbound','DELETE')
  THEN RAISE EXCEPTION 'Maintenance grants incorrect'; END IF;
  SELECT COUNT(*) INTO n FROM public.nex_whatsapp_inbound
   WHERE provider_message_id LIKE 'wamid.role-ci-%';
  IF n <> 2 THEN RAISE EXCEPTION 'Maintenance role sees unexpected rows: %',n; END IF;
END $$;

WITH expired AS (
 SELECT inbound_id FROM public.nex_whatsapp_inbound
 WHERE expires_at <= NOW()
 ORDER BY expires_at,inbound_id
 LIMIT 1
)
DELETE FROM public.nex_whatsapp_inbound AS inbox
USING expired
WHERE inbox.inbound_id = expired.inbound_id;

DO $$
DECLARE n integer;
BEGIN
 SELECT COUNT(*) INTO n FROM public.nex_whatsapp_inbound
 WHERE provider_message_id LIKE 'wamid.role-ci-%';
 IF n <> 1 THEN RAISE EXCEPTION 'Bounded delete expected 1 expired row, saw %',n; END IF;
END $$;

WITH expired AS (
 SELECT inbound_id FROM public.nex_whatsapp_inbound
 WHERE expires_at <= NOW()
 ORDER BY expires_at,inbound_id
 LIMIT 5
)
DELETE FROM public.nex_whatsapp_inbound AS inbox
USING expired
WHERE inbox.inbound_id = expired.inbound_id;

RESET ROLE;
DO $$
DECLARE n integer;
BEGIN
 SELECT COUNT(*) INTO n FROM public.nex_whatsapp_inbound
 WHERE provider_message_id LIKE 'wamid.role-ci-%';
 IF n <> 1 THEN RAISE EXCEPTION 'Expected only one live row, saw %',n; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.nex_whatsapp_inbound
 WHERE provider_message_id='wamid.role-ci-3')
 THEN RAISE EXCEPTION 'Maintenance role deleted active row'; END IF;
END $$;
SELECT 'restricted retention role + RLS passed on disposable postgres' AS result;
