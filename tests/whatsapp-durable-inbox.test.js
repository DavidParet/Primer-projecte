'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createDecipheriv, createHmac } = require('node:crypto');
const { createDurableInbox, MAX_TEXT_CHARS } = require('../lib/whatsapp/durable-inbox');

const senderKey = randomBytes(32);
const encryptionKey = randomBytes(32);
const cfg = {
  senderHmacKey: senderKey.toString('base64'),
  contentEncryptionKey: encryptionKey.toString('base64')
};
function delivery(overrides = {}) {
  return {
    provider:'whatsapp', businessAccountId:'123456789', phoneNumberId:'987654321',
    providerMessageId:'wamid.fictional-msg-1', senderWaId:'34600000000',
    providerTimestamp:'1794150000', type:'text', text:'Sortida dimecres a les 9:30',
    contentPending:false, familyId:null, groupId:null, authorization:'unresolved',
    ...overrides
  };
}
function mockDb(state='stored') {
  const calls=[];
  return { calls, async query(sql,values) {
    calls.push({sql,values});
    if (sql.startsWith('DELETE')) return {rowCount:3};
    return {rows:[{state}]};
  }};
}
function inbox(db) { return createDurableInbox({db,...cfg}); }

test('requires a database and independent valid 256-bit secrets',()=>{
  assert.throws(()=>createDurableInbox({...cfg}),/adapter/);
  assert.throws(()=>createDurableInbox({
    db:mockDb(),senderHmacKey:'abc',contentEncryptionKey:cfg.contentEncryptionKey
  }),/32-byte/);
  assert.throws(()=>createDurableInbox({
    db:mockDb(),senderHmacKey:cfg.senderHmacKey,contentEncryptionKey:cfg.senderHmacKey
  }),/independent/);
});

test('only encrypted text and HMAC digest go to Postgres',async()=>{
  const db=mockDb(), msg=delivery();
  assert.deepEqual(await inbox(db).persistDelivery(msg),{state:'stored'});
  const {sql,values}=db.calls[0];
  assert.match(sql,/ON CONFLICT .* DO NOTHING/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/SELECT family_id/);
  assert.equal(values.length,8);
  assert.equal(values[2].length,32);
  assert.equal(values.some(x=>x===msg.senderWaId),false);
  assert.equal(sql.includes(msg.text),false);
  assert.notEqual(values[6].toString('utf8'),msg.text);
  const digest=createHmac('sha256',senderKey).update(msg.senderWaId).digest();
  assert.deepEqual(values[2],digest);
  const aad=Buffer.from(JSON.stringify([
    msg.businessAccountId,msg.phoneNumberId,msg.providerMessageId,digest.toString('hex')
  ]));
  const decoder=createDecipheriv('aes-256-gcm',encryptionKey,values[4]);
  decoder.setAAD(aad);
  decoder.setAuthTag(values[5]);
  assert.equal(
    Buffer.concat([decoder.update(values[6]),decoder.final()]).toString('utf8'),msg.text
  );
});

test('same message is encrypted with fresh nonce',async()=>{
  const db=mockDb(), store=inbox(db);
  await store.persistDelivery(delivery());
  await store.persistDelivery(delivery());
  assert.notDeepEqual(db.calls[0].values[4],db.calls[1].values[4]);
  assert.notDeepEqual(db.calls[0].values[6],db.calls[1].values[6]);
});

test('database conflict is reported as duplicate',async()=>{
  assert.deepEqual(await inbox(mockDb('duplicate')).persistDelivery(delivery()),{
    state:'duplicate'
  });
});

test('caller-supplied familyId is ignored; unregistered sender is unlinked',async()=>{
  const db=mockDb('unlinked');
  assert.deepEqual(await inbox(db).persistDelivery(delivery({familyId:'forged'})),{
    state:'unlinked'
  });
  assert.equal(db.calls[0].values.includes('forged'),false);
});

