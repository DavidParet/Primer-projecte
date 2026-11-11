'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createVerifiedIngestion } = require('../lib/whatsapp/verified-ingestion');
const secret = 'synthetic-test-secret';
const payload = Buffer.from(JSON.stringify({ object:'whatsapp_business_account',entry:[] }));
const sign = bytes => 'sha256='+createHmac('sha256',secret).update(bytes).digest('hex');
test('rejects unsigned and modified payloads before storage',async()=>{
 let calls=0;
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>{calls++;return {stored:1,duplicate:0,unlinked:0,unsupported:0};}}});
 assert.equal((await run(payload,'bad')).outcome,'rejected');
 assert.equal((await run(Buffer.from('{}'),sign(payload))).outcome,'rejected');
 assert.equal(calls,0);
});
test('signed and durable event can be marked durable',async()=>{
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>({stored:1,duplicate:0,unlinked:0,unsupported:0})}});
 assert.deepEqual(await run(payload,sign(payload)),{outcome:'durable',counts:{stored:1,duplicate:0,unlinked:0,unsupported:0}});
});
test('unlinked or unsupported events are not marked durable',async()=>{
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>({stored:0,duplicate:0,unlinked:1,unsupported:0})}});
 assert.equal((await run(payload,sign(payload))).outcome,'needs_review');
});
test('storage failure must propagate rather than report success',async()=>{
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>{throw new Error('db offline');}}});
 await assert.rejects(run(payload,sign(payload)),/db offline/);
});
test('malformed JSON and malformed persistence result fail closed',async()=>{
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>({stored:1})}});
 const invalid=Buffer.from('not-json');
 assert.equal((await run(invalid,sign(invalid))).outcome,'rejected');
 await assert.rejects(run(payload,sign(payload)),/Unrecognized persistence result/);
});

test('signed invalid UTF-8 is rejected without touching persistence', async () => {
 let calls=0;
 const run=createVerifiedIngestion({appSecret:secret,inbox:{persistVerifiedBatch:async()=>{calls++;return {stored:1,duplicate:0,unlinked:0,unsupported:0};}}});
 const bytes=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc3,0x28,0x22,0x7d]);
 assert.deepEqual(await run(bytes,sign(bytes)),{outcome:'rejected',reason:'invalid_json'});
 assert.equal(calls,0);
});
