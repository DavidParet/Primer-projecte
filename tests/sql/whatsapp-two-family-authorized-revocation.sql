-- NexLupa WhatsApp TTP 231: two-family authorization integration contract.
-- SYNTHETIC identities/messages; run only on disposable GitHub Actions PG17.
-- Requires all earlier schema/RLS/role tests, including TTP228 definer.
-- This is NOT proof of production IdP authentication, nor safe to run on Neon.
\set ON_ERROR_STOP on

-- Re-enable account-b as member and add a separate authenticated-looking
-- administrator for Family B. These are fake identity test fixtures only.
UPDATE public.nex_ci_family_memberships
 SET status='active', revoked_at=NULL, updated_at=now()
 WHERE user_id='account-b'
   AND family_id='22222222-2222-4222-8222-222222222222';
INSERT INTO public.nex_ci_family_memberships
 (user_id, family_id, role, status)
VALUES ('account-b-admin','22222222-2222-4222-8222-222222222222',
        'admin','active');

INSERT INTO public.nex_whatsapp_sender_authorizations
 (business_account_id, phone_number_id, sender_digest, family_id, scope,
  consent_version,consent_at,consent_source)
VALUES
 ('555551111','666661111',decode(repeat('d1',32),'hex'),
  '11111111-1111-4111-8111-111111111111',
  'incoming_text','ci-231',now(),'synthetic'),
 ('555552222','666662222',decode(repeat('d2',32),'hex'),
  '22222222-2222-4222-8222-222222222222',
  'incoming_text','ci-231',now(),'synthetic');

INSERT INTO public.nex_whatsapp_inbound
 (business_account_id,phone_number_id,provider_message_id,family_id,
  sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
VALUES
 ('555551111','666661111','wamid.ttp231.family-a',
  '11111111-1111-4111-8111-111111111111',
  decode(repeat('d1',32),'hex'),now(),decode(repeat('01',12),'hex'),
  decode(repeat('02',16),'hex'),decode('aabb','hex'),now()+interval '2 days'),
 ('555552222','666662222','wamid.ttp231.family-b',
  '22222222-2222-4222-8222-222222222222',
  decode(repeat('d2',32),'hex'),now(),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),decode('ccdd','hex'),now()+interval '2 days');

-- Family A sees its own unexpired message, not B, and no consent records.
SET ROLE whatsapp_ci_family_alpha;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.nex_whatsapp_inbound
     WHERE provider_message_id LIKE 'wamid.ttp231.%') <> 1 OR
    NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
      WHERE provider_message_id='wamid.ttp231.family-a') THEN
   RAISE EXCEPTION 'Family A message isolation failed'; END IF;
 IF has_table_privilege(current_user,
     'public.nex_whatsapp_sender_authorizations','SELECT')
    OR has_table_privilege(current_user,
     'public.nex_whatsapp_sender_authorizations','UPDATE')
    OR has_table_privilege(current_user,
     'public.nex_whatsapp_inbound','DELETE') THEN
   RAISE EXCEPTION 'Family A has unwanted consent/content privileges'; END IF;
END $$;
RESET ROLE;

-- Family B sees its own message, not A.
SET ROLE whatsapp_ci_family_beta;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.nex_whatsapp_inbound
     WHERE provider_message_id LIKE 'wamid.ttp231.%') <> 1 OR
    NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
      WHERE provider_message_id='wamid.ttp231.family-b') THEN
   RAISE EXCEPTION 'Family B message isolation failed'; END IF;
END $$;
RESET ROLE;

-- The request-scoped server role is only a test impersonation here:
-- it MUST receive verified IdP principal from application server in reality.
SET ROLE nex_ci_consent_revoker;
BEGIN;
DO $$
DECLARE
  accepted boolean;
  changed int;
BEGIN
 SELECT public.nex_authorize_family_locked(
  'account-a','22222222-2222-4222-8222-222222222222',
  'revoke_whatsapp_consent') INTO accepted;
 IF accepted IS DISTINCT FROM FALSE THEN
  RAISE EXCEPTION 'Family A administrator impersonated B'; END IF;

 SELECT public.nex_authorize_family_locked(
  'account-b-admin','11111111-1111-4111-8111-111111111111',
  'revoke_whatsapp_consent') INTO accepted;
 IF accepted IS DISTINCT FROM FALSE THEN
  RAISE EXCEPTION 'Family B administrator impersonated A'; END IF;

 SELECT public.nex_authorize_family_locked(
  'account-b','22222222-2222-4222-8222-222222222222',
  'revoke_whatsapp_consent') INTO accepted;
 IF accepted IS DISTINCT FROM FALSE THEN
  RAISE EXCEPTION 'Ordinary B member can revoke consent'; END IF;

 -- A can revoke A only; membership lock and writes use same transaction.
 SELECT public.nex_authorize_family_locked(
  'account-a','11111111-1111-4111-8111-111111111111',
  'revoke_whatsapp_consent') INTO accepted;
 IF accepted IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Family A admin denied'; END IF;

 UPDATE public.nex_whatsapp_sender_authorizations
 SET revoked_at=now()
 WHERE family_id='11111111-1111-4111-8111-111111111111'
   AND business_account_id='555551111'
   AND phone_number_id='666661111'
   AND sender_digest=decode(repeat('d1',32),'hex')
   AND revoked_at IS NULL;
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed <> 1 THEN RAISE EXCEPTION 'A authorization not revoked exactly once'; END IF;

 DELETE FROM public.nex_whatsapp_inbound
 WHERE family_id='11111111-1111-4111-8111-111111111111'
   AND business_account_id='555551111'
   AND phone_number_id='666661111'
   AND sender_digest=decode(repeat('d1',32),'hex');
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed <> 1 THEN RAISE EXCEPTION 'A content not deleted exactly once'; END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp231.family-a') THEN
  RAISE EXCEPTION 'A messages remained after A revocation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id='wamid.ttp231.family-b') THEN
  RAISE EXCEPTION 'A revoked another family message'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_whatsapp_sender_authorizations
   WHERE business_account_id='555552222' AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'Family B consent was changed by A'; END IF;
END $$;

-- B's administrator can then independently revoke B.
SET ROLE nex_ci_consent_revoker;
BEGIN;
DO $$
DECLARE accepted boolean; changed int;
BEGIN
 SELECT public.nex_authorize_family_locked(
  'account-b-admin','22222222-2222-4222-8222-222222222222',
  'revoke_whatsapp_consent') INTO accepted;
 IF accepted IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Family B admin denied'; END IF;
 UPDATE public.nex_whatsapp_sender_authorizations
 SET revoked_at=now()
 WHERE family_id='22222222-2222-4222-8222-222222222222'
   AND business_account_id='555552222'
   AND phone_number_id='666662222'
   AND sender_digest=decode(repeat('d2',32),'hex')
   AND revoked_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'B authorization not revoked'; END IF;
 DELETE FROM public.nex_whatsapp_inbound
 WHERE family_id='22222222-2222-4222-8222-222222222222'
   AND business_account_id='555552222'
   AND phone_number_id='666662222'
   AND sender_digest=decode(repeat('d2',32),'hex');
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'B content not deleted'; END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.nex_whatsapp_inbound
   WHERE provider_message_id LIKE 'wamid.ttp231.%') THEN
  RAISE EXCEPTION 'Two-family test messages remain'; END IF;
END $$;
SELECT 'TTP231 two-family restricted role and consent isolation passed' AS result;
