'use strict';
/**
 * Dedicated Neon adapter for the metadata-only, opt-in forwarding pilot.
 *
 * A single SQL statement must recheck recipient ownership + consent in the
 * SAME statement that inserts the receipt, closing the async TOCTOU window.
 * Database role needs only EXECUTE on resolve_authorized_recipient(text) and
 * INSERT/SELECT on nexlupa_pilot.resend_inbox_queue.
 * This adapter is not wired to the live webhook.
 */
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/;
const EMAIL_ID=/^[a-zA-Z0-9_-]{10,100}$/;
const RECIPIENT=/^in-[0-9a-f]{32}@entrada\.nexlupa\.app$/;

const INSERT_SQL=`
WITH permitted AS (
  SELECT nexlupa_worker_rpc.resolve_authorized_recipient($3::text) AS family_id
), inserted AS (
  INSERT INTO nexlupa_pilot.resend_inbox_queue
    (queue_id, encrypted_envelope, state, attempts)
  SELECT $1::char(64), $2::text, 'received', 0
  FROM permitted WHERE family_id = $4::uuid
  ON CONFLICT (queue_id) DO NOTHING RETURNING queue_id
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM inserted) THEN 'inserted'
  WHEN EXISTS (SELECT 1 FROM permitted WHERE family_id = $4::uuid) THEN 'duplicate'
  ELSE 'revoked'
END AS outcome
`;

function createNeonReceiptAdapters({query,encryptionKeyHex}){
  if(typeof query!=='function'||typeof encryptionKeyHex!=='string'||
     !/^[0-9a-f]{64}$/i.test(encryptionKeyHex))
    throw new Error('forwarding_secure_adapter_not_configured');
  const key=Buffer.from(encryptionKeyHex,'hex');
  if(key.length!==32)throw new Error('forwarding_secure_adapter_not_configured');

  async function resolveAuthorizedRecipient(recipient){
    if(typeof recipient!=='string'||!RECIPIENT.test(recipient))
      return null;
    // The SECURITY DEFINER function itself checks active family, alias and
    // unexpired, unrevoked resend_forward/read_school_mail consent.
    const result=await query(
      'SELECT nexlupa_worker_rpc.resolve_authorized_recipient($1::text) AS family_id',
      [recipient]
    );
    const id=result?.rows?.[0]?.family_id;
    if(typeof id!=='string'||!UUID.test(id))return null;
    return {familyId:id.toLowerCase(),active:true,consentActive:true};
  }

  async function enqueueReceipt({receiptKey,familyId,emailId,recipient}){
    if(!SHA256.test(receiptKey||'')||!UUID.test(familyId||'')||
       !EMAIL_ID.test(emailId||'')||!RECIPIENT.test(recipient||''))
      throw new Error('invalid_receipt_metadata');
    const plaintext=Buffer.from(JSON.stringify({
      v:1,kind:'resend_metadata_receipt',
      receiptKey,emailId,recipient,familyId
    }),'utf8');
    // The encryption key is a server-only secret and never sent to browsers.
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    // Cryptographically bind the envelope to the exact database primary key.
    // Copying ciphertext to another queue row must fail decryption.
    cipher.setAAD(Buffer.from(receiptKey,'ascii'));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const encoded=[
      'v1',iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url')
    ].join('.');
    if(Buffer.byteLength(encoded,'utf8')>4096)
      throw new Error('encrypted_receipt_too_large');
    // Atomic consent check + durable uniqueness. Do not reimplement this as
    // separate check and INSERT queries.
    const result=await query(INSERT_SQL,[receiptKey,encoded,recipient,familyId]);
    const outcome=result?.rows?.[0]?.outcome;
    if(!['inserted','duplicate','revoked'].includes(outcome))
      throw new Error('durable_receipt_not_confirmed');
    return outcome;
  }
  return {resolveAuthorizedRecipient,enqueueReceipt};
}

// Worker-facing, server-only inverse. Never expose decrypted metadata over HTTP.
function decryptReceiptEnvelope({receiptKey,encryptedEnvelope,encryptionKeyHex}){
  if(!SHA256.test(receiptKey||'') ||
      typeof encryptionKeyHex!=='string' ||
      !/^[0-9a-f]{64}$/i.test(encryptionKeyHex) ||
      typeof encryptedEnvelope!=='string' ||
      encryptedEnvelope.length<40 || encryptedEnvelope.length>4096)
    throw new Error('invalid_receipt_envelope');
  const [version,iv64,tag64,cipher64,...extra]=encryptedEnvelope.split('.');
  if(version!=='v1'||extra.length ||
     !/^[A-Za-z0-9_-]{16}$/.test(iv64||'') ||
     !/^[A-Za-z0-9_-]{22}$/.test(tag64||'') ||
     !/^[A-Za-z0-9_-]+$/.test(cipher64||''))
    throw new Error('invalid_receipt_envelope');
  try{
    const iv=Buffer.from(iv64,'base64url');
    const tag=Buffer.from(tag64,'base64url');
    const payload=Buffer.from(cipher64,'base64url');
    if(iv.length!==12 || tag.length!==16 || payload.length<25 ||
       iv.toString('base64url')!==iv64 ||
       tag.toString('base64url')!==tag64 ||
       payload.toString('base64url')!==cipher64)
      throw new Error('invalid_receipt_envelope');
    const decipher=createDecipheriv('aes-256-gcm',
      Buffer.from(encryptionKeyHex,'hex'),iv);
    decipher.setAAD(Buffer.from(receiptKey,'ascii'));
    decipher.setAuthTag(tag);
    const obj=JSON.parse(Buffer.concat([
      decipher.update(payload),decipher.final()
    ]).toString('utf8'));
    if(!obj || Array.isArray(obj) || obj.v!==1 ||
       obj.kind!=='resend_metadata_receipt' ||
       obj.receiptKey!==receiptKey ||
       !UUID.test(obj.familyId||'') ||
       !EMAIL_ID.test(obj.emailId||'') ||
       !RECIPIENT.test(obj.recipient||'') ||
       Object.keys(obj).sort().join(',')!==
         ['emailId','familyId','kind','receiptKey','recipient','v'].sort().join(','))
      throw new Error('invalid_receipt_envelope');
    return obj;
  }catch{
    throw new Error('invalid_receipt_envelope');
  }
}

module.exports={createNeonReceiptAdapters,decryptReceiptEnvelope,INSERT_SQL};
