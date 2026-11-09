-- TTP237: purpose-scoped pairing roles and definer functions.
-- Disposable GitHub Actions PostgreSQL 17 ONLY. NEVER run on Neon.
-- Existing CI-only TTP236 pairing tables must be created first.
\set ON_ERROR_STOP on

-- Separate runtime identities: issuance and signed-Meta confirmation must
-- never share raw DML privileges or inherit each other's SQL functions.
CREATE ROLE nex_ci_pairing_issuer NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_pairing_confirmer NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_pairing_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_pairing_issuer,nex_ci_pairing_confirmer,
 nex_ci_pairing_owner;
GRANT SELECT,INSERT,UPDATE(consumed_at)
 ON public.nex_ci_whatsapp_pairing_challenges TO nex_ci_pairing_owner;
GRANT SELECT,INSERT ON public.nex_ci_whatsapp_pairing_receipts TO nex_ci_pairing_owner;
GRANT SELECT,INSERT ON public.nex_whatsapp_sender_authorizations
 TO nex_ci_pairing_owner;
GRANT EXECUTE ON FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 TO nex_ci_pairing_owner;

ALTER TABLE public.nex_ci_whatsapp_pairing_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_whatsapp_pairing_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_whatsapp_pairing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_ci_whatsapp_pairing_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY nex_ci_pairing_owner_challenge_select
 ON public.nex_ci_whatsapp_pairing_challenges FOR SELECT
 TO nex_ci_pairing_owner USING (true);
CREATE POLICY nex_ci_pairing_owner_challenge_insert
 ON public.nex_ci_whatsapp_pairing_challenges FOR INSERT
 TO nex_ci_pairing_owner
 WITH CHECK (consumed_at IS NULL AND expires_at>created_at
  AND expires_at<=created_at+interval '10 minutes');
CREATE POLICY nex_ci_pairing_owner_challenge_update
 ON public.nex_ci_whatsapp_pairing_challenges FOR UPDATE
 TO nex_ci_pairing_owner
 USING (consumed_at IS NULL) WITH CHECK (consumed_at IS NOT NULL);

CREATE POLICY nex_ci_pairing_owner_receipt_select
 ON public.nex_ci_whatsapp_pairing_receipts FOR SELECT
 TO nex_ci_pairing_owner USING (true);
CREATE POLICY nex_ci_pairing_owner_receipt_insert
 ON public.nex_ci_whatsapp_pairing_receipts FOR INSERT
 TO nex_ci_pairing_owner WITH CHECK (true);
CREATE POLICY nex_ci_pairing_owner_consent_select
 ON public.nex_whatsapp_sender_authorizations FOR SELECT
 TO nex_ci_pairing_owner
 USING (scope='incoming_text' AND consent_source='sender_whatsapp_explicit_opt_in');
CREATE POLICY nex_ci_pairing_owner_consent_insert
 ON public.nex_whatsapp_sender_authorizations FOR INSERT
 TO nex_ci_pairing_owner
 WITH CHECK (scope='incoming_text'
  AND consent_source='sender_whatsapp_explicit_opt_in'
  AND consent_version='whatsapp-incoming-text-v1');

CREATE FUNCTION public.nex_ci_issue_whatsapp_pairing(
  p_user text,p_family uuid,p_business text,p_phone text,p_digest bytea
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $f$
DECLARE allowed boolean; added record;
BEGIN
 IF p_user IS NULL OR length(p_user)<1 OR length(p_user)>128 OR
    p_family IS NULL OR p_business IS NULL OR
    p_business !~ '^[0-9]{5,30}$' OR p_phone IS NULL OR
    p_phone !~ '^[0-9]{5,30}$' OR p_digest IS NULL OR
    octet_length(p_digest)<>32
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 SELECT public.nex_authorize_family_locked(p_user,p_family,
   'enroll_whatsapp_sender') INTO allowed;
 IF allowed IS DISTINCT FROM TRUE THEN
   RETURN jsonb_build_object('state','rejected'); END IF;

 INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
   family_id,business_account_id,phone_number_id,code_digest,
   requested_by,consent_version,expires_at
 ) VALUES(
   p_family,p_business,p_phone,p_digest,p_user,
   'whatsapp-incoming-text-v1',
   clock_timestamp()+interval '9 minutes'
 ) RETURNING challenge_id,expires_at INTO added;

 IF NOT FOUND THEN
   RAISE EXCEPTION 'Pairing challenge not created'; END IF;
 RETURN jsonb_build_object('state','created',
   'expiresAt',added.expires_at::text);
END;
$f$;
ALTER FUNCTION public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)
 OWNER TO nex_ci_pairing_owner;
REVOKE ALL ON FUNCTION public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)
 TO nex_ci_pairing_issuer;

