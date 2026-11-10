'use strict';

/**
 * TTP236, STAGED ONLY. Consent confirmation MUST originate in a Meta-signed
 * inbound text from the WhatsApp account being enrolled. A bare challenge
 * code, claimed family, or caller-supplied sender phone is never sufficient.
 * No production webhook calls this module.
 */
const {createHmac}=require('node:crypto');
const {verifyMetaSignature}=require('./webhook-security');
const {normalizeMetaDeliveries}=require('./delivery-normalizer');
const {
  parseAcceptanceCommand,pairingDigest,parseSecret,CONSENT_VERSION
}=require('./family-pairing-protocol');

const ALREADY_RECEIVED_SQL=`
SELECT 1 FROM public.nex_ci_whatsapp_pairing_receipts
WHERE business_account_id=$1 AND provider_message_id=$2
LIMIT 1
`;
const LOCK_CHALLENGE_SQL=`
SELECT challenge_id,family_id,requested_by,consent_version
FROM public.nex_ci_whatsapp_pairing_challenges
WHERE business_account_id=$1 AND phone_number_id=$2
 AND code_digest=$3::bytea AND consumed_at IS NULL
 AND expires_at>clock_timestamp()
LIMIT 2 FOR UPDATE
`;
const CURRENT_ADMIN_SQL=`
SELECT public.nex_authorize_family_locked(
  $1,$2::uuid,'enroll_whatsapp_sender'
) AS allowed
`;
const CONSUME_CHALLENGE_SQL=`
UPDATE public.nex_ci_whatsapp_pairing_challenges
SET consumed_at=clock_timestamp()
WHERE challenge_id=$1 AND consumed_at IS NULL
RETURNING challenge_id
`;
const INSERT_CONSENT_SQL=`
INSERT INTO public.nex_whatsapp_sender_authorizations(
 family_id,business_account_id,phone_number_id,sender_digest,
 scope,consent_version,consent_at,consent_source,valid_until
)
VALUES ($1::uuid,$2,$3,$4::bytea,'incoming_text',$5,
 clock_timestamp(),'sender_whatsapp_explicit_opt_in',
 clock_timestamp()+interval '30 days')
RETURNING authorization_id
`;
const INSERT_RECEIPT_SQL=`
INSERT INTO public.nex_ci_whatsapp_pairing_receipts(
 business_account_id,provider_message_id,challenge_id
)
VALUES ($1,$2,$3)
ON CONFLICT DO NOTHING
RETURNING provider_message_id
`;

function createMetaPairingConfirmer({
  db,metaAppSecret,senderHmacKey,pairingHmacKey
}={}){
  if(!db||typeof db.connect!=='function')
    throw new TypeError('Trusted transactional enrollment database required');
  if(typeof metaAppSecret!=='string'||!metaAppSecret)
    throw new TypeError('Meta app secret required');
  const senderKey=parseSecret(senderHmacKey,'Sender HMAC key');
  const pairingKey=parseSecret(pairingHmacKey,'Pairing HMAC key');
  if(senderKey.equals(pairingKey))
    throw new TypeError('Separate sender and pairing HMAC keys required');

  return async function confirmSignedPairing(rawBody,signature){
    if(!Buffer.isBuffer(rawBody)||
       !verifyMetaSignature(rawBody,signature,metaAppSecret)) {
      return {state:'rejected'};
    }
    let payload;
    try{payload=JSON.parse(rawBody.toString('utf8'));}
    catch{return {state:'ignored'};}
    let normalized;
    try{normalized=normalizeMetaDeliveries(payload);}
    catch{return {state:'ignored'};}
    const {deliveries,meta}=normalized;
    if(meta.skipped||meta.truncated||deliveries.length!==1||
       deliveries[0].type!=='text'||deliveries[0].contentPending) {
      return {state:'ignored'};
    }
    const delivery=deliveries[0];
    const code=parseAcceptanceCommand(delivery.text);
    if(!code)return {state:'ignored'};
    const digest=pairingDigest({
      code,businessAccountId:delivery.businessAccountId,
      phoneNumberId:delivery.phoneNumberId,pairingKey
    });
    const senderDigest=createHmac('sha256',senderKey)
      .update(delivery.senderWaId,'utf8').digest();
    const client=await db.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new TypeError('Invalid pairing transaction client');
    let began=false;
    try{
      await client.query('BEGIN');began=true;
      const received=await client.query(ALREADY_RECEIVED_SQL,[
        delivery.businessAccountId,delivery.providerMessageId
      ]);
      if(received?.rows?.length===1) {
        await client.query('ROLLBACK');began=false;
        return {state:'already_processed'};
      }
      const challenge=await client.query(LOCK_CHALLENGE_SQL,[
        delivery.businessAccountId,delivery.phoneNumberId,digest
      ]);
      if(challenge?.rows?.length!==1){
        await client.query('ROLLBACK');began=false;
        return {state:'rejected'};
      }
      const row=challenge.rows[0];
      if(row.consent_version!==CONSENT_VERSION ||
         typeof row.requested_by!=='string'||!row.requested_by ||
         typeof row.family_id!=='string') {
        throw new Error('Malformed enrollment challenge');
      }
      const permission=await client.query(CURRENT_ADMIN_SQL,[
        row.requested_by,row.family_id
      ]);
      if(permission?.rows?.length!==1||permission.rows[0].allowed!==true){
        await client.query('ROLLBACK');began=false;
        return {state:'rejected'};
      }
      const consumed=await client.query(CONSUME_CHALLENGE_SQL,[row.challenge_id]);
      if(consumed?.rows?.length!==1)throw new Error('Challenge consumption failed');

      const enrolled=await client.query(INSERT_CONSENT_SQL,[
        row.family_id,delivery.businessAccountId,delivery.phoneNumberId,
        senderDigest,CONSENT_VERSION
      ]);
      if(enrolled?.rows?.length!==1)throw new Error('Pairing enrollment failed');

      const receipt=await client.query(INSERT_RECEIPT_SQL,[
        delivery.businessAccountId,delivery.providerMessageId,row.challenge_id
      ]);
      if(receipt?.rows?.length!==1)throw new Error('Pairing receipt race');
      await client.query('COMMIT');began=false;
      return {state:'paired'};
    }catch(err){
      if(began){
        try{await client.query('ROLLBACK');}
        catch(rollbackError){err.cause=rollbackError;}
      }
      throw err;
    }finally{client.release();}
  };
}

module.exports={
  createMetaPairingConfirmer,ALREADY_RECEIVED_SQL,LOCK_CHALLENGE_SQL,
  CURRENT_ADMIN_SQL,CONSUME_CHALLENGE_SQL,INSERT_CONSENT_SQL,INSERT_RECEIPT_SQL
};
