'use strict';

/**
 * CI/STAGED ONLY. Sign exact one-use family inbox requests after the caller
 * has independently verified the active IdP session and canonical membership.
 * A role with only PostgreSQL EXECUTE cannot forge arbitrary identity reads.
 * Never accept signing keys, userId or sessionId from HTTP JSON.
 */
const {createHmac,createHash,randomUUID}=require('node:crypto');
const {FAMILY_UUID}=require('./family-authorization');
const PURPOSE='whatsapp-inbox-read';
const PREFIX='NEXLUPA-INBOX-READ-1';
const KEY_ID=/^[a-z][a-z0-9_-]{2,39}$/;
const USER=/^[A-Za-z0-9_-]{1,128}$/;
const SESSION_MAX=1024;
const MAX_LIMIT=20;
const TTL_SECONDS=30;

function secretBytes(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))
  throw new TypeError('Dedicated canonical 32-byte inbox signing key required');
 const key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)
  throw new TypeError('Inbox signing key is invalid');
 return key;
}
function inboxReadPayload({keyId,userId,familyId,sessionDigest,
  beforeInboundId,limit,expiresAt,nonce}){
 if(!KEY_ID.test(keyId||'')||!USER.test(userId||'')||
    !FAMILY_UUID.test(familyId||'')||!Buffer.isBuffer(sessionDigest)||
    sessionDigest.length!==32||
    !(beforeInboundId===null||(Number.isSafeInteger(beforeInboundId)&&beforeInboundId>0))||
    !Number.isInteger(limit)||limit<1||limit>MAX_LIMIT||
    !Number.isSafeInteger(expiresAt)||expiresAt<=0||
    typeof nonce!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce))
  throw new TypeError('Invalid signed inbox request fields');
 return [PREFIX,keyId,userId,familyId.toLowerCase(),sessionDigest.toString('hex'),
  beforeInboundId===null?'0':String(beforeInboundId),String(limit),
  String(expiresAt),nonce.toLowerCase()].join('|');
}
function createInboxReadPermitSigner({getActiveSigningKey,now=Date.now,
  contentEncryptionKey}={}){
 if(typeof getActiveSigningKey!=='function'||typeof now!=='function')
  throw new TypeError('Trusted inbox signing key resolver and clock required');
 const encryptionKey=secretBytes(contentEncryptionKey);
 return async function signInboxReadPermit({userId,sessionId,familyId,
   beforeInboundId=null,limit=10}={}){
  if(typeof sessionId!=='string'||sessionId.length<1||
     sessionId.length>SESSION_MAX||!USER.test(userId||'')||
     !FAMILY_UUID.test(familyId||''))
   throw new TypeError('Verified canonical session is required');
  // A hash of the server-only session identifier is signed and submitted to
  // SQL. Neither a cookie nor the raw session ID reaches PostgreSQL.
  const sessionDigest=createHash('sha256').update(
   'nexlupa:inbox-session:v1:').update(sessionId,'utf8').digest();
  const selected=await getActiveSigningKey(PURPOSE);
  if(!selected||selected.purpose!==PURPOSE||selected.state!=='active'||
     !KEY_ID.test(selected.keyId||''))
   throw new Error('No active dedicated inbox signing key');
  const key=secretBytes(selected.keyBase64);
  if(key.equals(encryptionKey))throw new Error('Inbox signing key must be isolated');
  const current=Math.floor(now()/1000);
  if(!Number.isSafeInteger(current)||current<=0)
   throw new Error('Invalid trusted inbox signing clock');
  const permit={
   userId,familyId:familyId.toLowerCase(),sessionDigest,
   beforeInboundId,limit,keyId:selected.keyId,
   expiresAt:current+TTL_SECONDS,nonce:randomUUID()
  };
  const signature=createHmac('sha256',key)
   .update(inboxReadPayload(permit),'utf8').digest();
  return Object.freeze({...permit,signature});
 };
}

module.exports={createInboxReadPermitSigner,inboxReadPayload,
 PURPOSE,PREFIX,TTL_SECONDS};
