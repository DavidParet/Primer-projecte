-- TTP 236: temporary phone-to-family enrollment protocol.
-- Disposable GitHub Actions PostgreSQL only; DO NOT run on Neon.
-- All ids, digests, senders, text and secrets in this file are synthetic.
\set ON_ERROR_STOP on

CREATE TABLE public.nex_ci_whatsapp_pairing_challenges (
  challenge_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id uuid NOT NULL,
  business_account_id text NOT NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  code_digest bytea NOT NULL UNIQUE CHECK (octet_length(code_digest)=32),
  requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 128),
  consent_version text NOT NULL CHECK (consent_version='whatsapp-incoming-text-v1'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX nex_ci_pairing_challenge_expiration
 ON public.nex_ci_whatsapp_pairing_challenges(expires_at);
CREATE TABLE public.nex_ci_whatsapp_pairing_receipts (
  business_account_id text NOT NULL,
  provider_message_id text NOT NULL,
  challenge_id bigint NOT NULL REFERENCES public.nex_ci_whatsapp_pairing_challenges,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (business_account_id,provider_message_id)
);
REVOKE ALL ON public.nex_ci_whatsapp_pairing_challenges FROM PUBLIC;
REVOKE ALL ON public.nex_ci_whatsapp_pairing_receipts FROM PUBLIC;

-- A request-bound family admin generates a code; only an HMAC digest is saved.
-- The following fake HMAC key is CI-only, never a real NexLupa secret.
INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
  family_id,business_account_id,phone_number_id,code_digest,requested_by,
  consent_version,expires_at
) VALUES(
  '11111111-1111-4111-8111-111111111111','744441234','844441234',
  public.hmac(convert_to(
    'nexlupa-pairing-v1|744441234|844441234|ABCD-EFGH-JKLM-NPQR',
    'UTF8'),decode(repeat('f0',32),'hex'),'sha256'),
  'account-a','whatsapp-incoming-text-v1',clock_timestamp()+interval '9 minutes'
);
INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
  family_id,business_account_id,phone_number_id,code_digest,requested_by,
  consent_version,created_at,expires_at
) VALUES(
  '11111111-1111-4111-8111-111111111111','744441234','844441234',
  public.hmac(convert_to(
    'nexlupa-pairing-v1|744441234|844441234|WXYZ-2345-6789-ABCD',
    'UTF8'),decode(repeat('f0',32),'hex'),'sha256'),
  'account-a','whatsapp-incoming-text-v1',
  clock_timestamp()-interval '20 minutes',
  clock_timestamp()-interval '11 minutes'
);
INSERT INTO public.nex_ci_whatsapp_pairing_challenges(
  family_id,business_account_id,phone_number_id,code_digest,requested_by,
  consent_version,expires_at
) VALUES(
  '22222222-2222-4222-8222-222222222222','744441234','844441234',
  public.hmac(convert_to(
    'nexlupa-pairing-v1|744441234|844441234|ABCD-EFGH-JKLM-NPQS',
    'UTF8'),decode(repeat('f0',32),'hex'),'sha256'),
  'account-b','whatsapp-incoming-text-v1',
  clock_timestamp()+interval '9 minutes'
);

DO $$
DECLARE n integer; accepted boolean;
BEGIN
  -- A valid family membership, but not a B ordinary member.
  SELECT public.nex_authorize_family_locked(
   'account-a','11111111-1111-4111-8111-111111111111',
   'enroll_whatsapp_sender') INTO accepted;
  IF accepted IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Admin A cannot issue enrollment'; END IF;
  SELECT public.nex_authorize_family_locked(
   'account-b','22222222-2222-4222-8222-222222222222',
   'enroll_whatsapp_sender') INTO accepted;
  IF accepted IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Ordinary member B can enroll sender'; END IF;

  SELECT count(*) INTO n FROM public.nex_ci_whatsapp_pairing_challenges
   WHERE business_account_id='744441234'
     AND phone_number_id='844441234'
     AND code_digest=public.hmac(convert_to(
      'nexlupa-pairing-v1|744441234|844441234|WXYZ-2345-6789-ABCD',
      'UTF8'),decode(repeat('f0',32),'hex'),'sha256')
     AND expires_at>clock_timestamp() AND consumed_at IS NULL;
  IF n<>0 THEN RAISE EXCEPTION 'Expired pairing challenge remains valid'; END IF;

  SELECT count(*) INTO n FROM public.nex_ci_whatsapp_pairing_challenges
   WHERE business_account_id='744441235'
     AND code_digest=public.hmac(convert_to(
      'nexlupa-pairing-v1|744441234|844441234|ABCD-EFGH-JKLM-NPQR',
      'UTF8'),decode(repeat('f0',32),'hex'),'sha256')
     AND expires_at>clock_timestamp() AND consumed_at IS NULL;
  IF n<>0 THEN RAISE EXCEPTION 'Challenge may be used on wrong business'; END IF;
