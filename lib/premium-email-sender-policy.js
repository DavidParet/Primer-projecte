'use strict';
/**
 * NEXLUPA — sender trust POLICY for a VERIFIED provider authentication result.
 *
 * NOT a parser for raw MIME, user-supplied HTTP fields or Authentication-Results
 * headers. Call ONLY after the webhook HMAC has been checked and an adapter has
 * normalized evidence directly from the provider's authenticated metadata.
 * Until real Mailgun field names and behavior are validated against a signed
 * TEST fixture, fail closed and do NOT auto-authorize senderProof.
 *
 * Policy: exact enrolled forwarding address and envelope/From agreement;
 * provider-reported DMARC pass plus exact-domain alignment of DKIM or SPF.
 * Legitimate forwarded mail may be quarantined; a human approval flow is needed.
 */
const ADDRESS=/^[^\s<>@]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const domainOf=mail=>typeof mail==='string'&&ADDRESS.test(mail.trim())
  ?mail.trim().toLowerCase().split('@')[1]:null;
const emailOf=mail=>typeof mail==='string'&&ADDRESS.test(mail.trim())
  ?mail.trim().toLowerCase():null;
function evaluateForwarderTrust({webhookVerified=false,from=null,envelopeSender=null,
  enrolledAddresses=[],providerAuth=null}={}){
  const reject=(reason,review=true)=>({trusted:false,reason,needsReview:review});
  if(webhookVerified!==true)return reject('PROVIDER_SIGNATURE_NOT_VERIFIED',false);
  const fromEmail=emailOf(from),sender=emailOf(envelopeSender);
  if(!fromEmail||!sender)return reject('INVALID_MAIL_IDENTITY');
  if(fromEmail!==sender)return reject('ENVELOPE_FROM_MISMATCH');
  if(!Array.isArray(enrolledAddresses)||
    !enrolledAddresses.some(a=>emailOf(a)===fromEmail))
    return reject('FORWARDER_NOT_ENROLLED',false);
  if(!providerAuth||providerAuth.normalizedFromProvider!==true)
    return reject('VERIFIED_PROVIDER_AUTH_RESULT_MISSING');
  const d=domainOf(fromEmail);
  if(providerAuth.dmarc!=='pass')
    return reject('DMARC_NOT_PASS');
  const dkimAligned=providerAuth.dkim==='pass'&&
    providerAuth.dkimDomain===d;
  const spfAligned=providerAuth.spf==='pass'&&
    providerAuth.spfDomain===d;
  if(!dkimAligned&&!spfAligned)return reject('NO_ALIGNED_PASS');
  return {trusted:true,reason:'ENROLLED_AND_ALIGNED_AUTHENTICATION',
    needsReview:false,mechanisms:{
      dkim:dkimAligned,spf:spfAligned,dmarc:true
    }};
}
module.exports={evaluateForwarderTrust,domainOf,emailOf};