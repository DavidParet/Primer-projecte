'use strict';
/**
 * Signed Resend email.received -> encrypted durable metadata queue.
 *
 * This is an injection-only server library: no endpoint and no API keys.
 * The caller MUST supply a real transactional, persistent insertIfAbsent
 * before sending HTTP 2xx. Never ACK when this function throws.
 * The encrypted event-id inbox does not process or fetch email body.
 */
const {verifySvix}=require('../pilot/resend-webhook/lib/verify-svix');
const {enqueueVerifiedResendEvent}=require('./premium-resend-secure-queue');
const MAX_BYTES=65536;
async function receiveVerifiedResendMetadata({
  raw,headers,webhookSecret,encryptionKey,allowedRecipient,
  store,nowSeconds
}){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)
    throw Error('INVALID_PAYLOAD_SIZE');
  if(!verifySvix(raw,headers,webhookSecret,nowSeconds))
    throw Error('INVALID_WEBHOOK_SIGNATURE');
  let event;
  try{event=JSON.parse(raw);}
  catch(_err){throw Error('INVALID_JSON');}
  return enqueueVerifiedResendEvent({
    verifiedEvent:event,svixId:headers['svix-id'],
    allowedRecipient,keyBase64:encryptionKey,store
  });
}
module.exports={receiveVerifiedResendMetadata};
