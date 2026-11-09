'use strict';
/** Svix/Resend HMAC-SHA256 verifier. No provider API keys here. */
const crypto = require('node:crypto');
function verifySvix(raw, headers, secret, nowSeconds=Math.floor(Date.now()/1000)) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw,'utf8') > 65536 ||
      typeof secret !== 'string' || !secret.startsWith('whsec_') ||
      secret.length < 20 || !headers || typeof headers !== 'object') return false;
  const id=headers['svix-id'], ts=headers['svix-timestamp'],
        signatures=headers['svix-signature'];
  if (typeof id !== 'string' || id.length<4 || id.length>200 ||
      typeof ts !== 'string' || !/^\d{10}$/.test(ts) ||
      typeof signatures !== 'string' || signatures.length>3000 ||
      Math.abs(nowSeconds-Number(ts))>300) return false;
  let key;
  try {key=Buffer.from(secret.slice(6),'base64');}
  catch (_err) {return false;}
  if (key.length<16) return false;
  const expected=crypto.createHmac('sha256',key)
    .update(id+'.'+ts+'.'+raw).digest();
  for(const entry of signatures.trim().split(/\s+/)) {
    if(!entry.startsWith('v1,')) continue;
    const encoded=entry.slice(3);
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))continue;
    const received=Buffer.from(encoded,'base64');
    if(received.length===expected.length &&
       crypto.timingSafeEqual(received,expected))return true;
  }
  return false;
}
module.exports={verifySvix};
