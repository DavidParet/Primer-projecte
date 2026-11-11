-- CI ONLY. Run AFTER the legacy family inbox smoke test, never Neon.
-- Synthetic key and family IDs. This proves a bare DB runtime credential
-- cannot impersonate an arbitrary family without a correctly signed permit.
\set ON_ERROR_STOP on

INSERT INTO public.nex_ci_inbox_read_keys(key_id,key_data,state)
 VALUES('ci-inbox-read-v1',decode(repeat('ef',32),'hex'),'active');

UPDATE public.nex_family_memberships
 SET status='active',updated_at=clock_timestamp()
 WHERE user_id='ci-inbox-member-b'
 AND family_id='22222222-2222-4222-8222-222222222222';

SET ROLE nex_ci_inbox_reader_runtime;
DO $test$
DECLARE
 v_a uuid='11111111-1111-4111-8111-111111111111';
 v_b uuid='22222222-2222-4222-8222-222222222222';
 v_nonce uuid; v_exp bigint; v_session bytea;
 v_sig bytea; v_payload text; v_count integer;
 v_kid text='ci-inbox-read-v1';
 v_secret bytea=decode(repeat('ef',32),'hex'); -- CI-only fixture
BEGIN
 IF has_function_privilege(current_user,
  'public.nex_ci_read_family_whatsapp_inbox(text,uuid,bigint,integer)','EXECUTE')
 OR NOT has_function_privilege(current_user,
  'public.nex_ci_signed_read_family_whatsapp_inbox(text,uuid,bytea,bigint,integer,text,bigint,uuid,bytea)','EXECUTE')
 OR has_table_privilege(current_user,'public.nex_ci_inbox_read_keys','SELECT')
 OR has_table_privilege(current_user,'public.nex_ci_inbox_read_nonces','INSERT')
 OR has_table_privilege(current_user,'public.nex_whatsapp_inbound','SELECT')
 OR has_function_privilege(current_user,
  'public.nex_ci_authorize_canonical_family_locked(text,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Inbox runtime has excessive privileges'; END IF;

 v_nonce=gen_random_uuid();v_exp=floor(extract(epoch from clock_timestamp()))::bigint+30;
 v_session=decode(repeat('a1',32),'hex');
 v_payload=concat_ws('|','NEXLUPA-INBOX-READ-1',v_kid,
  'canonical-a',v_a::text,encode(v_session,'hex'),'0','5',
  v_exp::text,v_nonce::text);
 v_sig=public.hmac(convert_to(v_payload,'UTF8'),v_secret,'sha256');

 SELECT count(*) INTO v_count FROM public.nex_ci_signed_read_family_whatsapp_inbox(
  'canonical-a',v_a,v_session,NULL,5,v_kid,v_exp,v_nonce,v_sig);
 IF v_count<>5 THEN RAISE EXCEPTION 'Valid A permit returned % rows',v_count; END IF;

 SELECT count(*) INTO v_count FROM public.nex_ci_signed_read_family_whatsapp_inbox(
  'canonical-a',v_a,v_session,NULL,5,v_kid,v_exp,v_nonce,v_sig);
 IF v_count<>0 THEN RAISE EXCEPTION 'Replay returned A ciphertext'; END IF;

 -- Altering any signed field (family, page, limit, session) invalidates proof.
 IF EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_b,v_session,NULL,5,v_kid,v_exp,gen_random_uuid(),v_sig))
 OR EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,v_session,100,5,v_kid,v_exp,gen_random_uuid(),v_sig))
 OR EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,v_session,NULL,6,v_kid,v_exp,gen_random_uuid(),v_sig))
 OR EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,decode(repeat('a2',32),'hex'),NULL,5,v_kid,v_exp,gen_random_uuid(),v_sig))
 OR EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,v_session,NULL,5,v_kid,v_exp+300,gen_random_uuid(),v_sig))
 OR EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,v_session,NULL,5,v_kid,v_exp,gen_random_uuid(),
   decode(repeat('bb',32),'hex')))
 THEN RAISE EXCEPTION 'Modified/expired/forged read permit leaked data'; END IF;

 -- A different family must receive only its own synthetic inbox entries,
 -- even though both readers use the same restricted SQL runtime role.
 v_nonce=gen_random_uuid();
 v_session=decode(repeat('b1',32),'hex');
 v_payload=concat_ws('|','NEXLUPA-INBOX-READ-1',v_kid,
  'ci-inbox-member-b',v_b::text,encode(v_session,'hex'),'0','5',
  v_exp::text,v_nonce::text);
 v_sig=public.hmac(convert_to(v_payload,'UTF8'),v_secret,'sha256');
 SELECT count(*) INTO v_count
 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
  'ci-inbox-member-b',v_b,v_session,NULL,5,v_kid,v_exp,v_nonce,v_sig)
 WHERE family_id=v_b;
 IF v_count<1 THEN RAISE EXCEPTION 'Valid B permit cannot read B'; END IF;
END;
$test$;
RESET ROLE;

UPDATE public.nex_family_memberships
 SET status='suspended',updated_at=clock_timestamp()
 WHERE user_id='ci-inbox-member-b'
 AND family_id='22222222-2222-4222-8222-222222222222';

SET ROLE nex_ci_inbox_reader_runtime;
DO $test$
DECLARE
 v_b uuid='22222222-2222-4222-8222-222222222222';
 v_nonce uuid=gen_random_uuid();
 v_exp bigint=floor(extract(epoch from clock_timestamp()))::bigint+30;
 v_session bytea=decode(repeat('b1',32),'hex');
 v_sig bytea;
BEGIN
 v_sig=public.hmac(convert_to(concat_ws('|','NEXLUPA-INBOX-READ-1',
  'ci-inbox-read-v1','ci-inbox-member-b',v_b::text,
  encode(v_session,'hex'),'0','5',v_exp::text,v_nonce::text),'UTF8'),
  decode(repeat('ef',32),'hex'),'sha256');
 IF EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'ci-inbox-member-b',v_b,v_session,NULL,5,'ci-inbox-read-v1',
   v_exp,v_nonce,v_sig))
 THEN RAISE EXCEPTION 'Suspended member kept signed inbox access'; END IF;
END;
$test$;
RESET ROLE;

UPDATE public.nex_ci_inbox_read_keys SET state='revoked'
 WHERE key_id='ci-inbox-read-v1';

SET ROLE nex_ci_inbox_reader_runtime;
DO $test$
DECLARE
 v_a uuid='11111111-1111-4111-8111-111111111111';
 v_nonce uuid=gen_random_uuid();
 v_exp bigint=floor(extract(epoch from clock_timestamp()))::bigint+30;
 v_session bytea=decode(repeat('a1',32),'hex');
 v_sig bytea;
BEGIN
 v_sig=public.hmac(convert_to(concat_ws('|','NEXLUPA-INBOX-READ-1',
  'ci-inbox-read-v1','canonical-a',v_a::text,
  encode(v_session,'hex'),'0','5',v_exp::text,v_nonce::text),'UTF8'),
  decode(repeat('ef',32),'hex'),'sha256');
 IF EXISTS(SELECT 1 FROM public.nex_ci_signed_read_family_whatsapp_inbox(
   'canonical-a',v_a,v_session,NULL,5,'ci-inbox-read-v1',
   v_exp,v_nonce,v_sig))
 THEN RAISE EXCEPTION 'Revoked key still unlocked WhatsApp data'; END IF;
END;
$test$;
RESET ROLE;

SELECT 'CI only: signed one-use family inbox RLS and replay denial passed' AS result;
