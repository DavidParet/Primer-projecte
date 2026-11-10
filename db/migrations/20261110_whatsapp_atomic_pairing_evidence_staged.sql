-- NexLupa TTP: ATOMIC consent evidence. CI-only migration proposal.
-- NEVER apply to Neon, production, or a non-disposable branch without review.
-- Evidence rows are inserted ONLY by trusted verified Meta + authenticated web
-- backends (not implemented by this migration); raw phone/code/receipt are not
-- stored. The runtime and restricted writer roles remain TO BE DESIGNED.
-- This migration intentionally FAILS CLOSED with FORCE RLS and NO policies.
CREATE TABLE IF NOT EXISTS public.nex_whatsapp_verified_phone_proofs (
  proof_digest bytea PRIMARY KEY CHECK (octet_length(proof_digest)=32),
  family_id uuid NOT NULL,
  business_account_id text NOT NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  sender_digest bytea NOT NULL CHECK (octet_length(sender_digest)=32),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at>verified_at)
);
CREATE TABLE IF NOT EXISTS public.nex_whatsapp_explicit_receipt_proofs (
  receipt_digest bytea PRIMARY KEY CHECK (octet_length(receipt_digest)=32),
  proof_digest bytea NOT NULL REFERENCES
    public.nex_whatsapp_verified_phone_proofs(proof_digest),
  family_id uuid NOT NULL,
  business_account_id text NOT NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  sender_digest bytea NOT NULL CHECK (octet_length(sender_digest)=32),
  scope text NOT NULL CHECK (scope='incoming_text'),
  consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 40),
  source text NOT NULL CHECK (source='account-web-consent'),
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at>accepted_at)
);
CREATE INDEX IF NOT EXISTS nex_whatsapp_atomic_receipt_proof
  ON public.nex_whatsapp_explicit_receipt_proofs (proof_digest);
CREATE INDEX IF NOT EXISTS nex_whatsapp_atomic_phone_expiry
  ON public.nex_whatsapp_verified_phone_proofs (expires_at);
CREATE INDEX IF NOT EXISTS nex_whatsapp_atomic_receipt_expiry
  ON public.nex_whatsapp_explicit_receipt_proofs (expires_at);

REVOKE ALL ON public.nex_whatsapp_verified_phone_proofs FROM PUBLIC;
REVOKE ALL ON public.nex_whatsapp_explicit_receipt_proofs FROM PUBLIC;
ALTER TABLE public.nex_whatsapp_verified_phone_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_verified_phone_proofs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_explicit_receipt_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_explicit_receipt_proofs FORCE ROW LEVEL SECURITY;
-- Deliberately no RLS policies, no public functions and no live grants.
