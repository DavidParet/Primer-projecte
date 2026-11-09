-- TTP246: WhatsApp prototype MUST start with no open tenant reads.
-- Disposable GitHub Actions PostgreSQL 17 ONLY. Never run on Neon.
-- Run directly AFTER the base schema migration, BEFORE any CI policies.
\set ON_ERROR_STOP on
DO $check$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_class c
 WHERE c.oid IN ('public.nex_whatsapp_inbound'::regclass,
                 'public.nex_whatsapp_sender_authorizations'::regclass)
 AND c.relrowsecurity AND c.relforcerowsecurity;
 IF n<>2 THEN RAISE EXCEPTION 'WhatsApp tables do not default to FORCE RLS'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename IN (
    'nex_whatsapp_inbound','nex_whatsapp_sender_authorizations'))
 THEN RAISE EXCEPTION 'Unreviewed table access policy exists at schema creation'; END IF;
END;
$check$;

BEGIN;
CREATE ROLE nex_ci_whatsapp_unlinked NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_whatsapp_unlinked;
GRANT SELECT ON public.nex_whatsapp_inbound,
 public.nex_whatsapp_sender_authorizations TO nex_ci_whatsapp_unlinked;

-- These disposable rows are rolled back at the end of this test.
INSERT INTO public.nex_whatsapp_sender_authorizations(
 business_account_id,phone_number_id,sender_digest,family_id,
 scope,consent_version,consent_at,consent_source
) VALUES(
 '811111111','822222222',decode(repeat('d1',32),'hex'),
 '11111111-1111-4111-8111-111111111111',
 'incoming_text','ci-prototype','2026-11-09T00:00:00Z',
 'synthetic_ci_only'
);
INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,expires_at,nonce,
 authentication_tag,ciphertext
) VALUES(
 '811111111','822222222','wamid.default-deny-ci-only',
 '11111111-1111-4111-8111-111111111111',
 decode(repeat('d1',32),'hex'),'2026-11-09T00:00:00Z',
 '2027-12-09T00:00:00Z',decode(repeat('a1',12),'hex'),
 decode(repeat('b1',16),'hex'),decode('c1','hex')
);
SET ROLE nex_ci_whatsapp_unlinked;
SELECT (
 has_table_privilege(current_user,'public.nex_whatsapp_inbound','SELECT')
 AND has_table_privilege(current_user,
   'public.nex_whatsapp_sender_authorizations','SELECT')
 AND NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound)
 AND NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations)
) AS no_unlinked_rows_visible \gset
\if :no_unlinked_rows_visible
\else
 \echo 'Default-deny WhatsApp schema exposed protected data'
 \quit 1
\endif
RESET ROLE;
ROLLBACK;
DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nex_ci_whatsapp_unlinked')
 THEN RAISE EXCEPTION 'Temporary synthetic role not rolled back'; END IF;
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
  WHERE provider_message_id='wamid.default-deny-ci-only')
 THEN RAISE EXCEPTION 'Synthetic inbox row persisted after rollback'; END IF;
END;
$check$;
SELECT 'TTP246 default-deny WhatsApp schema RLS proven before policy setup' AS result;
