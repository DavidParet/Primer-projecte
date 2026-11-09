-- TTP 233: rotating signer key registry (disposable PostgreSQL CI only).
-- All keys/identities are SYNTHETIC. NEVER run this fixture on Neon.
-- Requires TTP232 signed function and restricted roles.
\set ON_ERROR_STOP on

CREATE TABLE public.nex_ci_revocation_keyring_v2 (
  key_id text PRIMARY KEY CHECK (key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
  key_data bytea NOT NULL CHECK (octet_length(key_data)=32),
  state text NOT NULL CHECK (state IN ('active','verify_only','revoked')),
  accept_until timestamptz,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
   (state='active' AND accept_until IS NULL) OR
   (state='verify_only' AND accept_until IS NOT NULL) OR
   (state='revoked')
  )
);
CREATE UNIQUE INDEX nex_ci_one_active_signer_v2
 ON public.nex_ci_revocation_keyring_v2 ((true))
 WHERE state='active';
REVOKE ALL ON public.nex_ci_revocation_keyring_v2 FROM PUBLIC;
GRANT SELECT ON public.nex_ci_revocation_keyring_v2
 TO nex_ci_signed_revoke_owner;

INSERT INTO public.nex_ci_revocation_keyring_v2(key_id,key_data,state)
VALUES ('key-old',decode(repeat('a8',32),'hex'),'active');

-- The legacy V1 API is no longer executable by the app role. A runtime with
-- an old signing key must not bypass V2's rotation/revocation registry.
REVOKE EXECUTE ON FUNCTION public.nex_ci_revoke_whatsapp_with_permit(
 text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)
 FROM nex_ci_consent_revoker;

CREATE FUNCTION public.nex_ci_revoke_whatsapp_with_rotating_permit(
 p_key_id text, p_user_id text, p_family_id uuid, p_authorization_id bigint,
 p_business_id text, p_phone_id text, p_sender_digest bytea,
 p_expires_epoch bigint, p_nonce uuid, p_signature bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $func$
DECLARE
 v_secret bytea;
 v_payload text;
 v_expected bytea;
 v_locked boolean;
 v_consumed uuid;
 v_auth_id bigint;
 v_deleted bigint;
 v_now_epoch bigint;
BEGIN
 v_now_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$'
   OR p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9_-]{1,128}$'
   OR p_family_id IS NULL OR p_authorization_id IS NULL OR
      p_authorization_id <= 0
   OR p_business_id IS NULL OR p_business_id !~ '^[0-9]{5,30}$'
   OR p_phone_id IS NULL OR p_phone_id !~ '^[0-9]{5,30}$'
   OR p_sender_digest IS NULL OR octet_length(p_sender_digest)<>32
   OR p_expires_epoch IS NULL OR p_expires_epoch<=v_now_epoch
   OR p_expires_epoch>v_now_epoch+90
   OR p_nonce IS NULL OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 -- Only active/temporarily verify_only keys can verify. Rotation owner can
 -- revoke a key even before outstanding signed permits reach their expiry.
 SELECT key_data INTO v_secret
 FROM public.nex_ci_revocation_keyring_v2
 WHERE key_id=p_key_id AND (
   state='active' OR
   (state='verify_only' AND accept_until>clock_timestamp())
 );
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-WA-REVOKE-2',p_key_id,p_user_id,
    p_family_id::text,p_authorization_id::text,p_business_id,p_phone_id,
    encode(p_sender_digest,'hex'),p_expires_epoch::text,p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_secret,'sha256');
 IF v_expected<>p_signature THEN
   RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT public.nex_authorize_family_locked(
  p_user_id,p_family_id,'revoke_whatsapp_consent') INTO v_locked;
 IF v_locked IS DISTINCT FROM TRUE THEN
   RETURN jsonb_build_object('state','rejected'); END IF;
 INSERT INTO public.nex_ci_revocation_permit_uses(nonce,expires_at)
  VALUES(p_nonce,to_timestamp(p_expires_epoch))
  ON CONFLICT DO NOTHING RETURNING nonce INTO v_consumed;
 IF v_consumed IS NULL THEN
   RETURN jsonb_build_object('state','rejected'); END IF;
 UPDATE public.nex_whatsapp_sender_authorizations
 SET revoked_at=clock_timestamp()
 WHERE authorization_id=p_authorization_id AND family_id=p_family_id
   AND business_account_id=p_business_id AND phone_number_id=p_phone_id
   AND sender_digest=p_sender_digest AND revoked_at IS NULL
 RETURNING authorization_id INTO v_auth_id;
 IF v_auth_id IS NULL THEN
   RETURN jsonb_build_object('state','not_active'); END IF;
 DELETE FROM public.nex_whatsapp_inbound
 WHERE family_id=p_family_id AND business_account_id=p_business_id
   AND phone_number_id=p_phone_id AND sender_digest=p_sender_digest;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 RETURN jsonb_build_object('state','revoked','deletedMessages',v_deleted);
