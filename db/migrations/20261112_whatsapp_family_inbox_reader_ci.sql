-- NexLupa · Family WhatsApp inbox SELECT RPC. CI POSTGRESQL ONLY.
-- This file requires the durable-inbox and canonical identity CI migrations.
-- NEVER execute on Neon or production. The p_user argument is NOT a session
-- proof: only an independently verified, restricted server may supply it.
-- The future preview RPC requires an audited server-to-DB identity binding.
\set ON_ERROR_STOP on

CREATE ROLE nex_ci_inbox_reader_owner
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_inbox_reader_runtime
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public
 TO nex_ci_inbox_reader_owner,nex_ci_inbox_reader_runtime;

-- The function owner can SELECT only the encrypted inbox columns, not
-- sender authorizations, canonical identity tables or writable data.
GRANT SELECT (
 inbound_id,family_id,business_account_id,phone_number_id,
 provider_message_id,sender_digest,nonce,authentication_tag,
 ciphertext,received_at,expires_at
) ON public.nex_whatsapp_inbound TO nex_ci_inbox_reader_owner;

-- FORCE RLS is already set by the prototype migration. The owner sees
-- unexpired rows only, and the definer itself must impose family isolation.
CREATE POLICY nex_ci_inbox_reader_unexpired
 ON public.nex_whatsapp_inbound FOR SELECT TO nex_ci_inbox_reader_owner
 USING (expires_at > clock_timestamp());

-- Canonical authorization is checked INSIDE this SQL call under a row
-- lock, held until the statement/transaction finishes. The RPC runtime
-- CANNOT invoke the privileged membership lock itself.
GRANT EXECUTE ON FUNCTION
 public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
 TO nex_ci_inbox_reader_owner;

CREATE FUNCTION public.nex_ci_read_family_whatsapp_inbox(
 p_user text,p_family uuid,p_before bigint,p_limit integer
) RETURNS TABLE(
 inbound_id bigint,family_id uuid,business_account_id text,
 phone_number_id text,provider_message_id text,sender_digest bytea,
 nonce bytea,authentication_tag bytea,ciphertext bytea,
 received_at timestamptz,expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $body$
BEGIN
 IF p_user IS NULL OR p_user !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_family IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>20
    OR (p_before IS NOT NULL AND p_before<=0)
 THEN RETURN; END IF;

 IF public.nex_ci_authorize_canonical_family_locked(
   p_user,p_family,'read_whatsapp_messages') IS DISTINCT FROM TRUE
 THEN RETURN; END IF;

 RETURN QUERY
 SELECT i.inbound_id,i.family_id,i.business_account_id,
        i.phone_number_id,i.provider_message_id,i.sender_digest,
        i.nonce,i.authentication_tag,i.ciphertext,
        i.received_at,i.expires_at
 FROM public.nex_whatsapp_inbound AS i
 WHERE i.family_id=p_family
   AND i.expires_at>clock_timestamp()
   AND (p_before IS NULL OR i.inbound_id<p_before)
 ORDER BY i.inbound_id DESC
 LIMIT p_limit;
END;
$body$;
ALTER FUNCTION public.nex_ci_read_family_whatsapp_inbox(
 text,uuid,bigint,integer) OWNER TO nex_ci_inbox_reader_owner;
REVOKE ALL ON FUNCTION public.nex_ci_read_family_whatsapp_inbox(
 text,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_read_family_whatsapp_inbox(
 text,uuid,bigint,integer) TO nex_ci_inbox_reader_runtime;

-- Runtime receives NO direct SELECT, INSERT, UPDATE, DELETE, canonical
-- identity access, or ability to request the membership-locking function.
-- No credential, live session, application route or Meta number is configured.
