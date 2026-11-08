'use strict';
/** No network or database; cryptographic signature and durable ACK contract. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createDurableWebhook}=
  require('../pilot/resend-durable-webhook/handler');
const secret='whsec_'+crypto.randomBytes(32).toString('base64');
const encryptionKey=crypto.randomBytes(32).toString('base64');
const recipient='pilot@entrada.nexlupa.app';
const stamp=Math.floor(Date.now()/1000);
const event={type:'email.received',data:{
  email_id:'ed4def10-bb31-47b6-b383-70e7f228a2ca',
  to:[recipient],from:'fake@example.test',
  subject:'Nothing from real families',attachments:[]}};
const body=JSON.stringify(event);
function signed(data){
  const id='msg_synthetic_5678',ts=String(stamp);
  return {'Svix-Id':id,'SVIX-TIMESTAMP':ts,'svix-signature':'v1,'+
    crypto.createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
      .update(id+'.'+ts+'.'+data).digest('base64')};
}
async function main(){
  const inbox=new Map();
  const store={async insertIfAbsent({id,envelope}){
    if(inbox.has(id))return false;
    inbox.set(id,envelope);return true;
  }};
  const handle=createDurableWebhook({webhookSecret:secret,encryptionKey,
    allowedRecipient:recipient,store,nowSeconds:stamp});
  const req={method:'POST',headers:signed(body),body};
  const first=await handle(req);
  assert.equal(first.statusCode,204);
  assert.equal(first.body,'');
  assert.equal(inbox.size,1);
  assert.ok(!JSON.stringify([...inbox.values()]).includes(event.data.subject));
  assert.equal((await handle(req)).statusCode,204);
  assert.equal(inbox.size,1);
  assert.equal((await handle({...req,body:body+' ' })).statusCode,400);
  assert.equal((await handle({...req,method:'GET'})).statusCode,405);
  assert.equal((await handle({...req,headers:{}})).statusCode,400);
  assert.equal((await handle({...req,body:'x'.repeat(66000)})).statusCode,413);
  const noDb=createDurableWebhook({webhookSecret:secret,encryptionKey,
    allowedRecipient:recipient,nowSeconds:stamp,
    store:{insertIfAbsent:async()=>{throw Error('DATABASE_DOWN')}}});
  assert.equal((await noDb(req)).statusCode,503);
  const noConfirm=createDurableWebhook({webhookSecret:secret,encryptionKey,
    allowedRecipient:recipient,nowSeconds:stamp,
    store:{insertIfAbsent:async()=>undefined}});
  assert.equal((await noConfirm(req)).statusCode,503);
  assert.throws(()=>createDurableWebhook({webhookSecret:secret,
    encryptionKey,allowedRecipient:recipient}),/DURABLE_WEBHOOK_NOT_CONFIGURED/);
  console.log('PASS — signed metadata safely saved, duplicate ACK 204 with empty body');
  console.log('PASS — forged payload, missing signature, wrong method and oversize rejected');
  console.log('PASS — DB failures/unconfirmed inserts produce 503, not a false ACK');
  console.log('LIMIT — no actual deployment, DB client, user messages, or Calendar writes');
}
main().catch(err=>{console.error(err);process.exitCode=1});