END;
$func$;
ALTER FUNCTION public.nex_ci_revoke_whatsapp_with_rotating_permit(
 text,text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)
 OWNER TO nex_ci_signed_revoke_owner;
REVOKE ALL ON FUNCTION public.nex_ci_revoke_whatsapp_with_rotating_permit(
 text,text,uuid,bigint,text,text,bytea,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_revoke_whatsapp_with_rotating_permit(
 text,text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)
 TO nex_ci_consent_revoker;

-- Test fixture: three distinct active authorizations and encrypted messages.
INSERT INTO public.nex_whatsapp_sender_authorizations(
 business_account_id,phone_number_id,sender_digest,family_id,scope,
 consent_version,consent_at,consent_source
)VALUES
 ('733330001','833330001',decode(repeat('c1',32),'hex'),
  '11111111-1111-4111-8111-111111111111','incoming_text','ci-233',now(),'ci'),
 ('733330002','833330002',decode(repeat('c2',32),'hex'),
  '22222222-2222-4222-8222-222222222222','incoming_text','ci-233',now(),'ci'),
 ('733330003','833330003',decode(repeat('c3',32),'hex'),
  '11111111-1111-4111-8111-111111111111','incoming_text','ci-233',now(),'ci');
INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at
)VALUES
 ('733330001','833330001','wamid.ttp233.old-a',
  '11111111-1111-4111-8111-111111111111',decode(repeat('c1',32),'hex'),
  now(),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
  decode('aa','hex'),now()+interval '2 days'),
 ('733330002','833330002','wamid.ttp233.new-b',
  '22222222-2222-4222-8222-222222222222',decode(repeat('c2',32),'hex'),
  now(),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  decode('bb','hex'),now()+interval '2 days'),
 ('733330003','833330003','wamid.ttp233.compromised-a',
  '11111111-1111-4111-8111-111111111111',decode(repeat('c3',32),'hex'),
  now(),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),
  decode('cc','hex'),now()+interval '2 days');

-- Privileged CI-only signer issues an OLD key permit BEFORE rotation.
SELECT authorization_id AS old_auth FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='733330001' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+60) AS old_exp,
 gen_random_uuid()::text AS old_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-WA-REVOKE-2','key-old','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'old_auth','733330001','833330001',repeat('c1',32),
 :'old_exp',:'old_nonce'),'UTF8'),
 decode(repeat('a8',32),'hex'),'sha256'),'hex') AS old_signature \gset

-- Planned rotation: stop issuing with OLD, allow verification of outstanding
-- short-lived permits for at most 90 seconds, start issuing NEW.
BEGIN;
UPDATE public.nex_ci_revocation_keyring_v2
 SET state='verify_only',accept_until=clock_timestamp()+interval '90 seconds',
 changed_at=clock_timestamp() WHERE key_id='key-old' AND state='active';
INSERT INTO public.nex_ci_revocation_keyring_v2(key_id,key_data,state)
 VALUES('key-new',decode(repeat('a9',32),'hex'),'active');
COMMIT;

SELECT authorization_id AS new_auth FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='733330002' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+60) AS new_exp,
 gen_random_uuid()::text AS new_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-WA-REVOKE-2','key-new','account-b-admin',
 '22222222-2222-4222-8222-222222222222',
 :'new_auth','733330002','833330002',repeat('c2',32),
 :'new_exp',:'new_nonce'),'UTF8'),
 decode(repeat('a9',32),'hex'),'sha256'),'hex') AS new_signature \gset

-- Prepare a new-key permit before emergency compromise revocation.
SELECT authorization_id AS breach_auth FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='733330003' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+60) AS breach_exp,
 gen_random_uuid()::text AS breach_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-WA-REVOKE-2','key-new','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'breach_auth','733330003','833330003',repeat('c3',32),
 :'breach_exp',:'breach_nonce'),'UTF8'),
 decode(repeat('a9',32),'hex'),'sha256'),'hex') AS breach_signature \gset

