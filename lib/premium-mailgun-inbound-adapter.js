'use strict';
/**
 * INTERNAL Mailgun Routes forward() FORM adapter — no HTTP endpoint.
 * Production requirements outside this module: authenticated HTTP transport,
 * bounded multipart parser, rate limits, durable atomic replay cache,
 * independent sender authentication, secret management, privacy and consent.
 * Mailgun webhook HMAC attests the PROVIDER, not the sender's identity.
 */
const crypto=require('node:crypto');
const MAX_SKEW_SECONDS=3600;
const MAX_TEXT=8000;
const MAX_SUBJECT=500;
const SIGNATURE=/^[a-f0-9]{64}$/i;
const TOKEN=/^[a-zA-Z0-9]{20,100}$/;
const TIMESTAMP=/^\d{10,12}$/;
const EMAIL=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
function single(x){return typeof x==='string'?x:null}
function smtpEmail(raw){
  const v=single(raw);
  return v&&EMAIL.test(v.trim().toLowerCase())?v.trim().toLowerCase():null;
}
function fromHeaderEmail(raw){
  const v=single(raw);
  if(!v)return null;
  const t=v.trim();
  const m=/^.*<([^<>\s]+@[^<>\s]+)>$/.exec(t);
  return smtpEmail(m?m[1]:t);
}
function verifyMailgunSignature({form,signingKey,nowSeconds,usedTokens=[]}){
  if(!form||typeof form!=='object'||typeof signingKey!=='string'||signingKey.length<20)
    return {verified:false,reason:'MISSING_VERIFICATION_INPUT'};
  const timestamp=single(form.timestamp),token=single(form.token),signature=single(form.signature);
  if(!TIMESTAMP.test(timestamp||'')||!TOKEN.test(token||'')||!SIGNATURE.test(signature||''))
    return {verified:false,reason:'INVALID_SIGNATURE_FIELDS'};
  const seconds=Number(timestamp);
  if(!Number.isSafeInteger(seconds)||!Number.isFinite(nowSeconds)||
    Math.abs(nowSeconds-seconds)>MAX_SKEW_SECONDS)
    return {verified:false,reason:'EXPIRED_OR_FUTURE_SIGNATURE'};
  if(!Array.isArray(usedTokens))return {verified:false,reason:'INVALID_REPLAY_CACHE'};
  if(usedTokens.includes(token))return {verified:false,reason:'REPLAYED_TOKEN'};
  const expected=crypto.createHmac('sha256',signingKey)
    .update(timestamp+token,'utf8').digest();
  const received=Buffer.from(signature,'hex');
  if(expected.length!==received.length||
    !crypto.timingSafeEqual(expected,received))
    return {verified:false,reason:'INVALID_HMAC'};
  return {verified:true,token,timestamp:seconds};
}
function mailgunFormToDelivery({form,signatureResult,independentlyAuthenticatedSender=false}){
  if(signatureResult?.verified!==true)
    return {status:'rejected',reason:'UNVERIFIED_MAILGUN_REQUEST',externalWrites:0};
  if(!form||typeof form!=='object')
    return {status:'rejected',reason:'INVALID_PAYLOAD',externalWrites:0};
  const from=fromHeaderEmail(form.from),sender=smtpEmail(form.sender);
  const to=smtpEmail(form.recipient);
  if(!sender||!from||!to||sender!==from)
    return {status:'needs-review',reason:'ENVELOPE_FROM_MISMATCH',externalWrites:0};
  if(typeof form.subject!=='string'||form.subject.length>MAX_SUBJECT||
    typeof form['body-plain']!=='string'||form['body-plain'].length>MAX_TEXT||
    !form['body-plain'].trim())
    return {status:'needs-review',reason:'UNSUPPORTED_OR_OVERSIZED_CONTENT',externalWrites:0};
  const count=single(form['attachment-count'])||'0';
  if(!/^\d{1,3}$/.test(count)||Number(count)>100)
    return {status:'needs-review',reason:'INVALID_ATTACHMENT_COUNT',externalWrites:0};
  // The HMAC alone does not prove sender identity.
  if(independentlyAuthenticatedSender!==true)
    return {status:'needs-review',reason:'SENDER_AUTHENTICATION_PENDING',externalWrites:0};
  const attachmentCount=Number(count);
  return {
    status:'mapped',
    verification:{providerAuthenticated:true,senderAuthenticated:true},
    delivery:{
      envelopeRecipient:to,envelopeSender:sender,
      providerMessageId:'mailgun-route-'+signatureResult.token,
      receivedAt:new Date(signatureResult.timestamp*1000).toISOString(),
      subject:form.subject,textPlain:form['body-plain'],
      attachments:Array.from({length:attachmentCount},(_,i)=>({
        received:true,ordinal:i+1
      }))
    },
    usedWebhookToken:signatureResult.token,externalWrites:0
  };
}
function adaptMailgunRoute({form,signingKey,nowSeconds,usedTokens=[],independentlyAuthenticatedSender=false}){
  const signatureResult=verifyMailgunSignature({form,signingKey,nowSeconds,usedTokens});
  if(!signatureResult.verified)
    return {status:'rejected',reason:signatureResult.reason,externalWrites:0};
  return mailgunFormToDelivery({form,signatureResult,independentlyAuthenticatedSender});
}
module.exports={
  verifyMailgunSignature,mailgunFormToDelivery,adaptMailgunRoute,
  MAX_SKEW_SECONDS,MAX_TEXT,MAX_SUBJECT
};