'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createDurableInbox}=require('../lib/whatsapp/durable-inbox');
const payload={object:'whatsapp_business_account',entry:[{
  id:'123456789',changes:[{field:'messages',value:{
    metadata:{phone_number_id:'987654321'},
    messages:[
      {id:'wamid.synthetic-one',from:'34600000000',timestamp:'1794150000',
        type:'text',text:{body:'Fictional message one'}},
      {id:'wamid.synthetic-two',from:'34600000000',timestamp:'1794150001',
        type:'text',text:{body:'Fictional message two'}}
    ]
  }}]
}]};
const config={senderHmacKey:randomBytes(32).toString('base64'),
  contentEncryptionKey:randomBytes(32).toString('base64')};
test('two messages commit on one transaction and one connection',async()=>{
  const calls=[];let releases=0;
  const db={query:async()=>{throw Error('pool query forbidden');},
    connect:async()=>({release(){releases++;},async query(sql){
      calls.push(sql);
      if(sql==='BEGIN'||sql==='COMMIT')return {};
      if(sql.includes('INSERT INTO nex_whatsapp_inbound'))return {rows:[{state:'stored'}]};
      throw Error('unexpected query');
    }})};
  assert.deepEqual(await createDurableInbox({db,...config}).persistVerifiedBatch(payload),
    {stored:2,duplicate:0,unlinked:0,unsupported:0});
  assert.equal(calls[0],'BEGIN');
  assert.equal(calls.at(-1),'COMMIT');
  assert.equal(calls.filter(s=>s.includes('INSERT INTO nex_whatsapp_inbound')).length,2);
  assert.equal(releases,1);
});
test('second write failure rolls back instead of committing partial batch',async()=>{
  const calls=[];let releases=0,insertions=0;
  const db={query:async()=>{throw Error('pool query forbidden');},
    connect:async()=>({release(){releases++;},async query(sql){
      calls.push(sql);
      if(sql.includes('INSERT INTO nex_whatsapp_inbound')){
        insertions++;
        if(insertions===2)throw Error('synthetic database failure');
        return {rows:[{state:'stored'}]};
      }
      return {};
    }})};
  await assert.rejects(createDurableInbox({db,...config}).persistVerifiedBatch(payload),
    /synthetic database failure/);
  assert.equal(calls.at(-1),'ROLLBACK');
  assert.equal(calls.includes('COMMIT'),false);
  assert.equal(releases,1);
});
test('multi-message batch fails closed without transactional adapter',async()=>{
  let queries=0;
  const db={query:async()=>{queries++;return {rows:[{state:'stored'}]};}};
  await assert.rejects(createDurableInbox({db,...config}).persistVerifiedBatch(payload),
    /transactional PostgreSQL connection/);
  assert.equal(queries,0);
});
