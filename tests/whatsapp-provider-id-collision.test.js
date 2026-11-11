'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createDurableInbox,INSERT_SQL}=require('../lib/whatsapp/durable-inbox');

const delivery={
  provider:'whatsapp',businessAccountId:'9999900000',phoneNumberId:'8888800000',
  providerMessageId:'wamid.synthetic-collision',senderWaId:'34600000000',
  providerTimestamp:'1794150000',type:'text',text:'synthetic only'
};
const keys={senderHmacKey:randomBytes(32).toString('base64'),
  contentEncryptionKey:randomBytes(32).toString('base64')};

test('SQL only classifies same-family same-sender provider ID as duplicate',()=>{
  assert.match(INSERT_SQL,/existing\.family_id = \(SELECT family_id FROM permitted\)/);
  assert.match(INSERT_SQL,/existing\.sender_digest = \$3/);
  assert.match(INSERT_SQL,/existing\.phone_number_id = \$2/);
  assert.match(INSERT_SQL,/THEN 'collision'/);
});
test('conflicting provider ID fails closed and never reports duplicate',async()=>{
  let calls=0;
  const db={query:async(sql,values)=>{
    calls++;
    assert.match(sql,/THEN 'collision'/);
    assert.equal(values[3],delivery.providerMessageId);
    return {rows:[{state:'collision'}]};
  }};
  await assert.rejects(createDurableInbox({db,...keys}).persistDelivery(delivery),
    /Provider message ID collision/);
  assert.equal(calls,1);
});
test('matching provider ID still returns duplicate',async()=>{
  const db={query:async()=>({rows:[{state:'duplicate'}]})};
  assert.deepEqual(await createDurableInbox({db,...keys}).persistDelivery(delivery),
    {state:'duplicate'});
});
