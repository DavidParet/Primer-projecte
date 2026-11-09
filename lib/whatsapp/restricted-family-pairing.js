'use strict';

/**
 * TTP237 internal, restricted-role pairing prototype.
 *
 * Neither operation is a public HTTP handler. The injected restricted
 * database role must have only EXECUTE on the two SQL functions; the
 * functions independently re-check current family membership and atomically
 * record consent. App-level IdP and Meta proofs are required but their
 * cryptographic trust is not yet bound to the DB credential itself.
 */
const {createHmac}=require('node:crypto');
const {FAMILY_UUID}=require('./family-authorization');
const {createRequestIdentityBinder}=require('./request-identity-binding');
const {verifyMetaSignature}=require('./webhook-security');
const {normalizeMetaDeliveries}=require('./delivery-normalizer');
const {
 newPairingCode,pairingDigest,parseAcceptanceCommand,parseSecret,
 CONSENT_VERSION,WHATSAPP_ID
}=require('./family-pairing-protocol');

const ISSUE_RESTRICTED_SQL=`
SELECT public.nex_ci_issue_whatsapp_pairing(
 $1,$2::uuid,$3,$4,$5::bytea
) AS result
`;
const CONFIRM_RESTRICTED_SQL=`
SELECT public.nex_ci_confirm_whatsapp_pairing(
 $1,$2,$3::bytea,$4::bytea,$5
) AS result
`;

async function transaction(pool,query,params){
 const client=await pool.connect();
 if(!client||typeof client.query!=='function'||
    typeof client.release!=='function')
   throw new TypeError('Restricted transaction client required');
 let began=false;
 try{
  await client.query('BEGIN');began=true;
  const response=await client.query(query,params);
  const outcome=response?.rows?.length===1?response.rows[0].result:null;
  if(!outcome||typeof outcome!=='object'||Array.isArray(outcome)||
     !['created','paired','rejected','already_processed'].includes(outcome.state))
    throw new Error('Invalid restricted pairing operation response');
  await client.query('COMMIT');began=false;
  return outcome;
 }catch(err){
  if(began){
   try{await client.query('ROLLBACK');}
   catch(rollbackError){err.cause=rollbackError;}
  }
  throw err;
 }finally{client.release();}
}

function createRestrictedPairingIssuer({
 db,pairingHmacKey,getAuthenticatedSession,getMembership,now=Date.now
}={}){
 if(!db||typeof db.connect!=='function')
  throw new TypeError('Restricted pairing database required');
 const pairingKey=parseSecret(pairingHmacKey,'Pairing key');
 const bindRequest=createRequestIdentityBinder({
  getAuthenticatedSession,getMembership,now
 });
 return async function issueRestricted({
  familyId,businessAccountId,phoneNumberId
 }={}){
  if(typeof familyId!=='string'||!FAMILY_UUID.test(familyId)||
     !WHATSAPP_ID.test(businessAccountId||'')||
     !WHATSAPP_ID.test(phoneNumberId||''))
    throw new TypeError('Invalid pairing destination');
  const auth=await bindRequest();
  if(await auth.authorizeFamily({
    familyId,action:'enroll_whatsapp_sender'
  })!==true)throw new Error('Verified family administrator required');
  const principal=await auth.getVerifiedPrincipal();
  if(!principal)throw new Error('Verified server session changed');
  const code=newPairingCode();
  const digest=pairingDigest({
    code,businessAccountId,phoneNumberId,pairingKey
  });
  // The server's verified principal is passed as a bound parameter. The
  // definer re-checks active administrator membership under a row lock.
  const result=await transaction(db,ISSUE_RESTRICTED_SQL,[
    principal.userId,familyId,businessAccountId,phoneNumberId,digest
  ]);
  if(result.state!=='created'||
     typeof result.expiresAt!=='string'||!result.expiresAt)
    throw new Error('Pairing creation refused');
  return Object.freeze({
    code,expiresAt:result.expiresAt,consentVersion:CONSENT_VERSION,
    instruction:'Envia NEXLUPA ACCEPTA '+code+
      ' des del teu WhatsApp al número oficial de NexLupa'
  });
 };
}

function createRestrictedPairingConfirmer({
 db,metaAppSecret,senderHmacKey,pairingHmacKey
}={}){
 if(!db||typeof db.connect!=='function')
  throw new TypeError('Restricted pairing database required');
 if(typeof metaAppSecret!=='string'||!metaAppSecret)
  throw new TypeError('Trusted Meta application secret required');
 const senderKey=parseSecret(senderHmacKey,'Sender HMAC key');
 const pairingKey=parseSecret(pairingHmacKey,'Pairing HMAC key');
 if(senderKey.equals(pairingKey))
  throw new TypeError('Separate sender and pairing HMAC keys required');
 return async function confirmRestricted(rawBody,signature){
  if(!Buffer.isBuffer(rawBody)||
     !verifyMetaSignature(rawBody,signature,metaAppSecret))
    return {state:'rejected'};
  let payload,normalized;
  try{
   payload=JSON.parse(rawBody.toString('utf8'));
   normalized=normalizeMetaDeliveries(payload);
  }catch{return {state:'ignored'};}
  const {deliveries,meta}=normalized;
  if(meta.skipped||meta.truncated||deliveries.length!==1||
     deliveries[0].type!=='text'||deliveries[0].contentPending)
    return {state:'ignored'};
  const delivery=deliveries[0];
  const code=parseAcceptanceCommand(delivery.text);
  if(!code)return {state:'ignored'};
  const codeDigest=pairingDigest({
   code,businessAccountId:delivery.businessAccountId,
   phoneNumberId:delivery.phoneNumberId,pairingKey
  });
  const senderDigest=createHmac('sha256',senderKey)
   .update(delivery.senderWaId,'utf8').digest();
  const result=await transaction(db,CONFIRM_RESTRICTED_SQL,[
   delivery.businessAccountId,delivery.phoneNumberId,
   codeDigest,senderDigest,delivery.providerMessageId
  ]);
  return {state:result.state};
 };
}

module.exports={
 createRestrictedPairingIssuer,createRestrictedPairingConfirmer,
 ISSUE_RESTRICTED_SQL,CONFIRM_RESTRICTED_SQL
};
