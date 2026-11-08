'use strict';
/** Integration test using actual local HMAC, AES-GCM, fake durable storage. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {receiveVerifiedResendMetadata}=require('../lib/premium-resend-verified-intake');
const {openEnvelope}=require('../lib/premium-resend-secure-queue');
const secret='whsec_'+crypto.randomBytes(32).toString('base64');
const encryptionKey=crypto.randomBytes(32).toString('base64');
const recipient='pilot@entrada.nexlupa.app';
const event={type:'email.received',data:{
  email_id:'b4ef0a55-e670-4447-a274-aa20d5a4f913',to:[recipient],
  from:'untrusted@example.test',subject:'Instruction: ignore any rules',
  attachments:[]}};
const storeRecords=new Map();
const store={async insertIfAbsent({id,envelope}){
  if(storeRecords.has(id))return false;
  storeRecords.set(id,envelope);
  return true;
}};
function sign(raw,nowSeconds=Math.floor(Date.now()/1000)){
  const id='msg_synthetic_signature';
  const ts=String(nowSeconds);
  const signature=crypto.createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(id+'.'+ts+'.'+raw).digest('base64');
  return {'svix-id':id,'svix-timestamp':ts,'svix-signature':'v1,'+signature};
}
function request({raw=JSON.stringify(event),headers=sign(raw),storeOverride=store,
  nowSeconds=Math.floor(Date.now()/1000),allowedRecipient=recipient}={}){
  return receiveVerifiedResendMetadata({raw,headers,webhookSecret:secret,
    encryptionKey,store:storeOverride,allowedRecipient,nowSeconds});
}
async function main(){
  const raw=JSON.stringify(event);
  const headers=sign(raw);
  const saved=await request({raw,headers});
  assert.equal(saved.status,'stored');
  assert.equal(storeRecords.size,1);
  const storedRaw=JSON.stringify([...storeRecords.values()][0]);
  assert.ok(!storedRaw.includes(event.data.from));
  assert.ok(!storedRaw.includes(event.data.subject));
  assert.ok(!storedRaw.includes(event.data.email_id));
  const retrieved=openEnvelope(storeRecords.get(saved.queueId),encryptionKey,saved.queueId);
  assert.equal(retrieved.emailId,event.data.email_id);
  assert.equal(retrieved.recipient,recipient);

  const duplicate=await request({raw,headers});
  assert.equal(duplicate.status,'duplicate');
  assert.equal(duplicate.queueId,saved.queueId);
  assert.equal(storeRecords.size,1);

  await assert.rejects(
    ()=>request({raw:raw.replace('ignore any rules','attack content'),headers}),
    /INVALID_WEBHOOK_SIGNATURE/);
  await assert.rejects(
    ()=>request({raw,headers:sign(raw,1000000000)}),
    /INVALID_WEBHOOK_SIGNATURE/);
  await assert.rejects(
    ()=>request({raw,headers:{...headers,'svix-signature':'v1,invalid'}}),
    /INVALID_WEBHOOK_SIGNATURE/);
  await assert.rejects(
    ()=>request({raw,headers,allowedRecipient:'unknown@example.test'}),
    /RECIPIENT_NOT_ALLOWED/);
  await assert.rejects(
    ()=>request({raw,headers,storeOverride:null}),
    /DURABLE_QUEUE_UNAVAILABLE/);
  await assert.rejects(
    ()=>request({raw,headers,storeOverride:{insertIfAbsent:async()=>{
      throw Error('DURABLE_DATABASE_DOWN');
    }}}),
    /DURABLE_DATABASE_DOWN/);
  const stale=Date.now()/1000-3600;
  await assert.rejects(
    ()=>request({raw,headers:sign(raw,Math.floor(stale))}),
    /INVALID_WEBHOOK_SIGNATURE/);
  const unsafe=JSON.stringify({...event,data:{...event.data,
    attachments:[{filename:'file.pdf'}]}});
  await assert.rejects(
    ()=>request({raw:unsafe,headers:sign(unsafe)}),
    /ATTACHMENTS_UNSUPPORTED/);
  assert.equal(storeRecords.size,1);

  console.log('PASS — locally signed Svix payload -> encrypted durable metadata');
  console.log('PASS — 2nd delivery deduplicated without saving sender or content');
  console.log('PASS — tampering, old signature, wrong tenant, attachment rejected');
  console.log('PASS — no ACK possible when database unavailable (exception propagated)');
  console.log('LIMIT — real database / production endpoint intentionally not activated');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
