-- Prototype schema. DO NOT apply to a production database until consent,
-- key custody, scheduled purge, and tenant access controls have been approved.
-- PostgreSQL/Neon compatible. No personal data or credentials are included.
CREATE TABLE IF NOT EXISTS nex_whatsapp_sender_authorizations (
  authorization_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_account_id text NOT NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  sender_digest bytea NOT NULL CHECK (octet_length(sender_digest) = 32),
  family_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope = 'incoming_text'),
  consent_version text NOT NULL,
  consent_at timestamptz NOT NULL,
  consent_source text NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until > consent_at)
);

-- A sender cannot belong to two active families on the same business number.
CREATE UNIQUE INDEX IF NOT EXISTS nex_whatsapp_one_active_family
  ON nex_whatsapp_sender_authorizations (
    business_account_id, phone_number_id, sender_digest
  ) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS nex_whatsapp_inbound (
  inbound_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_account_id text NOT NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  provider_message_id text NOT NULL CHECK (length(provider_message_id) BETWEEN 7 AND 270),
  family_id uuid NOT NULL,
  sender_digest bytea NOT NULL CHECK (octet_length(sender_digest) = 32),
  provider_sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  ciphertext bytea NOT NULL,
  processing_state text NOT NULL DEFAULT 'pending_review'
    CHECK (processing_state IN ('pending_review', 'completed', 'needs_review')),
  UNIQUE (business_account_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS nex_whatsapp_inbound_expiration
  ON nex_whatsapp_inbound (expires_at);
CREATE INDEX IF NOT EXISTS nex_whatsapp_inbound_family
  ON nex_whatsapp_inbound (family_id, received_at);

-- No cross-family public read APIs. Authenticated tenant access and DB grants
-- still need separate implementation and review before any real deployment.
