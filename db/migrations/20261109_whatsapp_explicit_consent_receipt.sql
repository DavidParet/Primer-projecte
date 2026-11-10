-- WhatsApp prototype only: never apply to production without approval.
-- Store pseudonymized proof of a separate, explicit consent receipt.
-- NULL is permitted only for legacy synthetic rows; new enrollments always set it.
ALTER TABLE nex_whatsapp_sender_authorizations
  ADD COLUMN IF NOT EXISTS consent_receipt_digest bytea
  CHECK (consent_receipt_digest IS NULL OR octet_length(consent_receipt_digest) = 32);
CREATE UNIQUE INDEX IF NOT EXISTS nex_whatsapp_unique_consent_receipt
  ON nex_whatsapp_sender_authorizations (consent_receipt_digest)
  WHERE consent_receipt_digest IS NOT NULL;
