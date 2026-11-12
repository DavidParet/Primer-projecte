'use strict';

/**
 * STAGED, server-only: replace raw durable-inbox INSERT with an HMAC-signed
 * restricted PostgreSQL RPC. NO public route or Neon wiring. This adaptor is
 * only safe when its db client actually uses the restricted ingest role; a
 * privileged connection is NOT narrowed merely by using this JavaScript.
 *
 * The backend must independently verify Meta's RAW X-Hub-Signature-256 before
 * calling the durable inbox. No provider verification can happen in SQL.
 */
const {createHmac,createHash,randomUUID}=require('node:crypto');
const {INSERT_SQL}=require('./durable-inbox');
const PURPOSE='whatsapp-inbound-ingest';
const PREFIX='NEXLUPA-WA-INGEST-1';
const KEY_ID=/^[a-z][a-z0-9_-]{2,39}$/;
const DIGITS=/^[0-9]{5,30}$/;
const MSG=/^wamid\.[A-Za-z0-9._=-]{1,256}$/;
const TTL_SECONDS=30;
const SIGNED_INSERT_SQL='SELECT public.nex_ci_signed_store_whatsapp_inbound('+
 ' $1,$2,$3::bytea,$4,$5::bytea,$6::bytea,$7::bytea,$8::bigint,'+
 ' $9,$10::bigint,$11::uuid,$12::bytea) AS state';

function canonicalKey(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))
  throw new TypeError('Dedicated canonical 32-byte secret required');
 const key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)
  throw new TypeError('Invalid dedicated 32-byte secret');
 return key;
}
function ingestPermitPayload({
 keyId,business,phone,senderDigest,messageId,iv,tag,ciphertext,
 providerTimestamp,expiresAt,nonce
}={}){
 if(!KEY_ID.test(keyId||'')||
  !DIGITS.test(business||'')||!DIGITS.test(phone||'')||
  !Buffer.isBuffer(senderDigest)||senderDigest.length!==32||
  !MSG.test(messageId||'')||
  !Buffer.isBuffer(iv)||iv.length!==12||
  !Buffer.isBuffer(tag)||tag.length!==16||
  !Buffer.isBuffer(ciphertext)||ciphertext.length<1||
  ciphertext.length>65536||
  !/^[0-9]{9,12}$/.test(String(providerTimestamp||''))||
  !Number.isSafeInteger(expiresAt)||expiresAt<=0||
  typeof nonce!=='string'||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce))
  throw new TypeError('Invalid verified synthetic inbound permit fields');
 return [
  PREFIX,keyId,business,phone,senderDigest.toString('hex'),
  messageId,iv.toString('hex'),tag.toString('hex'),
  createHash('sha256').update(ciphertext).digest('hex'),
  String(providerTimestamp),String(expiresAt),nonce.toLowerCase()
 ].join('|');
}
function createSignedInboundIngestAdapter({
 db,getActiveSigningKey,now=Date.now,senderHmacKey,contentEncryptionKey
}={}){
 if(!db||typeof db.query!=='function'||typeof getActiveSigningKey!=='function'||
    typeof now!=='function')
  throw new TypeError('Restricted SQL client and trusted ingress signer required');
 const senderKey=canonicalKey(senderHmacKey);
 const encryptionKey=canonicalKey(contentEncryptionKey);
 if(senderKey.equals(encryptionKey))throw new TypeError('Sender and content keys must differ');

 async function translateQuery(client,sql,params){
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
   if(params!==undefined && params!==null)
    throw new TypeError('Transaction control does not accept parameters');
   return client.query(sql);
  }
  if(sql!==INSERT_SQL||!Array.isArray(params)||params.length!==8)
   throw new Error('Only signed inbound insertion is available');
  const [business,phone,senderDigest,messageId,iv,tag,ciphertext,providerTimestamp]=params;
  // Signing keys cannot be sourced from the webhook, database response,
  // caller's input JSON or the durable inbox's sender/encryption keys.
  const selection=await getActiveSigningKey(PURPOSE);
  if(!selection||selection.purpose!==PURPOSE||
     selection.state!=='active'||!KEY_ID.test(selection.keyId||''))
   throw new Error('Active dedicated inbound signing key unavailable');
  const key=canonicalKey(selection.keyBase64);
  if(key.equals(senderKey)||key.equals(encryptionKey))
   throw new Error('Inbound signing key must be isolated');
  const current=Math.floor(now()/1000);
  if(!Number.isSafeInteger(current)||current<=0)
   throw new Error('Trusted inbound signing clock required');
  const permit={
   keyId:selection.keyId,business,phone,senderDigest,messageId,
   iv,tag,ciphertext,providerTimestamp,
   expiresAt:current+TTL_SECONDS,nonce:randomUUID()
  };
  const signature=createHmac('sha256',key)
   .update(ingestPermitPayload(permit),'utf8').digest();
  return client.query(SIGNED_INSERT_SQL,[
   business,phone,senderDigest,messageId,iv,tag,ciphertext,
   String(providerTimestamp),permit.keyId,permit.expiresAt,permit.nonce,signature
  ]);
 }

 const adapter={query:(sql,params)=>translateQuery(db,sql,params)};
 if(typeof db.connect==='function'){
  adapter.connect=async()=>{
   const client=await db.connect();
   if(!client||typeof client.query!=='function'||typeof client.release!=='function')
    throw new Error('Restricted transaction client required');
   return {
    query:(sql,params)=>translateQuery(client,sql,params),
    release:()=>client.release()
   };
  };
 }
 return Object.freeze(adapter);
}
module.exports={
 createSignedInboundIngestAdapter,ingestPermitPayload,SIGNED_INSERT_SQL,
 PURPOSE,PREFIX,TTL_SECONDS
};
