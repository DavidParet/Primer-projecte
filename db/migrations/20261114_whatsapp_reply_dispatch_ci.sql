-- Pilot schema for ephemeral PostgreSQL. The inbox remains the source of truth.
CREATE TABLE public.nex_whatsapp_reply_dispatch (
  inbound_id bigint PRIMARY KEY REFERENCES public.nex_whatsapp_inbound ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL,
  claim_token uuid NOT NULL,
  dispatch_started_at timestamptz,
  outgoing_message_id text
);
ALTER TABLE public.nex_whatsapp_reply_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_whatsapp_reply_dispatch FORCE ROW LEVEL SECURITY;
