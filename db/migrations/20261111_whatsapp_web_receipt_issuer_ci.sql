-- NexLupa STAGED CI ONLY: explicit web-consent receipt -> atomic activation.
-- Prereqs TTP240 canonical family, verified Meta phone proof ledger, receipt ledger.
-- NEVER apply roles or migrations to real Neon without independent review.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE nex_ci_web_receipt_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_web_receipt_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_web_receipt_owner,nex_ci_web_receipt_runtime;
GRANT EXECUTE ON FUNCTION
 public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
 TO nex_ci_web_receipt_owner;

CREATE TABLE public.nex_ci_web_receipt_signing_keys(
 key_id text PRIMARY KEY CHECK(key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
 key_data bytea NOT NULL CHECK(octet_length(key_data)=32),
 state text NOT NULL CHECK(state IN('active','revoked'))
);
CREATE TABLE public.nex_ci_web_receipt_operation_nonces(
 nonce uuid PRIMARY KEY,expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_web_receipt_signing_keys,
 public.nex_ci_web_receipt_operation_nonces FROM PUBLIC;
ALTER TABLE public.nex_ci_web_receipt_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_web_receipt_signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_web_receipt_operation_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_web_receipt_operation_nonces FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.nex_ci_web_receipt_signing_keys TO nex_ci_web_receipt_owner;
GRANT SELECT,INSERT ON public.nex_ci_web_receipt_operation_nonces
 TO nex_ci_web_receipt_owner;
CREATE POLICY nex_ci_web_key_read ON public.nex_ci_web_receipt_signing_keys
 FOR SELECT TO nex_ci_web_receipt_owner USING(true);
CREATE POLICY nex_ci_web_nonce_read ON public.nex_ci_web_receipt_operation_nonces
 FOR SELECT TO nex_ci_web_receipt_owner USING(true);
CREATE POLICY nex_ci_web_nonce_insert ON public.nex_ci_web_receipt_operation_nonces
 FOR INSERT TO nex_ci_web_receipt_owner
 WITH CHECK(expires_at>clock_timestamp() AND
 expires_at<=clock_timestamp()+interval '60 seconds');

-- Proof identity is read from the verified Meta evidence, not from browser.
GRANT SELECT ON public.nex_whatsapp_verified_phone_proofs
 TO nex_ci_web_receipt_owner;
GRANT SELECT,INSERT ON public.nex_whatsapp_explicit_receipt_proofs
 TO nex_ci_web_receipt_owner;
CREATE POLICY nex_ci_web_phone_proof_read
 ON public.nex_whatsapp_verified_phone_proofs FOR SELECT
 TO nex_ci_web_receipt_owner USING(true);
CREATE POLICY nex_ci_web_receipt_read
 ON public.nex_whatsapp_explicit_receipt_proofs FOR SELECT
 TO nex_ci_web_receipt_owner USING(true);
CREATE POLICY nex_ci_web_receipt_insert
 ON public.nex_whatsapp_explicit_receipt_proofs FOR INSERT
 TO nex_ci_web_receipt_owner
 WITH CHECK(consumed_at IS NULL AND scope='incoming_text' AND
 source='account-web-consent' AND expires_at>accepted_at AND
 expires_at<=accepted_at+interval '10 minutes');
-- One verified number proof is bound to exactly one explicit web receipt.
CREATE UNIQUE INDEX IF NOT EXISTS nex_ci_web_receipt_single_per_proof
 ON public.nex_whatsapp_explicit_receipt_proofs(proof_digest);

CREATE FUNCTION public.nex_ci_signed_create_web_consent_receipt(
 p_user text,p_family uuid,p_business text,p_phone text,
 p_proof_digest bytea,p_receipt_digest bytea,p_consent_version text,
 p_key_id text,p_expires bigint,p_nonce uuid,p_signature bytea
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $f$
DECLARE
 v_now bigint;v_key bytea;v_payload text;v_expected bytea;
 v_proof record;v_nonce uuid;v_new bytea;
BEGIN
 v_now=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_user IS NULL OR length(p_user) NOT BETWEEN 1 AND 128 OR
    p_user ~ '[^A-Za-z0-9_-]' OR
    p_family IS NULL OR
    p_business IS NULL OR p_business !~ '^[0-9]{5,30}$' OR
    p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$' OR
    p_proof_digest IS NULL OR octet_length(p_proof_digest)<>32 OR
    p_receipt_digest IS NULL OR octet_length(p_receipt_digest)<>32 OR
    p_consent_version IS NULL OR
     p_consent_version<>'whatsapp-incoming-text-v1' OR
    p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$' OR
    p_expires IS NULL OR p_expires<=v_now OR p_expires>v_now+60 OR
    p_nonce IS NULL OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT key_data INTO v_key FROM public.nex_ci_web_receipt_signing_keys
 WHERE key_id=p_key_id AND state='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-WEB-CONSENT-1',p_key_id,p_user,
   p_family::text,p_business,p_phone,encode(p_proof_digest,'hex'),
   encode(p_receipt_digest,'hex'),p_consent_version,p_expires::text,
   p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_expected<>p_signature THEN RETURN jsonb_build_object('state','rejected'); END IF;
 IF public.nex_ci_authorize_canonical_family_locked(p_user,p_family,
    'enroll_whatsapp_sender') IS DISTINCT FROM TRUE
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 SELECT family_id,business_account_id,phone_number_id,sender_digest
   INTO v_proof FROM public.nex_whatsapp_verified_phone_proofs
 WHERE proof_digest=p_proof_digest AND consumed_at IS NULL
   AND expires_at>clock_timestamp()
   AND verified_at<=clock_timestamp()
   AND verified_at>=clock_timestamp()-interval '15 minutes';
 IF NOT FOUND OR v_proof.family_id<>p_family OR
   v_proof.business_account_id<>p_business OR
   v_proof.phone_number_id<>p_phone
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_ci_web_receipt_operation_nonces(nonce,expires_at)
 VALUES(p_nonce,to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_nonce;
 IF v_nonce IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_whatsapp_explicit_receipt_proofs(
  receipt_digest,proof_digest,family_id,business_account_id,
  phone_number_id,sender_digest,scope,consent_version,
  source,accepted_at,expires_at)
 VALUES(p_receipt_digest,p_proof_digest,p_family,p_business,p_phone,
   v_proof.sender_digest,'incoming_text',p_consent_version,
   'account-web-consent',clock_timestamp(),clock_timestamp()+interval '10 minutes')
 ON CONFLICT DO NOTHING RETURNING receipt_digest INTO v_new;
 IF v_new IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;
 RETURN jsonb_build_object('state','issued');
END;$f$;
ALTER FUNCTION public.nex_ci_signed_create_web_consent_receipt(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 OWNER TO nex_ci_web_receipt_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_create_web_consent_receipt(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_create_web_consent_receipt(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 TO nex_ci_web_receipt_runtime;
-- No public SELECT/INSERT, no direct runtime access to proof/receipt rows.
