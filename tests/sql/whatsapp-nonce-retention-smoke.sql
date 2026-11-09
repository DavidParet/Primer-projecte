-- TTP234 nonce retention — disposable PostgreSQL 17 CI ONLY.
-- Requires TTP232/233 signed permit and keyring fixtures.
-- Do NOT run against Neon or production.
\set ON_ERROR_STOP on

CREATE INDEX nex_ci_nonce_retention_expiration
 ON public.nex_ci_revocation_permit_uses(expires_at,nonce);
ALTER TABLE public.nex_ci_revocation_permit_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_revocation_permit_uses FORCE ROW LEVEL SECURITY;

-- Preserve verified single-use insert semantics for the definer owner after
-- FORCE RLS; no DELETE and no UPDATE is granted to that owner.
CREATE POLICY nex_ci_nonce_verifier_insert
 ON public.nex_ci_revocation_permit_uses FOR INSERT
 TO nex_ci_signed_revoke_owner
 WITH CHECK (expires_at > clock_timestamp()
   AND expires_at <= clock_timestamp()+interval '90 seconds');
CREATE POLICY nex_ci_nonce_verifier_select
 ON public.nex_ci_revocation_permit_uses FOR SELECT
 TO nex_ci_signed_revoke_owner USING (true);

CREATE ROLE nex_ci_nonce_retention
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_nonce_retention;
GRANT SELECT,DELETE ON public.nex_ci_revocation_permit_uses
 TO nex_ci_nonce_retention;

-- The five-minute grace window is enforced AGAIN at the database RLS layer,
-- independently of the app worker's query. No membership/consent privileges.
CREATE POLICY nex_ci_nonce_retention_select
 ON public.nex_ci_revocation_permit_uses FOR SELECT
 TO nex_ci_nonce_retention
 USING (expires_at < clock_timestamp()-interval '5 minutes');
CREATE POLICY nex_ci_nonce_retention_delete
 ON public.nex_ci_revocation_permit_uses FOR DELETE
 TO nex_ci_nonce_retention
 USING (expires_at < clock_timestamp()-interval '5 minutes');

INSERT INTO public.nex_ci_revocation_permit_uses(nonce,expires_at) VALUES
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',clock_timestamp()-interval '20 minutes'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',clock_timestamp()-interval '10 minutes'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',clock_timestamp()-interval '6 minutes'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',clock_timestamp()-interval '1 minute'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05',clock_timestamp()+interval '1 minute');

SET ROLE nex_ci_nonce_retention;
DO $$
DECLARE visible int;
BEGIN
 IF has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','INSERT') OR
    has_table_privilege(current_user,
    'public.nex_ci_revocation_permit_uses','UPDATE') OR
    has_table_privilege(current_user,
    'public.nex_ci_revocation_keyring_v2','SELECT') OR
    has_table_privilege(current_user,
    'public.nex_whatsapp_sender_authorizations','UPDATE') OR
    has_table_privilege(current_user,
    'public.nex_whatsapp_inbound','DELETE')
 THEN RAISE EXCEPTION 'Nonce retention role has dangerous privileges'; END IF;
 SELECT count(*) INTO visible FROM public.nex_ci_revocation_permit_uses
 WHERE nonce::text LIKE 'eeeeeeee-eeee-4eee-8eee-%';
 IF visible<>3 THEN
   RAISE EXCEPTION 'RLS visible eligible nonce count incorrect: %',visible;
 END IF;
END $$;

-- Explicit attempt to delete a recently expired nonce must affect zero rows.
DELETE FROM public.nex_ci_revocation_permit_uses
 WHERE nonce='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04';
-- Bounded batch 1: exactly two aged nonce records.
WITH eligible AS (
 SELECT nonce FROM public.nex_ci_revocation_permit_uses
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 2
)
DELETE FROM public.nex_ci_revocation_permit_uses AS used USING eligible
WHERE used.nonce=eligible.nonce
 AND used.expires_at<clock_timestamp()-interval '5 minutes'
RETURNING used.nonce;

RESET ROLE;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.nex_ci_revocation_permit_uses
   WHERE nonce::text LIKE 'eeeeeeee-eeee-4eee-8eee-%')<>3 THEN
   RAISE EXCEPTION 'Bounded first batch deleted wrong number of nonces'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_ci_revocation_permit_uses
  WHERE nonce='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04')
 OR NOT EXISTS(SELECT 1 FROM public.nex_ci_revocation_permit_uses
  WHERE nonce='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05')
 THEN RAISE EXCEPTION 'Unexpired/grace nonce deleted'; END IF;
END $$;

