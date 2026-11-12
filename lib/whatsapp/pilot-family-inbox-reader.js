'use strict';

/**
 * STAGED, server-only, preview inbox reader. No HTTP route or real Neon
 * function is enabled here. Database must expose a reviewed restricted
 * SECURITY DEFINER RPC which checks and LOCKS canonical family membership
 * in the SAME statement as ciphertext retrieval. Direct table reads and
 * browser-supplied actor/role identifiers are forbidden.
 */
const {createDecipheriv}=require('node:crypto');
const {TextDecoder}=require('node:util');
const {FAMILY_UUID}=require('./family-authorization');
const {createPilotFamilyBinderFactory}=require('./pilot-family-session');
const {createInboxReadPermitSigner}=require('./signed-inbox-read-permit');

const LIMIT_MAX=20;
const READ_SQL=`
SELECT inbound_id,family_id,business_account_id,phone_number_id,
       provider_message_id,sender_digest,nonce,authentication_tag,
       ciphertext,received_at,expires_at
FROM public.nex_ci_signed_read_family_whatsapp_inbox(
 $1,$2::uuid,$3::bytea,$4::bigint,$5::integer,$6,$7::bigint,$8::uuid,$9::bytea
)
`;
const DIGITS=/^[0-9]{5,30}$/;
const MESSAGE_ID=/^wamid\.[A-Za-z0-9._=-]{1,256}$/;
function keyBytes(base64){
 if(typeof base64!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(base64))
  throw new TypeError('Dedicated 32-byte content encryption key required');
 const value=Buffer.from(base64,'base64');
 if(value.length!==32||value.toString('base64')!==base64)
  throw new TypeError('Invalid dedicated content encryption key');
 return value;
}
function fail(){throw new Error('Inbox data unavailable');}
function safeRow(row,familyId,now,beforeId){
 if(!row||typeof row!=='object'||row.family_id!==familyId||
    !DIGITS.test(row.business_account_id||'')||
    !DIGITS.test(row.phone_number_id||'')||
    !MESSAGE_ID.test(row.provider_message_id||'')||
    !Buffer.isBuffer(row.sender_digest)||row.sender_digest.length!==32||
    !Buffer.isBuffer(row.nonce)||row.nonce.length!==12||
    !Buffer.isBuffer(row.authentication_tag)||row.authentication_tag.length!==16||
    !Buffer.isBuffer(row.ciphertext)||row.ciphertext.length<1)fail();
 const id=Number(row.inbound_id);
 const expiry=new Date(row.expires_at).getTime();
 const receivedAt=new Date(row.received_at);
 if(!Number.isSafeInteger(id)||id<=0||
    (beforeId!==null&&id>=beforeId)||
    !Number.isFinite(expiry)||expiry<=now()||
    !Number.isFinite(receivedAt.getTime()))fail();
 return {id,receivedAt};
}
function createPilotFamilyInboxReader({db,bindVerifiedRequest,contentEncryptionKey,
 getActiveSigningKey,now=Date.now}={}){
 if(!db||typeof db.query!=='function'||typeof bindVerifiedRequest!=='function'||
    typeof now!=='function')throw new TypeError('Verified restricted inbox reader required');
 const key=keyBytes(contentEncryptionKey);
 const signRead=createInboxReadPermitSigner({
  getActiveSigningKey,contentEncryptionKey,now
 });
 return async function readFamilyInbox({familyId,beforeInboundId=null,limit=10}={}){
  if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
     (beforeInboundId!==null&&(!Number.isSafeInteger(beforeInboundId)||beforeInboundId<=0))||
     !Number.isInteger(limit)||limit<1||limit>LIMIT_MAX)
   throw new TypeError('Invalid family inbox query');
  const auth=await bindVerifiedRequest();
  if(!auth||typeof auth.authorizeFamily!=='function'||
     typeof auth.getVerifiedPrincipal!=='function')
   throw new Error('Verified read-only family session required');
  const action={familyId,action:'read_whatsapp_messages'};
  if(await auth.authorizeFamily(action)!==true)
   throw new Error('Current family membership required');
  const principal=await auth.getVerifiedPrincipal();
  if(!principal||typeof principal.userId!=='string'||
     !/^[A-Za-z0-9_-]{1,128}$/.test(principal.userId)||
     typeof principal.sessionId!=='string'||!principal.sessionId)
   throw new Error('Verified family session required');

  // The HMAC key belongs only to the trusted, independently verified
  // session signer. The read DB role can EXECUTE the signed RPC but cannot
  // claim any different user, family, session, cursor or message limit.
  const permit=await signRead({
   userId:principal.userId,sessionId:principal.sessionId,
   familyId,beforeInboundId,limit
  });
  // A remote IdP/role can be revoked while awaiting the key resolver.
  if(await auth.authorizeFamily(action)!==true)
   throw new Error('Family access expired before inbox query');
  const afterSigning=await auth.getVerifiedPrincipal();
  if(!afterSigning||afterSigning.userId!==principal.userId||
     afterSigning.sessionId!==principal.sessionId)
   throw new Error('Family session changed before inbox query');
  const result=await db.query(READ_SQL,[
   permit.userId,permit.familyId,permit.sessionDigest,
   permit.beforeInboundId,permit.limit,permit.keyId,permit.expiresAt,
   permit.nonce,permit.signature
  ]);
  if(!result||!Array.isArray(result.rows)||result.rows.length>limit)fail();
  // The original IdP session and membership may have been revoked during SQL.
  if(await auth.authorizeFamily(action)!==true)
   throw new Error('Family access expired during inbox read');
  const refreshed=await auth.getVerifiedPrincipal();
  if(!refreshed||refreshed.userId!==principal.userId||
     refreshed.sessionId!==principal.sessionId)
   throw new Error('Family session changed during inbox read');
  const messages=[];
  let previous=beforeInboundId;
  for(const row of result.rows){
   const {id,receivedAt}=safeRow(row,familyId,now,previous);
   let text;
   try{
    const aad=Buffer.from(JSON.stringify([
     row.business_account_id,row.phone_number_id,
     row.provider_message_id,row.sender_digest.toString('hex')
    ]),'utf8');
    const decipher=createDecipheriv('aes-256-gcm',key,row.nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(row.authentication_tag);
    const plaintext=Buffer.concat([
     decipher.update(row.ciphertext),decipher.final()
    ]); 
    text=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
   }catch{fail();}
   if(!text.trim())fail();
   messages.push(Object.freeze({id,receivedAt:receivedAt.toISOString(),text}));
   previous=id;
  }
  return Object.freeze({
   messages:Object.freeze(messages),
   nextBeforeInboundId:messages.length===limit?previous:null
  });
 };
}

function createPilotFamilyInboxFactory({
 env,identityDb,inboxDb,contentEncryptionKey,getActiveSigningKey,
 fetchImpl=fetch,now=Date.now
}={}){
 if(!inboxDb||typeof inboxDb.query!=='function')
  throw new TypeError('Dedicated restricted WhatsApp inbox database client required');
 const bindPilotRequest=createPilotFamilyBinderFactory({
  env,db:identityDb,fetchImpl,now
 });
 return function fromPilotReadRequest(request){
  return createPilotFamilyInboxReader({
   db:inboxDb,contentEncryptionKey,getActiveSigningKey,now,
   bindVerifiedRequest:bindPilotRequest(request,{mutation:false})
  });
 };
}
module.exports={createPilotFamilyInboxReader,createPilotFamilyInboxFactory,
 READ_SQL,LIMIT_MAX};
