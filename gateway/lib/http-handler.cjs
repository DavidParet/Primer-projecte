'use strict';

/**
 * HTTP boundary for a separately gated Resend forwarding PILOT.
 * This module has no credentials, database connections, or production side effects.
 * It accepts only signed metadata events: email bodies never pass this boundary.
 */
const {acceptSignedReceipt,verifySvix}=require('./resend-intake.cjs');

const ALLOWED_BRANCH='feature/gmail-resend-forwarding-pilot-20261110';
const LIMIT=16384;

function enabled(config) {
  return config?.vercelEnv==='preview' &&
    config?.gitRef===ALLOWED_BRANCH &&
    config?.enabled==='true';
}

function reply(res,status,payload) {
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.statusCode=status;
  if(payload===undefined){res.end();return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function rawBody(req) {
  if(typeof req?.[Symbol.asyncIterator]!=='function')
    throw new Error('raw_body_required');
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=buffer.length;
    if(size>LIMIT)throw new Error('oversized_webhook');
    chunks.push(buffer);
  }
  if(size===0)throw new Error('empty_webhook');
  const bytes=Buffer.concat(chunks);
  // UTF-8 is mandatory; replacement characters would break signature checks.
  let decoded;
  try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new Error('invalid_webhook_encoding');}
  return decoded;
}

function makeHttpHandler({config,createAdapters}) {
  return async function handler(req,res){
    // Keep inactive in production even if a production env accidentally
    // inherits a preview feature flag. No authorization from query/body.
    const active=enabled(config);
    if(req.method==='GET'){
      return reply(res,200,{configurationPresent:active && config?.configured===true,
        databaseConnectivityVerified:false,
        mode:'isolated-forwarding-pilot',emailBodiesFetched:false,
        metadataReceiptsEnabled:active && config?.configured===true,
        productionEnabled:false});
    }
    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      return reply(res,405,{error:'method_not_allowed'});
    }
    if(!active || config?.configured!==true ||
       typeof createAdapters!=='function'){
      return reply(res,503,{error:'pilot_disabled'});
    }
    // Reject an advertised oversized payload before consuming the stream.
    // Streaming LIMIT remains authoritative when Content-Length is absent or false.
    const advertised=req.headers?.['content-length'];
    if(advertised!==undefined && advertised!==null &&
       (!/^(0|[1-9][0-9]*)$/.test(String(advertised)) ||
        Number(advertised)>LIMIT))
      return reply(res,413,{error:'invalid_request_body'});
    let raw;
    try{raw=await rawBody(req);}
    catch(err){
      return reply(res,err?.message==='oversized_webhook'?413:400,
        {error:'invalid_request_body'});
    }
    // Check signature before even initializing the database adapter. A forged
    // event must never be able to cause database connections or queries.
    if(!verifySvix(raw,req.headers||{},config.webhookSecret))
      return reply(res,400,{error:'invalid_webhook'});
    let adapters;
    try{adapters=await createAdapters();}
    catch{return reply(res,503,{error:'pilot_unavailable'});}
    try {
      const result=await acceptSignedReceipt({
        raw,headers:req.headers||{},secret:config.webhookSecret,enabled:true,
        resolveAuthorizedRecipient:adapters.resolveAuthorizedRecipient,
        enqueueReceipt:adapters.enqueueReceipt
      });
      // Never expose hashes, family membership, aliases, or provider events.
      // Signed unsupported or unauthorized receipts are acknowledged so the
      // provider does not retry them as if they were transient failures.
      if(['queued','duplicate','ignored_event','unsupported_receipt',
           'unsupported_recipient','not_authorized'].includes(result.status))
        return reply(res,204);
      return reply(res,503,{error:'pilot_unavailable'});
    }catch(error){
      if(error?.message==='invalid_webhook_signature'||
         error?.message==='invalid_event_json')
        return reply(res,400,{error:'invalid_webhook'});
      // Includes transient Neon failures, which Resend should retry.
      return reply(res,503,{error:'pilot_unavailable'});
    }
  };
}

module.exports={enabled,rawBody,makeHttpHandler,ALLOWED_BRANCH};
