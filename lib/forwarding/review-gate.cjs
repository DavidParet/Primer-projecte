'use strict';

/**
 * Worker-side human-review gate for forwarded emails.
 *
 * Calling this helper MUST NOT trigger any AI action, message send, calendar
 * mutation or automatic publication. All returned text is UNTRUSTED and must
 * be shown in a human-approval interface, never injected as instructions.
 *
 * The webhook only stores encrypted metadata. The separate fetchReceivedEmail
 * adapter is called ONLY after an active family+alias consent check.
 */
const {decryptReceiptEnvelope}=require('./neon-receipt.cjs');

const MAX_BODY_BYTES=12000;
const MAX_SUBJECT_CHARS=180;
const MAX_SENDER_CHARS=254;
const emailPattern=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function senderAddress(from){
  if(typeof from!=='string'||from.length>MAX_SENDER_CHARS||/[\r\n\0]/.test(from))
    return null;
  const trimmed=from.trim();
  let address;
  if(emailPattern.test(trimmed)){
    address=trimmed;
  } else {
    // Display names can be untrusted. Reject embedded email addresses, commas
    // and multiple mailbox syntaxes to prevent a deceptive sender identity.
    const match=/^([^<>]*)<([^<>]+)>$/.exec(trimmed);
    if(!match)return null;
    const display=match[1].trim();
    if(!display || display.length>120 || /[@,]/.test(display))return null;
    address=match[2].trim();
    if(!emailPattern.test(address))return null;
  }
  return address.toLowerCase();
}

function cleanPlainText(raw){
  if(typeof raw!=='string'||!raw.trim()||
      Buffer.byteLength(raw,'utf8')>MAX_BODY_BYTES)return null;
  // Strip disallowed controls, but preserve line breaks. Plain text is DATA.
  const cleaned=raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
    .replace(/\r\n?/g,'\n');
  return cleaned.trim()||null;
}

async function prepareHumanReview({
  receiptKey,encryptedEnvelope,encryptionKeyHex,
  resolveAuthorizedRecipient,fetchReceivedEmail,approvedSenders
}){
  if(typeof resolveAuthorizedRecipient!=='function'||
     typeof fetchReceivedEmail!=='function'||
     !Array.isArray(approvedSenders)||
     approvedSenders.length===0||approvedSenders.length>20)
    throw new Error('review_gate_not_configured');
  // This is decrypted in server memory; no mailbox data goes to logs.
  const receipt=decryptReceiptEnvelope({
    receiptKey,encryptedEnvelope,encryptionKeyHex
  });
  const approved=new Set();
  for(const candidate of approvedSenders){
    const email=senderAddress(candidate);
    if(!email||candidate.trim().toLowerCase()!==email)
      throw new Error('invalid_approved_sender');
    approved.add(email);
  }
  const authorized=async()=>{
    const record=await resolveAuthorizedRecipient(receipt.recipient);
    return Boolean(record && record.active===true &&
      record.consentActive===true &&
      typeof record.familyId==='string' &&
      record.familyId.toLowerCase()===receipt.familyId);
  };

  // 1. Consent MUST be true before fetching any content.
  if(!await authorized())
    return {status:'consent_missing',bodyFetched:false};

  // 2. The API adapter is injected: no Resend key or provider calls here.
  const response=await fetchReceivedEmail(receipt.emailId);
  if(!response||typeof response!=='object'||Array.isArray(response)||
     response.error || !response.data || typeof response.data!=='object')
    return {status:'retrieval_failed',bodyFetched:false};
  const email=response.data;
  const id=email.id||email.email_id;
  const address=senderAddress(email.from);
  // The retrieved email must still be addressed exclusively to the alias
  // bound to this receipt. Do not infer family identity from From or Subject.
  const recipientMatches=Array.isArray(email.to) && email.to.length===1 &&
    typeof email.to[0]==='string' &&
    email.to[0].toLowerCase()===receipt.recipient;
  if(id!==receipt.emailId || !recipientMatches || !address || !approved.has(address) ||
     !Array.isArray(email.attachments)||email.attachments.length!==0)
    return {status:'source_not_approved',bodyFetched:true};

  // Enforce text-only first pilot. Never parse HTML, links, images or files.
  const body=cleanPlainText(email.text);
  const subject=email.subject;
  if(!body||typeof subject!=='string'||!subject.trim()||
     subject.length>MAX_SUBJECT_CHARS||
     /[\r\n\0]/.test(subject))
    return {status:'unsupported_content',bodyFetched:true};

  // 3. If consent was revoked while Resend was responding, drop the body.
  if(!await authorized())
    return {status:'consent_missing',bodyFetched:true};

  return {
    status:'pending_human_review',
    familyId:receipt.familyId,receiptKey,
    sender:address,subject:subject.trim(),
    text:body,
    untrustedContent:true,
    approvedForAutoActions:false,
    requiresHumanApproval:true
  };
}

module.exports={prepareHumanReview,senderAddress,cleanPlainText};