CREATE FUNCTION public.nex_ci_confirm_whatsapp_pairing(
 p_business text,p_phone text,p_code_digest bytea,
 p_sender_digest bytea,p_provider_message text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $f$
DECLARE challenge record; allowed boolean; consumed bigint;
        granted bigint; receipt text;
BEGIN
 IF p_business IS NULL OR p_business !~ '^[0-9]{5,30}$' OR
    p_phone IS NULL OR p_phone !~ '^[0-9]{5,30}$' OR
    p_code_digest IS NULL OR octet_length(p_code_digest)<>32 OR
    p_sender_digest IS NULL OR octet_length(p_sender_digest)<>32 OR
    p_provider_message IS NULL OR
    length(p_provider_message)>262 OR
    p_provider_message !~ '^wamid[.][A-Za-z0-9._=-]+$'
 THEN RETURN jsonb_build_object('state','rejected'); END IF;

 IF EXISTS (SELECT 1 FROM public.nex_ci_whatsapp_pairing_receipts
            WHERE business_account_id=p_business
              AND provider_message_id=p_provider_message) THEN
   RETURN jsonb_build_object('state','already_processed'); END IF;

 SELECT challenge_id,family_id,requested_by,consent_version
   INTO challenge FROM public.nex_ci_whatsapp_pairing_challenges
 WHERE business_account_id=p_business AND phone_number_id=p_phone
   AND code_digest=p_code_digest AND consumed_at IS NULL
   AND expires_at>clock_timestamp()
 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','rejected'); END IF;
 IF challenge.consent_version<>'whatsapp-incoming-text-v1' THEN
   RETURN jsonb_build_object('state','rejected'); END IF;

 SELECT public.nex_authorize_family_locked(
  challenge.requested_by,challenge.family_id,
  'enroll_whatsapp_sender') INTO allowed;
 IF allowed IS DISTINCT FROM TRUE THEN
   RETURN jsonb_build_object('state','rejected'); END IF;

 UPDATE public.nex_ci_whatsapp_pairing_challenges
 SET consumed_at=clock_timestamp()
 WHERE challenge_id=challenge.challenge_id AND consumed_at IS NULL
 RETURNING challenge_id INTO consumed;
 IF consumed IS NULL THEN RAISE EXCEPTION 'Challenge race'; END IF;

 INSERT INTO public.nex_whatsapp_sender_authorizations(
  family_id,business_account_id,phone_number_id,sender_digest,
  scope,consent_version,consent_at,consent_source,valid_until
 )VALUES(
  challenge.family_id,p_business,p_phone,p_sender_digest,
  'incoming_text','whatsapp-incoming-text-v1',clock_timestamp(),
  'sender_whatsapp_explicit_opt_in',clock_timestamp()+interval '30 days'
 ) RETURNING authorization_id INTO granted;
 IF granted IS NULL THEN RAISE EXCEPTION 'Consent not persisted'; END IF;

 INSERT INTO public.nex_ci_whatsapp_pairing_receipts(
   business_account_id,provider_message_id,challenge_id
 ) VALUES(p_business,p_provider_message,challenge.challenge_id)
 ON CONFLICT DO NOTHING RETURNING provider_message_id INTO receipt;
 IF receipt IS NULL THEN
   RAISE EXCEPTION 'Duplicate provider message race'; END IF;

 RETURN jsonb_build_object('state','paired');
END;
$f$;
ALTER FUNCTION public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)
 OWNER TO nex_ci_pairing_owner;
REVOKE ALL ON FUNCTION public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)
 TO nex_ci_pairing_confirmer;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
  ('nex_ci_pairing_issuer','nex_ci_pairing_confirmer','nex_ci_pairing_owner')
  AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
   RAISE EXCEPTION 'Pairing roles have excessive global privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN (
  'public.nex_ci_whatsapp_pairing_challenges'::regclass,
  'public.nex_ci_whatsapp_pairing_receipts'::regclass,
  'public.nex_whatsapp_sender_authorizations'::regclass
 ) AND c.relowner=(SELECT oid FROM pg_roles
  WHERE rolname='nex_ci_pairing_owner')) THEN
   RAISE EXCEPTION 'Function owner also owns protected tables'; END IF;
END $$;

SET ROLE nex_ci_pairing_issuer;
DO $$
BEGIN
 IF has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_challenges','INSERT') OR
 has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_challenges','SELECT') OR
 has_table_privilege(current_user,
  'public.nex_whatsapp_sender_authorizations','INSERT') OR
 has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_receipts','INSERT') OR
 has_function_privilege(current_user,
  'public.nex_ci_confirm_whatsapp_pairing(text,text,bytea,bytea,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Issuer can bypass restricted function'; END IF;
 BEGIN
  INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
   family_id,business_account_id,phone_number_id,code_digest,
   requested_by,consent_version,expires_at
  ) VALUES('11111111-1111-4111-8111-111111111111',
   '744441234','844441234',decode(repeat('a1',32),'hex'),
   'account-a','whatsapp-incoming-text-v1',
   clock_timestamp()+interval '1 minute');
  RAISE EXCEPTION 'Direct challenge INSERT succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT (public.nex_ci_issue_whatsapp_pairing(
 'account-b','22222222-2222-4222-8222-222222222222',
 '744441234','844441234',decode(repeat('a2',32),'hex'))->>'state'
 ='rejected') AS denied_member \gset
