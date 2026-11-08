'use strict';
/**
 * PostgreSQL adapter for the NEXLUPA isolated Resend metadata queue.
 *
 * REQUIRES migration pilot/resend-postgres/001_queue.sql in a private DB.
 * A DB adapter with async query(sql, params) is injected; NO real DB setup,
 * connection string, provider token or network call is performed here.
 *
 * insertIfAbsent is one ACID INSERT...ON CONFLICT transaction in Postgres.
 * claimOne uses row locking and a fencing lease UUID, avoiding duplicate
 * concurrent worker claims, and permits reclaim after a lost worker.
 * Finish/retry can modify only a row owned by that lease token.
 * Never log decrypted envelopes, model prompts, or mail content.
 */
const crypto=require('node:crypto');
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TABLE='nexlupa_pilot.resend_inbox_queue';
function checkDb(db){
  if(!db||typeof db.query!=='function')throw Error('DATABASE_NOT_CONFIGURED');
  return db;
}
function checkId(id){
  if(typeof id!=='string'||!HEX64.test(id))throw Error('INVALID_QUEUE_ID');
  return id;
}
function checkToken(token){
  if(typeof token!=='string'||!UUID.test(token))throw Error('INVALID_LEASE_TOKEN');
  return token;
}
function integerRange(x,min,max,label){
  if(!Number.isInteger(x)||x<min||x>max)throw Error(label);
  return x;
}
function checkedEnvelope(envelope){
  if(!envelope||envelope.version!==1||
    typeof envelope.iv!=='string'||typeof envelope.tag!=='string'||
    typeof envelope.ciphertext!=='string')throw Error('INVALID_ENVELOPE');
  const s=JSON.stringify({
    version:envelope.version,iv:envelope.iv,
    ciphertext:envelope.ciphertext,tag:envelope.tag
  });
  if(Buffer.byteLength(s)>4096)throw Error('INVALID_ENVELOPE');
  return s;
}
function assertDbResponse(r){
  if(!r||!Number.isInteger(r.rowCount)||!Array.isArray(r.rows))
    throw Error('UNCONFIRMED_DATABASE_RESULT');
  return r;
}
function createResendPostgresStore(db){
  checkDb(db);
  return {
    async insertIfAbsent({id,envelope}={}){
      const queueId=checkId(id),body=checkedEnvelope(envelope);
      const sql=`INSERT INTO ${TABLE} (queue_id,encrypted_envelope)
                 VALUES ($1,$2)
                 ON CONFLICT (queue_id) DO NOTHING
                 RETURNING queue_id`;
      const result=assertDbResponse(await db.query(sql,[queueId,body]));
      if(result.rowCount>1||result.rowCount!==result.rows.length)
        throw Error('UNCONFIRMED_DATABASE_RESULT');
      if(result.rowCount===1&&result.rows[0].queue_id.trim()!==queueId)
        throw Error('DATABASE_QUEUE_ID_MISMATCH');
      return result.rowCount===1;
    },
    async claimOne({leaseSeconds=120,maxAttempts=5}={}){
      integerRange(leaseSeconds,30,1800,'INVALID_LEASE_SECONDS');
      integerRange(maxAttempts,1,100,'INVALID_MAX_ATTEMPTS');
      const token=crypto.randomUUID();
      const sql=`WITH selected AS (
        SELECT queue_id
        FROM ${TABLE}
        WHERE attempts < $1 AND (
          (state IN ('received','retry') AND available_at <= now())
          OR (state='processing' AND lease_until < now())
        )
        ORDER BY available_at,created_at,queue_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${TABLE} q
         SET state='processing',
             lease_token=$2::uuid,
             lease_until=now()+($3::integer * interval '1 second'),
             attempts=q.attempts+1,
             updated_at=now()
        FROM selected
       WHERE q.queue_id=selected.queue_id
      RETURNING q.queue_id,q.encrypted_envelope,q.attempts`;
      const result=assertDbResponse(await db.query(sql,[maxAttempts,token,leaseSeconds]));
      if(result.rowCount>1||result.rowCount!==result.rows.length)
        throw Error('UNCONFIRMED_DATABASE_RESULT');
      if(result.rowCount===0)return null;
      const row=result.rows[0];
      const queueId=checkId(row.queue_id.trim());
      integerRange(row.attempts,1,maxAttempts,'INVALID_ATTEMPTS');
      let envelope;
      try{envelope=JSON.parse(row.encrypted_envelope)}
      catch(_err){throw Error('INVALID_STORED_ENVELOPE')}
      checkedEnvelope(envelope);
      return {queueId,leaseToken:token,attempts:row.attempts,envelope};
    },
    async complete({queueId,leaseToken,outcome}={}){
      checkId(queueId);checkToken(leaseToken);
      if(outcome!=='done'&&outcome!=='needs_review')
        throw Error('INVALID_COMPLETION_OUTCOME');
      const sql=`UPDATE ${TABLE}
           SET state=$3,lease_token=NULL,lease_until=NULL,updated_at=now()
         WHERE queue_id=$1 AND lease_token=$2::uuid AND
               state='processing' AND lease_until > now()
         RETURNING queue_id`;
      const result=assertDbResponse(await db.query(sql,[queueId,leaseToken,outcome]));
      if(result.rowCount>1||result.rowCount!==result.rows.length)
        throw Error('UNCONFIRMED_DATABASE_RESULT');
      if(result.rowCount===1&&result.rows[0].queue_id.trim()!==queueId)
        throw Error('DATABASE_QUEUE_ID_MISMATCH');
      return result.rowCount===1;
    },
    async fail({queueId,leaseToken,backoffSeconds=300,maxAttempts=5}={}){
      checkId(queueId);checkToken(leaseToken);
      integerRange(backoffSeconds,10,86400,'INVALID_BACKOFF_SECONDS');
      integerRange(maxAttempts,1,100,'INVALID_MAX_ATTEMPTS');
      const sql=`UPDATE ${TABLE}
           SET state=CASE WHEN attempts >= $4 THEN 'failed' ELSE 'retry' END,
               available_at=now()+($3::integer * interval '1 second'),
               lease_token=NULL,lease_until=NULL,updated_at=now()
         WHERE queue_id=$1 AND lease_token=$2::uuid AND
               state='processing' AND lease_until > now()
         RETURNING queue_id,state`;
      const result=assertDbResponse(await db.query(sql,[
        queueId,leaseToken,backoffSeconds,maxAttempts
      ]));
      if(result.rowCount>1||result.rowCount!==result.rows.length)
        throw Error('UNCONFIRMED_DATABASE_RESULT');
      if(result.rowCount===1&&result.rows[0].queue_id.trim()!==queueId)
        throw Error('DATABASE_QUEUE_ID_MISMATCH');
      if(result.rowCount===1&&!['failed','retry'].includes(result.rows[0].state))
        throw Error('INVALID_DATABASE_STATE');
      return result.rowCount===0?{accepted:false}:{accepted:true,state:result.rows[0].state};
    }
  };
}
module.exports={createResendPostgresStore};
