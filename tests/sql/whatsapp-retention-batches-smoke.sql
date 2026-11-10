-- Disposable GitHub Actions PostgreSQL 17 only, not Neon.
-- Validate the exact bounded SKIP LOCKED purge shape used by retention-worker.js.
\set ON_ERROR_STOP on
INSERT INTO nex_whatsapp_inbound
(business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
SELECT '555555555','666666666','wamid.retention-ci-'||g,
 '11111111-1111-4111-8111-111111111111',
 decode(repeat('bc',32),'hex'),now(),
 decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
 decode('03','hex'),now()-interval '1 hour'
FROM generate_series(1,3) AS g;

INSERT INTO nex_whatsapp_inbound
(business_account_id,phone_number_id,provider_message_id,family_id,
 sender_digest,provider_sent_at,nonce,authentication_tag,ciphertext,expires_at)
VALUES ('555555555','666666666','wamid.retention-ci-active',
'11111111-1111-4111-8111-111111111111',decode(repeat('bc',32),'hex'),
now(),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
decode('03','hex'),now()+interval '7 days');

CREATE TEMP TABLE purge_counts (batch int, removed int);
WITH expired AS (
  SELECT inbound_id FROM nex_whatsapp_inbound
  WHERE expires_at <= NOW()
  ORDER BY expires_at, inbound_id
  LIMIT 2
  FOR UPDATE SKIP LOCKED
), removed AS (
 DELETE FROM nex_whatsapp_inbound AS inbox
 USING expired WHERE inbox.inbound_id=expired.inbound_id
 RETURNING inbox.inbound_id
)
INSERT INTO purge_counts SELECT 1,count(*)::int FROM removed;

WITH expired AS (
  SELECT inbound_id FROM nex_whatsapp_inbound
  WHERE expires_at <= NOW()
  ORDER BY expires_at, inbound_id
  LIMIT 2
  FOR UPDATE SKIP LOCKED
), removed AS (
 DELETE FROM nex_whatsapp_inbound AS inbox
 USING expired WHERE inbox.inbound_id=expired.inbound_id
 RETURNING inbox.inbound_id
)
INSERT INTO purge_counts SELECT 2,count(*)::int FROM removed;

DO $$
BEGIN
 IF (SELECT removed FROM purge_counts WHERE batch=1) <> 2 OR
    (SELECT removed FROM purge_counts WHERE batch=2) <> 1 THEN
   RAISE EXCEPTION 'bounded retention batch counts incorrect';
 END IF;
 IF EXISTS(SELECT 1 FROM nex_whatsapp_inbound
           WHERE provider_message_id LIKE 'wamid.retention-ci-%'
           AND expires_at <= NOW()) THEN
   RAISE EXCEPTION 'expired synthetic content remains';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM nex_whatsapp_inbound
               WHERE provider_message_id='wamid.retention-ci-active') THEN
   RAISE EXCEPTION 'unexpired synthetic content was deleted';
 END IF;
END $$;

SELECT 'bounded retention SQL smoke succeeded' AS result;
