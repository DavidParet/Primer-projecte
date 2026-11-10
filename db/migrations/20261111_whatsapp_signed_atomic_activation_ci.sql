-- NexLupa staged PostgreSQL CI ONLY: SIGNED atomic activation with restricted role.
-- NEVER execute on Neon/production. NO real identity, Meta, or family grants.
-- Prerequisites (disposable DB only): durable inbox, consent receipt and atomic evidence schema.
-- Secret-bearing signing key must be provisioned by trusted operator in REAL design.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE nex_ci_atomic_activation_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_atomic_activation_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO
  nex_ci_atomic_activation_owner,nex_ci_atomic_activation_runtime;

-- CI analogue of the canonical family membership model.
-- NOT a migration for real nex_family_memberships.
CREATE TABLE public.nex_ci_atomic_membership_fixture (
 user_id text NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128),
 family_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','admin','member')),
 active boolean NOT NULL,
 revoked_at timestamptz,
 lock_marker bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,family_id)
);
REVOKE ALL ON public.nex_ci_atomic_membership_fixture FROM PUBLIC;
ALTER TABLE public.nex_ci_atomic_membership_fixture ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_atomic_membership_fixture FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE(lock_marker) ON public.nex_ci_atomic_membership_fixture
 TO nex_ci_atomic_activation_owner;
CREATE POLICY nex_ci_atomic_member_owner_read
 ON public.nex_ci_atomic_membership_fixture FOR SELECT
 TO nex_ci_atomic_activation_owner USING(true);

