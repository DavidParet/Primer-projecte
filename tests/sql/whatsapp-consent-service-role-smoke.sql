-- NexLupa WhatsApp TTP 227 — disposable PostgreSQL 17 only.
-- Deliberately synthetic service grants and RLS; NEVER apply to Neon.
-- Pre-requisite: earlier CI migrations, family RLS, synthetic memberships.
\set ON_ERROR_STOP on

CREATE ROLE nex_ci_consent_revoker
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_consent_revoker;

-- FOR SHARE on membership rows requires UPDATE privilege on at least one
-- referenced table column in PostgreSQL. Grant ONLY updated_at, while RLS
-- remains default-deny for actual UPDATE operations.
GRANT SELECT, UPDATE (updated_at) ON public.nex_ci_family_memberships
  TO nex_ci_consent_revoker;
CREATE POLICY nex_ci_consent_member_read
  ON public.nex_ci_family_memberships FOR SELECT
  TO nex_ci_consent_revoker USING (status = 'active' AND revoked_at IS NULL);
-- SELECT FOR SHARE also consults UPDATE RLS. A narrowly granted updated_at
-- column is still mutable: this is a test-only privilege tradeoff, NOT an
-- approved production security model.
CREATE POLICY nex_ci_consent_member_row_lock
  ON public.nex_ci_family_memberships FOR UPDATE
  TO nex_ci_consent_revoker
  USING (status = 'active' AND revoked_at IS NULL)
  WITH CHECK (status = 'active' AND revoked_at IS NULL);

GRANT SELECT, UPDATE (revoked_at)
  ON public.nex_whatsapp_sender_authorizations TO nex_ci_consent_revoker;
GRANT SELECT, DELETE ON public.nex_whatsapp_inbound
  TO nex_ci_consent_revoker;

-- These policies are service-scoped, NOT per-family authorization.
-- The real server MUST recheck current verified membership in the very same
-- transaction and restrict WHERE by the exact authorization/sender digest.
CREATE POLICY nex_ci_revoker_consent_select
 ON public.nex_whatsapp_sender_authorizations FOR SELECT
 TO nex_ci_consent_revoker USING (
    scope = 'incoming_text'
 );
CREATE POLICY nex_ci_revoker_consent_update
 ON public.nex_whatsapp_sender_authorizations FOR UPDATE
 TO nex_ci_consent_revoker
 USING (scope = 'incoming_text' AND revoked_at IS NULL)
 WITH CHECK (scope = 'incoming_text');

CREATE POLICY nex_ci_revoker_inbound_select
 ON public.nex_whatsapp_inbound FOR SELECT
 TO nex_ci_consent_revoker USING (true);
CREATE POLICY nex_ci_revoker_inbound_delete
 ON public.nex_whatsapp_inbound FOR DELETE
 TO nex_ci_consent_revoker USING (true);

-- Create one synthetic active authorization and inbound message for Alpha.
INSERT INTO public.nex_whatsapp_sender_authorizations (
  business_account_id, phone_number_id, sender_digest, family_id, scope,
  consent_version, consent_at, consent_source
) VALUES (
  '444444444', '333333333', decode(repeat('ee',32),'hex'),
  '11111111-1111-4111-8111-111111111111',
  'incoming_text', 'ci-1', now()-interval '1 hour', 'synthetic-ci'
);

INSERT INTO public.nex_whatsapp_inbound (
 business_account_id, phone_number_id, provider_message_id, family_id,
 sender_digest, provider_sent_at, nonce, authentication_tag, ciphertext,
 expires_at
) VALUES (
 '444444444','333333333','wamid.revoker-ttp227-alpha',
 '11111111-1111-4111-8111-111111111111',
 decode(repeat('ee',32),'hex'),now(),decode(repeat('11',12),'hex'),
 decode(repeat('22',16),'hex'),decode('33','hex'),now()+interval '2 days'
);

-- The earlier membership CI suspended account-a. Re-enable it as
-- synthetic data for the success path.
UPDATE public.nex_ci_family_memberships
SET status='active', revoked_at=NULL, updated_at=now()
WHERE user_id='account-a'
AND family_id='11111111-1111-4111-8111-111111111111';

SET ROLE nex_ci_consent_revoker;
DO $$
DECLARE
  n int;
BEGIN
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Revoker role bypasses RLS';
  END IF;
  IF has_table_privilege(current_user,'public.nex_whatsapp_inbound','INSERT')
   OR has_table_privilege(current_user,'public.nex_whatsapp_inbound','UPDATE')
   OR has_table_privilege(current_user,'public.nex_whatsapp_sender_authorizations','INSERT')
   OR has_column_privilege(current_user,'public.nex_whatsapp_sender_authorizations','family_id','UPDATE')
   OR has_column_privilege(current_user,'public.nex_whatsapp_sender_authorizations','sender_digest','UPDATE')
   OR has_column_privilege(current_user,'public.nex_ci_family_memberships','status','UPDATE')
   OR has_column_privilege(current_user,'public.nex_ci_family_memberships','revoked_at','UPDATE')
  THEN RAISE EXCEPTION 'Revocation role has excess privileges'; END IF;

  -- The test role must never edit role, status or revocation fields.
  -- updated_at is a known narrow write gap required by this RLS/row-lock
  -- prototype; it is NOT accepted as a production design.
END $$;

BEGIN;
-- This SELECT and mutation must share the exact same transaction/connection.
DO $$
DECLARE locked_role text;
BEGIN
 SELECT role INTO locked_role
 FROM public.nex_ci_family_memberships
 WHERE user_id='account-a'
 AND family_id='11111111-1111-4111-8111-111111111111'
 AND role IN ('owner','admin') AND status='active' AND revoked_at IS NULL
 FOR SHARE;
 IF NOT FOUND OR locked_role <> 'admin' THEN
   RAISE EXCEPTION 'Revoker cannot lock verified administrator membership';
 END IF;
END $$;

UPDATE public.nex_whatsapp_sender_authorizations
SET revoked_at=now()
WHERE family_id='11111111-1111-4111-8111-111111111111'
 AND business_account_id='444444444'
 AND phone_number_id='333333333'
 AND sender_digest=decode(repeat('ee',32),'hex')
 AND revoked_at IS NULL
RETURNING authorization_id \gset

DELETE FROM public.nex_whatsapp_inbound
WHERE family_id='11111111-1111-4111-8111-111111111111'
 AND business_account_id='444444444'
 AND phone_number_id='333333333'
 AND sender_digest=decode(repeat('ee',32),'hex')
RETURNING inbound_id \gset

COMMIT;
RESET ROLE;

DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.nex_whatsapp_sender_authorizations
    WHERE business_account_id='444444444'
      AND phone_number_id='333333333'
      AND sender_digest=decode(repeat('ee',32),'hex')
      AND revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'Revocation did not persist'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.revoker-ttp227-alpha'
 ) THEN RAISE EXCEPTION 'Revocation did not delete matching inbound'; END IF;
END $$;
SELECT 'TTP227 purpose-scoped revoker role and RLS checks passed' AS result;
