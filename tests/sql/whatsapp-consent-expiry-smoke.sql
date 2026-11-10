-- CI ONLY: PostgreSQL 17 disposable GitHub Actions service. Synthetic records.
-- Run after the prototype WhatsApp migration and other schema smoke tests.
\set ON_ERROR_STOP on

-- Expired authorization: even if an old grant was valid, it must fail now.
INSERT INTO nex_whatsapp_sender_authorizations
(business_account_id,phone_number_id,sender_digest,family_id,scope,
 consent_version,consent_at,consent_source,valid_until)
VALUES ('333333333','444444444',decode(repeat('ee',32),'hex'),
'11111111-1111-4111-8111-111111111111','incoming_text','ci-expired',
now()-interval '3 days','synthetic-test',now()-interval '1 day');

WITH permitted AS (
 SELECT family_id FROM nex_whatsapp_sender_authorizations
 WHERE business_account_id='333333333' AND phone_number_id='444444444'
 AND sender_digest=decode(repeat('ee',32),'hex') AND scope='incoming_text'
 AND consent_at <= now() AND revoked_at IS NULL
 AND (valid_until IS NULL OR valid_until > now())
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE
)
INSERT INTO nex_whatsapp_inbound
(business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '333333333','444444444','wamid.synthetic-ci-expired',family_id,
decode(repeat('ee',32),'hex'),now(),decode(repeat('01',12),'hex'),
decode(repeat('02',16),'hex'),decode('03','hex'),now()+interval '7 days'
FROM permitted
ON CONFLICT (business_account_id,provider_message_id) DO NOTHING;

-- Future consent: a grant with consent_at in the future must not authorize yet.
INSERT INTO nex_whatsapp_sender_authorizations
(business_account_id,phone_number_id,sender_digest,family_id,scope,
 consent_version,consent_at,consent_source)
VALUES ('333333333','444444444',decode(repeat('ff',32),'hex'),
'22222222-2222-4222-8222-222222222222','incoming_text','ci-future',
now()+interval '1 day','synthetic-test');

WITH permitted AS (
 SELECT family_id FROM nex_whatsapp_sender_authorizations
 WHERE business_account_id='333333333' AND phone_number_id='444444444'
 AND sender_digest=decode(repeat('ff',32),'hex') AND scope='incoming_text'
 AND consent_at <= now() AND revoked_at IS NULL
 AND (valid_until IS NULL OR valid_until > now())
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE
)
INSERT INTO nex_whatsapp_inbound
(business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '333333333','444444444','wamid.synthetic-ci-future',family_id,
decode(repeat('ff',32),'hex'),now(),decode(repeat('01',12),'hex'),
decode(repeat('02',16),'hex'),decode('03','hex'),now()+interval '7 days'
FROM permitted
ON CONFLICT (business_account_id,provider_message_id) DO NOTHING;

DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM nex_whatsapp_inbound
 WHERE provider_message_id IN ('wamid.synthetic-ci-expired','wamid.synthetic-ci-future');
 IF n <> 0 THEN
  RAISE EXCEPTION 'Expired or future consent accepted % inbound records',n;
 END IF;
END $$;

-- Expiration is physical deletion, not merely a timestamp.
INSERT INTO nex_whatsapp_inbound
(business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
VALUES ('333333333','444444444','wamid.synthetic-ci-purge',
'11111111-1111-4111-8111-111111111111',decode(repeat('ee',32),'hex'),
now(),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
decode('03','hex'),now()-interval '1 hour');

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM nex_whatsapp_inbound WHERE provider_message_id='wamid.synthetic-ci-purge')
 THEN RAISE EXCEPTION 'Missing synthetic expired row before purge'; END IF;
END $$;

DELETE FROM nex_whatsapp_inbound WHERE expires_at <= now();

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM nex_whatsapp_inbound WHERE provider_message_id='wamid.synthetic-ci-purge')
 THEN RAISE EXCEPTION 'Expired inbound content still present after purge'; END IF;
END $$;

SELECT 'expired/future consent and physical purge smoke passed (disposable CI only)' AS result;
