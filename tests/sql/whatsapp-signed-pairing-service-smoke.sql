-- TTP238: operation-signed WhatsApp pairing. SYNTHETIC PG17 CI ONLY.
-- NEVER deploy to Neon or a live database without independent security review.
-- Prereq: TTP237 purpose-scoped roles/functions and consent fixture.
\set ON_ERROR_STOP on

CREATE TABLE public.nex_ci_pairing_signing_keys (
 key_id text PRIMARY KEY,
 purpose text NOT NULL CHECK (purpose IN ('issue','confirm')),
 key_data bytea NOT NULL CHECK (octet_length(key_data)=32),
 state text NOT NULL CHECK (state IN ('active','revoked')),
 UNIQUE(key_id,purpose)
);
CREATE TABLE public.nex_ci_pairing_operation_nonces (
 nonce uuid PRIMARY KEY,
 purpose text NOT NULL CHECK (purpose IN ('issue','confirm')),
 expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_pairing_signing_keys FROM PUBLIC;
REVOKE ALL ON public.nex_ci_pairing_operation_nonces FROM PUBLIC;
ALTER TABLE public.nex_ci_pairing_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_pairing_signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_pairing_operation_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_pairing_operation_nonces FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.nex_ci_pairing_signing_keys TO nex_ci_pairing_owner;
GRANT SELECT,INSERT ON public.nex_ci_pairing_operation_nonces TO nex_ci_pairing_owner;
CREATE POLICY nex_ci_pairing_signer_read ON public.nex_ci_pairing_signing_keys
 FOR SELECT TO nex_ci_pairing_owner USING (true);
CREATE POLICY nex_ci_pairing_nonce_read ON public.nex_ci_pairing_operation_nonces
 FOR SELECT TO nex_ci_pairing_owner USING (true);
CREATE POLICY nex_ci_pairing_nonce_insert ON public.nex_ci_pairing_operation_nonces
 FOR INSERT TO nex_ci_pairing_owner
 WITH CHECK (expires_at>clock_timestamp()
  AND expires_at<=clock_timestamp()+interval '60 seconds');

INSERT INTO public.nex_ci_pairing_signing_keys(key_id,purpose,key_data,state)
VALUES ('issue-key-v1','issue',decode(repeat('e1',32),'hex'),'active'),
       ('confirm-key-v1','confirm',decode(repeat('e2',32),'hex'),'active');

-- Runtime roles may no longer use unsigned entrypoints. The NOLOGIN
-- function owner retains internal ability to call them after verification.
REVOKE EXECUTE ON FUNCTION
 public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)
 FROM nex_ci_pairing_issuer;
REVOKE EXECUTE ON FUNCTION
 public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)
 FROM nex_ci_pairing_confirmer;

