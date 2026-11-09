'use strict';
/** Strict offline encrypted intake queue: invented data, no real service calls. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {enqueueVerifiedResendEvent,openEnvelope,
  assertVerifiedMetadata}=require('../lib/premium-resend-secure-queue');
const key=crypto.randomBytes(32).toString('base64');
const recipient='pilot@entrada.nexlupa.app';  // known public pilot mailbox, no child data
const event={type:'email.received',data:{
  email_id:'ce88e8c0-af25-4cb6-b472-c485acd1a6f2',
  to:[recipient],from:'invented@example.test',
  subject:'DO NOT SAVE PRIVATE CONTENT',
  attachments:[]}};
function memoryStore(){
  const saved=new Map();
  return {saved,async insertIfAbsent({id,envelope}){
    if(saved.has(id))return false;
    saved.set(id,envelope);
    return true;
  }};
}
async function run(overrides={}){
  return enqueueVerifiedResendEvent({
    verifiedEvent:event,svixId:'msg_synthetic_only',
    allowedRecipient:recipient,keyBase64:key,
    store:memoryStore(),...overrides
  });
}
async function mustFail(fn,reason){
  await assert.rejects(fn,err=>err.message===reason);
}
async function main(){
  const store=memoryStore();
  const first=await run({store});
  assert.equal(first.status,'stored');
  assert.equal(store.saved.size,1);
  assert.match(first.queueId,/^[a-f0-9]{64}$/);
  const bytes=JSON.stringify([...store.saved.values()][0]);
  assert.ok(!bytes.includes(event.data.email_id));
  assert.ok(!bytes.includes(event.data.subject));
  assert.ok(!bytes.includes(event.data.from));
  const opened=openEnvelope(store.saved.get(first.queueId),key,first.queueId);
  assert.deepEqual(Object.keys(opened).sort(),['emailId','recipient','version']);
  assert.equal(opened.emailId,event.data.email_id);
  assert.equal(opened.recipient,recipient);

  const repeated=await run({store});
  assert.equal(repeated.status,'duplicate');
  assert.equal(repeated.queueId,first.queueId);
  assert.equal(store.saved.size,1);

  const alternate=await run({store:memoryStore()});
  assert.equal(alternate.queueId,first.queueId);

  const badEnvelope={...store.saved.get(first.queueId),
    ciphertext:Buffer.from('NOT A REAL CIPHERTEXT').toString('base64')};
  assert.throws(()=>openEnvelope(badEnvelope,key,first.queueId),/INVALID_ENVELOPE/);
  assert.throws(()=>openEnvelope(store.saved.get(first.queueId),
    crypto.randomBytes(32).toString('base64'),first.queueId),/INVALID_ENVELOPE/);

  const ignored=await run({verifiedEvent:{type:'email.delivered'}});
  assert.equal(ignored.status,'ignored');

  await mustFail(()=>run({store:null}),'DURABLE_QUEUE_UNAVAILABLE');
  await mustFail(()=>run({keyBase64:'bad-key'}),'QUEUE_KEY_UNAVAILABLE');
  await mustFail(()=>run({allowedRecipient:'other@nexlupa.app'}),'RECIPIENT_NOT_ALLOWED');
  await mustFail(()=>run({verifiedEvent:{...event,data:{...event.data,
    to:[recipient,'unknown@example.test']}}}),'INVALID_QUEUE_INPUT');
  await mustFail(()=>run({verifiedEvent:{...event,data:{...event.data,
    attachments:[{filename:'invented.pdf'}]}}}),'ATTACHMENTS_UNSUPPORTED');

  await mustFail(()=>run({store:{insertIfAbsent:async()=>undefined}}),
    'UNCONFIRMED_DURABLE_WRITE');
  await mustFail(()=>run({store:{insertIfAbsent:async()=>{throw Error('DB_DOWN')}}}),
    'DB_DOWN');
  assert.throws(()=>assertVerifiedMetadata({event,svixId:'bad id!',
    allowedRecipient:recipient}),/INVALID_QUEUE_INPUT/);

  console.log('PASS — encrypts only a verified event ID and allowed recipient; no sender/content saved');
  console.log('PASS — stable deduplication ID; atomic insertion contract; retry becomes duplicate');
  console.log('PASS — AES-GCM integrity prevents tampering and access with the wrong key');
  console.log('PASS — missing database, invalid key/recipient, unsafe attachments fail closed');
  console.log('LIMIT — memory store is a mock; real transactional storage NOT installed or enabled');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