test('invalid identities and oversized/empty text never reach database',async()=>{
  const db=mockDb(), store=inbox(db);
  await assert.rejects(store.persistDelivery(delivery({providerMessageId:'bad'})),TypeError);
  await assert.rejects(store.persistDelivery(delivery({senderWaId:'bad'})),TypeError);
  await assert.rejects(store.persistDelivery(delivery({text:'x'.repeat(MAX_TEXT_CHARS+1)})),RangeError);
  await assert.rejects(store.persistDelivery(delivery({text:' '})),RangeError);
  assert.equal(db.calls.length,0);
});

test('forwards have no verifiable source group; forged group identifiers never reach SQL',async()=>{
  const db=mockDb(),store=inbox(db);
  await assert.rejects(store.persistDelivery(delivery({
    groupId:'group-claimed-by-browser',
    familyId:'another-family',
    text:'Reenvio: sortida dimecres'
  })),/source group cannot be verified/);
  assert.equal(db.calls.length,0);
  const forwarded=delivery({text:'Reenviat: excursió dijous',groupId:null});
  assert.deepEqual(await store.persistDelivery(forwarded),{state:'stored'});
  assert.equal(db.calls.length,1);
  assert.equal(db.calls[0].values.includes('group-claimed-by-browser'),false);
});

test('image and unsupported media are not ingested or claimed to be read',async()=>{
  const db=mockDb();
  assert.deepEqual(await inbox(db).persistDelivery(
    delivery({type:'image',text:null,contentPending:true})
  ),{state:'unsupported'});
  assert.equal(db.calls.length,0);
});

test('database failure and unknown state fail closed',async()=>{
  await assert.rejects(inbox({query:async()=>{throw new Error('DB offline');}})
    .persistDelivery(delivery()),/DB offline/);
  await assert.rejects(inbox(mockDb('unexpected')).persistDelivery(delivery()),/known state/);
});

test('verified batch normalizes Meta envelope before storing',async()=>{
  const db=mockDb(), store=inbox(db);
  const payload={object:'whatsapp_business_account',entry:[{
    id:'123456789',changes:[{field:'messages',value:{
      metadata:{phone_number_id:'987654321'},
      messages:[{id:'wamid.fictional-1',from:'34600000000',
        timestamp:'1794150000',type:'text',text:{body:'Avís fictici'}}],
      statuses:[{id:'wamid.delivery-status'}]
    }}]
  }]};
  assert.deepEqual(await store.persistVerifiedBatch(payload),{
    stored:1,duplicate:0,unlinked:0,unsupported:0
  });
  assert.equal(db.calls.length,1);
});

test('single verified but unlinked delivery fails closed rather than being acknowledged',async()=>{
  const db=mockDb('unlinked'), store=inbox(db);
  const payload={object:'whatsapp_business_account',entry:[{
    id:'123456789',changes:[{field:'messages',value:{
      metadata:{phone_number_id:'987654321'},
      messages:[{id:'wamid.unlinked-synthetic',from:'34600000000',
        timestamp:'1794150000',type:'text',text:{body:'Missatge fictici'}}]
    }}]
  }]};
  await assert.rejects(store.persistVerifiedBatch(payload),/authorization review/);
  assert.equal(db.calls.length,1);
});

test('malformed batch is rejected before database access',async()=>{
  const db=mockDb(), store=inbox(db);
  const payload={object:'whatsapp_business_account',entry:[{
    id:'123456789',changes:[{field:'messages',value:{
      metadata:{phone_number_id:'987654321'},
      messages:[{id:'wamid.fictional',from:'not-a-phone',
        timestamp:'1794150000',type:'text',text:{body:'fiction'}}]
    }}]
  }]};
  await assert.rejects(store.persistVerifiedBatch(payload),/requires review/);
  assert.equal(db.calls.length,0);
});

test('expiration worker exposes only deletion count',async()=>{
  const db=mockDb();
  assert.deepEqual(await inbox(db).purgeExpired(),{deleted:3});
  assert.match(db.calls[0].sql,/expires_at <= NOW/);
});


