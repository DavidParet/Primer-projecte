-- TTP232: disposable PostgreSQL 17 only; DO NOT run on Neon.
-- All phones, identities, and keys below are synthetic CI fixtures.
-- Requires TTP231 tests and restricted membership function to have run.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Separate signer key custody. The test key is public and for CI ONLY.
CREATE TABLE public.nex_ci_revocation_signer_key (
  key_id smallint PRIMARY KEY CHECK(key_id=1),
  key_data bytea NOT NULL CHECK(octet_length(key_data)=32)
);
REVOKE ALL ON public.nex_ci_revocation_signer_key FROM PUBLIC;
INSERT INTO public.nex_ci_revocation_signer_key
VALUES (1, decode(repeat('a7',32),'hex'));

CREATE TABLE public.nex_ci_revocation_permit_uses (
  nonce uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_revocation_permit_uses FROM PUBLIC;

CREATE ROLE nex_ci_signed_revoke_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_signed_revoke_owner;
GRANT SELECT ON public.nex_ci_revocation_signer_key
 TO nex_ci_signed_revoke_owner;
GRANT INSERT, SELECT(nonce) ON public.nex_ci_revocation_permit_uses
 TO nex_ci_signed_revoke_owner;
GRANT EXECUTE ON FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 TO nex_ci_signed_revoke_owner;
GRANT SELECT, UPDATE(revoked_at)
 ON public.nex_whatsapp_sender_authorizations TO nex_ci_signed_revoke_owner;
GRANT SELECT, DELETE ON public.nex_whatsapp_inbound
 TO nex_ci_signed_revoke_owner;

-- Previously broad TTP227/TTP231 service runtime grants are explicitly
-- removed; runtime has only EXECUTE on the new signed operation.
REVOKE SELECT, UPDATE(revoked_at)
 ON public.nex_whatsapp_sender_authorizations FROM nex_ci_consent_revoker;
REVOKE SELECT, DELETE ON public.nex_whatsapp_inbound
 FROM nex_ci_consent_revoker;
REVOKE EXECUTE ON FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 FROM nex_ci_consent_revoker;

-- Both WhatsApp tables already use FORCE RLS in this disposable CI suite.
CREATE POLICY nex_ci_signed_revoker_auth_read
 ON public.nex_whatsapp_sender_authorizations FOR SELECT
 TO nex_ci_signed_revoke_owner USING (scope='incoming_text');
CREATE POLICY nex_ci_signed_revoker_auth_update
 ON public.nex_whatsapp_sender_authorizations FOR UPDATE
 TO nex_ci_signed_revoke_owner
 USING (scope='incoming_text' AND revoked_at IS NULL)
 WITH CHECK (scope='incoming_text');
CREATE POLICY nex_ci_signed_revoker_msg_read
 ON public.nex_whatsapp_inbound FOR SELECT
 TO nex_ci_signed_revoke_owner USING (true);
CREATE POLICY nex_ci_signed_revoker_msg_delete
 ON public.nex_whatsapp_inbound FOR DELETE
 TO nex_ci_signed_revoke_owner USING (true);

CREATE FUNCTION public.nex_ci_revoke_whatsapp_with_permit(
 p_user_id text, p_family_id uuid, p_authorization_id bigint,
 p_business_id text, p_phone_id text, p_sender_digest bytea,
 p_expires_epoch bigint, p_nonce uuid, p_signature bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $func$
DECLARE
  v_secret bytea;
  v_payload text;
  v_expected bytea;
  v_locked boolean;
  v_consumed uuid;
  v_authorization_id bigint;
  v_deleted bigint;
  v_now_epoch bigint;
BEGIN
  v_now_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_family_id IS NULL OR p_authorization_id IS NULL
    OR p_authorization_id <= 0
    OR p_business_id IS NULL OR p_business_id !~ '^[0-9]{5,30}$'
    OR p_phone_id IS NULL OR p_phone_id !~ '^[0-9]{5,30}$'
    OR p_sender_digest IS NULL OR octet_length(p_sender_digest)<>32
    OR p_expires_epoch IS NULL OR p_expires_epoch <= v_now_epoch
    OR p_expires_epoch > v_now_epoch + 90
    OR p_nonce IS NULL OR p_signature IS NULL OR
    octet_length(p_signature)<>32
  THEN RETURN jsonb_build_object('state','rejected'); END IF;

  SELECT key_data INTO v_secret
   FROM public.nex_ci_revocation_signer_key WHERE key_id=1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Signing key not provisioned';
  END IF;
  v_payload=concat_ws('|','NEXLUPA-WA-REVOKE-1',p_user_id,
    p_family_id::text,p_authorization_id::text,p_business_id,p_phone_id,
    encode(p_sender_digest,'hex'),p_expires_epoch::text,p_nonce::text);
  v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_secret,'sha256');
  IF v_expected <> p_signature THEN
    RETURN jsonb_build_object('state','rejected');
  END IF;

  -- This obtains and holds a row lock until the caller transaction commits.
  SELECT public.nex_authorize_family_locked(
    p_user_id,p_family_id,'revoke_whatsapp_consent') INTO v_locked;
  IF v_locked IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('state','rejected'); END IF;

  -- Single-use: a replay cannot spend the same signed permit twice.
  INSERT INTO public.nex_ci_revocation_permit_uses(nonce,expires_at)
   VALUES(p_nonce,to_timestamp(p_expires_epoch))
   ON CONFLICT DO NOTHING RETURNING nonce INTO v_consumed;
  IF v_consumed IS NULL THEN
    RETURN jsonb_build_object('state','rejected'); END IF;

  UPDATE public.nex_whatsapp_sender_authorizations
   SET revoked_at=now()
   WHERE authorization_id=p_authorization_id AND family_id=p_family_id
    AND business_account_id=p_business_id AND phone_number_id=p_phone_id
    AND sender_digest=p_sender_digest AND revoked_at IS NULL
   RETURNING authorization_id INTO v_authorization_id;
  IF v_authorization_id IS NULL THEN
    RETURN jsonb_build_object('state','not_active'); END IF;

  DELETE FROM public.nex_whatsapp_inbound
   WHERE family_id=p_family_id AND business_account_id=p_business_id
    AND phone_number_id=p_phone_id AND sender_digest=p_sender_digest;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN jsonb_build_object('state','revoked','deletedMessages',v_deleted);
END;
$func$;
ALTER FUNCTION public.nex_ci_revoke_whatsapp_with_permit(
 text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)
 OWNER TO nex_ci_signed_revoke_owner;
REVOKE ALL ON FUNCTION public.nex_ci_revoke_whatsapp_with_permit(
 text,uuid,bigint,text,text,bytea,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_revoke_whatsapp_with_permit(
 text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)
 TO nex_ci_consent_revoker;

-- Two fresh synthetic authorization/message fixtures.
INSERT INTO public.nex_whatsapp_sender_authorizations(
 business_account_id,phone_number_id,sender_digest,family_id,scope,
 consent_version,consent_at,consent_source
)VALUES
 ('777770001','888880001',decode(repeat('b1',32),'hex'),
  '11111111-1111-4111-8111-111111111111',
  'incoming_text','ci-232',now(),'ci'),
 ('777770002','888880002',decode(repeat('b2',32),'hex'),
  '22222222-2222-4222-8222-222222222222',
  'incoming_text','ci-232',now(),'ci');

INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at
)VALUES
 ('777770001','888880001','wamid.ttp232.family-a',
  '11111111-1111-4111-8111-111111111111',
  decode(repeat('b1',32),'hex'),now(),decode(repeat('01',12),'hex'),
  decode(repeat('02',16),'hex'),decode('0a','hex'),now()+interval '2 days'),
 ('777770002','888880002','wamid.ttp232.family-b',
  '22222222-2222-4222-8222-222222222222',
  decode(repeat('b2',32),'hex'),now(),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),decode('0b','hex'),now()+interval '2 days');

