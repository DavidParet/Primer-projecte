-- NexLupa · restricted family inbox SQL lifecycle. Disposable PostgreSQL 17 ONLY.
-- Requires earlier durable inbox, canonical identity and pairing SQL fixtures.
-- Uses synthetic encrypted-looking bytes. NEVER run on Neon or real data.
\set ON_ERROR_STOP on

DO $body$
BEGIN
 IF NOT (SELECT c.relforcerowsecurity AND c.relrowsecurity
   FROM pg_class c WHERE c.oid='public.nex_whatsapp_inbound'::regclass)
 THEN RAISE EXCEPTION 'Inbox reader requires FORCE RLS'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles
    WHERE rolname IN ('nex_ci_inbox_reader_owner','nex_ci_inbox_reader_runtime')
    AND (rolcanlogin OR rolsuper OR rolbypassrls))
 THEN RAISE EXCEPTION 'Inbox roles cannot login or bypass RLS'; END IF;
 IF has_function_privilege('nex_ci_canonical_identity_runtime',
    'public.nex_ci_read_family_whatsapp_inbox(text,uuid,bigint,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Canonical lookup runtime may execute inbox reader'; END IF;
END;
$body$;

INSERT INTO public.nex_users(user_id)
VALUES('ci-inbox-member-b');
INSERT INTO public.nex_family_memberships(user_id,family_id,role,status)
VALUES('ci-inbox-member-b','22222222-2222-4222-8222-222222222222',
 'member','active');

-- 23 unexpired rows for Family A; an expired row; one separate row for B.
-- Raw plaintext and personal sender identities are NOT in this fixture.
INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,
 family_id,sender_digest,provider_sent_at,expires_at,
 nonce,authentication_tag,ciphertext
)
SELECT '123456789','987654321','wamid.inbox-ci-a-'||i,
 '11111111-1111-4111-8111-111111111111'::uuid,
 decode(repeat('11',32),'hex'),clock_timestamp(),
 clock_timestamp()+interval '1 day',
 decode(repeat('aa',12),'hex'),decode(repeat('bb',16),'hex'),
 decode('01','hex')
FROM generate_series(1,23) AS i;

INSERT INTO public.nex_whatsapp_inbound(
 business_account_id,phone_number_id,provider_message_id,
 family_id,sender_digest,provider_sent_at,expires_at,
 nonce,authentication_tag,ciphertext
) VALUES
('123456789','987654321','wamid.inbox-ci-a-expired',
 '11111111-1111-4111-8111-111111111111',
 decode(repeat('11',32),'hex'),clock_timestamp(),
 clock_timestamp()-interval '1 minute',
 decode(repeat('aa',12),'hex'),decode(repeat('bb',16),'hex'),decode('01','hex')),
('123456789','987654321','wamid.inbox-ci-b-1',
 '22222222-2222-4222-8222-222222222222',
 decode(repeat('22',32),'hex'),clock_timestamp(),
 clock_timestamp()+interval '1 day',
 decode(repeat('aa',12),'hex'),decode(repeat('bb',16),'hex'),decode('01','hex'));

