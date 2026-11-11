-- NexLupa CI ONLY: signed, one-use family inbox read permit.
-- Disposable PostgreSQL 17, NEVER execute on Neon or production.
-- Prerequisite: 20261112_whatsapp_family_inbox_reader_ci.sql.
-- A runtime that only has SQL EXECUTE cannot claim somebody else's user ID:
-- a separate trusted session verifier must HMAC-sign the exact read request.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.nex_ci_inbox_read_keys(
 key_id text PRIMARY KEY CHECK(key_id ~ '^[a-z][a-z0-9_-]{2,39}$'),
 key_data bytea NOT NULL CHECK(octet_length(key_data)=32),
 state text NOT NULL CHECK(state IN ('active','revoked'))
);
CREATE TABLE public.nex_ci_inbox_read_nonces(
 nonce uuid PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
REVOKE ALL ON public.nex_ci_inbox_read_keys,
 public.nex_ci_inbox_read_nonces FROM PUBLIC;
ALTER TABLE public.nex_ci_inbox_read_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbox_read_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbox_read_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_inbox_read_nonces FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.nex_ci_inbox_read_keys TO nex_ci_inbox_reader_owner;
GRANT INSERT ON public.nex_ci_inbox_read_nonces TO nex_ci_inbox_reader_owner;
CREATE POLICY nex_ci_inbox_key_select
 ON public.nex_ci_inbox_read_keys FOR SELECT
 TO nex_ci_inbox_reader_owner USING(true);
CREATE POLICY nex_ci_inbox_nonce_insert
 ON public.nex_ci_inbox_read_nonces FOR INSERT
 TO nex_ci_inbox_reader_owner
 WITH CHECK(expires_at>clock_timestamp() AND
  expires_at<=clock_timestamp()+interval '45 seconds');

-- The legacy function accepts an unverified user ID and MUST NOT be
-- exposed even to the restricted runtime once a signed alternative exists.
REVOKE ALL ON FUNCTION public.nex_ci_read_family_whatsapp_inbox(
 text,uuid,bigint,integer) FROM nex_ci_inbox_reader_runtime;

CREATE FUNCTION public.nex_ci_signed_read_family_whatsapp_inbox(
 p_user text,p_family uuid,p_session_digest bytea,
 p_before bigint,p_limit integer,p_key_id text,
 p_expires bigint,p_nonce uuid,p_signature bytea
) RETURNS TABLE(
 inbound_id bigint,family_id uuid,business_account_id text,
 phone_number_id text,provider_message_id text,sender_digest bytea,
 nonce bytea,authentication_tag bytea,ciphertext bytea,
 received_at timestamptz,expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $body$
DECLARE
 v_epoch bigint;v_key bytea;v_expected bytea;v_payload text;v_used uuid;
BEGIN
 v_epoch=floor(extract(epoch from clock_timestamp()))::bigint;
 IF p_user IS NULL OR p_user !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_family IS NULL OR p_session_digest IS NULL
    OR octet_length(p_session_digest)<>32
    OR p_before IS NOT NULL AND p_before<=0
    OR p_limit IS NULL OR p_limit<1 OR p_limit>20
    OR p_key_id IS NULL OR p_key_id !~ '^[a-z][a-z0-9_-]{2,39}$'
    OR p_expires IS NULL OR p_expires<=v_epoch OR p_expires>v_epoch+45
    OR p_nonce IS NULL OR p_signature IS NULL OR octet_length(p_signature)<>32
 THEN RETURN; END IF;

 SELECT key_data INTO v_key
 FROM public.nex_ci_inbox_read_keys
 WHERE key_id=p_key_id AND state='active';
 IF NOT FOUND THEN RETURN; END IF;
 v_payload=concat_ws('|','NEXLUPA-INBOX-READ-1',p_key_id,p_user,
  p_family::text,encode(p_session_digest,'hex'),
  coalesce(p_before::text,'0'),p_limit::text,p_expires::text,p_nonce::text);
 v_expected=public.hmac(convert_to(v_payload,'UTF8'),v_key,'sha256');
 IF v_expected<>p_signature THEN RETURN; END IF;

 -- Lock canonical member row during read; prevent revocation race.
 IF public.nex_ci_authorize_canonical_family_locked(
   p_user,p_family,'read_whatsapp_messages') IS DISTINCT FROM TRUE
 THEN RETURN; END IF;

 -- A read permit can be consumed only once. Replays, concurrent duplicates,
 -- expired and revoked-key signatures cannot retrieve ciphertext.
 INSERT INTO public.nex_ci_inbox_read_nonces(nonce,expires_at)
 VALUES(p_nonce,to_timestamp(p_expires))
 ON CONFLICT DO NOTHING RETURNING nonce INTO v_used;
 IF v_used IS NULL THEN RETURN; END IF;

 RETURN QUERY
 SELECT i.inbound_id,i.family_id,i.business_account_id,
        i.phone_number_id,i.provider_message_id,i.sender_digest,
        i.nonce,i.authentication_tag,i.ciphertext,
        i.received_at,i.expires_at
 FROM public.nex_whatsapp_inbound AS i
 WHERE i.family_id=p_family
   AND i.expires_at>clock_timestamp()
   AND (p_before IS NULL OR i.inbound_id<p_before)
 ORDER BY i.inbound_id DESC LIMIT p_limit;
END;
$body$;
ALTER FUNCTION public.nex_ci_signed_read_family_whatsapp_inbox(
 text,uuid,bytea,bigint,integer,text,bigint,uuid,bytea)
 OWNER TO nex_ci_inbox_reader_owner;
REVOKE ALL ON FUNCTION public.nex_ci_signed_read_family_whatsapp_inbox(
 text,uuid,bytea,bigint,integer,text,bigint,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_signed_read_family_whatsapp_inbox(
 text,uuid,bytea,bigint,integer,text,bigint,uuid,bytea)
 TO nex_ci_inbox_reader_runtime;

-- No live app credentials, real user data, public HTTP route, or Neon writes.