SET ROLE nex_ci_consent_revoker;
DO $$
BEGIN
 IF has_table_privilege(current_user,
  'public.nex_ci_revocation_keyring_v2','SELECT')
 OR has_table_privilege(current_user,
  'public.nex_ci_revocation_keyring_v2','UPDATE')
 OR has_function_privilege(current_user,
  'public.nex_ci_revoke_whatsapp_with_permit(text,uuid,bigint,text,text,bytea,bigint,uuid,bytea)',
  'EXECUTE')
 THEN RAISE EXCEPTION 'Runtime can bypass key rotation boundary'; END IF;
END $$;

-- Wrong key ID or modified signature must reject without consuming nonce.
SELECT (public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-new','account-a','11111111-1111-4111-8111-111111111111',
 :'old_auth','733330001','833330001',decode(repeat('c1',32),'hex'),
 :'old_exp',:'old_nonce'::uuid,decode(:'old_signature','hex')
)->>'state'='rejected') AS denied \gset
\if :denied
\else
 \echo 'Tampering with key ID succeeded'
 \quit 1
\endif

-- A permit issued before planned rotation remains valid while verify_only.
BEGIN;
SELECT ((res->>'state'='revoked') AND
 (res->>'deletedMessages')::int=1) AS accepted
FROM (SELECT public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-old','account-a','11111111-1111-4111-8111-111111111111',
 :'old_auth','733330001','833330001',decode(repeat('c1',32),'hex'),
 :'old_exp',:'old_nonce'::uuid,decode(:'old_signature','hex')) AS res) q \gset
COMMIT;
\if :accepted
\else
 \echo 'In-flight old-key permit denied during planned overlap'
 \quit 1
\endif

-- The new key works without touching previously authorized other-family rows.
BEGIN;
SELECT ((res->>'state'='revoked') AND
 (res->>'deletedMessages')::int=1) AS accepted
FROM (SELECT public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-new','account-b-admin','22222222-2222-4222-8222-222222222222',
 :'new_auth','733330002','833330002',decode(repeat('c2',32),'hex'),
 :'new_exp',:'new_nonce'::uuid,decode(:'new_signature','hex')) AS res) q \gset
COMMIT;
\if :accepted
\else
 \echo 'New-key permit not accepted after planned rotation'
 \quit 1
\endif
RESET ROLE;

-- Emergency key revocation: outstanding valid signatures immediately lose
-- acceptance for new calls after this transaction commits.
UPDATE public.nex_ci_revocation_keyring_v2
 SET state='revoked',accept_until=NULL,changed_at=clock_timestamp()
 WHERE key_id='key-new';

SET ROLE nex_ci_consent_revoker;
SELECT (public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-new','account-a','11111111-1111-4111-8111-111111111111',
 :'breach_auth','733330003','833330003',decode(repeat('c3',32),'hex'),
 :'breach_exp',:'breach_nonce'::uuid,decode(:'breach_signature','hex')
)->>'state'='rejected') AS denied \gset
\if :denied
\else
 \echo 'Emergency-revoked signing key still accepted'
 \quit 1
\endif
RESET ROLE;

-- Grace period expiry MUST invalidate old key even when the permit itself
-- has time remaining. CI operator simulates the passage of the grace period.
UPDATE public.nex_ci_revocation_keyring_v2
 SET accept_until=clock_timestamp()-interval '1 second'
 WHERE key_id='key-old';
SET ROLE nex_ci_consent_revoker;
SELECT (public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-old','account-a','11111111-1111-4111-8111-111111111111',
 :'old_auth','733330001','833330001',decode(repeat('c1',32),'hex'),
 :'old_exp',gen_random_uuid(),decode(:'old_signature','hex')
)->>'state'='rejected') AS denied \gset
\if :denied
\else
 \echo 'Expired grace key accepted'
 \quit 1
\endif
RESET ROLE;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
    WHERE provider_message_id IN ('wamid.ttp233.old-a','wamid.ttp233.new-b'))
 OR NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
    WHERE provider_message_id='wamid.ttp233.compromised-a')
 THEN RAISE EXCEPTION 'Key rotation changed incorrect family data'; END IF;
 IF (SELECT count(*) FROM public.nex_ci_revocation_permit_uses
  WHERE nonce IN (:'old_nonce'::uuid,:'new_nonce'::uuid))<>2
 THEN RAISE EXCEPTION 'Nonce use ledger lost two valid entries'; END IF;
END $$;
SELECT 'TTP233 planned rotation, emergency revoke, and replay isolation passed' AS result;
