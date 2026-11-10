'use strict';

/**
 * Resend email.received -> consented family queue receipt, offline pilot.
 * No email bodies, attachment downloads, AI, Gmail API, Calendar or sending.
 * An untrusted email never becomes an instruction or authority.
 *
 * IMPORTANT: enqueueReceipt MUST be backed by a durable unique constraint on
 * receiptKey; a process-local Set is NOT production deduplication.
 */
const {createHmac,createHash,timingSafeEqual}=require('node:crypto');

const MAX_BYTES=16384;
const EMAIL_ID=/^[a-zA-Z0-9_-]{10,100}$/;
const FAMILY_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 128-bit non-predictable mailbox alias, never a name or family ID.
const PILOT_RECIPIENT=/^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/;

function verifySvix(raw,headers,secret,nowSeconds=Math.floor(Date.now()/1000)){
  if(typeof raw!=='string' || Buffer.byteLength(raw,'utf8')>MAX_BYTES ||
     !raw.length || typeof secret!=='string' || !secret.startsWith('whsec_') ||
     !headers || typeof headers!=='object' || Array.isArray(headers) ||
     !Number.isSafeInteger(nowSeconds)) return false;
  const id=headers['svix-id'],timestamp=headers['svix-timestamp'];
  const signatures=headers['svix-signature'];
  if(typeof id!=='string' || !/^[A-Za-z0-9_-]{4,150}$/.test(id) ||
     typeof timestamp!=='string' || !/^\d{10}$/.test(timestamp) ||
     Math.abs(nowSeconds-Number(timestamp))>300 ||
     typeof signatures!=='string' || signatures.length>1000) return false;
  const rawSecret=secret.slice(6);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(rawSecret))return false;
  const key=Buffer.from(rawSecret,'base64');
  if(key.length<16 || key.toString('base64')!==rawSecret) return false;
  const expected=createHmac('sha256',key)
    .update(id+'.'+timestamp+'.'+raw,'utf8').digest();
  const parts=signatures.trim().split(/\s+/);
  if(parts.length>5)return false;
  for(const part of parts){
    if(!part.startsWith('v1,'))continue;
    const value=part.slice(3);
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))continue;
    const received=Buffer.from(value,'base64');
    if(received.length===expected.length &&
       received.toString('base64')===value &&
       timingSafeEqual(received,expected))return true;
  }
  return false;
}

function normalizeRecipient(value){
  if(typeof value!=='string' || value.length>120 || value.trim()!==value)
    return null;
  const lower=value.toLowerCase();
  return PILOT_RECIPIENT.test(lower)?lower:null;
}
function parseEvent(raw){
  let event;
  try{event=JSON.parse(raw);}catch{throw new Error('invalid_event_json');}
  if(!event || typeof event!=='object' || Array.isArray(event))
    throw new Error('invalid_event_json');
  return event;
}

async function acceptSignedReceipt({
  raw,headers,secret,enabled=false,nowSeconds,
  resolveAuthorizedRecipient,enqueueReceipt
}){
  if(enabled!==true) return {status:'pilot_disabled'};
  if(typeof resolveAuthorizedRecipient!=='function' ||
     typeof enqueueReceipt!=='function')
    throw new Error('secure_backend_required');
  if(!verifySvix(raw,headers,secret,nowSeconds))
    throw new Error('invalid_webhook_signature');
  const event=parseEvent(raw);
  if(event.type!=='email.received')return {status:'ignored_event'};
  const data=event.data;
  if(!data || typeof data!=='object' || Array.isArray(data) ||
     typeof data.email_id!=='string' || !EMAIL_ID.test(data.email_id) ||
     !Array.isArray(data.to) || data.to.length!==1 ||
     !Array.isArray(data.attachments))
    return {status:'unsupported_receipt'};
  // Attachments / multiple recipients are excluded from the first pilot.
  if(data.attachments.length!==0)return {status:'unsupported_receipt'};
  const recipient=normalizeRecipient(data.to[0]);
  if(!recipient)return {status:'unsupported_recipient'};

  // Sender/subject/message body are deliberately NEVER used for
  // authentication, family routing, or enqueued data.
  const authorization=await resolveAuthorizedRecipient(recipient);
  if(!authorization || authorization.active!==true ||
     authorization.consentActive!==true ||
     typeof authorization.familyId!=='string' ||
     !FAMILY_ID.test(authorization.familyId))
    return {status:'not_authorized'};

  // Fail closed on revoked consent immediately before the durable write.
  const checkAgain=await resolveAuthorizedRecipient(recipient);
  if(!checkAgain || checkAgain.active!==true ||
     checkAgain.consentActive!==true ||
     checkAgain.familyId.toLowerCase()!==authorization.familyId.toLowerCase())
    return {status:'not_authorized'};

  const receiptKey=createHash('sha256')
    .update(JSON.stringify(['resend',recipient,data.email_id]),'utf8')
    .digest('hex');
  const result=await enqueueReceipt({
    receiptKey,
    familyId:authorization.familyId.toLowerCase(),
    emailId:data.email_id,
    recipient
  });
  if(result!=='inserted' && result!=='duplicate')
    throw new Error('durable_receipt_not_confirmed');
  return {status:result==='inserted'?'queued':'duplicate',receiptKey};
}

module.exports={verifySvix,acceptSignedReceipt,normalizeRecipient};