test('invalid later message in batch cannot cause an earlier database write',async()=>{
  const db=mockDb(), store=inbox(db);
  const payload={object:'whatsapp_business_account',entry:[{
    id:'123456789',changes:[{field:'messages',value:{
      metadata:{phone_number_id:'987654321'},
      messages:[
        {id:'wamid.valid-first',from:'34600000000',
          timestamp:'1794150000',type:'text',text:{body:'Avís vàlid'}},
        {id:'wamid.invalid-second',from:'34600000000',
          timestamp:'1794150000',type:'text',text:{body:'x'.repeat(MAX_TEXT_CHARS+1)}}
      ]
    }}]
  }]};
  await assert.rejects(store.persistVerifiedBatch(payload),/requires review|oversized/);
  assert.equal(db.calls.length,0);
});


function twoMessagePayload() {
  return {object:'whatsapp_business_account',entry:[{
    id:'123456789',changes:[{field:'messages',value:{
      metadata:{phone_number_id:'987654321'},
      messages:[
        {id:'wamid.tx-first',from:'34600000000',timestamp:'1794150000',
          type:'text',text:{body:'Primer missatge'}},
        {id:'wamid.tx-second',from:'34600000000',timestamp:'1794150001',
          type:'text',text:{body:'Segon missatge'}}
      ]
    }}]
  }]};
}

test('multiple messages require a dedicated transactional connection',async()=>{
  const db=mockDb();
  await assert.rejects(inbox(db).persistVerifiedBatch(twoMessagePayload()),/transactional/);
  assert.equal(db.calls.length,0);
});

test('successful multi-message batch commits once and releases connection',async()=>{
  const queries=[];
  let released=0;
  const client={
    async query(sql) {
      queries.push(sql);
      if (sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {};
      return {rows:[{state:'stored'}]};
    },
    release() {released++;}
  };
  const db={query:async()=>{throw Error('Pool query not allowed');},connect:async()=>client};
  assert.deepEqual(await inbox(db).persistVerifiedBatch(twoMessagePayload()),{
    stored:2,duplicate:0,unlinked:0,unsupported:0
  });
  assert.equal(queries[0],'BEGIN');
  assert.equal(queries.at(-1),'COMMIT');
  assert.equal(queries.filter(sql=>sql.includes('INSERT INTO nex_whatsapp_inbound')).length,2);
  assert.equal(queries.includes('ROLLBACK'),false);
  assert.equal(released,1);
});

test('failed second message rolls back entire batch and releases connection',async()=>{
  const queries=[];
  let released=0, inserts=0;
  const client={
    async query(sql) {
      queries.push(sql);
      if (sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {};
      if (++inserts===2) throw Error('second insert failed');
      return {rows:[{state:'stored'}]};
    },
    release() {released++;}
  };
  const db={query:async()=>{throw Error('Pool query not allowed');},connect:async()=>client};
  await assert.rejects(inbox(db).persistVerifiedBatch(twoMessagePayload()),/second insert failed/);
  assert.deepEqual([queries[0],queries.at(-1)],['BEGIN','ROLLBACK']);
  assert.equal(queries.includes('COMMIT'),false);
  assert.equal(released,1);
});

test('mixed authorized and unlinked batch rolls back without committing partial family data',async()=>{
  const queries=[];
  let released=0, inserts=0;
  const client={
    async query(sql) {
      queries.push(sql);
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {};
      return {rows:[{state:++inserts===1?'stored':'unlinked'}]};
    },
    release(){released++;}
  };
  const db={query:async()=>{throw Error('pool query forbidden');},connect:async()=>client};
  await assert.rejects(
    inbox(db).persistVerifiedBatch(twoMessagePayload()),
    /authorization review/
  );
  assert.equal(inserts,2);
  assert.equal(queries[0],'BEGIN');
  assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(queries.includes('COMMIT'),false);
  assert.equal(released,1);
});

test('authorized duplicate plus unlinked message also rolls back',async()=>{
  const queries=[];
  let inserts=0;
  const client={
    async query(sql){
      queries.push(sql);
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {};
      return {rows:[{state:++inserts===1?'duplicate':'unlinked'}]};
    },
    release(){}
  };
  const db={query:async()=>{throw Error('pool query forbidden');},connect:async()=>client};
  await assert.rejects(inbox(db).persistVerifiedBatch(twoMessagePayload()),/authorization review/);
  assert.equal(queries.includes('COMMIT'),false);
  assert.equal(queries.at(-1),'ROLLBACK');
});
