'use strict';
/**
 * Isolated NEXLUPA webhook pilot. ONLY cryptographic transport verification.
 * No full email fetch, AI processing, persistence, Calendar, DNS or replies.
 * All inbound content remains untrusted and is not executed or logged.
 */
const {verifySvix}=require('../lib/verify-svix');
async function rawBody(req,maxBytes=65536){
  const chunks=[];
  let bytes=0;
  for await (const chunk of req){
    const part=Buffer.from(chunk);
    bytes+=part.length;
    if(bytes>maxBytes)throw Error('OVERSIZED_BODY');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function reply(res,status,content){
  res.statusCode=status;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(content===undefined){res.end();return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(content));
}
module.exports=async function handler(req,res){
  if(req.method==='GET')
    return reply(res,200,{service:'nexlupa-resend-isolated-pilot',
      configured:Boolean(process.env.RESEND_WEBHOOK_SECRET),
      scope:'signature-verification-only',emailProcessing:false});
  if(req.method!=='POST')return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
  const secret=process.env.RESEND_WEBHOOK_SECRET;
  if(!secret)return reply(res,503,{error:'NOT_CONFIGURED'});
  let raw;
  try{raw=await rawBody(req);}catch(_err){
    return reply(res,413,{error:'INVALID_PAYLOAD_SIZE'});
  }
  if(!verifySvix(raw,req.headers,secret))
    return reply(res,401,{error:'INVALID_SIGNATURE'});
  let event;
  try{event=JSON.parse(raw);}catch(_err){
    return reply(res,400,{error:'INVALID_PAYLOAD'});
  }
  // Ack signed notifications; do not fetch, save, or execute email content.
  // No sender trust is inferred from Resend signature or From header.
  if(event?.type==='email.received' &&
     Array.isArray(event?.data?.to) &&
     event.data.to.length===1 &&
     event.data.to[0]==='pilot-nexlupa@pibnolee.resend.app' &&
     typeof event.data.email_id==='string'){
    // Transport proof only; no PII log or unsafe processing.
  }
  return reply(res,204);
};
module.exports._test={rawBody};
