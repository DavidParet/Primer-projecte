-- NexLupa WhatsApp inbound: CI-ONLY signed, restricted, encrypted ingress.
-- PostgreSQL 17 ephemeral runner ONLY. NEVER run against Neon or production.
-- PREREQUISITES: prototype durable schema and pgcrypto installed by CI.
-- Only a TRUSTED backend which verified Meta's signature over RAW bytes may
-- sign permits. A bare DB runtime credential is not an authentication proof.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE nex_ci_inbound_ingest_owner
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_inbound_ingest_runtime
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public
 TO nex_ci_inbound_ingest_owner,nex_ci_inbound_ingest_runtime;

CREATE TABLE public.nex_ci_inbound_ingest_keys(
 key_id text PRIMARY KEY CHECK(key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
 key_data bytea NOT NULL CHECK(octet_length(key_data)=32),
 state text NOT NULL CHECK(state IN ('active','revoked'))
);
CREATE TABLE public.nex_ci_inbound_ingest_nonces(
 nonce uuid PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_inbound_ingest_keys,
 public.nex_ci_inbound_ingest_nonces FROM PUBLIC;
ALTER TABLE public.nex_ci_inbound_ingest_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbound_ingest_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbound_ingest_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbound_ingest_nonces FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.nex_ci_inbound_ingest_keys TO nex_ci_inbound_ingest_owner;
GRANT INSERT ON public.nex_ci_inbound_ingest_nonces TO nex_ci_inbound_ingest_owner;
CREATE POLICY nex_ci_ingest_key_read
 ON public.nex_ci_inbound_ingest_keys FOR SELECT
 TO nex_ci_inbound_ingest_owner USING (true);
CREATE POLICY nex_ci_ingest_nonce_write
 ON public.nex_ci_inbound_ingest_nonces FOR INSERT
 TO nex_ci_inbound_ingest_owner WITH CHECK (
  expires_at>clock_timestamp()
  AND expires_at<=clock_timestamp()+interval '45 seconds'
 );

-- The function owner (a NOLOGIN role) can only read active consents and
-- store/recheck encrypted inbound rows. The runtime role has NO table rights.
-- UPDATE(consent_at) is required for PostgreSQL FOR SHARE row locking;
-- this narrow owner privilege still needs independent review before preview.
GRANT SELECT (
 authorization_id,family_id,business_account_id,phone_number_id,
 sender_digest,scope,consent_at,revoked_at,valid_until
) ON public.nex_whatsapp_sender_authorizations TO nex_ci_inbound_ingest_owner;
GRANT UPDATE(consent_at) ON public.nex_whatsapp_sender_authorizations
 TO nex_ci_inbound_ingest_owner;
CREATE POLICY nex_ci_ingest_consent_select
 ON public.nex_whatsapp_sender_authorizations FOR SELECT
 TO nex_ci_inbound_ingest_owner USING (
  scope='incoming_text' AND revoked_at IS NULL
 );
CREATE POLICY nex_ci_ingest_consent_lock
 ON public.nex_whatsapp_sender_authorizations FOR UPDATE
 TO nex_ci_inbound_ingest_owner
 USING (scope='incoming_text' AND revoked_at IS NULL)
 WITH CHECK (scope='incoming_text' AND revoked_at IS NULL);

GRANT SELECT (
 inbound_id,family_id,business_account_id,phone_number_id,
 provider_message_id,sender_digest,provider_sent_at,expires_at
) ON public.nex_whatsapp_inbound TO nex_ci_inbound_ingest_owner;
GRANT INSERT (
 business_account_id,phone_number_id,provider_message_id,
 family_id,sender_digest,provider_sent_at,nonce,authentication_tag,
 ciphertext,expires_at
) ON public.nex_whatsapp_inbound TO nex_ci_inbound_ingest_owner;
GRANT USAGE ON SEQUENCE public.nex_whatsapp_inbound_inbound_id_seq
 TO nex_ci_inbound_ingest_owner;
CREATE POLICY nex_ci_ingest_existing_read
 ON public.nex_whatsapp_inbound FOR SELECT TO nex_ci_inbound_ingest_owner
 USING (expires_at>clock_timestamp());
CREATE POLICY nex_ci_ingest_encrypted_write
 ON public.nex_whatsapp_inbound FOR INSERT TO nex_ci_inbound_ingest_owner
 WITH CHECK (expires_at>clock_timestamp()
   AND expires_at<=clock_timestamp()+interval '8 days'
   AND octet_length(ciphertext)>0 AND octet_length(ciphertext)<=65536);

CREATE FUNCTION public.nex_ci_signed_store_whatsapp_inbound(
 p_business text,p_phone text,p_sender bytea,p_message_id text,
 p_iv bytea,p_tag bytea,p_ciphertext bytea,p_timestamp bigint,
 p_key_id text,p_expires bigint,p_nonce uuid,p_signature bytea
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $body$
DECLARE
 v_epoch bigint;v_key bytea;v_payload text;v_expected bytea;
 v_family uuid;v_saved uuid;v_inserted integer;
BEGIN
 v_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_business IS NULL OR p_business !~ '^[0-9]{5,30}$'
   OR p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$'
   OR p_sender IS NULL OR octet_length(p_sender)<>32
   OR p_message_id IS NULL OR length(p_message_id)>262 OR p_message_id !~
      '^wamid[.][A-Za-z0-9._=-]+$'
   OR p_iv IS NULL OR octet_length(p_iv)<>12
   OR p_tag IS NULL OR octet_length(p_tag)<>16
   OR p_ciphertext IS NULL OR octet_length(p_ciphertext)<1
   OR octet_length(p_ciphertext)>65536
   OR p_timestamp IS NULL OR p_timestamp<100000000 OR
      p_timestamp>999999999999
   OR p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$'
   OR p_expires IS NULL OR p_expires<=v_epoch OR p_expires>v_epoch+45
   OR p_nonce IS NULL OR p_signature IS NULL OR
      octet_length(p_signature)<>32
 THEN RETURN 'unlinked'; END IF;

 SELECT key_data INTO v_key
 FROM public.nex_ci_inbound_ingest_keys
 WHERE key_id=p_key_id AND state='active';
 IF NOT FOUND THEN RETURN 'unlinked'; END IF;
 v_payload=concat_ws('|','NEXLUPA-WA-INGEST-1',p_key_id,
  p_business,p_phone,encode(p_sender,'hex'),p_message_id,
  encode(p_iv,'hex'),encode(p_tag,'hex'),
  encode(public.digest(p_ciphertext,'sha256'),'hex'),
  p_timestamp::text,p_expires::text,p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_expected<>p_signature THEN RETURN 'unlinked'; END IF;

 -- Lock the consent row while saving the encrypted text. Revocation must
 -- wait or win the lock; a revoked sender cannot be silently enrolled.
 SELECT family_id INTO v_family
 FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id=p_business AND phone_number_id=p_phone
  AND sender_digest=p_sender AND scope='incoming_text'
  AND consent_at<=clock_timestamp() AND revoked_at IS NULL
  AND (valid_until IS NULL OR valid_until>clock_timestamp())
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE;
 IF NOT FOUND THEN RETURN 'unlinked'; END IF;

 INSERT INTO public.nex_ci_inbound_ingest_nonces(nonce,expires_at)
 VALUES(p_nonce,to_timestamp(p_expires)) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted<>1 THEN RETURN 'unlinked'; END IF;

 INSERT INTO public.nex_whatsapp_inbound(
  business_account_id,phone_number_id,provider_message_id,
  family_id,sender_digest,provider_sent_at,
  nonce,authentication_tag,ciphertext,expires_at
 ) VALUES(
  p_business,p_phone,p_message_id,v_family,p_sender,to_timestamp(p_timestamp),
  p_iv,p_tag,p_ciphertext,clock_timestamp()+interval '7 days'
 ) ON CONFLICT (business_account_id,provider_message_id) DO NOTHING
 RETURNING family_id INTO v_saved;
 IF v_saved IS NOT NULL THEN RETURN 'stored'; END IF;

 -- Never ACK collisions belonging to a different family/sender/time.
 IF EXISTS(
  SELECT 1 FROM public.nex_whatsapp_inbound AS i
  WHERE i.business_account_id=p_business
   AND i.phone_number_id=p_phone
   AND i.provider_message_id=p_message_id
   AND i.family_id=v_family
   AND i.sender_digest=p_sender
   AND i.provider_sent_at=to_timestamp(p_timestamp)
   AND i.expires_at>clock_timestamp()
 ) THEN RETURN 'duplicate'; END IF;
 RETURN 'unlinked';
END;
$body$;
ALTER FUNCTION public.nex_ci_signed_store_whatsapp_inbound(
 text,text,bytea,text,bytea,bytea,bytea,bigint,text,bigint,uuid,bytea)
 OWNER TO nex_ci_inbound_ingest_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_store_whatsapp_inbound(
 text,text,bytea,text,bytea,bytea,bytea,bigint,text,bigint,uuid,bytea)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_store_whatsapp_inbound(
 text,text,bytea,text,bytea,bytea,bytea,bigint,text,bigint,uuid,bytea)
 TO nex_ci_inbound_ingest_runtime;

-- Database role cannot issue its own permits or see real phone/text.
-- This file contains synthetic CI roles only, no live service credentials.
