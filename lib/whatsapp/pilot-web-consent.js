'use strict';
/**
 * STAGED ONLY, no HTTP endpoint. An explicit browser acceptance from a
 * verified family admin creates a one-use web receipt for an independently
 * verified Meta phone proof. It NEVER enrolls the sender automatically.
 */
const {createHmac,randomUUID,randomBytes}=require('node:crypto');
const {createPilotFamilyBinderFactory}=
 require('./pilot-family-session');
const {parseSecret,WHATSAPP_ID,CONSENT_VERSION}=
 require('./family-pairing-protocol');
const {FAMILY_UUID}=require('./family-authorization');

const PURPOSE='web-consent-issue';
const SIGNED_WEB_RECEIPT_SQL=
 'SELECT public.nex_ci_signed_create_web_consent_receipt('+
 ' $1,$2::uuid,$3,$4,$5::bytea,$6::bytea,$7,$8,'+
 ' $9::bigint,$10::uuid,$11::bytea) AS result';
const TOKEN=/^[A-Za-z0-9_-]{16,128}$/;
const KID=/^[a-z][a-z0-9_-]{2,39}$/;
function formatWebConsentPermit({
 keyId,userId,familyId,businessAccountId,phoneNumberId,
 proofDigest,receiptDigest,consentVersion,expiresAt,nonce
}){
 return ['NEXLUPA-WEB-CONSENT-1',keyId,userId,familyId.toLowerCase(),
  businessAccountId,phoneNumberId,proofDigest.toString('hex'),
  receiptDigest.toString('hex'),consentVersion,
  String(expiresAt),nonce.toLowerCase()].join('|');
}
function createSignedWebConsentIssuer({
 db,bindVerifiedRequest,proofHmacKey,receiptHmacKey,
 getActiveSigningKey,businessAccountId,phoneNumberId,now=Date.now
}={}){
 if(!db||typeof db.connect!=='function'||
    typeof bindVerifiedRequest!=='function'||
    typeof getActiveSigningKey!=='function'||typeof now!=='function'||
    !WHATSAPP_ID.test(businessAccountId||'')||
    !WHATSAPP_ID.test(phoneNumberId||''))
  throw new TypeError('Verified web consent issuer configuration required');
 const proofKey=parseSecret(proofHmacKey,'Proof HMAC key');
 const receiptKey=parseSecret(receiptHmacKey,'Web receipt HMAC key');
 if(proofKey.equals(receiptKey))
  throw new Error('Proof and receipt HMAC keys must be independent');
 return async function issueWebConsent({
   familyId,challengeId,accepted,versionAccepted,
   businessAccountId:requestedBusiness,phoneNumberId:requestedPhone
 }={}){
  if(accepted!==true||versionAccepted!==CONSENT_VERSION)
   throw new Error('Explicit current-version web consent required');
  if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
     typeof challengeId!=='string'||!TOKEN.test(challengeId)||
     (requestedBusiness!==undefined&&requestedBusiness!==businessAccountId)||
     (requestedPhone!==undefined&&requestedPhone!==phoneNumberId))
   throw new TypeError('Invalid web consent family or phone proof');
  const auth=await bindVerifiedRequest();
  if(!auth||typeof auth.authorizeFamily!=='function'||
     typeof auth.getVerifiedPrincipal!=='function')
   throw new Error('Verified request-bound family administrator required');
  if(await auth.authorizeFamily({
   familyId,action:'enroll_whatsapp_sender'
  })!==true)throw new Error('Verified family administrator required');
  const principal=await auth.getVerifiedPrincipal();
  if(!principal||typeof principal.userId!=='string'||
     !/^[A-Za-z0-9_-]{1,128}$/.test(principal.userId)||
     typeof principal.sessionId!=='string'||!principal.sessionId)
   throw new Error('Current verified family session required');
  const key=await getActiveSigningKey(PURPOSE);
  if(!key||key.purpose!==PURPOSE||key.state!=='active'||
     !KID.test(key.keyId||''))
   throw new Error('Dedicated web receipt key unavailable');
  const signingKey=parseSecret(key.keyBase64,'Web receipt operation signing key');
  if([proofKey,receiptKey].some(other=>other.equals(signingKey)))
   throw new Error('Web receipt signing key not isolated');
  // Only the trusted server can mint the receipt token. Raw token is never
  // written to PostgreSQL, but returned to the verified web session once.
  const receiptId=randomBytes(24).toString('base64url');
  const proofDigest=createHmac('sha256',proofKey)
   .update('nexlupa:phone-proof:v1:').update(challengeId).digest();
  const receiptDigest=createHmac('sha256',receiptKey)
   .update('nexlupa:consent-receipt:v1:').update(receiptId).digest();
  const epoch=Math.floor(now()/1000);
  if(!Number.isSafeInteger(epoch)||epoch<=0)
   throw new Error('Trusted consent signing clock required');
  const permit={
   keyId:key.keyId,userId:principal.userId,familyId,
   businessAccountId,phoneNumberId,
   proofDigest,receiptDigest,consentVersion:CONSENT_VERSION,
   expiresAt:epoch+45,nonce:randomUUID()
  };
  const signature=createHmac('sha256',signingKey)
   .update(formatWebConsentPermit(permit),'utf8').digest();
  if(await auth.authorizeFamily({
   familyId,action:'enroll_whatsapp_sender'
  })!==true)throw new Error('Family administrator permission expired');
  const refreshed=await auth.getVerifiedPrincipal();
  if(!refreshed||refreshed.userId!==principal.userId||
     refreshed.sessionId!==principal.sessionId)
   throw new Error('Family session changed after consent signing');

  const client=await db.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
   throw new Error('Invalid restricted web receipt database client');
  let began=false;
  try{
   await client.query('BEGIN');began=true;
   const result=await client.query(SIGNED_WEB_RECEIPT_SQL,[
    permit.userId,permit.familyId,businessAccountId,phoneNumberId,
    proofDigest,receiptDigest,CONSENT_VERSION,
    permit.keyId,permit.expiresAt,permit.nonce,signature
   ]);
   const state=result?.rowCount===1&&result?.rows?.length===1?
    result.rows[0].result?.state:null;
   if(!['issued','rejected'].includes(state))
    throw new Error('Unverified web consent receipt result');
   if(state==='rejected'){
    await client.query('ROLLBACK');began=false;
    return {state:'rejected'};
   }
   await client.query('COMMIT');began=false;
   return Object.freeze({state:'issued',receiptId,consentVersion:CONSENT_VERSION});
  }catch(error){
   if(began){
    try{await client.query('ROLLBACK');}
    catch(rollbackError){error.cause=rollbackError;}
   }
   throw error;
  }finally{client.release();}
 };
}
function createPilotWebConsentFactory({
 env,identityDb,receiptDb,proofHmacKey,receiptHmacKey,
 getActiveSigningKey,fetchImpl=fetch,now=Date.now
}={}){
 if(!identityDb||typeof identityDb.query!=='function'||
    !receiptDb||typeof receiptDb.connect!=='function')
  throw new TypeError('Restricted identity and web receipt DB clients required');
 const bindPilotRequest=createPilotFamilyBinderFactory({
  env,db:identityDb,fetchImpl,now
 });
 const businessAccountId=env?.WHATSAPP_WABA_ID;
 const phoneNumberId=env?.WHATSAPP_PHONE_NUMBER_ID;
 if(!WHATSAPP_ID.test(businessAccountId||'')||
    !WHATSAPP_ID.test(phoneNumberId||''))
  throw new Error('Official pilot WhatsApp phone configuration required');
 return function fromPilotRequest(request){
  return createSignedWebConsentIssuer({
   db:receiptDb,bindVerifiedRequest:bindPilotRequest(request,{mutation:true}),
   proofHmacKey,receiptHmacKey,getActiveSigningKey,
   businessAccountId,phoneNumberId,now
  });
 };
}
module.exports={createSignedWebConsentIssuer,createPilotWebConsentFactory,
 SIGNED_WEB_RECEIPT_SQL,formatWebConsentPermit,PURPOSE};
