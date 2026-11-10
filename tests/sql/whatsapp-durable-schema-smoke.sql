-- CI ONLY: run after the real prototype migration on disposable postgres:17.
-- No Neon connections; entirely synthetic identifiers, encrypted-looking bytes.
\set ON_ERROR_STOP on
INSERT INTO nex_whatsapp_sender_authorizations
 (business_account_id, phone_number_id, sender_digest, family_id,
  scope, consent_version, consent_at, consent_source)
VALUES
 ('123456789', '987654321', decode(repeat('ab',32),'hex'),
  '11111111-1111-4111-8111-111111111111','incoming_text','ci-1',
  now()-interval '1 hour','synthetic-test');

-- The unique index prevents mapping a sender to a second active family.
DO $$
BEGIN
  BEGIN
    INSERT INTO nex_whatsapp_sender_authorizations
     (business_account_id,phone_number_id,sender_digest,family_id,scope,
      consent_version,consent_at,consent_source)
    VALUES ('123456789','987654321',decode(repeat('ab',32),'hex'),
      '22222222-2222-4222-8222-222222222222','incoming_text','ci-1',
      now(),'synthetic-test');
    RAISE EXCEPTION 'duplicate active consent was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Apply the same authorization->insert pattern as the Node adapter;
-- no plaintext or real phone numbers are present.
WITH permitted AS (
 SELECT family_id
 FROM nex_whatsapp_sender_authorizations
 WHERE business_account_id='123456789'
 AND phone_number_id='987654321'
 AND sender_digest=decode(repeat('ab',32),'hex')
 AND revoked_at IS NULL AND scope='incoming_text'
 AND consent_at <= now() AND (valid_until IS NULL OR valid_until > now())
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE
)
INSERT INTO nex_whatsapp_inbound
 (business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '123456789','987654321','wamid.synthetic-ci-1',
 family_id,decode(repeat('ab',32),'hex'),now(),
 decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
 decode('03','hex'),now()+interval '7 days' FROM permitted
ON CONFLICT (business_account_id,provider_message_id) DO NOTHING;

-- Repeated Meta delivery must not duplicate storage.
WITH permitted AS (
 SELECT family_id
 FROM nex_whatsapp_sender_authorizations
 WHERE business_account_id='123456789'
 AND phone_number_id='987654321'
 AND sender_digest=decode(repeat('ab',32),'hex')
 AND revoked_at IS NULL AND scope='incoming_text'
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE
)
INSERT INTO nex_whatsapp_inbound
 (business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '123456789','987654321','wamid.synthetic-ci-1',
 family_id,decode(repeat('ab',32),'hex'),now(),
 decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
 decode('03','hex'),now()+interval '7 days' FROM permitted
ON CONFLICT (business_account_id,provider_message_id) DO NOTHING;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM nex_whatsapp_inbound;
  IF n <> 1 THEN RAISE EXCEPTION 'Deduplication expected 1 record, got %',n; END IF;
END $$;

-- One transaction revokes sender and deletes the one stored message.
BEGIN;
UPDATE nex_whatsapp_sender_authorizations SET revoked_at=now()
 WHERE business_account_id='123456789' AND phone_number_id='987654321'
 AND sender_digest=decode(repeat('ab',32),'hex') AND revoked_at IS NULL;
DELETE FROM nex_whatsapp_inbound
 WHERE business_account_id='123456789' AND phone_number_id='987654321'
 AND sender_digest=decode(repeat('ab',32),'hex');
COMMIT;

-- Revoked consent cannot accept a new delivery.
WITH permitted AS (
 SELECT family_id
 FROM nex_whatsapp_sender_authorizations
 WHERE business_account_id='123456789'
 AND phone_number_id='987654321'
 AND sender_digest=decode(repeat('ab',32),'hex')
 AND scope='incoming_text' AND revoked_at IS NULL
 ORDER BY authorization_id DESC LIMIT 1 FOR SHARE
)
INSERT INTO nex_whatsapp_inbound
 (business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '123456789','987654321','wamid.synthetic-ci-2',
 family_id,decode(repeat('ab',32),'hex'),now(),
 decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
 decode('03','hex'),now()+interval '7 days' FROM permitted
ON CONFLICT (business_account_id,provider_message_id) DO NOTHING;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM nex_whatsapp_inbound;
 IF n <> 0 THEN RAISE EXCEPTION 'revoked sender persisted % messages', n; END IF;
 SELECT count(*) INTO n FROM nex_whatsapp_sender_authorizations WHERE revoked_at IS NOT NULL;
 IF n <> 1 THEN RAISE EXCEPTION 'revocation missing'; END IF;
END $$;

-- Verify transaction rollback protects against incomplete changes.
BEGIN;
INSERT INTO nex_whatsapp_sender_authorizations
 (business_account_id,phone_number_id,sender_digest,family_id,scope,
  consent_version,consent_at,consent_source)
VALUES ('123456789','987654321',decode(repeat('cd',32),'hex'),
 '11111111-1111-4111-8111-111111111111','incoming_text','ci-2',
 now(),'synthetic-test');
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM nex_whatsapp_sender_authorizations
           WHERE sender_digest=decode(repeat('cd',32),'hex'))
 THEN RAISE EXCEPTION 'rollback did not remove temporary consent'; END IF;
END $$;

SELECT 'real WhatsApp prototype schema CI smoke test succeeded' AS result;
