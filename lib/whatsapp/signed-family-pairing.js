'use strict';
/** TTP238 server-only prototype; NOT a public route or live Neon adapter. */
const {createHmac}=require('node:crypto');
const {FAMILY_UUID}=require('./family-authorization');
const {createRequestIdentityBinder}=require('./request-identity-binding');
const {verifyMetaSignature}=require('./webhook-security');
const {normalizeMetaDeliveries}=require('./delivery-normalizer');
const {newPairingCode,pairingDigest,parseAcceptanceCommand,
 parseSecret,CONSENT_VERSION,WHATSAPP_ID}=require('./family-pairing-protocol');
const {createPairingOperationSigner,signingKey,
 SIGNED_PAIR_ISSUE_SQL,SIGNED_PAIR_CONFIRM_SQL}
  =require('./signed-pairing-operations');

function isolatedSigner({kind,getActiveSigningKey,forbiddenKeys,now}){
 return createPairingOperationSigner({kind,now,
  getActiveSigningKey:async purpose=>{
   const candidate=await getActiveSigningKey(purpose);
   if(candidate&&typeof candidate.keyBase64==='string'){
    const key=signingKey(candidate.keyBase64);
    if(forbiddenKeys.some(other=>key.equals(other)))
     throw new Error('Pairing operation keys must be independent secrets');
   }
   return candidate;
  }
 });
}
async function runSignedOperation(db,query,params){
 const client=await db.connect();
 if(!client||typeof client.query!=='function'||
    typeof client.release!=='function')
  throw new TypeError('Restricted signing transaction client required');
 let started=false;
 try{
  await client.query('BEGIN');started=true;
  const result=await client.query(query,params);
  const output=result?.rows?.length===1?result.rows[0].result:null;
  if(!output||typeof output!=='object'||Array.isArray(output)||
     !['created','paired','rejected','already_processed'].includes(output.state))
   throw new Error('Invalid signed pairing operation result');
  if(output.state==='rejected'){
   await client.query('ROLLBACK');started=false;
   return output;
  }
  await client.query('COMMIT');started=false;
  return output;
 }catch(error){
  if(started){
   try{await client.query('ROLLBACK');}catch(rollbackError){
    error.cause=rollbackError;
   }
  }
  throw error;
 }finally{client.release();}
}

function createSignedFamilyPairingIssuer({db,pairingHmacKey,
  getActiveSigningKey,getAuthenticatedSession,getMembership,
  bindVerifiedRequest,now=Date.now}={}){
 if(!db||typeof db.connect!=='function')throw new TypeError('Restricted DB pool required');
 const pairKey=parseSecret(pairingHmacKey,'Pairing key');
 const sign=isolatedSigner({
  kind:'issue',getActiveSigningKey,forbiddenKeys:[pairKey],now
 });
 // For preview orchestration, reuse the SAME pinned request verifier used
 // by family operations rather than approximating a second identity check.
 // All dependencies are trusted server-only factories, never HTTP input.
 if(bindVerifiedRequest!==undefined &&
    (getAuthenticatedSession!==undefined||getMembership!==undefined))
  throw new TypeError('Provide one trusted authorization binding source');
 const bind=bindVerifiedRequest===undefined?
  createRequestIdentityBinder({getAuthenticatedSession,getMembership,now}):
  bindVerifiedRequest;
 if(typeof bind!=='function')
  throw new TypeError('Trusted request-bound family authorization required');
 return async function issue({familyId,businessAccountId,phoneNumberId}={}){
  if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
    !WHATSAPP_ID.test(businessAccountId||'')||
    !WHATSAPP_ID.test(phoneNumberId||''))
   throw new TypeError('Invalid family pairing destination');
  const auth=await bind();
  if(await auth.authorizeFamily({
   familyId,action:'enroll_whatsapp_sender'
  })!==true)throw new Error('Verified family administrator required');
  const principal=await auth.getVerifiedPrincipal();
  if(!principal)throw new Error('Verified request session changed');
  const code=newPairingCode();
  const codeDigest=pairingDigest({
   code,businessAccountId,phoneNumberId,pairingKey:pairKey
  });
  const permit=await sign({userId:principal.userId,familyId,
   businessAccountId,phoneNumberId,codeDigest});
  const outcome=await runSignedOperation(db,SIGNED_PAIR_ISSUE_SQL,[
   permit.userId,permit.familyId,permit.businessAccountId,
   permit.phoneNumberId,permit.codeDigest,permit.keyId,
   permit.expiresAt,permit.nonce,permit.signature
  ]);
  if(outcome.state!=='created'||typeof outcome.expiresAt!=='string'||
     !outcome.expiresAt)throw new Error('Signed pairing creation refused');
  return Object.freeze({code,expiresAt:outcome.expiresAt,
   consentVersion:CONSENT_VERSION,
   instruction:'Envia NEXLUPA ACCEPTA '+code+
    ' des del teu WhatsApp al número oficial de NexLupa'
  });
 };
}
function createSignedMetaPairingConfirmer({db,metaAppSecret,
 senderHmacKey,pairingHmacKey,getActiveSigningKey,now=Date.now}={}){
 if(!db||typeof db.connect!=='function')
  throw new TypeError('Restricted DB pool required');
 if(typeof metaAppSecret!=='string'||!metaAppSecret)
  throw new TypeError('Meta application secret required');
 const senderKey=parseSecret(senderHmacKey,'Sender HMAC key');
 const pairKey=parseSecret(pairingHmacKey,'Pairing key');
 if(senderKey.equals(pairKey))
  throw new TypeError('Sender and pairing keys must be independent');
 const sign=isolatedSigner({
  kind:'confirm',getActiveSigningKey,forbiddenKeys:[senderKey,pairKey],now
 });
 return async function confirm(rawBody,signature){
  if(!Buffer.isBuffer(rawBody)||
     !verifyMetaSignature(rawBody,signature,metaAppSecret))
   return {state:'rejected'};
  let normalized;
  try{
   normalized=normalizeMetaDeliveries(JSON.parse(rawBody.toString('utf8')));
  }catch{return {state:'ignored'};}
  const {meta,deliveries}=normalized;
  if(meta.skipped||meta.truncated||deliveries.length!==1||
     deliveries[0].type!=='text'||deliveries[0].contentPending)
   return {state:'ignored'};
  const delivery=deliveries[0];
  const code=parseAcceptanceCommand(delivery.text);
  if(!code)return {state:'ignored'};
  const businessAccountId=delivery.businessAccountId;
  const phoneNumberId=delivery.phoneNumberId;
  const codeDigest=pairingDigest({code,businessAccountId,
   phoneNumberId,pairingKey:pairKey});
  const senderDigest=createHmac('sha256',senderKey)
   .update(delivery.senderWaId,'utf8').digest();
  const permit=await sign({businessAccountId,phoneNumberId,
   codeDigest,senderDigest,providerMessageId:delivery.providerMessageId});
  const outcome=await runSignedOperation(db,SIGNED_PAIR_CONFIRM_SQL,[
   permit.businessAccountId,permit.phoneNumberId,permit.codeDigest,
   permit.senderDigest,permit.providerMessageId,permit.keyId,
   permit.expiresAt,permit.nonce,permit.signature
  ]);
  return {state:outcome.state};
 };
}
module.exports={createSignedFamilyPairingIssuer,
 createSignedMetaPairingConfirmer,runSignedOperation};