CREATE FUNCTION public.nex_ci_signed_issue_whatsapp_pairing(
 p_user text,p_family uuid,p_business text,p_phone text,p_digest bytea,
 p_key_id text,p_expires bigint,p_nonce uuid,p_signature bytea
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $f$
DECLARE v_epoch bigint; v_key bytea; v_payload text;
 v_verified bytea; v_used uuid;
BEGIN
 v_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_user IS NULL OR p_user !~ '^[A-Za-z0-9_-]{1,128}$'
  OR p_family IS NULL OR p_business IS NULL OR
   p_business !~ '^[0-9]{5,30}$'
  OR p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$'
  OR p_digest IS NULL OR octet_length(p_digest)<>32
  OR p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$'
  OR p_expires IS NULL OR p_expires<=v_epoch
  OR p_expires>v_epoch+60 OR p_nonce IS NULL
  OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT key_data INTO v_key FROM public.nex_ci_pairing_signing_keys
 WHERE key_id=p_key_id AND purpose='issue' AND state='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-PAIR-ISSUE-1',p_key_id,p_user,
  p_family::text,p_business,p_phone,encode(p_digest,'hex'),
  p_expires::text,p_nonce::text);
 v_verified=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_verified<>p_signature THEN
  RETURN jsonb_build_object('state','rejected'); END IF;
 INSERT INTO public.nex_ci_pairing_operation_nonces(nonce,purpose,expires_at)
 VALUES(p_nonce,'issue',to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_used;
 IF v_used IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;
 RETURN public.nex_ci_issue_whatsapp_pairing(
  p_user,p_family,p_business,p_phone,p_digest);
END;
$f$;
ALTER FUNCTION public.nex_ci_signed_issue_whatsapp_pairing(
 text,uuid,text,text,bytea,text,bigint,uuid,bytea)
 OWNER TO nex_ci_pairing_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_issue_whatsapp_pairing(
 text,uuid,text,text,bytea,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_issue_whatsapp_pairing(
 text,uuid,text,text,bytea,text,bigint,uuid,bytea)
 TO nex_ci_pairing_issuer;

CREATE FUNCTION public.nex_ci_signed_confirm_whatsapp_pairing(
 p_business text,p_phone text,p_digest bytea,p_sender bytea,
 p_provider_message text,p_key_id text,p_expires bigint,
 p_nonce uuid,p_signature bytea
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $f$
DECLARE v_epoch bigint; v_key bytea; v_payload text;
 v_verified bytea; v_used uuid;
BEGIN
 v_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_business IS NULL OR p_business !~ '^[0-9]{5,30}$'
  OR p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$'
  OR p_digest IS NULL OR octet_length(p_digest)<>32
  OR p_sender IS NULL OR octet_length(p_sender)<>32
  OR p_provider_message IS NULL OR length(p_provider_message)>262
  OR p_provider_message !~ '^wamid[.][A-Za-z0-9._=-]+$'
  OR p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$'
  OR p_expires IS NULL OR p_expires<=v_epoch
  OR p_expires>v_epoch+60 OR p_nonce IS NULL
  OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT key_data INTO v_key FROM public.nex_ci_pairing_signing_keys
 WHERE key_id=p_key_id AND purpose='confirm' AND state='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-PAIR-CONFIRM-1',p_key_id,
  p_business,p_phone,encode(p_digest,'hex'),encode(p_sender,'hex'),
  p_provider_message,p_expires::text,p_nonce::text);
 v_verified=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_verified<>p_signature THEN
  RETURN jsonb_build_object('state','rejected'); END IF;
 INSERT INTO public.nex_ci_pairing_operation_nonces(nonce,purpose,expires_at)
 VALUES(p_nonce,'confirm',to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_used;
 IF v_used IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;
 RETURN public.nex_ci_confirm_whatsapp_pairing(
   p_business,p_phone,p_digest,p_sender,p_provider_message);
END;
$f$;
ALTER FUNCTION public.nex_ci_signed_confirm_whatsapp_pairing(
 text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 OWNER TO nex_ci_pairing_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_confirm_whatsapp_pairing(
 text,text,bytea,bytea,text,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_confirm_whatsapp_pairing(
 text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 TO nex_ci_pairing_confirmer;

-- Verify neither restricted runtime has access to secret-bearing tables,
-- raw DML, or a signed function belonging to another operation purpose.
SET ROLE nex_ci_pairing_issuer;
DO $f$
BEGIN
 IF has_table_privilege(current_user,'public.nex_ci_pairing_signing_keys','SELECT')
  OR has_table_privilege(current_user,'public.nex_ci_pairing_operation_nonces','INSERT')
  OR has_table_privilege(current_user,'public.nex_whatsapp_sender_authorizations','INSERT')
  OR has_function_privilege(current_user,
   'public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)','EXECUTE')
  OR has_function_privilege(current_user,
   'public.nex_ci_signed_confirm_whatsapp_pairing(text,text,bytea,bytea,text,text,bigint,uuid,bytea)','EXECUTE')
 THEN RAISE EXCEPTION 'Issuer role can bypass signed operation'; END IF;
END;
$f$;
RESET ROLE;
SET ROLE nex_ci_pairing_confirmer;
DO $f$
BEGIN
 IF has_table_privilege(current_user,'public.nex_ci_pairing_signing_keys','SELECT')
  OR has_table_privilege(current_user,'public.nex_ci_pairing_operation_nonces','INSERT')
  OR has_table_privilege(current_user,'public.nex_whatsapp_sender_authorizations','INSERT')
  OR has_function_privilege(current_user,
   'public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)','EXECUTE')
  OR has_function_privilege(current_user,
   'public.nex_ci_signed_issue_whatsapp_pairing(text,uuid,text,text,bytea,text,bigint,uuid,bytea)','EXECUTE')
 THEN RAISE EXCEPTION 'Confirmer role can bypass signed operation'; END IF;
END;
$f$;
RESET ROLE;

-- The following test permits are minted by CI's privileged synthetic signer.
-- Neither runtime can mint them from its DB credentials alone.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55)
 AS issue_exp,gen_random_uuid()::text AS issue_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-ISSUE-1','issue-key-v1','account-a',
 '11111111-1111-4111-8111-111111111111',
 '755551111','855551111',repeat('d8',32),
 :'issue_exp',:'issue_nonce'),'UTF8'),
 decode(repeat('e1',32),'hex'),'sha256'),'hex')
 AS issue_signature \gset

SET ROLE nex_ci_pairing_issuer;
SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'account-a','11111111-1111-4111-8111-111111111111',
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 'issue-key-v1',:'issue_exp',:'issue_nonce'::uuid,
 decode(repeat('00',32),'hex'))->>'state'='rejected') AS invalid_sig \gset
