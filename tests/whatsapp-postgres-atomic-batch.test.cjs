'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomBytes,createHmac}=require('node:crypto');
const {Pool}=require('pg');
const {createDurableInbox}=require('../lib/whatsapp/durable-inbox');

const url=process.env.WHATSAPP_TEST_DATABASE_URL;
test('PostgreSQL: failed second delivery rolls back entire batch, retry stores exactly once',{
  skip:!url,timeout:40000
},async()=>{
  const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:6000});
  const hmacKey=randomBytes(32);
  const sender='34600000000';
  const account='9999900000',phone='8888800000';
  const family='00000000-0000-4000-8000-000000000001';
  const payload={object:'whatsapp_business_account',entry:[{
    id:account,changes:[{field:'messages',value:{
      metadata:{phone_number_id:phone},
      messages:[
        {id:'wamid.synthetic-batch-one',from:sender,timestamp:'1794150000',
          type:'text',text:{body:'Synthetic one'}},
        {id:'wamid.synthetic-batch-two',from:sender,timestamp:'1794150001',
          type:'text',text:{body:'Synthetic two'}}
      ]
    }}]
  }]};
  try{
    await pool.query(readFileSync(join(__dirname,
      '../db/migrations/20261108_whatsapp_durable_inbox.sql'),'utf8'));
    await pool.query(readFileSync(join(__dirname,
      '../db/migrations/20261109_whatsapp_explicit_consent_receipt.sql'),'utf8'));
    await pool.query(
      "INSERT INTO nex_whatsapp_sender_authorizations "+
      "(business_account_id,phone_number_id,sender_digest,family_id,scope,consent_version,consent_at,consent_source,consent_receipt_digest) "+
      "VALUES ($1,$2,$3,$4,'incoming_text','synthetic-v1',NOW(),'synthetic-ci',$5)",
      [account,phone,createHmac('sha256',hmacKey).update(sender).digest(),family,randomBytes(32)]);
    const inbox=createDurableInbox({db:pool,senderHmacKey:hmacKey.toString('base64'),
      contentEncryptionKey:randomBytes(32).toString('base64')});
    await pool.query(`CREATE FUNCTION synthetic_reject_second() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.provider_message_id = 'wamid.synthetic-batch-two' THEN
          RAISE EXCEPTION 'synthetic second insert failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await pool.query(`CREATE TRIGGER synthetic_reject_second_before_insert
      BEFORE INSERT ON nex_whatsapp_inbound FOR EACH ROW
      EXECUTE FUNCTION synthetic_reject_second()`);
    await assert.rejects(inbox.persistVerifiedBatch(payload),/synthetic second insert failure/);
    let count=await pool.query('SELECT COUNT(*)::integer AS n FROM nex_whatsapp_inbound');
    assert.equal(count.rows[0].n,0,'first insert must also roll back');
    await pool.query('DROP TRIGGER synthetic_reject_second_before_insert ON nex_whatsapp_inbound');
    await pool.query('DROP FUNCTION synthetic_reject_second()');
    assert.deepEqual(await inbox.persistVerifiedBatch(payload),
      {stored:2,duplicate:0,unlinked:0,unsupported:0});
    assert.deepEqual(await inbox.persistVerifiedBatch(payload),
      {stored:0,duplicate:2,unlinked:0,unsupported:0});
    count=await pool.query('SELECT COUNT(*)::integer AS n FROM nex_whatsapp_inbound WHERE family_id=$1',[family]);
    assert.equal(count.rows[0].n,2);
  }finally{await pool.end();}
});

test('PostgreSQL: provider ID collision across authorized senders fails closed without leaking families',{
  skip:!url,timeout:40000
},async()=>{
  const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:6000});
  const hmacKey=randomBytes(32);
  const account='9999900001',phone='8888800001';
  const familyA='00000000-0000-4000-8000-000000000011';
  const familyB='00000000-0000-4000-8000-000000000012';
  const senders=['34600000011','34600000012'];
  const messageId='wamid.synthetic-cross-family-collision';
  try {
    await pool.query(readFileSync(join(__dirname,
      '../db/migrations/20261108_whatsapp_durable_inbox.sql'),'utf8'));
    await pool.query(readFileSync(join(__dirname,
      '../db/migrations/20261109_whatsapp_explicit_consent_receipt.sql'),'utf8'));
    for (const [index,sender] of senders.entries()) {
      await pool.query(
        "INSERT INTO nex_whatsapp_sender_authorizations "+
        "(business_account_id,phone_number_id,sender_digest,family_id,scope,consent_version,consent_at,consent_source,consent_receipt_digest) "+
        "VALUES ($1,$2,$3,$4,'incoming_text','synthetic-v1',NOW(),'synthetic-ci',$5)",
        [account,phone,createHmac('sha256',hmacKey).update(sender).digest(),
          index===0?familyA:familyB,randomBytes(32)]);
    }
    const inbox=createDurableInbox({db:pool,senderHmacKey:hmacKey.toString('base64'),
      contentEncryptionKey:randomBytes(32).toString('base64')});
    const delivery=sender=>({
      provider:'whatsapp',businessAccountId:account,phoneNumberId:phone,
      providerMessageId:messageId,senderWaId:sender,providerTimestamp:'1794150000',
      type:'text',text:'Entirely synthetic message',contentPending:false
    });
    assert.deepEqual(await inbox.persistDelivery(delivery(senders[0])),{state:'stored'});
    await assert.rejects(inbox.persistDelivery(delivery(senders[1])),
      /Provider message ID collision/);
    assert.deepEqual(await inbox.persistDelivery(delivery(senders[0])),{state:'duplicate'});
    const {rows}=await pool.query(
      'SELECT family_id,COUNT(*)::integer AS n FROM nex_whatsapp_inbound '+
      'WHERE business_account_id=$1 AND provider_message_id=$2 GROUP BY family_id',
      [account,messageId]);
    assert.equal(rows.length,1);
    assert.equal(rows[0].family_id,familyA);
    assert.equal(rows[0].n,1);
  } finally { await pool.end(); }
});
