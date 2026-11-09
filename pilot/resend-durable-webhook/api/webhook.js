'use strict';
/**
 * NEXLUPA standalone pilot HTTPS route. Must be deployed ONLY to isolated
 * nexlupa-resend-pilot and tested first as preview. Never edit NEXLUPA main.
 *
 * Does not fetch message contents, call AI or write Calendar.
 */
const {createDurableWebhook}=require('../handler');
const {createResendPostgresStore}=require('../../../lib/premium-resend-postgres-store');
let pool;
function service(){
  const url=process.env.DATABASE_URL;
  const secret=process.env.RESEND_WEBHOOK_SECRET;
  const key=process.env.RESEND_QUEUE_ENCRYPTION_KEY;
  const recipient=process.env.RESEND_PILOT_RECIPIENT;
  if(!url||!secret||!key||recipient!=='pilot@entrada.nexlupa.app')
    throw Error('PILOT_NOT_CONFIGURED');
  if(!pool){
    const {Pool}=require('pg');
    pool=new Pool({connectionString:url,
      ssl:{rejectUnauthorized:true},
      max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,
      statement_timeout:7000});
  }
  return createDurableWebhook({
    webhookSecret:secret,encryptionKey:key,allowedRecipient:recipient,
    store:createResendPostgresStore(pool)
  });
}
async function rawBody(req,maxBytes=65536){
  const chunks=[];
  let bytes=0;
  for await(const chunk of req){
    bytes+=Buffer.byteLength(chunk);
    if(bytes>maxBytes)throw Error('OVERSIZED_PAYLOAD');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){
    res.statusCode=405;res.end();return;
  }
  let handle;
  try{handle=service()}catch(_err){
    res.statusCode=503;res.end();return;
  }
  let body;
  try{body=await rawBody(req)}catch(_err){
    res.statusCode=413;res.end();return;
  }
  const result=await handle({method:'POST',headers:req.headers,body});
  res.statusCode=result.statusCode;
  for(const [name,value] of Object.entries(result.headers||{}))
    res.setHeader(name,value);
  res.end(result.body||'');
};
module.exports._test={rawBody};
