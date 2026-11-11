-- NexLupa STAGED / POSTGRES CI ONLY; do NOT apply to Neon or production.
-- Prerequisites: canonical TTP240 users/families/memberships, signed pairing
-- challenge table, and atomic phone proof table. Secrets are synthetic in CI.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE nex_ci_meta_proof_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_meta_proof_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_meta_proof_owner,nex_ci_meta_proof_runtime;
GRANT EXECUTE ON FUNCTION
 public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
 TO nex_ci_meta_proof_owner;

CREATE TABLE public.nex_ci_meta_proof_signing_keys(
 key_id text PRIMARY KEY CHECK(key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
 key_data bytea NOT NULL CHECK(octet_length(key_data)=32),
 state text NOT NULL CHECK(state IN('active','revoked'))
);
CREATE TABLE public.nex_ci_meta_proof_operation_nonces(
 nonce uuid PRIMARY KEY,expires_at timestamptz NOT NULL
);
CREATE TABLE public.nex_ci_meta_proof_provider_receipts(
 business_account_id text NOT NULL CHECK(business_account_id ~ '^[0-9]{5,30}$'),
 provider_message_id text NOT NULL CHECK(
   length(provider_message_id)<=262 AND
   provider_message_id ~ '^wamid[.][A-Za-z0-9._=-]+$'),
 proof_digest bytea NOT NULL CHECK(octet_length(proof_digest)=32),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_account_id,provider_message_id)
);
REVOKE ALL ON public.nex_ci_meta_proof_signing_keys,
 public.nex_ci_meta_proof_operation_nonces,
 public.nex_ci_meta_proof_provider_receipts FROM PUBLIC;
ALTER TABLE public.nex_ci_meta_proof_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_meta_proof_signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_meta_proof_operation_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_meta_proof_operation_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_meta_proof_provider_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_meta_proof_provider_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.nex_ci_meta_proof_signing_keys TO nex_ci_meta_proof_owner;
GRANT SELECT,INSERT ON public.nex_ci_meta_proof_operation_nonces TO nex_ci_meta_proof_owner;
GRANT SELECT,INSERT ON public.nex_ci_meta_proof_provider_receipts TO nex_ci_meta_proof_owner;
CREATE POLICY nex_ci_meta_signing_read
 ON public.nex_ci_meta_proof_signing_keys FOR SELECT
 TO nex_ci_meta_proof_owner USING(true);
CREATE POLICY nex_ci_meta_nonce_read
 ON public.nex_ci_meta_proof_operation_nonces FOR SELECT
 TO nex_ci_meta_proof_owner USING(true);
CREATE POLICY nex_ci_meta_nonce_insert
 ON public.nex_ci_meta_proof_operation_nonces FOR INSERT
 TO nex_ci_meta_proof_owner
 WITH CHECK(expires_at>clock_timestamp() AND
   expires_at<=clock_timestamp()+interval '60 seconds');
CREATE POLICY nex_ci_meta_receipt_read
 ON public.nex_ci_meta_proof_provider_receipts FOR SELECT
 TO nex_ci_meta_proof_owner USING(true);
CREATE POLICY nex_ci_meta_receipt_insert
 ON public.nex_ci_meta_proof_provider_receipts FOR INSERT
 TO nex_ci_meta_proof_owner WITH CHECK(true);

-- The pairing challenge was created by a separate authenticated and signed
-- family operation. This role can consume ONLY consumed_at, not issue codes.
GRANT SELECT,UPDATE(consumed_at)
 ON public.nex_ci_whatsapp_pairing_challenges TO nex_ci_meta_proof_owner;
CREATE POLICY nex_ci_meta_pair_read
 ON public.nex_ci_whatsapp_pairing_challenges FOR SELECT
 TO nex_ci_meta_proof_owner USING(consumed_at IS NULL);
CREATE POLICY nex_ci_meta_pair_lock
 ON public.nex_ci_whatsapp_pairing_challenges FOR UPDATE
 TO nex_ci_meta_proof_owner USING(consumed_at IS NULL)
 WITH CHECK(consumed_at IS NOT NULL);

GRANT SELECT,INSERT ON public.nex_whatsapp_verified_phone_proofs
 TO nex_ci_meta_proof_owner;
CREATE POLICY nex_ci_meta_proof_read
 ON public.nex_whatsapp_verified_phone_proofs FOR SELECT
 TO nex_ci_meta_proof_owner USING(true);
CREATE POLICY nex_ci_meta_proof_insert
 ON public.nex_whatsapp_verified_phone_proofs FOR INSERT
 TO nex_ci_meta_proof_owner WITH CHECK(consumed_at IS NULL AND
   expires_at>verified_at AND
   expires_at<=verified_at+interval '10 minutes');

