'use strict';
// Safe external HTTP probe: GET only, no cookies, credentials or OAuth.
// Usage: node scripts/probe-gmail-preview.cjs https://<approved-preview>.vercel.app
const {URL}=require('node:url');
async function probe(raw, fetchImpl=globalThis.fetch){
  if(typeof raw!=='string')throw Error('preview_url_required');
  const url=new URL(raw);
  if(url.protocol!=='https:' || url.username || url.password ||
    url.port || url.search || url.hash || url.pathname!=='/' ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
    !url.hostname.startsWith('primer-projecte-'))
    throw Error('preview_url_not_allowed');
  const results=[];
  for(const path of ['/api/gmail/pilot-auth','/api/gmail/pilot/start','/api/gmail/pilot/callback']){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetchImpl(new URL(path,url),{
        method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,
        headers:{'Accept':'application/json'}
      });
      const type=response.headers.get('content-type')||'';
      // Authentication walls are not an application HTTP pass.
      const protectedByVercel=response.status===401||response.status===403;
      const expected=path.endsWith('/start')?405:path.endsWith('/callback')?400:200;
      const result={path,status:response.status,
        contentType:type.split(';')[0],protectedByVercel,
        expectedStatus:expected,routeVerified:response.status===expected};
      results.push(result);
    }finally{clearTimeout(timeout);}
  }
  return {preview:url.origin,results,
    fullyVerified:results.length===3 &&
      results.every(x=>x.routeVerified && !x.protectedByVercel && x.contentType==='application/json')};
}
if(require.main===module){
  probe(process.argv[2]).then(result=>{
    console.log(JSON.stringify(result,null,2));
    if(!result.fullyVerified)process.exitCode=2;
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={probe};
