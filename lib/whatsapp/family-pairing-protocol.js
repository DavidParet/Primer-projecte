'use strict';

/**
 * TTP236 prototype only: a one-time family pairing code.
 *
 * A verified family administrator displays the code to the intended phone
 * holder, who voluntarily sends "NEXLUPA ACCEPTA <code>" to the NexLupa
 * WhatsApp business number. A Meta-signed inbound message proves possession
 * of the sender account; the code alone NEVER registers a sender.
 *
 * Pairing codes and phone numbers must not be logged or retained as text.
 */
const {createHmac,randomBytes}=require('node:crypto');

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN=/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
const WHATSAPP_ID=/^\d{5,30}$/;
const CONSENT_VERSION='whatsapp-incoming-text-v1';
const PAIRING_VALID_MINUTES=10;

function parseSecret(value,label){
  if(typeof value!=='string')throw new TypeError(label+' required');
  const b=Buffer.from(value,'base64');
  if(b.length!==32||b.toString('base64')!==value)
    throw new TypeError(label+' must be canonical 32-byte base64');
  return b;
}

function newPairingCode(){
  // 16 x 5 bits of unbiased random entropy: 80-bit one-time challenge.
  const random=randomBytes(16);
  const letters=Array.from(random,b=>ALPHABET[b & 31]).join('');
  return letters.match(/.{4}/g).join('-');
}

function parseAcceptanceCommand(message) {
  if(typeof message!=='string'||message.length>80)return null;
  const match=/^NEXLUPA ACCEPTA ([A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3})$/i
    .exec(message.trim());
  const code=match?.[1]?.toUpperCase();
  return code && CODE_PATTERN.test(code)?code:null;
}

function pairingDigest({code,businessAccountId,phoneNumberId,pairingKey}){
  if(!CODE_PATTERN.test(code||'') ||
    !WHATSAPP_ID.test(businessAccountId||'') ||
    !WHATSAPP_ID.test(phoneNumberId||'')) {
    throw new TypeError('Invalid pairing challenge identity');
  }
  const key=Buffer.isBuffer(pairingKey)?pairingKey:parseSecret(pairingKey,'Pairing key');
  if(key.length!==32)throw new TypeError('Pairing HMAC key must have 32 bytes');
  return createHmac('sha256',key)
    .update('nexlupa-pairing-v1|'+businessAccountId+'|'+phoneNumberId+'|'+code)
    .digest();
}
module.exports={
  newPairingCode,parseAcceptanceCommand,pairingDigest,parseSecret,
  CODE_PATTERN,WHATSAPP_ID,CONSENT_VERSION,PAIRING_VALID_MINUTES
};
