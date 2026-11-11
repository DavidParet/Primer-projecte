'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {createVerifiedIngestion}=require('../lib/whatsapp/verified-ingestion');
const {createDurableInbox}=require('../lib/whatsapp/durable-inbox');

const secret='synthetic-app-secret';
const payload={object:'whatsapp_business_account',entry:[{
  id:'123456789',changes:[{field:'messages',value:{
    metadata:{phone_number_id:'987654321'},
    messages:[{id:'wamid.synthetic-verified-1',from:'34600000000',
      timestamp:'1794150000',type:'text',text:{body:'Fictional schedule update'}}]
  }}]
}]};
const raw=Buffer.from(JSON.stringify(payload));
const sign=b=>'sha256='+createHmac('sha256',secret).update(b).digest('hex');

test('signed synthetic delivery crosses verification, normalization, encryption and inbox SQL',async()=>{
  const queries=[];
  const db={async query(sql,values){queries.push({sql,values});
    return {rows:[{state:'stored'}]};}};
  const inbox=createDurableInbox({db,
    senderHmacKey:randomBytes(32).toString('base64'),
    contentEncryptionKey:randomBytes(32).toString('base64')});
  const ingest=createVerifiedIngestion({appSecret:secret,inbox});
  assert.deepEqual(await ingest({rawBody:raw,signature:sign(raw)}),
    {stored:1,duplicate:0,unlinked:0,unsupported:0});
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/INSERT INTO nex_whatsapp_inbound/);
  assert.equal(queries[0].values[3],'wamid.synthetic-verified-1');
  assert.equal(Buffer.isBuffer(queries[0].values[2]),true);
  assert.equal(Buffer.isBuffer(queries[0].values[6]),true);
  assert.equal(queries[0].values.some(v=>v==='34600000000' ||
    v==='Fictional schedule update'),false);
});
test('tampering, missing signature and malformed authenticated JSON never write',async()=>{
  let writes=0;
  const inbox={async persistVerifiedBatch(){writes++;return {};}};
  const ingest=createVerifiedIngestion({appSecret:secret,inbox});
  await assert.rejects(ingest({rawBody:Buffer.from(raw.toString().replace('schedule','meeting')),
    signature:sign(raw)}),/signature rejected/);
  await assert.rejects(ingest({rawBody:raw,signature:undefined}),/signature rejected/);
  const malformed=Buffer.from('{not-json');
  await assert.rejects(ingest({rawBody:malformed,signature:sign(malformed)}),
    /Malformed authenticated JSON/);
  await assert.rejects(ingest({rawBody:Buffer.alloc(256*1024+1),
    signature:sign(Buffer.alloc(256*1024+1))}),/oversized/);
  assert.equal(writes,0);
});
test('authenticated malformed delivery fails closed before database write',async()=>{
  let writes=0;
  const db={async query(){writes++;return {rows:[{state:'stored'}]};}};
  const inbox=createDurableInbox({db,
    senderHmacKey:randomBytes(32).toString('base64'),
    contentEncryptionKey:randomBytes(32).toString('base64')});
  const ingest=createVerifiedIngestion({appSecret:secret,inbox});
  const bad=structuredClone(payload);
  bad.entry[0].changes[0].value.messages[0].text={};
  const bytes=Buffer.from(JSON.stringify(bad));
  await assert.rejects(ingest({rawBody:bytes,signature:sign(bytes)}),
    /review|acknowledge|Malformed/i);
  assert.equal(writes,0);
});
