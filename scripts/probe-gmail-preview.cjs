'use strict';
// Safe external HTTP probe: GET only, no cookies, credentials or OAuth.
// Usage: node scripts/probe-gmail-preview.cjs https://<approved-preview>.vercel.app
// Distinguish reachable-but-disabled pilot routes from a fully ready pilot.
const {URL}=require('node:url');

const EXPECTED={
  '/api/gmail/pilot-auth': {ready:200,guarded:503},
  '/api/gmail/pilot/start': {ready:405,guarded:405},
  '/api/gmail/pilot/callback': {ready:400,guarded:503}
};
function matchesReply(path,status,body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) return {ready:false,guarded:false};
  if(path==='/api/gmail/pilot-auth') {
    return {ready:status===200 && body.ready===true && body.real_email_access===false,
      guarded:status===503 && body.error==='pilot_not_ready' && body.ready===false};
  }
  if(path==='/api/gmail/pilot/start') {
    return {ready:status===405 && body.error==='method_not_allowed',guarded:false};
  }
  return {ready:status===400 && body.error==='invalid_oauth_return',
    guarded:status===503 && body.error==='gmail_pilot_unavailable'};
}
async function probe(raw,fetchImpl=globalThis.fetch){
  if(typeof raw!=='string')throw Error('preview_url_required');
  const url=new URL(raw);
  if(url.protocol!=='https:' || url.username || url.password ||
    url.port || url.search || url.hash || url.pathname!=='/' ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
    !url.hostname.startsWith('primer-projecte-'))
    throw Error('preview_url_not_allowed');

  const results=[];
  for(const path of Object.keys(EXPECTED)){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetchImpl(new URL(path,url),{
        method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,
        headers:{'Accept':'application/json'}
      });
      const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      const protectedByVercel=response.status===401||response.status===403;
      const allowedStatus=[EXPECTED[path].ready,EXPECTED[path].guarded].includes(response.status);
      let body;
      // Never print response bodies: they could contain private information.
      // Only inspect the expected, small JSON contract; no user data is needed.
      if(type==='application/json' && !protectedByVercel && allowedStatus){
        try{ body=await response.json(); }catch{ body=null; }
      }
      const contract=matchesReply(path,response.status,body);
      const ready=contract.ready && !protectedByVercel && type==='application/json';
      const guarded=contract.guarded && !protectedByVercel && type==='application/json';
      results.push({path,status:response.status,contentType:type,protectedByVercel,
        expectedReadyStatus:EXPECTED[path].ready,routeVerified:ready||guarded,
        ready,guarded});
    }catch(error){
      // A DNS, TLS or timeout failure on one route must not hide the other
      // results. Never include raw exception messages (URLs may contain secrets).
      results.push({path,status:null,contentType:null,protectedByVercel:false,
        expectedReadyStatus:EXPECTED[path].ready,routeVerified:false,
        ready:false,guarded:false,
        failure:controller.signal.aborted?'timeout':'network_error'});
    }finally{clearTimeout(timeout);}
  }
  const routeReachable=results.length===3 && results.every(x=>x.routeVerified);
  const fullyVerified=routeReachable && results.every(x=>x.ready);
  return {preview:url.origin,results,routeReachable,fullyVerified,
    phase:fullyVerified?'configured_readiness':routeReachable?'guarded_not_ready':'unverified'};
}
if(require.main===module){
  probe(process.argv[2]).then(result=>{
    console.log(JSON.stringify(result,null,2));
    if(!result.fullyVerified)process.exitCode=2;
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={probe};