\if :invalid_sig
\else
 \echo 'Unsigned issue operation accepted'
 \quit 1
\endif

SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'account-a','22222222-2222-4222-8222-222222222222',
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 'issue-key-v1',:'issue_exp',:'issue_nonce'::uuid,
 decode(:'issue_signature','hex'))->>'state'='rejected') AS cross_family \gset
\if :cross_family
\else
 \echo 'Signed issue permit family field could be tampered'
 \quit 1
\endif

SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'account-a','11111111-1111-4111-8111-111111111111',
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 'issue-key-v1',:'issue_exp',:'issue_nonce'::uuid,
 decode(:'issue_signature','hex'))->>'state'='created') AS valid_issue \gset
\if :valid_issue
\else
 \echo 'Valid issue permit refused'
 \quit 1
\endif

SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'account-a','11111111-1111-4111-8111-111111111111',
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 'issue-key-v1',:'issue_exp',:'issue_nonce'::uuid,
 decode(:'issue_signature','hex'))->>'state'='rejected') AS replay_issue \gset
\if :replay_issue
\else
 \echo 'Issue permit replay accepted'
 \quit 1
\endif
RESET ROLE;

SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55)
 AS confirm_exp,gen_random_uuid()::text AS confirm_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-CONFIRM-1','confirm-key-v1',
 '755551111','855551111',repeat('d8',32),repeat('b8',32),
 'wamid.ttp238-confirm',:'confirm_exp',:'confirm_nonce'),'UTF8'),
 decode(repeat('e2',32),'hex'),'sha256'),'hex')
 AS confirm_signature \gset

SET ROLE nex_ci_pairing_confirmer;
SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 decode(repeat('b8',32),'hex'),'wamid.ttp238-confirm',
 'issue-key-v1',:'confirm_exp',:'confirm_nonce'::uuid,
 decode(:'confirm_signature','hex'))->>'state'='rejected') AS wrong_key \gset
\if :wrong_key
\else
 \echo 'Issuer key accepted as Meta confirmation'
 \quit 1
\endif

SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 decode(repeat('b9',32),'hex'),'wamid.ttp238-confirm',
 'confirm-key-v1',:'confirm_exp',:'confirm_nonce'::uuid,
 decode(:'confirm_signature','hex'))->>'state'='rejected') AS changed_sender \gset
\if :changed_sender
\else
 \echo 'Confirmation permit sender digest could be tampered'
 \quit 1
\endif

SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 decode(repeat('b8',32),'hex'),'wamid.ttp238-confirm',
 'confirm-key-v1',:'confirm_exp',:'confirm_nonce'::uuid,
 decode(:'confirm_signature','hex'))->>'state'='paired') AS valid_confirm \gset
\if :valid_confirm
\else
 \echo 'Valid signed confirmation refused'
 \quit 1
\endif

SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '755551111','855551111',decode(repeat('d8',32),'hex'),
 decode(repeat('b8',32),'hex'),'wamid.ttp238-confirm',
 'confirm-key-v1',:'confirm_exp',:'confirm_nonce'::uuid,
 decode(:'confirm_signature','hex'))->>'state'='rejected') AS replay_confirm \gset
\if :replay_confirm
\else
 \echo 'Confirm permit replay accepted'
 \quit 1
\endif
RESET ROLE;

-- Confirmed code is consumed once, and consent only points to Family A.
DO $f$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE business_account_id='755551111' AND phone_number_id='855551111'
   AND family_id='11111111-1111-4111-8111-111111111111'
   AND sender_digest=decode(repeat('b8',32),'hex')
   AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Valid signed consent not present'; END IF;
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE business_account_id='755551111' AND
   family_id='22222222-2222-4222-8222-222222222222')
 THEN RAISE EXCEPTION 'Cross-family signed consent created'; END IF;
END;
$f$;
SELECT (SELECT count(*) FROM public.nex_ci_pairing_operation_nonces
 WHERE nonce IN (:'issue_nonce'::uuid,:'confirm_nonce'::uuid))=2 AS ledger_ok \gset
\if :ledger_ok
\else
 \echo 'Single-use nonce ledger did not record both operations'
 \quit 1
\endif
SELECT 'TTP238 two-purpose signed pairing operations passed' AS result;
