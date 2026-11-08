-- NEXLUPA isolated Resend pilot — migration 001
-- Execute ONLY on a dedicated private pilot PostgreSQL database.
-- No subjects, bodies, senders, addresses or per-family identifiers in clear.
-- This migration is NOT executed by GitHub or Vercel automatically.
BEGIN;
CREATE SCHEMA IF NOT EXISTS nexlupa_pilot;
CREATE TABLE IF NOT EXISTS nexlupa_pilot.resend_inbox_queue (
  queue_id CHAR(64) PRIMARY KEY
    CHECK (queue_id ~ '^[0-9a-f]{64}$'),
  encrypted_envelope TEXT NOT NULL
    CHECK (octet_length(encrypted_envelope) BETWEEN 30 AND 4096),
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received','processing','retry','done','needs_review','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT process_lease_consistency CHECK (
    (state='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state<>'processing' AND lease_token IS NULL AND lease_until IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS resend_inbox_ready_idx
  ON nexlupa_pilot.resend_inbox_queue(available_at,created_at)
  WHERE state IN ('received','retry');
CREATE INDEX IF NOT EXISTS resend_inbox_lease_idx
  ON nexlupa_pilot.resend_inbox_queue(lease_until)
  WHERE state='processing';
-- Purge policy must be approved and implemented before real user data.
-- Grant only least-privileged role access to nexlupa_pilot schema.
COMMIT;
