'use strict';
/**
 * NEXLUPA isolated, NOT DEPLOYED prototype receiver.
 *
 * Requirements before deployment:
 * - real transactional PostgreSQL store with least-privilege DB credentials
 * - RESEND_WEBHOOK_SECRET and 32-byte encryption key in Vercel secrets
 * - strict recipient allowlist, rate limiting, logging without PII
 * - worker/sender authentication and consent before fetching any body
 *
 * Acknowledges email.received only after an INSERT commits. No AI or
 * Calendar actions. Dependencies injected for fully offline tests.
 */
const {receiveVerifiedResendMetadata}=
  require('../../lib/premium-resend-verified-intake');
function response(status,code){
  return {statusCode:status,headers:{'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Content-Type':'application/json'},
    body:JSON.stringify({code})};
}
function normalizedHeaders(rawHeaders={}){
  if(!rawHeaders||typeof rawHeaders!=='object')return {};
  const result={};
  for(const key of ['svix-id','svix-timestamp','svix-signature']){
    const entry=Object.entries(rawHeaders).find(([k])=>k.toLowerCase()===key);
    if(entry)result[key]=entry[1];
  }
  return result;
}
function createDurableWebhook({
  webhookSecret,encryptionKey,allowedRecipient,store,nowSeconds
}={}){
  // Fail closed at boot if any dependency is missing.
  if(typeof webhookSecret!=='string'||!webhookSecret.startsWith('whsec_')||
    typeof encryptionKey!=='string'||typeof allowedRecipient!=='string'||
    !store||typeof store.insertIfAbsent!=='function')
    throw Error('DURABLE_WEBHOOK_NOT_CONFIGURED');
  return async function handle({method,headers,body}={}){
    if(method!=='POST')return response(405,'METHOD_NOT_ALLOWED');
    if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>65536)
      return response(413,'INVALID_PAYLOAD_SIZE');
    try{
      const result=await receiveVerifiedResendMetadata({
        raw:body,headers:normalizedHeaders(headers),
        webhookSecret,encryptionKey,allowedRecipient,store,nowSeconds
      });
      if(result.status==='stored'||result.status==='duplicate'||
         result.status==='ignored')return response(204,'OK');
      return response(503,'UNCONFIRMED_DELIVERY');
    }catch(err){
      const badInput=new Set([
        'INVALID_WEBHOOK_SIGNATURE','INVALID_JSON','INVALID_QUEUE_INPUT',
        'RECIPIENT_NOT_ALLOWED','ATTACHMENTS_UNSUPPORTED',
        'INVALID_PAYLOAD_SIZE'
      ]);
      if(badInput.has(err?.message))return response(400,'REJECTED');
      // Unknown database errors are 503, never success. Don't log email.
      return response(503,'DURABLE_STORAGE_UNAVAILABLE');
    }
  };
}
module.exports={createDurableWebhook};
