'use strict';
/**
 * Lease protocol for the *future*, isolated forwarding review worker.
 *
 * This module does not read emails, start jobs or access production. The DB
 * worker must have a distinct role from nexlupa_resend_ingest; no grants are
 * performed here. Never run on an anonymous HTTP request.
 */
const {randomUUID}=require('node:crypto');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT=/^[0-9a-f]{64}$/;

const CLAIM_SQL=`
WITH next_receipt AS (
  SELECT queue_id FROM nexlupa_pilot.resend_inbox_queue
  WHERE attempts < $2::integer
    AND (
      (state IN ('received','retry') AND available_at <= now())
      OR (state = 'processing' AND lease_until < now())
    )
  ORDER BY available_at, created_at, queue_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE nexlupa_pilot.resend_inbox_queue q SET
  state='processing',
  lease_token=$1::uuid,
  lease_until=now() + ($3::integer * interval '1 second'),
  attempts=q.attempts + 1,
  updated_at=now()
FROM next_receipt n
WHERE q.queue_id=n.queue_id
RETURNING q.queue_id,q.encrypted_envelope,q.attempts,q.lease_token
`;

const COMPLETE_SQL=`
UPDATE nexlupa_pilot.resend_inbox_queue SET
  state=$3::text,
  lease_token=NULL,
  lease_until=NULL,
  available_at=CASE WHEN $3::text='retry'
    THEN now() + ($4::integer * interval '1 second')
    ELSE available_at END,
  updated_at=now()
WHERE queue_id=$1::char(64)
  AND lease_token=$2::uuid
  AND state='processing'
  AND lease_until > now()
RETURNING queue_id
`;

function createLeaseAdapter({query,maxAttempts=5,leaseSeconds=45}={}){
  if(typeof query!=='function' ||
     !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||
     !Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>120)
    throw Error('lease_adapter_not_configured');

  async function claimOne(){
    const token=randomUUID();
    const r=await query(CLAIM_SQL,[token,maxAttempts,leaseSeconds]);
    const row=r?.rows?.[0];
    if(!row)return null;
    const queueId=typeof row.queue_id==='string'?row.queue_id.trim():null;
    if(!RECEIPT.test(queueId||'') || typeof row.encrypted_envelope!=='string' ||
      !UUID.test(row.lease_token||'') || row.lease_token!==token ||
      !Number.isInteger(row.attempts)||row.attempts<1||row.attempts>maxAttempts)
      throw Error('invalid_claim_result');
    return {queueId,encryptedEnvelope:row.encrypted_envelope,
      attempts:row.attempts,leaseToken:token};
  }

  async function finish({queueId,leaseToken,status,retrySeconds=30,
    reviewArtifactStored=false}={}){
    if(!RECEIPT.test(queueId||'') || !UUID.test(leaseToken||'') ||
       !['retry','done','failed','needs_review'].includes(status) ||
       (status==='needs_review' && reviewArtifactStored!==true) ||
       !Number.isInteger(retrySeconds) || retrySeconds<10 ||retrySeconds>300)
      throw Error('invalid_lease_completion');
    const r=await query(COMPLETE_SQL,
      [queueId,leaseToken,status,retrySeconds]);
    return r?.rowCount===1;
  }

  return {claimOne,finish};
}

module.exports={createLeaseAdapter,CLAIM_SQL,COMPLETE_SQL};