-- No raw WhatsApp body, phone, pairing code or receipt tokens are persisted.
-- The application signer MUST validate Meta's HMAC of RAW webhook bytes
-- BEFORE issuing the independent permit signed with a different server key.
CREATE FUNCTION public.nex_ci_signed_store_meta_phone_proof(
 p_business text,p_phone text,p_code_digest bytea,p_sender_digest bytea,
 p_proof_digest bytea,p_provider_message text,
 p_key_id text,p_expires bigint,p_nonce uuid,p_signature bytea
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $f$
DECLARE
 v_now bigint;v_key bytea;v_payload text;v_expected bytea;
 v_challenge record;v_used uuid;v_row bytea;v_id bigint;v_receipt text;
BEGIN
 v_now=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_business IS NULL OR p_business !~ '^[0-9]{5,30}$' OR
    p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$' OR
    p_code_digest IS NULL OR octet_length(p_code_digest)<>32 OR
    p_sender_digest IS NULL OR octet_length(p_sender_digest)<>32 OR
    p_proof_digest IS NULL OR octet_length(p_proof_digest)<>32 OR
    p_provider_message IS NULL OR length(p_provider_message)>262 OR
      p_provider_message !~ '^wamid[.][A-Za-z0-9._=-]+$' OR
    p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$' OR
    p_expires IS NULL OR p_expires<=v_now OR p_expires>v_now+60 OR
    p_nonce IS NULL OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT key_data INTO v_key FROM public.nex_ci_meta_proof_signing_keys
 WHERE key_id=p_key_id AND state='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-META-PROOF-1',p_key_id,p_business,p_phone,
   encode(p_code_digest,'hex'),encode(p_sender_digest,'hex'),
   encode(p_proof_digest,'hex'),p_provider_message,p_expires::text,p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_expected<>p_signature THEN
    RETURN jsonb_build_object('state','rejected'); END IF;

 IF EXISTS(SELECT 1 FROM public.nex_ci_meta_proof_provider_receipts
   WHERE business_account_id=p_business AND provider_message_id=p_provider_message)
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 SELECT challenge_id,family_id,requested_by,consent_version,created_at
   INTO v_challenge FROM public.nex_ci_whatsapp_pairing_challenges
 WHERE business_account_id=p_business AND phone_number_id=p_phone
   AND code_digest=p_code_digest AND consumed_at IS NULL
   AND expires_at>clock_timestamp()
 FOR UPDATE;
 IF NOT FOUND OR
    v_challenge.consent_version<>'whatsapp-incoming-text-v1'
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 IF public.nex_ci_authorize_canonical_family_locked(
   v_challenge.requested_by,v_challenge.family_id,
   'enroll_whatsapp_sender') IS DISTINCT FROM TRUE
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_ci_meta_proof_operation_nonces(nonce,expires_at)
 VALUES(p_nonce,to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_used;
 IF v_used IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_whatsapp_verified_phone_proofs(
  proof_digest,family_id,business_account_id,phone_number_id,
  sender_digest,verified_at,expires_at)
 VALUES(p_proof_digest,v_challenge.family_id,p_business,p_phone,p_sender_digest,
  clock_timestamp(),clock_timestamp()+interval '10 minutes')
 ON CONFLICT DO NOTHING RETURNING proof_digest INTO v_row;
 IF v_row IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;

 UPDATE public.nex_ci_whatsapp_pairing_challenges
 SET consumed_at=clock_timestamp()
 WHERE challenge_id=v_challenge.challenge_id AND consumed_at IS NULL
 RETURNING challenge_id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Phone challenge consumption lost'; END IF;
 INSERT INTO public.nex_ci_meta_proof_provider_receipts(
   business_account_id,provider_message_id,proof_digest)
 VALUES(p_business,p_provider_message,p_proof_digest)
 ON CONFLICT DO NOTHING RETURNING provider_message_id INTO v_receipt;
 IF v_receipt IS NULL THEN RAISE EXCEPTION 'Meta receipt replay race'; END IF;
 RETURN jsonb_build_object('state','verified');
END;$f$;
ALTER FUNCTION public.nex_ci_signed_store_meta_phone_proof(
 text,text,bytea,bytea,bytea,text,text,bigint,uuid,bytea)
 OWNER TO nex_ci_meta_proof_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_store_meta_phone_proof(
 text,text,bytea,bytea,bytea,text,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_store_meta_phone_proof(
 text,text,bytea,bytea,bytea,text,text,bigint,uuid,bytea)
 TO nex_ci_meta_proof_runtime;
-- The runtime has ZERO direct SQL access to raw evidences/challenges.