SET ROLE nex_ci_nonce_retention;
-- Batch 2: only the third eligible record, NOT the two protected ones.
WITH eligible AS (
 SELECT nonce FROM public.nex_ci_revocation_permit_uses
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 2
)
DELETE FROM public.nex_ci_revocation_permit_uses AS used USING eligible
WHERE used.nonce=eligible.nonce
 AND used.expires_at<clock_timestamp()-interval '5 minutes'
RETURNING used.nonce;
RESET ROLE;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.nex_ci_revocation_permit_uses
   WHERE nonce::text LIKE 'eeeeeeee-eeee-4eee-8eee-%')<>2
 THEN RAISE EXCEPTION 'Nonce retention left eligible test rows'; END IF;
 IF (SELECT count(*) FROM public.nex_ci_revocation_permit_uses
   WHERE nonce IN (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04'::uuid,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05'::uuid
   ))<>2 THEN
  RAISE EXCEPTION 'Protected nonce unexpectedly deleted'; END IF;
END $$;

-- After any deletion of old nonce rows, the permit expiration check must
-- remain authoritative even with a syntactically valid HMAC signature.
INSERT INTO public.nex_ci_revocation_keyring_v2(key_id,key_data,state)
 VALUES ('key-cleanup',decode(repeat('ab',32),'hex'),'active');
SELECT authorization_id AS old_authorization
 FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='733330003' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint-600)
  AS expired_epoch \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-WA-REVOKE-2','key-cleanup','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'old_authorization','733330003','833330003',
 repeat('c3',32),:'expired_epoch',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'),'UTF8'),
 decode(repeat('ab',32),'hex'),'sha256'),'hex')
 AS expired_signature \gset
SET ROLE nex_ci_consent_revoker;
SELECT (public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-cleanup','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'old_authorization','733330003','833330003',
 decode(repeat('c3',32),'hex'),:'expired_epoch',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
 decode(:'expired_signature','hex'))->>'state'='rejected')
 AS denied \gset
\if :denied
\else
 \echo 'Expired permit passed verification after nonce cleanup'
 \quit 1
\endif
RESET ROLE;


-- A fresh, valid permit must STILL work after FORCE RLS on the nonce ledger.
-- This catches RLS changes that would silently disable revocation itself.
INSERT INTO public.nex_whatsapp_sender_authorizations(
 business_account_id,phone_number_id,sender_digest,family_id,scope,
 consent_version,consent_at,consent_source
)VALUES(
 '744440001','844440001',decode(repeat('d7',32),'hex'),
 '11111111-1111-4111-8111-111111111111','incoming_text',
 'ci-234',now(),'ci'
);
INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at
)VALUES(
 '744440001','844440001','wamid.ttp234.fresh',
 '11111111-1111-4111-8111-111111111111',
 decode(repeat('d7',32),'hex'),now(),decode(repeat('07',12),'hex'),
 decode(repeat('08',16),'hex'),decode('09','hex'),now()+interval '2 days'
);
SELECT authorization_id AS fresh_auth FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='744440001' \gset
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+60)
 AS fresh_exp, gen_random_uuid()::text AS fresh_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-WA-REVOKE-2','key-cleanup','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'fresh_auth','744440001','844440001',repeat('d7',32),
 :'fresh_exp',:'fresh_nonce'),'UTF8'),
 decode(repeat('ab',32),'hex'),'sha256'),'hex') AS fresh_signature \gset
SET ROLE nex_ci_consent_revoker;
BEGIN;
SELECT ((result->>'state'='revoked') AND
 (result->>'deletedMessages')::int=1) AS fresh_accepted
FROM (SELECT public.nex_ci_revoke_whatsapp_with_rotating_permit(
 'key-cleanup','account-a',
 '11111111-1111-4111-8111-111111111111',
 :'fresh_auth','744440001','844440001',
 decode(repeat('d7',32),'hex'),:'fresh_exp',
 :'fresh_nonce'::uuid,decode(:'fresh_signature','hex')) AS result) q \gset
COMMIT;
\if :fresh_accepted
\else
 \echo 'RLS broke legitimate signed consent revocation'
 \quit 1
\endif
RESET ROLE;

-- Test that the newly consumed nonce is NOT accidentally eligible for purge.
SET ROLE nex_ci_nonce_retention;
SELECT count(*)=0 AS protected
 FROM public.nex_ci_revocation_permit_uses
 WHERE nonce=:'fresh_nonce'::uuid \gset
\if :protected
\else
 \echo 'Freshly consumed nonce incorrectly exposed to deletion role'
 \quit 1
\endif
RESET ROLE;

DO $
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp233.compromised-a')
 THEN RAISE EXCEPTION 'Expired permit changed WhatsApp content'; END IF;
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp234.fresh')
 THEN RAISE EXCEPTION 'Fresh legitimate permit did not delete message'; END IF;
END $$;
SELECT 'TTP234 bounded nonce retention and expired replay checks passed' AS result;
