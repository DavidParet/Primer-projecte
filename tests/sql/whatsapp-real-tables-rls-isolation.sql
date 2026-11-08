-- NexLupa WhatsApp TTP 222: real WhatsApp tables, disposable PostgreSQL 17 ONLY.
-- Requires prototype schema and earlier CI smoke tests. NEVER run on Neon.
\set ON_ERROR_STOP on

-- Test-only roles representing separately verified family identities.
-- These are not the production family-authorization model.
CREATE ROLE whatsapp_ci_family_alpha NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE whatsapp_ci_family_beta NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE whatsapp_ci_unauthorized NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;

GRANT USAGE ON SCHEMA public TO
  whatsapp_ci_family_alpha, whatsapp_ci_family_beta, whatsapp_ci_unauthorized;
GRANT SELECT ON public.nex_whatsapp_inbound TO
  whatsapp_ci_family_alpha, whatsapp_ci_family_beta, whatsapp_ci_unauthorized;

ALTER TABLE public.nex_whatsapp_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_inbound FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_sender_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_sender_authorizations FORCE ROW LEVEL SECURITY;

-- Fixed role/family mappings are deliberately test-only. Never use a client-
-- supplied family_id or a mutable session GUC as proof of membership.
CREATE POLICY whatsapp_ci_alpha_read ON public.nex_whatsapp_inbound
  FOR SELECT TO whatsapp_ci_family_alpha
  USING (family_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND expires_at > NOW());
CREATE POLICY whatsapp_ci_beta_read ON public.nex_whatsapp_inbound
  FOR SELECT TO whatsapp_ci_family_beta
  USING (family_id = '22222222-2222-4222-8222-222222222222'::uuid
    AND expires_at > NOW());

-- The maintenance role created by the preceding smoke test already has
-- expired-only policies; check that adding family policies does not expand them.
INSERT INTO public.nex_whatsapp_inbound (
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at
)
SELECT '555555555','777777777','wamid.tenant-ci-'||i,
  CASE WHEN i=1 THEN '11111111-1111-4111-8111-111111111111'::uuid
       ELSE '22222222-2222-4222-8222-222222222222'::uuid END,
  decode(repeat('ab',32),'hex'),now(),decode(repeat('01',12),'hex'),
  decode(repeat('02',16),'hex'),decode('03','hex'),
  CASE WHEN i=3 THEN now()-interval '1 day' ELSE now()+interval '1 day' END
FROM generate_series(1,3) AS i;

SET ROLE whatsapp_ci_family_alpha;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.nex_whatsapp_inbound
 WHERE provider_message_id LIKE 'wamid.tenant-ci-%';
 IF n <> 1 THEN RAISE EXCEPTION 'Alpha expected 1 unexpired row, found %',n; END IF;
 IF EXISTS (SELECT 1 FROM public.nex_whatsapp_inbound WHERE
  provider_message_id='wamid.tenant-ci-2') THEN
  RAISE EXCEPTION 'Alpha can read beta'; END IF;
 IF has_table_privilege(current_user,'public.nex_whatsapp_inbound','DELETE')
    OR has_table_privilege(current_user,'public.nex_whatsapp_inbound','INSERT')
    OR has_table_privilege(current_user,'public.nex_whatsapp_sender_authorizations','SELECT')
 THEN RAISE EXCEPTION 'Alpha has excessive privileges'; END IF;
END $$;
RESET ROLE;

SET ROLE whatsapp_ci_family_beta;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.nex_whatsapp_inbound
 WHERE provider_message_id LIKE 'wamid.tenant-ci-%';
 IF n <> 1 THEN RAISE EXCEPTION 'Beta expected 1 unexpired row, found %',n; END IF;
 IF EXISTS (SELECT 1 FROM public.nex_whatsapp_inbound WHERE
  provider_message_id='wamid.tenant-ci-1') THEN
  RAISE EXCEPTION 'Beta can read alpha'; END IF;
END $$;
RESET ROLE;

SET ROLE whatsapp_ci_unauthorized;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.nex_whatsapp_inbound WHERE
  provider_message_id LIKE 'wamid.tenant-ci-%') THEN
  RAISE EXCEPTION 'Unlinked role can read messages'; END IF;
END $$;
RESET ROLE;

SET ROLE nexlupa_whatsapp_retention;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.nex_whatsapp_inbound
 WHERE provider_message_id LIKE 'wamid.tenant-ci-%';
 IF n <> 1 THEN RAISE EXCEPTION 'Retention must see only expired row, saw %',n; END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
 AND tablename='nex_whatsapp_sender_authorizations') <> 0 THEN
 RAISE EXCEPTION 'Test expected consent table default-deny'; END IF;
 IF NOT (SELECT relforcerowsecurity FROM pg_class
 WHERE oid='public.nex_whatsapp_sender_authorizations'::regclass) THEN
 RAISE EXCEPTION 'Consent FORCE RLS not enabled'; END IF;
END $$;
SELECT 'real WhatsApp table cross-family RLS negative tests passed' AS result;