CREATE TABLE public.nex_ci_atomic_activation_keys (
 key_id text PRIMARY KEY CHECK(key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
 key_data bytea NOT NULL CHECK(octet_length(key_data)=32),
 state text NOT NULL CHECK(state IN('active','revoked'))
);
CREATE TABLE public.nex_ci_atomic_activation_nonces (
 nonce uuid PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_atomic_activation_keys,
  public.nex_ci_atomic_activation_nonces FROM PUBLIC;
ALTER TABLE public.nex_ci_atomic_activation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_atomic_activation_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_atomic_activation_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_atomic_activation_nonces FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.nex_ci_atomic_activation_keys
 TO nex_ci_atomic_activation_owner;
GRANT SELECT,INSERT ON public.nex_ci_atomic_activation_nonces
 TO nex_ci_atomic_activation_owner;
CREATE POLICY nex_ci_atomic_key_owner_read
 ON public.nex_ci_atomic_activation_keys FOR SELECT
 TO nex_ci_atomic_activation_owner USING(true);
CREATE POLICY nex_ci_atomic_nonce_owner_read
 ON public.nex_ci_atomic_activation_nonces FOR SELECT
 TO nex_ci_atomic_activation_owner USING(true);
CREATE POLICY nex_ci_atomic_nonce_owner_insert
 ON public.nex_ci_atomic_activation_nonces FOR INSERT
 TO nex_ci_atomic_activation_owner WITH CHECK(
  expires_at>clock_timestamp() AND
  expires_at<=clock_timestamp()+interval '60 seconds'
 );

-- The role that OWNS the security-definer function is NOT the table owner and
-- cannot bypass RLS. Permissions are limited to exactly these columns/rows.
GRANT SELECT,UPDATE(consumed_at) ON
 public.nex_whatsapp_verified_phone_proofs,
 public.nex_whatsapp_explicit_receipt_proofs
 TO nex_ci_atomic_activation_owner;
GRANT SELECT,INSERT ON public.nex_whatsapp_sender_authorizations
 TO nex_ci_atomic_activation_owner;
GRANT USAGE ON SEQUENCE public.nex_whatsapp_sender_authorizations_authorization_id_seq
 TO nex_ci_atomic_activation_owner;

CREATE POLICY nex_ci_atomic_phone_owner_read
 ON public.nex_whatsapp_verified_phone_proofs FOR SELECT
 TO nex_ci_atomic_activation_owner USING(true);
CREATE POLICY nex_ci_atomic_phone_owner_update
 ON public.nex_whatsapp_verified_phone_proofs FOR UPDATE
 TO nex_ci_atomic_activation_owner USING(true) WITH CHECK(true);
CREATE POLICY nex_ci_atomic_receipt_owner_read
 ON public.nex_whatsapp_explicit_receipt_proofs FOR SELECT
 TO nex_ci_atomic_activation_owner USING(true);
CREATE POLICY nex_ci_atomic_receipt_owner_update
 ON public.nex_whatsapp_explicit_receipt_proofs FOR UPDATE
 TO nex_ci_atomic_activation_owner USING(true) WITH CHECK(true);
CREATE POLICY nex_ci_atomic_auth_owner_read
 ON public.nex_whatsapp_sender_authorizations FOR SELECT
 TO nex_ci_atomic_activation_owner
 USING(scope='incoming_text' AND consent_source='account-web-consent');
CREATE POLICY nex_ci_atomic_auth_owner_insert
 ON public.nex_whatsapp_sender_authorizations FOR INSERT
 TO nex_ci_atomic_activation_owner
 WITH CHECK(scope='incoming_text' AND consent_source='account-web-consent');

CREATE FUNCTION public.nex_ci_signed_activate_atomic_consent(
 p_user text,p_family uuid,p_business text,p_phone text,
 p_proof bytea,p_receipt bytea,p_consent_version text,
 p_key_id text,p_expires bigint,p_nonce uuid,p_signature bytea
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $body$
DECLARE
 v_epoch bigint; v_key bytea; v_payload text; v_expected bytea;
 v_proof public.nex_whatsapp_verified_phone_proofs%ROWTYPE;
 v_receipt public.nex_whatsapp_explicit_receipt_proofs%ROWTYPE;
 v_used uuid; v_auth bigint; v_count integer;
BEGIN
 v_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_user IS NULL OR length(p_user) NOT BETWEEN 1 AND 128 OR
    p_user ~ '[^A-Za-z0-9_-]' OR
    p_family IS NULL OR p_business IS NULL OR
   p_business !~ '^[0-9]{5,30}$' OR
   p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$' OR
   p_proof IS NULL OR octet_length(p_proof)<>32 OR
   p_receipt IS NULL OR octet_length(p_receipt)<>32 OR
   p_consent_version IS NULL OR
   p_consent_version !~ '^[A-Za-z0-9._-]{1,40}$' OR
   p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$' OR
   p_expires IS NULL OR p_expires<=v_epoch OR p_expires>v_epoch+60 OR
   p_nonce IS NULL OR
   p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 SELECT key_data INTO v_key
 FROM public.nex_ci_atomic_activation_keys
 WHERE key_id=p_key_id AND state='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 v_payload=concat_ws('|','NEXLUPA-ATOMIC-ACTIVATE-1',
  p_key_id,p_user,p_family::text,p_business,p_phone,encode(p_proof,'hex'),
  encode(p_receipt,'hex'),p_consent_version,p_expires::text,p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_expected<>p_signature THEN
  RETURN jsonb_build_object('state','rejected'); END IF;

 -- The membership check happens inside this SAME SQL transaction.
 -- SHARE locking serializes any concurrent admin removal and enrollment.
 PERFORM 1 FROM public.nex_ci_atomic_membership_fixture
 WHERE user_id=p_user AND family_id=p_family
   AND role IN('owner','admin') AND active=true AND revoked_at IS NULL
 FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;

 -- The proof and receipt are locked before any authorization is created.
 SELECT * INTO v_proof
 FROM public.nex_whatsapp_verified_phone_proofs
 WHERE proof_digest=p_proof AND consumed_at IS NULL
   AND expires_at>clock_timestamp() AND verified_at<=clock_timestamp()
   AND verified_at>=clock_timestamp()-interval '15 minutes'
 FOR UPDATE;
 IF NOT FOUND OR v_proof.family_id<>p_family OR
    v_proof.business_account_id<>p_business OR
    v_proof.phone_number_id<>p_phone
 THEN RETURN jsonb_build_object('state','rejected'); END IF;
 SELECT * INTO v_receipt
 FROM public.nex_whatsapp_explicit_receipt_proofs
 WHERE receipt_digest=p_receipt AND consumed_at IS NULL
   AND expires_at>clock_timestamp() AND accepted_at<=clock_timestamp()
   AND accepted_at>=clock_timestamp()-interval '15 minutes'
 FOR UPDATE;
 IF NOT FOUND OR v_receipt.family_id<>p_family OR
    v_receipt.business_account_id<>p_business OR
    v_receipt.phone_number_id<>p_phone OR
    v_receipt.proof_digest<>p_proof OR
    v_receipt.sender_digest<>v_proof.sender_digest OR
    v_receipt.scope<>'incoming_text' OR
    v_receipt.consent_version<>p_consent_version OR
    v_receipt.source<>'account-web-consent'
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_ci_atomic_activation_nonces(nonce,expires_at)
 VALUES(p_nonce,to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_used;
 IF v_used IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;
 INSERT INTO public.nex_whatsapp_sender_authorizations(
  business_account_id,phone_number_id,sender_digest,family_id,
  scope,consent_version,consent_at,consent_source,consent_receipt_digest,
  valid_until
 ) VALUES(p_business,p_phone,v_proof.sender_digest,p_family,
    'incoming_text',v_receipt.consent_version,v_receipt.accepted_at,
    'account-web-consent',p_receipt,clock_timestamp()+interval '30 days')
 ON CONFLICT DO NOTHING RETURNING authorization_id INTO v_auth;
 IF v_auth IS NULL THEN RETURN jsonb_build_object('state','rejected'); END IF;

 UPDATE public.nex_whatsapp_verified_phone_proofs
 SET consumed_at=clock_timestamp()
 WHERE proof_digest=p_proof AND consumed_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'Atomic proof consumption failed'; END IF;
 UPDATE public.nex_whatsapp_explicit_receipt_proofs
 SET consumed_at=clock_timestamp()
 WHERE receipt_digest=p_receipt AND consumed_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'Atomic receipt consumption failed'; END IF;
 RETURN jsonb_build_object('state','enrolled');
END;
$body$;
ALTER FUNCTION public.nex_ci_signed_activate_atomic_consent(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 OWNER TO nex_ci_atomic_activation_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_activate_atomic_consent(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_activate_atomic_consent(
 text,uuid,text,text,bytea,bytea,text,text,bigint,uuid,bytea)
 TO nex_ci_atomic_activation_runtime;

-- No direct table or signing-key access is granted to the runtime role.
-- A stolen runtime DB credential alone cannot forge a signed activation.
-- A compromised app signer COULD issue unwanted permits: real signer must
-- validate current canonical membership and verified external sessions.