\if :denied_member
\else
 \echo 'Member B forged pairing administrator'
 \quit 1
\endif

SELECT (public.nex_ci_issue_whatsapp_pairing(
 'account-a','22222222-2222-4222-8222-222222222222',
 '744441234','844441234',decode(repeat('a3',32),'hex'))->>'state'
 ='rejected') AS denied_cross_family \gset
\if :denied_cross_family
\else
 \echo 'Administrator A issued pairing in family B'
 \quit 1
\endif

SELECT (public.nex_ci_issue_whatsapp_pairing(
 'account-a','11111111-1111-4111-8111-111111111111',
 '744441234','844441234',decode(repeat('a4',32),'hex'))->>'state'
 ='created') AS created \gset
\if :created
\else
 \echo 'Restricted authorized issue operation failed'
 \quit 1
\endif
RESET ROLE;

SET ROLE nex_ci_pairing_confirmer;
DO $$
BEGIN
 IF has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_challenges','SELECT') OR
 has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_challenges','UPDATE') OR
 has_table_privilege(current_user,
  'public.nex_ci_whatsapp_pairing_receipts','INSERT') OR
 has_table_privilege(current_user,
  'public.nex_whatsapp_sender_authorizations','INSERT') OR
 has_function_privilege(current_user,
  'public.nex_ci_issue_whatsapp_pairing(text,uuid,text,text,bytea)','EXECUTE')
 THEN RAISE EXCEPTION 'Confirmation role can bypass function boundary'; END IF;
 BEGIN
  INSERT INTO public.nex_whatsapp_sender_authorizations(
   business_account_id,phone_number_id,sender_digest,family_id,
   scope,consent_version,consent_at,consent_source
  )VALUES(
   '744441234','844441234',decode(repeat('a9',32),'hex'),
   '11111111-1111-4111-8111-111111111111','incoming_text',
   'whatsapp-incoming-text-v1',clock_timestamp(),
   'sender_whatsapp_explicit_opt_in'
  );
  RAISE EXCEPTION 'Direct family consent INSERT succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT (public.nex_ci_confirm_whatsapp_pairing(
 '744441234','844441234',
 decode(repeat('a4',32),'hex'),decode(repeat('b4',32),'hex'),
 'wamid.ttp237-first')->>'state'='paired') AS paired \gset
\if :paired
\else
 \echo 'Restricted signed confirmation was not persisted'
 \quit 1
\endif

SELECT (public.nex_ci_confirm_whatsapp_pairing(
 '744441234','844441234',
 decode(repeat('a4',32),'hex'),decode(repeat('b4',32),'hex'),
 'wamid.ttp237-first')->>'state'='already_processed') AS repeated \gset
\if :repeated
\else
 \echo 'Duplicate provider event was not idempotent'
 \quit 1
\endif

SELECT (public.nex_ci_confirm_whatsapp_pairing(
 '744441234','844441234',
 decode(repeat('a4',32),'hex'),decode(repeat('b4',32),'hex'),
 'wamid.ttp237-second')->>'state'='rejected') AS consumed_denied \gset
\if :consumed_denied
\else
 \echo 'Consumed code accepted with new provider message'
 \quit 1
\endif
RESET ROLE;

-- Unrelated role must not execute either privileged pairing function.
SET ROLE whatsapp_ci_unauthorized;
DO $$
BEGIN
 BEGIN
  PERFORM public.nex_ci_issue_whatsapp_pairing('account-a',
   '11111111-1111-4111-8111-111111111111',
   '744441234','844441234',decode(repeat('a5',32),'hex'));
  RAISE EXCEPTION 'Unrelated role could issue pairing';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.nex_ci_confirm_whatsapp_pairing(
   '744441234','844441234',decode(repeat('a4',32),'hex'),
   decode(repeat('b4',32),'hex'),'wamid.ttp237-third');
  RAISE EXCEPTION 'Unrelated role could confirm pairing';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE sender_digest=decode(repeat('b4',32),'hex')
    AND family_id='11111111-1111-4111-8111-111111111111'
    AND consent_source='sender_whatsapp_explicit_opt_in'
    AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Consent not committed for intended family'; END IF;
 IF (SELECT count(*) FROM public.nex_ci_whatsapp_pairing_receipts
  WHERE provider_message_id='wamid.ttp237-first')<>1
 THEN RAISE EXCEPTION 'Pairing event receipt not recorded exactly once'; END IF;
END $$;

SELECT 'TTP237 purpose-scoped pairing role and RLS function checks passed' AS result;