END $$;

-- Simulated verified Meta sender: caller has already proven the request
-- signature in Node. Here we test database transaction and constraints only.
BEGIN;
SELECT challenge_id AS ci_challenge, family_id AS ci_family,
 requested_by AS ci_requested
FROM public.nex_ci_whatsapp_pairing_challenges
WHERE business_account_id='744441234' AND phone_number_id='844441234'
 AND code_digest=public.hmac(convert_to(
   'nexlupa-pairing-v1|744441234|844441234|ABCD-EFGH-JKLM-NPQR',
   'UTF8'),decode(repeat('f0',32),'hex'),'sha256')
 AND consumed_at IS NULL AND expires_at>clock_timestamp()
FOR UPDATE \gset

SELECT public.nex_authorize_family_locked(
  :'ci_requested',:'ci_family'::uuid,
  'enroll_whatsapp_sender') AS ci_authorized \gset
\if :ci_authorized
\else
 \echo 'Verified administrator membership missing'
 \quit 1
\endif

UPDATE public.nex_ci_whatsapp_pairing_challenges
 SET consumed_at=clock_timestamp()
 WHERE challenge_id=:'ci_challenge' AND consumed_at IS NULL
RETURNING challenge_id;
INSERT INTO public.nex_whatsapp_sender_authorizations(
 family_id,business_account_id,phone_number_id,sender_digest,scope,
 consent_version,consent_at,consent_source,valid_until
) VALUES(
 :'ci_family'::uuid,'744441234','844441234',
 public.hmac(convert_to('34611111111','UTF8'),
   decode(repeat('f1',32),'hex'),'sha256'),
 'incoming_text','whatsapp-incoming-text-v1',clock_timestamp(),
 'sender_whatsapp_explicit_opt_in',clock_timestamp()+interval '30 days'
);
INSERT INTO public.nex_ci_whatsapp_pairing_receipts(
 business_account_id,provider_message_id,challenge_id
)VALUES('744441234','wamid.ci-pairing-1',:'ci_challenge');
COMMIT;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.nex_whatsapp_sender_authorizations
 WHERE business_account_id='744441234' AND phone_number_id='844441234'
   AND family_id='11111111-1111-4111-8111-111111111111'
   AND scope='incoming_text'
   AND consent_version='whatsapp-incoming-text-v1'
   AND consent_source='sender_whatsapp_explicit_opt_in'
   AND revoked_at IS NULL AND valid_until>clock_timestamp();
 IF n<>1 THEN RAISE EXCEPTION 'Explicit opt-in not enrolled once'; END IF;

 SELECT count(*) INTO n FROM public.nex_ci_whatsapp_pairing_challenges
 WHERE challenge_id=(
  SELECT challenge_id FROM public.nex_ci_whatsapp_pairing_receipts
  WHERE provider_message_id='wamid.ci-pairing-1')
 AND consumed_at IS NULL;
 IF n<>0 THEN RAISE EXCEPTION 'Pairing code remains reusable'; END IF;

 SELECT count(*) INTO n FROM public.nex_ci_whatsapp_pairing_receipts
 WHERE business_account_id='744441234'
 AND provider_message_id='wamid.ci-pairing-1';
 IF n<>1 THEN RAISE EXCEPTION 'Missing idempotence receipt'; END IF;
END $$;

-- If the same WhatsApp sender tries to enroll in another family,
-- the active-sender uniqueness constraint blocks the association.
DO $$
BEGIN
 BEGIN
 INSERT INTO public.nex_whatsapp_sender_authorizations(
   family_id,business_account_id,phone_number_id,sender_digest,scope,
   consent_version,consent_at,consent_source
 ) VALUES(
  '22222222-2222-4222-8222-222222222222','744441234','844441234',
  public.hmac(convert_to('34611111111','UTF8'),
    decode(repeat('f1',32),'hex'),'sha256'),
  'incoming_text','whatsapp-incoming-text-v1',clock_timestamp(),
  'sender_whatsapp_explicit_opt_in'
 );
 RAISE EXCEPTION 'Sender was enrolled into two active families';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;

-- The provider message receipt itself is also unique.
DO $$
BEGIN
 BEGIN
  INSERT INTO public.nex_ci_whatsapp_pairing_receipts(
    business_account_id,provider_message_id,challenge_id
  ) VALUES('744441234','wamid.ci-pairing-1',
    (SELECT challenge_id FROM public.nex_ci_whatsapp_pairing_receipts
     WHERE provider_message_id='wamid.ci-pairing-1'));
  RAISE EXCEPTION 'Duplicate provider enrollment message accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
SELECT 'TTP236 family pairing, consent and replay checks passed' AS result;