-- CI privileged signer only: issue one scoped A permit with known test key.
SELECT authorization_id AS auth_id FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='777770001' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+60) AS exp,
 gen_random_uuid()::text AS nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
  'NEXLUPA-WA-REVOKE-1','account-a',
  '11111111-1111-4111-8111-111111111111',
  :'auth_id','777770001','888880001',repeat('b1',32),
  :'exp',:'nonce'),'UTF8'),decode(repeat('a7',32),'hex'),'sha256'),'hex')
  AS signature \gset

SET ROLE nex_ci_consent_revoker;
DO $$
BEGIN
 IF (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)
  OR has_table_privilege(current_user,
    'public.nex_whatsapp_sender_authorizations','UPDATE')
  OR has_table_privilege(current_user,
    'public.nex_whatsapp_sender_authorizations','SELECT')
  OR has_table_privilege(current_user,
    'public.nex_whatsapp_inbound','DELETE')
  OR has_table_privilege(current_user,
    'public.nex_ci_revocation_signer_key','SELECT')
  OR has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','SELECT')
 THEN RAISE EXCEPTION 'Runtime can bypass signed operation boundary'; END IF;
 BEGIN
   UPDATE public.nex_whatsapp_sender_authorizations SET revoked_at=now()
   WHERE business_account_id='777770002';
   RAISE EXCEPTION 'Direct consent mutation unexpectedly permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   DELETE FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp232.family-b';
   RAISE EXCEPTION 'Direct cross-family deletion unexpectedly permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM 1 FROM public.nex_ci_revocation_signer_key LIMIT 1;
   RAISE EXCEPTION 'Runtime read private signing key';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- A stolen DB credential alone cannot sign a new permit.
