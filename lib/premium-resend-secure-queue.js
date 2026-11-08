'use strict';
/**
 * Encrypted metadata-only intake for a future NEXLUPA Resend worker.
 *
 * IMPORTANT: This module is a library, not a live webhook or a database.
 * Call ONLY AFTER independent cryptographic verification of Resend/Svix.
 * A production store MUST implement atomic durable insertIfAbsent with a
 * unique key: process restarts or retries may never cause a double insert.
 *
 * Contains only Resend message IDs and a validated pilot recipient: no
 * subject, content, sender, attachment or family identity is stored.
 * The later worker must independently authenticate the sender, establish
 * consent and tenant routing before reading email body/using any model.
 */
const crypto=require('node:crypto');
const EMAIL_ID=/^[a-f\d-]{12,80}$/i;
const SvixId=/^[a-zA-Z\d_-]{4,200}$/;
const MAX_RECIPIENT=320;
const PREFIX='nexlupa:resend:metadata:v1:';
function parseQueueKey(key) {
  if(typeof key!=='string'||!/^([A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{44})$/.test(key))
    throw Error('QUEUE_KEY_UNAVAILABLE');
  const buf=Buffer.from(key,'base64');
  if(buf.length!==32)throw Error('QUEUE_KEY_UNAVAILABLE');
  return buf;
}
function normalizedRecipient(s) {
  if(typeof s!=='string'||s.length>MAX_RECIPIENT)return null;
  const e=s.toLowerCase().trim();
  if(!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e))
    return null;
  return e;
}
function assertVerifiedMetadata({event,svixId,allowedRecipient}) {
  const requested=normalizedRecipient(allowedRecipient);
  if(!requested||!SvixId.test(svixId||''))throw Error('INVALID_QUEUE_INPUT');
  if(event?.type!=='email.received')return {ignored:true};
  const d=event.data;
  if(!d||typeof d.email_id!=='string'||!EMAIL_ID.test(d.email_id)||
     !Array.isArray(d.to)||d.to.length!==1)
    throw Error('INVALID_QUEUE_INPUT');
  const recipient=normalizedRecipient(d.to[0]);
  if(!recipient||recipient!==requested)throw Error('RECIPIENT_NOT_ALLOWED');
  if(Array.isArray(d.attachments)&&d.attachments.length>0)
    throw Error('ATTACHMENTS_UNSUPPORTED');
  // Sender and body are *not* accepted into this metadata queue.
  return {emailId:d.email_id.toLowerCase(),recipient,ignored:false};
}
function sealEnvelope(metadata,key,queueId){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(PREFIX+queueId));
  const payload=Buffer.from(JSON.stringify(metadata),'utf8');
  const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
  return {version:1,iv:iv.toString('base64'),
    ciphertext:encrypted.toString('base64'),
    tag:cipher.getAuthTag().toString('base64')};
}
function openEnvelope(envelope,keyBase64,queueId){
  const key=parseQueueKey(keyBase64);
  if(!envelope||envelope.version!==1||
      !/^[a-f0-9]{64}$/.test(queueId||''))throw Error('INVALID_ENVELOPE');
  let iv,tag,body;
  try{
    iv=Buffer.from(envelope.iv,'base64');
    tag=Buffer.from(envelope.tag,'base64');
    body=Buffer.from(envelope.ciphertext,'base64');
  }catch(_err){throw Error('INVALID_ENVELOPE')}
  if(iv.length!==12||tag.length!==16||body.length<10||body.length>4096)
    throw Error('INVALID_ENVELOPE');
  try {
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(Buffer.from(PREFIX+queueId));
    decipher.setAuthTag(tag);
    const plaintext=Buffer.concat([decipher.update(body),decipher.final()]);
    const data=JSON.parse(plaintext.toString('utf8'));
    if(!data||data.version!==1||!EMAIL_ID.test(data.emailId||'')||
       !normalizedRecipient(data.recipient))throw Error('INVALID_ENVELOPE');
    return data;
  }catch(_err){throw Error('INVALID_ENVELOPE')}
}
/**
 * Returns stored|duplicate|ignored on successful atomic store.
 * Any database error is deliberately thrown: HTTP must return non-2xx.
 * insertIfAbsent MUST be persistent, transactional and uniqueness-enforced.
 */
async function enqueueVerifiedResendEvent({
  verifiedEvent,svixId,allowedRecipient,keyBase64,store
}){
  if(!store||typeof store.insertIfAbsent!=='function')
    throw Error('DURABLE_QUEUE_UNAVAILABLE');
  const key=parseQueueKey(keyBase64);
  const meta=assertVerifiedMetadata({
    event:verifiedEvent,svixId,allowedRecipient
  });
  if(meta.ignored)return {status:'ignored'};
  const queueId=crypto.createHmac('sha256',key)
    .update(PREFIX+meta.emailId).digest('hex');
  const sealed=sealEnvelope({version:1,emailId:meta.emailId,
    recipient:meta.recipient},key,queueId);
  // The caller's store must return true only for a committed new record,
  // false only for a known existing record, and otherwise throw.
  const inserted=await store.insertIfAbsent({id:queueId,envelope:sealed});
  if(inserted!==true&&inserted!==false)
    throw Error('UNCONFIRMED_DURABLE_WRITE');
  return {status:inserted?'stored':'duplicate',queueId};
}
module.exports={enqueueVerifiedResendEvent,openEnvelope,
  assertVerifiedMetadata,parseQueueKey};
