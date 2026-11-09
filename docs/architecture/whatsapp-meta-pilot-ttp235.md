# NexLupa — TTP 235: Meta webhook pilot bridge and go-live gates

**Scope:** branch `feat/whatsapp-durable-inbox-v1`, PR #7 only. This milestone stages a real HTTP contract with a **synthetic** durable-inbox dependency. No Meta app credentials, webhook subscription, Neon migration, live users, production endpoint or Resend changes are made.

## Current app routing

The existing public Vercel API file `api/whatsapp-webhook.js` is **unchanged** and supports only:
- **disabled by default**: GET and POST return 503;
- **verify-only** when explicitly configured: GET verifies Meta's verification challenge; POST validates original raw bytes against `X-Hub-Signature-256` but still returns 503 to avoid falsely acknowledging unpersisted messages.

The new internal module `lib/whatsapp/meta-durable-post-bridge.js` **does not export or register a live HTTP route** and defaults to disabled. It accepts an explicitly injected Meta app secret and `inbox.persistVerifiedBatch` implementation only in tests/authorized future integration.

## POST acknowledgement contract

- Require JSON content type and bounded raw bytes; the raw body is verified with Meta's signed SHA-256 header *before* parsing or writing messages.
- Return HTTP **200** only after all supported deliveries in the signed batch are **durably stored or recognized as already stored**. Also allow a signed, strictly recognized status-only callback (no incoming user message) to be ignored with 200.
- Return 403 on invalid signatures, 400 on malformed signed JSON or unexpected event envelopes, 413 on oversize, 415 on wrong content type, 405 on wrong method.
- Return **503** on failed writes, unsupported media, unknown/unlinked senders, partially processed content or ambiguous empty events. Do not expose message text, phone, token, or SQL errors in responses.
- A signed POST is *not* proof of a sender's family membership or consent. The durable inbox resolves a HMAC sender digest against valid consent before encrypting/storing text.

**Important operational limitation:** 503 on unlinked or unsupported events may lead Meta to retry repeatedly. Before enabling public POST delivery, approve a bounded, privacy-reviewed quarantine/dead-letter protocol, real alerting, and provider retry handling. Merely returning 200 would risk silent message loss; repeatedly returning 503 without a remediation workflow may risk retry storms.

## Group messaging limits and first pilot

The official Cloud API provides business-number webhooks. **It does not authorize a third-party application to silently read arbitrary existing school, sports or family group discussions.** Meta's newer group product is limited and not an API for joining or scraping any pre-existing family group.

The first pilot should therefore be limited to **voluntary forwarding of relevant communications to the NexLupa business number**, retaining only consented text, with an explicit family pairing flow. We must not invent or infer the original group identity from a forwarded message. The existing normalizer explicitly sets `groupId: null`.

## Next real-world release gates (outside current PR)

1. Verify and retire the previously exposed Vercel-like bearer credential. Its tracked copy remains in the default branch/history until separately remediated and the actual credential rotated/revoked.
2. Choose/validate an actual NexLupa IdP, server-side session verifier and family membership schema; implement consent enrollment and the verified phone-to-family pairing flow.
3. Establish Meta Business account, WABA, a dedicated business phone/Cloud API number, app secret and verification token through official Meta configuration. **No credentials go into GitHub or assistant chat.**
4. Approve an isolated Neon test branch migration with exact RLS roles; verify encryption, retention, permission isolation, and nonce-key management under true restricted connection strings.
5. Wire a dedicated DB pool and reliable durable failure handling into the HTTP bridge under an explicit enablement gate; safely handle statuses, retries, duplicate messages, and unlinked sender review.
6. Run supervised end-to-end tests: signed sample webhook, valid forwarding with active family consent, unknown sender, revoked consent, duplicate/redelivery, delayed retry, DB outage, secret/key rotation.
7. Only after a review of privacy notices, child/family data retention, user controls, monitoring and live endpoint credentials should production be considered.

**No public webhook has been activated by this task.**
