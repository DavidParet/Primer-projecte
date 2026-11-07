'use strict';
/**
 * NEXLUPA — OFFLINE prototype: forwarded e-mail -> family activity.
 * The trusted SMTP/webhook ingress MUST authenticate the provider request and
 * set trustedDelivery/senderAuthenticated from provider verification, NEVER from
 * mail headers or sender-controlled fields. Not an inbound mail server.
 */
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=x=>String(x||'').trim().toLowerCase();
const fold=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const words=x=>' '+fold(x).replace(/[^a-z0-9]+/g,' ').trim()+' ';
const isEmail=x=>EMAIL.test(clean(x));
const bounded=(s,min,max)=>typeof s==='string'&&s.length>=min&&s.length<=max;
const matchKeyword=(haystack,word)=>words(word).length>4&&words(haystack).includes(words(word));
function familyForAlias(registry,address){
  const alias=clean(address);
  const matches=(registry?.families||[]).filter(f=>clean(f.alias)===alias);
  return matches.length===1?matches[0]:null;
}
function routeActivity(family,subject,body){
  const text=subject+' '+body,matched=[];
  for(const activity of family.activities||[]){
    if((activity.keywords||[]).some(key=>matchKeyword(text,key)))matched.push(activity);
  }
  if(matched.length===1)return {status:'matched',activity:matched[0]};
  if(matched.length===0)return {status:'review',reason:'activity-not-recognized'};
  return {status:'review',reason:'multiple-activities-possible'};
}
function authorizedInbound(inbound,registry){
  if(!inbound||inbound.trustedDelivery!==true||
    inbound.senderAuthenticated!==true)return {status:'rejected',reason:'untrusted-delivery-or-sender'};
  if(!bounded(inbound.messageId,4,220)||!isEmail(inbound.to)||!isEmail(inbound.from)||
    !bounded(inbound.bodyText,1,100000)||!bounded(inbound.subject||'',0,600)||
    !bounded(inbound.receivedAt,15,80))
    return {status:'rejected',reason:'invalid-inbound-format'};
  const family=familyForAlias(registry,inbound.to);
  if(!family)return {status:'rejected',reason:'unknown-or-colliding-family-alias'};
  if(!(family.verifiedSenders||[]).map(clean).includes(clean(inbound.from)))
    return {status:'rejected',reason:'sender-not-enrolled'};
  return {status:'authorized',family};
}
function contentKey(inbound,familyId){
  return familyId+'|'+words(inbound.subject).trim()+'|'+words(inbound.bodyText).trim();
}
function receiveForwardedEmail({inbound,registry,processedIds=[],processedContent=[]}){
  const auth=authorizedInbound(inbound,registry);
  if(auth.status!=='authorized')return {...auth,externalWrites:0};
  const family=auth.family;
  const receiptKey=family.id+'|'+inbound.messageId;
  const fingerprint=contentKey(inbound,family.id);
  if(processedIds.includes(receiptKey)||processedContent.includes(fingerprint))
    return {status:'duplicate',familyId:family.id,externalWrites:0};
  const activity=routeActivity(family,inbound.subject,inbound.bodyText);
  if(activity.status!=='matched')
    return {status:'needs-review',familyId:family.id,reason:activity.reason,
      receiptKey,fingerprint,externalWrites:0};
  return {
    status:'ready',familyId:family.id,activityId:activity.activity.id,
    receiptKey,fingerprint,
    message:{
      messageId:receiptKey,activityId:activity.activity.id,authorized:true,
      channel:'email-forwarded',receivedAt:inbound.receivedAt,
      text:[inbound.subject,inbound.bodyText].filter(Boolean).join('\n\n'),
      intake:{originalSender:clean(inbound.from),destinationAlias:clean(inbound.to)}
    },
    externalWrites:0
  };
}
module.exports={authorizedInbound,familyForAlias,routeActivity,receiveForwardedEmail,matchKeyword};
