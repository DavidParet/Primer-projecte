'use strict';
/**
 * NEXLUPA LOCAL MAILGUN PILOT (NO public endpoint / NO production).
 *
 * Creates a Node HTTP server without listening automatically. Bind ONLY
 * to 127.0.0.1. The Mailgun webhook signing key verifies PROVIDER delivery,
 * not the real email sender; senderProof is a trusted callback and defaults
 * to false. In tests it is a deliberate synthetic stub, not real SPF/DKIM.
 *
 * Durable local files, including emails, are for SYNTHETIC data ONLY;
 * not encrypted or safe for real family/children's communications.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {adaptMailgunRoute,verifyMailgunSignature}=require('../lib/premium-mailgun-inbound-adapter');
const {routeForwardedEmail}=require('../lib/premium-forwarded-email');
const MAX_POST_BYTES=32768;
function bodyToForm(body){
  const params=new URLSearchParams(body.toString('utf8'));
  const out=Object.create(null);
  let count=0;
  for(const [name,value] of params){
    if(++count>50||Object.hasOwn(out,name)||name==='__proto__'||name==='constructor')
      throw Error('INVALID_FORM_FIELDS');
    out[name]=value;
  }
  return out;
}
function readRecords(dir){
  const records=[];
  if(!fs.existsSync(dir))return records;
  for(const name of fs.readdirSync(dir)){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const obj=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
    if(obj&&typeof obj==='object')records.push(obj);
  }
  return records;
}
function safePersist(dir,token,record){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const name=crypto.createHash('sha256').update(token).digest('hex')+'.json';
  const target=path.join(dir,name);
  if(fs.existsSync(target))return false;
  const tmp=path.join(dir,'.pending-'+crypto.randomBytes(12).toString('hex'));
  try{
    fs.writeFileSync(tmp,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
    try{fs.linkSync(tmp,target)}catch(err){
      if(err.code==='EEXIST')return false;
      throw err;
    }
    return true;
  }finally{
    try{fs.unlinkSync(tmp)}catch(err){if(err.code!=='ENOENT')throw err}
  }
}
function response(res,status,result){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  });
  res.end(JSON.stringify(result));
}
function makeLocalHandler({signingKey,registry,dataDir,senderProof=()=>false,clock=()=>Math.floor(Date.now()/1000)}){
  if(typeof signingKey!=='string'||signingKey.length<20||
    !registry||typeof dataDir!=='string'||!path.isAbsolute(dataDir)||
    typeof senderProof!=='function')throw Error('INVALID_LOCAL_PILOT_CONFIG');
  return async function handle(req,res){
    if(req.url!=='/inbound/mailgun')return response(res,404,{status:'not-found'});
    if(req.method!=='POST')return response(res,405,{status:'method-not-allowed'});
    const peer=req.socket.remoteAddress||'';
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer))
      return response(res,403,{status:'local-only'});
    if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i
      .test(req.headers['content-type']||''))
      return response(res,415,{status:'unsupported-content-type'});
    const claimed=Number(req.headers['content-length']);
    if(Number.isFinite(claimed)&&claimed>MAX_POST_BYTES)
      return response(res,413,{status:'too-large'});
    let size=0,chunks=[];
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>MAX_POST_BYTES)return response(res,413,{status:'too-large'});
        chunks.push(chunk);
      }
      let form;
      try{form=bodyToForm(Buffer.concat(chunks))}
      catch{return response(res,406,{status:'invalid-form'})}
      const prior=readRecords(dataDir);
      const usedTokens=prior.map(r=>r.token).filter(x=>typeof x==='string');
      const verified=verifyMailgunSignature({form,signingKey,nowSeconds:clock(),usedTokens});
      if(!verified.verified){
        if(verified.reason==='REPLAYED_TOKEN')
          return response(res,200,{status:'duplicate'});
        return response(res,406,{status:'invalid-signature'});
      }
      // Sender proof must come from trusted provider-authentication data,
      // NOT from form fields such as a spoofable From address.
      const independentlyAuthenticatedSender=senderProof(form)===true;
      const mapped=adaptMailgunRoute({
        form,signingKey,nowSeconds:clock(),usedTokens,
        independentlyAuthenticatedSender
      });
      let status='needs-review',reason=mapped.reason||null,
        familyId=null,activityId=null,fingerprint=null,payload=null;
      if(mapped.status==='mapped'){
        const seenFingerprints=prior.filter(r=>r.status==='queued')
          .map(r=>r.fingerprint).filter(Boolean);
        const routed=routeForwardedEmail({
          delivery:mapped.delivery,verification:mapped.verification,
          registry,seenFingerprints
        });
        status=routed.status==='accepted'?'queued':
          routed.status==='duplicate'?'duplicate-content':'needs-review';
        reason=routed.reason||null;
        familyId=routed.familyId||null;
        activityId=routed.activityId||null;
        fingerprint=routed.fingerprint||null;
        if(routed.status==='accepted'){
          payload={familyId,activityId,message:routed.message};
        }
      }
      // Untrusted/ambiguous messages: metadata only, never content.
      const record={token:verified.token,receivedAt:new Date(verified.timestamp*1000).toISOString(),
        status,reason,familyId,activityId,fingerprint,payload};
      if(!safePersist(dataDir,verified.token,record))
        return response(res,200,{status:'duplicate'});
      return response(res,200,{status,reviewPending:status==='needs-review'});
    }catch(_err){
      // Never leak private mail contents/secret keys into responses or logs.
      return response(res,503,{status:'persistence-or-processing-error'});
    }
  };
}
function createLocalPilot(options){
  return http.createServer(makeLocalHandler(options));
}
module.exports={makeLocalHandler,createLocalPilot,bodyToForm,readRecords,MAX_POST_BYTES};
