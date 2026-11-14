'use strict';

const {randomUUID} = require('node:crypto');

// A restart may reclaim an abandoned analysis, but never a dispatch that
// could already have reached Meta. Each update is fenced by the claim token.
const CLAIM = `
INSERT INTO public.nex_whatsapp_reply_dispatch AS d (inbound_id, claimed_at, claim_token)
SELECT inbound_id, clock_timestamp(), $2 FROM public.nex_whatsapp_inbound
WHERE inbound_id = $1 AND expires_at > clock_timestamp()
ON CONFLICT (inbound_id) DO UPDATE
SET claimed_at = EXCLUDED.claimed_at, claim_token = EXCLUDED.claim_token
WHERE d.dispatch_started_at IS NULL
  AND d.claimed_at < clock_timestamp() - interval '5 minutes'
RETURNING inbound_id`;

const BEGIN_DISPATCH = `
WITH consent AS MATERIALIZED (
  SELECT i.inbound_id
  FROM public.nex_whatsapp_inbound i
  JOIN public.nex_whatsapp_sender_authorizations a
    USING (business_account_id, phone_number_id, sender_digest, family_id)
  WHERE i.inbound_id = $1 AND i.expires_at > clock_timestamp()
    AND a.scope = 'incoming_text' AND a.revoked_at IS NULL
    AND a.consent_at <= clock_timestamp()
    AND a.consent_at <= i.received_at
    AND (a.valid_until IS NULL OR a.valid_until > clock_timestamp())
  FOR SHARE OF a
)
UPDATE public.nex_whatsapp_reply_dispatch
SET dispatch_started_at = clock_timestamp()
WHERE inbound_id IN (SELECT inbound_id FROM consent)
  AND claim_token = $2 AND dispatch_started_at IS NULL
RETURNING inbound_id`;

const MARK_SENT = `
UPDATE public.nex_whatsapp_reply_dispatch SET outgoing_message_id = $3
WHERE inbound_id = $1 AND claim_token = $2 AND dispatch_started_at IS NOT NULL
  AND outgoing_message_id IS NULL
RETURNING inbound_id`;

const RELEASE = `
DELETE FROM public.nex_whatsapp_reply_dispatch
WHERE inbound_id = $1 AND claim_token = $2 AND dispatch_started_at IS NULL`;

// The trusted loader must verify the recipient against the sender digest and
// return the decrypted text for this inbox ID only while access is permitted.
function createPilotReplyJobStore({db, loadAuthorizedDelivery} = {}) {
  if (typeof db?.query !== 'function' || typeof loadAuthorizedDelivery !== 'function') {
    throw new TypeError('Pilot reply storage and authorized inbox loader required');
  }

  async function claim(inboundId) {
    if (!Number.isSafeInteger(inboundId) || inboundId < 1) {
      throw new TypeError('Invalid WhatsApp inbox ID');
    }
    const delivery = await loadAuthorizedDelivery(inboundId);
    if (!delivery) return null;
    const claimToken = randomUUID();
    const result = await db.query(CLAIM, [inboundId, claimToken]);
    return result.rowCount === 1 ? {...delivery, inboundId, claimToken} : null;
  }

  async function beginDispatch({inboundId, claimToken}) {
    const result = await db.query(BEGIN_DISPATCH, [inboundId, claimToken]);
    return result.rowCount === 1;
  }

  async function markSent({inboundId, claimToken}, outgoingId) {
    const result = await db.query(MARK_SENT, [inboundId, claimToken, outgoingId]);
    if (result.rowCount !== 1) throw new Error('WhatsApp dispatch confirmation was not recorded');
  }

  async function releaseForRetry({inboundId, claimToken}) {
    await db.query(RELEASE, [inboundId, claimToken]);
  }

  return {claim, beginDispatch, markSent, releaseForRetry};
}

module.exports = {createPilotReplyJobStore};