SELECT (public.nex_ci_revoke_whatsapp_with_permit(
 'account-a','11111111-1111-4111-8111-111111111111',:'auth_id',
 '777770001','888880001',decode(repeat('b1',32),'hex'),
 :'exp',:'nonce'::uuid,decode(repeat('00',32),'hex'))->>'state'
 = 'rejected') AS denied \gset
\if :denied
\else
 \echo 'Invalid signature was not rejected'
 \quit 1
\endif

-- Copying signed A permit but substituting B's family must fail.
SELECT (public.nex_ci_revoke_whatsapp_with_permit(
 'account-a','22222222-2222-4222-8222-222222222222',:'auth_id',
 '777770001','888880001',decode(repeat('b1',32),'hex'),
 :'exp',:'nonce'::uuid,decode(:'signature','hex'))->>'state'
 = 'rejected') AS denied \gset
\if :denied
\else
 \echo 'Tampered family ID accepted'
 \quit 1
\endif

BEGIN;
SELECT ((result->>'state' = 'revoked') AND
 (result->>'deletedMessages')::integer = 1) AS accepted
FROM (SELECT public.nex_ci_revoke_whatsapp_with_permit(
 'account-a','11111111-1111-4111-8111-111111111111',:'auth_id',
 '777770001','888880001',decode(repeat('b1',32),'hex'),
 :'exp',:'nonce'::uuid,decode(:'signature','hex')) AS result) signed_revoke \gset
COMMIT;
\if :accepted
\else
 \echo 'Valid signed A revocation failed'
 \quit 1
\endif

-- Single-use permit must not be usable again.
SELECT (public.nex_ci_revoke_whatsapp_with_permit(
 'account-a','11111111-1111-4111-8111-111111111111',:'auth_id',
 '777770001','888880001',decode(repeat('b1',32),'hex'),
 :'exp',:'nonce'::uuid,decode(:'signature','hex'))->>'state'
 = 'rejected') AS denied \gset
\if :denied
\else
 \echo 'Permit replay accepted'
 \quit 1
\endif
RESET ROLE;

-- Confirm A is revoked and B remains completely untouched.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp232.family-a') OR
 NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp232.family-b')
 THEN RAISE EXCEPTION 'Cross-family content changed or A retained'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations
   WHERE business_account_id='777770002' AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'B authorization changed'; END IF;
 IF (SELECT count(*) FROM public.nex_ci_revocation_permit_uses) <> 1 THEN
   RAISE EXCEPTION 'Nonce ledger consumed unexpected permit count'; END IF;
END $$;
SELECT 'TTP232 signed one-use revocation and DB role restrictions passed' AS result;
