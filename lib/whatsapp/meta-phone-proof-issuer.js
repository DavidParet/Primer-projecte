'use strict';
/**
 * STAGED ONLY. Meta raw-body HMAC -> challenge possession -> signed,
 * restricted PostgreSQL proof. This DOES NOT enroll a WhatsApp sender.
 * Web consent receipt and signed atomic activation are still mandatory.
 * No public route calls this module; no real Meta/Neon credentials used.
 */
const {createHmac,randomUUID}=require('node:crypto');
const {MAX_BODY_BYTES,verifyMetaSignature}=require('./webhook-security');
const {TextDecoder}=require('node:util');
const {normalizeMetaDeliveries}=require('./delivery-normalizer');
const {parseAcceptanceCommand,pairingDigest,parseSecret,WHATSAPP_ID}=
 require('./family-pairing-protocol');

const PURPOSE='phone-proof-issue';
const ISSUE_SQL='SELECT public.nex_ci_signed_store_meta_phone_proof('+
 ' $1,$2,$3::bytea,$4::bytea,$5::bytea,$6,$7,$8::bigint,$9::uuid,$10::bytea'+
 ') AS result';
const KEY_ID=/^[a-z][a-z0-9_-]{2,39}$/;
const MESSAGE_ID=/^wamid[.][A-Za-z0-9._=-]{1,256}$/;
const MAX_MESSAGE_AGE_MS=10*60*1000;
function formatProofPermit({
  keyId,businessAccountId,phoneNumberId,codeDigest,senderDigest,
  proofDigest,providerMessageId,expiresAt,nonce
}){
  return ['NEXLUPA-META-PROOF-1',keyId,businessAccountId,
   phoneNumberId,codeDigest.toString('hex'),senderDigest.toString('hex'),
   proofDigest.toString('hex'),providerMessageId,String(expiresAt),
   nonce.toLowerCase()].join('|');
}
function createMetaPhoneProofIssuer({
 db,metaAppSecret,senderHmacKey,pairingHmacKey,proofHmacKey,
 getActiveSigningKey,businessAccountId,phoneNumberId,now=Date.now
}={}){
 if(!db||typeof db.connect!=='function'||
   typeof getActiveSigningKey!=='function'||typeof now!=='function'||
   typeof metaAppSecret!=='string'||!metaAppSecret||
   !WHATSAPP_ID.test(businessAccountId||'')||
   !WHATSAPP_ID.test(phoneNumberId||'')) {
  throw new TypeError('Trusted Meta proof signer configuration required');
 }
 const senderKey=parseSecret(senderHmacKey,'Meta sender HMAC key');
 const pairingKey=parseSecret(pairingHmacKey,'Pairing HMAC key');
 const proofKey=parseSecret(proofHmacKey,'Phone proof HMAC key');
 if(senderKey.equals(pairingKey)||senderKey.equals(proofKey)||
    pairingKey.equals(proofKey))
  throw new Error('Meta sender, pairing and phone proof secrets must be distinct');
 return async function storeVerifiedPhoneProof(rawBody,signature){
  if(!Buffer.isBuffer(rawBody)||rawBody.length>MAX_BODY_BYTES||
     !verifyMetaSignature(rawBody,signature,metaAppSecret))
   return {state:'rejected'};
  // Signed but malformed UTF-8 must never be silently replaced with U+FFFD.
  // Reject it before parsing, even if an unrelated JSON field is affected.
  let decoded;
  try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(rawBody);}
  catch{return {state:'rejected'};}
  let normalized;
  try{normalized=normalizeMetaDeliveries(JSON.parse(decoded));}
  catch{return {state:'ignored'};}
  const {deliveries,meta}=normalized;
  if(meta.skipped!==0||meta.truncated||meta.statusUpdates!==0||
     deliveries.length!==1||deliveries[0].type!=='text'||
     deliveries[0].contentPending)
   return {state:'ignored'};
  const item=deliveries[0];
  if(item.businessAccountId!==businessAccountId||
     item.phoneNumberId!==phoneNumberId||
     !MESSAGE_ID.test(item.providerMessageId))
   return {state:'rejected'};
  const code=parseAcceptanceCommand(item.text);
  if(!code)return {state:'ignored'};
  const nowMs=now();
  const sentMs=Number(item.providerTimestamp)*1000;
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(sentMs)||
     sentMs>nowMs+60000 || sentMs<nowMs-MAX_MESSAGE_AGE_MS)
   return {state:'rejected'};
  const codeDigest=pairingDigest({code,businessAccountId,phoneNumberId,
   pairingKey});
  const senderDigest=createHmac('sha256',senderKey)
   .update(item.senderWaId,'utf8').digest();
  const proofDigest=createHmac('sha256',proofKey)
   .update('nexlupa:phone-proof:v1:').update(code).digest();
  const key=await getActiveSigningKey(PURPOSE);
  if(!key||key.state!=='active'||key.purpose!==PURPOSE||
     !KEY_ID.test(key.keyId||''))
   throw new Error('Dedicated Meta proof signing key unavailable');
  const signingKey=parseSecret(key.keyBase64,'Meta proof operation HMAC key');
  if([senderKey,pairingKey,proofKey].some(previous=>previous.equals(signingKey)))
   throw new Error('Meta proof signing key not isolated');
  const timestamp=Math.floor(now()/1000);
  if(!Number.isSafeInteger(timestamp)||timestamp<=0||
     now()-nowMs>60000)
   throw new Error('Meta proof signing clock not trusted');
  const permit={keyId:key.keyId,businessAccountId,phoneNumberId,
   codeDigest,senderDigest,proofDigest,
   providerMessageId:item.providerMessageId,
   expiresAt:timestamp+45,nonce:randomUUID()};
  const mac=createHmac('sha256',signingKey)
   .update(formatProofPermit(permit),'utf8').digest();
  const client=await db.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
   throw new Error('Restricted Meta proof transaction client required');
  let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   const result=await client.query(ISSUE_SQL,[
    businessAccountId,phoneNumberId,codeDigest,senderDigest,
    proofDigest,item.providerMessageId,key.keyId,permit.expiresAt,
    permit.nonce,mac
   ]);
   const outcome=result?.rowCount===1&&result?.rows?.length===1?
     result.rows[0].result?.state:null;
   if(!['verified','rejected'].includes(outcome))
    throw new Error('Unverified restricted Meta proof result');
   if(outcome==='rejected'){
    await client.query('ROLLBACK');begun=false;
    return {state:'rejected'};
   }
   await client.query('COMMIT');begun=false;
   return {state:'verified'};
  }catch(error){
   if(begun){
    try{await client.query('ROLLBACK');}catch(rollbackError){error.cause=rollbackError;}
   }
   throw error;
  }finally{client.release();}
 };
}
module.exports={createMetaPhoneProofIssuer,ISSUE_SQL,formatProofPermit,PURPOSE};
