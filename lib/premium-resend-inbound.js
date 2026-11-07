'use strict';
/**
 * NEXLUPA Resend RECEIVING adapter (internal, prototype-only).
 *
 * Resend sends an email.received metadata event. It DOES NOT contain the
 * message body. Verify the raw webhook with the official SDK FIRST; only
 * then retrieve the message by email_id using receiving.get(email_id).
 *
 * This is NOT an HTTP endpoint or a ready-to-deploy integration. Production
 * still requires durable queue/ack, encrypted storage, independent sender
 * attestation, consent, retention, rate limiting and safe attachment handling.
 *
 * authenticateForwarder MUST be independent trusted proof. It defaults to
 * false. Never infer approval from From, webhook signature, or event payload.
 */
const {email,resolveFamily,processForwardedEmail}=require('./premium-forwarded-email');
const ID=/^[a-f0-9-]{12,80}$/i;
const MAX_TEXT=8000;
function canonicalFrom(value){
  if(typeof value!=='string'||value.length>320)return null;
  const m=/^[^<>]*<([^<>]+)>$/.exec(value.trim());
  return email(m?m[1]:value);
}
function singleRecipient(value){
  if(!Array.isArray(value)||value.length!==1)return null;
  return email(value[0]);
}
function result(status,reason=null,extra={}){
  return {status,reason,calendarPlans:[],externalWrites:0,...extra};
}
function verifiedResendEvent({resend,rawPayload,headers,webhookSecret}){
  if(!resend?.webhooks||typeof resend.webhooks.verify!=='function'||
    typeof rawPayload!=='string'||rawPayload.length>250000||
    typeof webhookSecret!=='string'||!webhookSecret.startsWith('whsec_')||
    !headers||typeof headers.id!=='string'||
    typeof headers.timestamp!=='string'||typeof headers.signature!=='string')
    return {status:'rejected',reason:'INVALID_VERIFICATION_INPUT'};
  let event;
  try{
    event=resend.webhooks.verify({
      payload:rawPayload,
      headers:{id:headers.id,timestamp:headers.timestamp,signature:headers.signature},
      webhookSecret
    });
  }catch(_err){return {status:'rejected',reason:'INVALID_WEBHOOK_SIGNATURE'}}
  if(!event||event.type!=='email.received')
    return {status:'ignored',reason:'NOT_AN_INBOUND_EMAIL_EVENT'};
  const d=event.data;
  if(!d||!ID.test(d.email_id||'')||!canonicalFrom(d.from)||
    !singleRecipient(d.to)||typeof d.subject!=='string'||d.subject.length>500||
    (d.attachments!==undefined&&!Array.isArray(d.attachments)))
    return {status:'needs-review',reason:'INVALID_INBOUND_METADATA'};
  if(d.attachments?.length)
    return {status:'needs-review',reason:'ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING'};
  return {status:'verified',event};
}
async function processResendReceived({
  resend,rawPayload,headers,webhookSecret,registry,state,
  authenticateForwarder=()=>false,client,todayLocal,model,seenFingerprints=[]
}){
  const verified=verifiedResendEvent({resend,rawPayload,headers,webhookSecret});
  if(verified.status!=='verified')return result(verified.status,verified.reason);
  const event=verified.event,d=event.data;
  const recipient=singleRecipient(d.to),sender=canonicalFrom(d.from);
  // Routing is before data retrieval and before any model call.
  const familyResolved=resolveFamily(recipient,registry);
  if(familyResolved.error)
    return result('rejected',familyResolved.error);
  const family=familyResolved.family;
  if(!Array.isArray(family.verifiedForwarders)||
    !family.verifiedForwarders.some(v=>email(v)===sender))
    return result('rejected','UNREGISTERED_FORWARDER');
  if(!state||state.familyId!==family.id)
    return result('rejected','STATE_IDENTITY_MISMATCH');
  if(typeof authenticateForwarder!=='function')
    return result('rejected','INVALID_SENDER_AUTH_ADAPTER');
  // The callback is a trust boundary and must be populated from externally
  // validated evidence, not raw user-controlled email headers.
  let forwarderAuthenticated=false;
  try{forwarderAuthenticated=await authenticateForwarder({
    verifiedProviderEvent:event,recipient,from:sender,familyId:family.id
  })===true}catch(_err){/* fail closed */}
  if(!forwarderAuthenticated)
    return result('needs-review','SENDER_AUTHENTICATION_PENDING',
      {familyId:family.id});
  if(!resend.emails?.receiving||typeof resend.emails.receiving.get!=='function')
    return result('retry','RECEIVING_API_UNAVAILABLE');
  let retrieved;
  try{
    const response=await resend.emails.receiving.get(d.email_id);
    if(response.error||!response.data)
      return result('retry','RECEIVING_API_FAILURE');
    retrieved=response.data;
  }catch(_err){return result('retry','RECEIVING_API_FAILURE')}
  if(retrieved.id!==d.email_id||
    canonicalFrom(retrieved.from)!==sender||
    singleRecipient(retrieved.to)!==recipient||
    retrieved.subject!==d.subject)
    return result('needs-review','RETRIEVED_METADATA_MISMATCH',{familyId:family.id});
  if(Array.isArray(retrieved.attachments)&&retrieved.attachments.length)
    return result('needs-review','ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING',
      {familyId:family.id});
  if(typeof retrieved.text!=='string'||!retrieved.text.trim()||
    retrieved.text.length>MAX_TEXT)
    return result('needs-review','UNSUPPORTED_OR_OVERSIZED_CONTENT',
      {familyId:family.id});
  const delivery={
    envelopeRecipient:recipient,envelopeSender:sender,
    providerMessageId:d.email_id,receivedAt:d.created_at||event.created_at,
    subject:d.subject,textPlain:retrieved.text,attachments:[]
  };
  // This is the existing shared NEXLUPA family/activity email engine.
  // All cross-tenant checks and calendar-plan-only behavior still apply.
  const processed=await processForwardedEmail({
    delivery,registry,
    verification:{providerAuthenticated:true,senderAuthenticated:true},
    seenFingerprints,client,state,todayLocal,model
  });
  return {...processed,provider:'resend',externalWrites:0};
}
module.exports={canonicalFrom,singleRecipient,verifiedResendEvent,processResendReceived};
