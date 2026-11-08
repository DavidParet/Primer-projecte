'use strict';

/**
 * Converts a VERIFIED Meta webhook payload into a bounded transport envelope.
 * Must ONLY be called after raw-body HMAC verification; no implicit consent.
 * The source of a forwarded WhatsApp message's original group is NOT exposed.
 */
const MAX_DELIVERIES=50;
const MAX_TEXT_CHARS=8192;

function normalizeMetaDeliveries(payload, opts={}) {
  if (!payload || payload.object!=='whatsapp_business_account' || !Array.isArray(payload.entry)) {
    throw new TypeError('INVALID_META_ENVELOPE');
  }
  const maxDeliveries=Math.max(1,Math.min(MAX_DELIVERIES,Number(opts.maxDeliveries)||MAX_DELIVERIES));
  const seen=new Set();
  const deliveries=[];
  let skipped=0, statusUpdates=0, truncated=false;
  outer: for (const entry of payload.entry) {
    if (!entry || !Array.isArray(entry.changes)) { skipped++; continue; }
    const businessAccountId=String(entry.id||'');
    if (!/^\d{5,30}$/.test(businessAccountId)) { skipped++; continue; }
    for (const change of entry.changes) {
      if (!change || change.field!=='messages' || !change.value) continue;
      const value=change.value;
      if (Array.isArray(value.statuses)) statusUpdates+=value.statuses.length;
      if (!Array.isArray(value.messages)) continue;
      const phoneNumberId=String(value.metadata?.phone_number_id||'');
      if (!/^\d{5,30}$/.test(phoneNumberId)) { skipped+=value.messages.length; continue; }
      for (const message of value.messages) {
        if (deliveries.length>=maxDeliveries) {truncated=true;break outer;}
        const from=String(message?.from||'');
        const providerMessageId=String(message?.id||'');
        const providerTimestamp=String(message?.timestamp||'');
        const type=String(message?.type||'');
        if (!/^\d{7,15}$/.test(from) ||
            !/^wamid\.[A-Za-z0-9._=-]{1,256}$/.test(providerMessageId) ||
            !/^\d{9,12}$/.test(providerTimestamp) || !type) { skipped++; continue; }
        const duplicateKey=businessAccountId+'|'+providerMessageId;
        if (seen.has(duplicateKey)) continue;
        seen.add(duplicateKey);
        const isText=type==='text' && typeof message.text?.body==='string';
        const rawText=isText ? message.text.body : '';
        if (rawText.length>MAX_TEXT_CHARS || (type==='text' && !rawText.trim())) {
          skipped++; continue;
        }
        deliveries.push({
          provider:'whatsapp',
          businessAccountId,
          phoneNumberId,
          providerMessageId,
          senderWaId:from, // personal data: never log; resolve to a verified family in the next phase
          providerTimestamp, // UTC epoch seconds as supplied; no inferred timezone
          type,
          text:isText ? rawText : null,
          contentPending:!isText, // media/interactive/unknown not actually read
          groupId:null,          // never infer original WhatsApp group from a forward
          familyId:null,         // NEVER trust a phone number as consent/registration
          authorization:'unresolved'
        });
      }
    }
  }
  return {deliveries,meta:{skipped,statusUpdates,truncated}};
}

module.exports={normalizeMetaDeliveries,MAX_DELIVERIES,MAX_TEXT_CHARS};
