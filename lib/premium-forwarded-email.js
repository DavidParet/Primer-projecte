'use strict';
/**
 * NEXLUPA — isolated prototype for family-email forwarding.
 *
 * This is an INTERNAL DOMAIN SERVICE, NOT a public inbound-email webhook.
 * A production webhook must independently authenticate its mail provider,
 * sender, recipient, and registration before calling routeForwardedEmail.
 *
 * Incoming plaintext MIME is untrusted. No Gmail account, SMTP, database,
 * WhatsApp group or Google Calendar is accessed here.
 */
const crypto=require('node:crypto');
const {processCommunication}=require('./premium-agent-pipeline');

const MAX_TEXT=25000;
const MAX_SUBJECT=500;
function norm(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}
function email(s){
  const x=String(s||'').trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)?x:null;
}
function cleanSubject(s){
  let subject=norm(s);
  for(let i=0;i<8;i++){
    const next=subject.replace(/^(?:re|fwd?|rv|i|aw)\s*:\s*/,'');
    if(next===subject)break;
    subject=next;
  }
  return subject;
}
function containsTerm(haystack,word){
  const target=norm(word);
  if(!target||target.length<3)return false;
  const tidy=s=>' '+s.replace(/[^a-z0-9]+/g,' ').trim()+' ';
  return tidy(haystack).includes(tidy(target));
}
function resolveFamily(recipient,registry){
  const families=Array.isArray(registry?.families)?registry.families:[];
  const matches=families.filter(f=>Array.isArray(f.inboundAddresses)&&
    f.inboundAddresses.some(address=>email(address)===recipient));
  return matches.length===1?{family:matches[0]}:{
    error:matches.length?'DUPLICATED_RECIPIENT_REGISTRATION':'UNKNOWN_FAMILY_ALIAS'
  };
}
function resolveActivity(family,subject,body){
  const activities=Array.isArray(family.activities)?family.activities:[];
  const matching=activities.filter(a=>{
    const terms=[a.name,...(Array.isArray(a.keywords)?a.keywords:[])];
    const distinct=[...new Set(terms.map(norm))];
    return distinct.some(term=>containsTerm(subject,term)||containsTerm(body,term));
  });
  if(!matching.length)return {status:'needs-review',reason:'ACTIVITY_NOT_FOUND'};
  if(matching.length>1)return {status:'needs-review',reason:'AMBIGUOUS_ACTIVITY',
    candidateActivityIds:matching.map(a=>a.id)};
  return {status:'matched',activity:matching[0]};
}
function canonicalBody(text){
  // Quote text is preserved; only insignificant whitespace is normalized.
  // Different signatures or added comments may still prevent deduplication.
  return norm(text);
}
function fingerprint({familyId,subject,textPlain}){
  return crypto.createHash('sha256').update(JSON.stringify([
    familyId,cleanSubject(subject),canonicalBody(textPlain)
  ])).digest('hex');
}
function routeForwardedEmail({delivery,registry,verification,seenFingerprints=[]}){
  // verification MUST be computed by a trusted adapter, never copied from
  // client headers/body or request JSON. This function is NOT an auth boundary.
  if(verification?.providerAuthenticated!==true||
     verification?.senderAuthenticated!==true)
    return {status:'rejected',reason:'UNVERIFIED_INBOUND'};
  if(!delivery||typeof delivery!=='object')
    return {status:'rejected',reason:'INVALID_DELIVERY'};
  const recipient=email(delivery.envelopeRecipient);
  const sender=email(delivery.envelopeSender);
  if(!recipient||!sender)return {status:'rejected',reason:'INVALID_ADDRESS'};
  const resolved=resolveFamily(recipient,registry);
  if(resolved.error)return {status:'rejected',reason:resolved.error};
  const family=resolved.family;
  if(!family.id||!Array.isArray(family.verifiedForwarders)||
    !family.verifiedForwarders.some(v=>email(v)===sender))
    return {status:'rejected',reason:'UNREGISTERED_FORWARDER'};
  if(typeof delivery.subject!=='string'||delivery.subject.length>MAX_SUBJECT||
    typeof delivery.textPlain!=='string'||!delivery.textPlain.trim()||
    delivery.textPlain.length>MAX_TEXT||
    typeof delivery.providerMessageId!=='string'||!delivery.providerMessageId.trim()||
    !Number.isFinite(Date.parse(delivery.receivedAt||'')))
    return {status:'rejected',reason:'INVALID_MESSAGE'};
  if(Array.isArray(delivery.attachments)&&delivery.attachments.length){
    return {status:'needs-review',reason:'ATTACHMENTS_NOT_PROCESSED',
      familyId:family.id,attachmentCount:delivery.attachments.length};
  }
  const subject=cleanSubject(delivery.subject);
  const body=canonicalBody(delivery.textPlain);
  const activity=resolveActivity(family,subject,body);
  if(activity.status!=='matched')
    return {status:'needs-review',familyId:family.id,reason:activity.reason,
      candidateActivityIds:activity.candidateActivityIds||[]};
  const digest=fingerprint({familyId:family.id,subject:delivery.subject,
    textPlain:delivery.textPlain});
  if(seenFingerprints.includes(digest))
    return {status:'duplicate',familyId:family.id,activityId:activity.activity.id,
      fingerprint:digest};
  const messageId='forwarded-'+digest;
  return {
    status:'accepted',familyId:family.id,activityId:activity.activity.id,
    fingerprint:digest,sourceProviderId:delivery.providerMessageId,
    message:{
      activityId:activity.activity.id,authorized:true,
      messageId,channel:'email-forwarded',receivedAt:delivery.receivedAt,
      text:delivery.textPlain,subject:delivery.subject
    }
  };
}
async function processForwardedEmail({delivery,registry,verification,
  seenFingerprints=[],client,state,todayLocal,model}){
  const routed=routeForwardedEmail({delivery,registry,verification,seenFingerprints});
  if(routed.status!=='accepted')return {
    ...routed,externalWrites:0,calendarPlans:[]};
  // Cross-tenant and cross-activity isolation must be rechecked after routing.
  if(!state||state.familyId!==routed.familyId||
    state.activityId!==routed.activityId)
    return {status:'rejected',reason:'STATE_IDENTITY_MISMATCH',
      externalWrites:0,calendarPlans:[]};
  const outcome=await processCommunication({
    client,state,message:routed.message,todayLocal,model
  });
  return {...outcome,status:outcome.outcome,forwardedEmail:{
    familyId:routed.familyId,activityId:routed.activityId,
    fingerprint:routed.fingerprint,sourceMessageId:routed.message.messageId
  }};
}
module.exports={
  norm,email,cleanSubject,containsTerm,resolveFamily,resolveActivity,
  fingerprint,routeForwardedEmail,processForwardedEmail
};