SET ROLE nex_ci_inbox_reader_runtime;
DO $body$
DECLARE n integer;v_cursor bigint;
BEGIN
 IF has_table_privilege(current_user,'public.nex_whatsapp_inbound','SELECT')
  OR has_table_privilege(current_user,'public.nex_whatsapp_inbound','INSERT')
  OR has_table_privilege(current_user,'public.nex_whatsapp_inbound','DELETE')
  OR has_table_privilege(current_user,'public.nex_family_memberships','SELECT')
  OR has_table_privilege(current_user,'public.nex_users','SELECT')
  OR has_function_privilege(current_user,
      'public.nex_ci_authorize_canonical_family_locked(text,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Family inbox runtime has excess SQL privileges'; END IF;
 BEGIN
  PERFORM 1 FROM public.nex_whatsapp_inbound;
  RAISE EXCEPTION 'Runtime obtained direct table access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 -- Can read its own family but never the other family's ciphertext.
 SELECT count(*) INTO n FROM public.nex_ci_read_family_whatsapp_inbox(
  'canonical-a','11111111-1111-4111-8111-111111111111',NULL,20);
 IF n<>20 THEN RAISE EXCEPTION 'Expected exactly 20 A rows, got %',n; END IF;
 IF EXISTS (
  SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
   'canonical-a','11111111-1111-4111-8111-111111111111',NULL,20)
  WHERE family_id <> '11111111-1111-4111-8111-111111111111'::uuid
     OR expires_at<=clock_timestamp()
 ) THEN RAISE EXCEPTION 'A received foreign or expired inbox data'; END IF;

 SELECT min(inbound_id) INTO v_cursor
 FROM public.nex_ci_read_family_whatsapp_inbox(
  'canonical-a','11111111-1111-4111-8111-111111111111',NULL,20);
 SELECT count(*) INTO n FROM public.nex_ci_read_family_whatsapp_inbox(
  'canonical-a','11111111-1111-4111-8111-111111111111',v_cursor,20)
 WHERE provider_message_id ~ '^wamid[.]inbox-ci-a-[0-9]+

 SELECT count(*) INTO n FROM public.nex_ci_read_family_whatsapp_inbox(
  'ci-inbox-member-b','22222222-2222-4222-8222-222222222222',NULL,20)
 WHERE provider_message_id='wamid.inbox-ci-b-1';
 IF n<>1 THEN RAISE EXCEPTION 'B fixture row missing, got %',n; END IF;

 IF EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','22222222-2222-4222-8222-222222222222',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'ci-inbox-member-b','11111111-1111-4111-8111-111111111111',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-disabled','11111111-1111-4111-8111-111111111111',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','11111111-1111-4111-8111-111111111111',NULL,21))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','11111111-1111-4111-8111-111111111111',0,20))
  THEN RAISE EXCEPTION 'Unlinked/disabled/invalid query leaked data'; END IF;
END;
$body$;
RESET ROLE;

UPDATE public.nex_family_memberships
SET status='suspended',updated_at=clock_timestamp()
WHERE user_id='ci-inbox-member-b'
 AND family_id='22222222-2222-4222-8222-222222222222';

SET ROLE nex_ci_inbox_reader_runtime;
DO $body$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
  'ci-inbox-member-b','22222222-2222-4222-8222-222222222222',NULL,10))
 THEN RAISE EXCEPTION 'Suspended B member retained inbox access'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
  'canonical-a','11111111-1111-4111-8111-111111111111',NULL,10))
 THEN RAISE EXCEPTION 'Suspending B unexpectedly removed A data'; END IF;
END;
$body$;
RESET ROLE;

SELECT 'CI only: canonical family inbox read RLS and limited RPC passed' AS result;
;
 IF n<>3 THEN RAISE EXCEPTION 'Cursor expected 3 more fixture A rows, got %',n; END IF;

 SELECT count(*) INTO n FROM public.nex_ci_read_family_whatsapp_inbox(
  'ci-inbox-member-b','22222222-2222-4222-8222-222222222222',NULL,20);
 IF n<>1 THEN RAISE EXCEPTION 'B should read only one record, got %',n; END IF;

 IF EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','22222222-2222-4222-8222-222222222222',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'ci-inbox-member-b','11111111-1111-4111-8111-111111111111',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-disabled','11111111-1111-4111-8111-111111111111',NULL,20))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','11111111-1111-4111-8111-111111111111',NULL,21))
  OR EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
    'canonical-a','11111111-1111-4111-8111-111111111111',0,20))
  THEN RAISE EXCEPTION 'Unlinked/disabled/invalid query leaked data'; END IF;
END;
$body$;
RESET ROLE;

UPDATE public.nex_family_memberships
SET status='suspended',updated_at=clock_timestamp()
WHERE user_id='ci-inbox-member-b'
 AND family_id='22222222-2222-4222-8222-222222222222';

SET ROLE nex_ci_inbox_reader_runtime;
DO $body$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
  'ci-inbox-member-b','22222222-2222-4222-8222-222222222222',NULL,10))
 THEN RAISE EXCEPTION 'Suspended B member retained inbox access'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_ci_read_family_whatsapp_inbox(
  'canonical-a','11111111-1111-4111-8111-111111111111',NULL,10))
 THEN RAISE EXCEPTION 'Suspending B unexpectedly removed A data'; END IF;
END;
$body$;
RESET ROLE;

SELECT 'CI only: canonical family inbox read RLS and limited RPC passed' AS result;
