'use strict';
/**
 * QA50: 50 peticions reals al motor /api/analyze, sense desplegar.
 * Les dades originals es llegeixen d'un secret comprimit; mai es publiquen al repositori.
 */
const fs=require('node:fs');
const zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
const expectedDate='2026-11-12';
const output='qa50-live-results.json';

function readFixtures() {
  const encoded=process.env.QA50_FIXTURES_GZIP_B64;
  if(!encoded) throw Error('No configurat: secret QA50_FIXTURES_GZIP_B64');
  const cases=JSON.parse(zlib.gunzipSync(Buffer.from(encoded.trim(),'base64')).toString('utf8'));
  if (!Array.isArray(cases)||cases.length!==50) throw Error('Calen exactament 50 casos.');
  const ids=new Set();
  for(const c of cases){
    if(!Number.isInteger(c.id)||c.id<1||c.id>50||ids.has(c.id)||typeof c.message!=='string'||!c.message.trim()||
       typeof c.esperat!=='string'||!c.esperat.trim())
      throw Error('Fixtures incompletes o amb IDs duplicats.');
    ids.add(c.id);
  }
  return cases.sort((a,b)=>a.id-b.id);
}
function endpoint() {
  const raw=process.env.NEXLUPA_QA_URL;
  if(!raw || !process.env.NEXLUPA_QA_KEY) throw Error('Calen NEXLUPA_QA_URL i NEXLUPA_QA_KEY.');
  const u=new URL(raw);
  if(u.protocol!=='https:' || u.username || u.password) throw Error('Cal HTTPS i URL sense credencials.');
  u.pathname='/api/analyze';
  u.search='';
  return u;
}
async function one(c,url){
  const begin=performance.now();
  try {
    const headers={'Content-Type':'application/json','x-nexlupa-qa-key':process.env.NEXLUPA_QA_KEY};
    if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
      headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const r=await fetch(url,{method:'POST',headers,signal:AbortSignal.timeout(90000),
      body:JSON.stringify({text:c.message,testReferenceDate:expectedDate})});
    const body=await r.text();
    let data;
    try{ data=JSON.parse(body) }
    catch{throw Error('Resposta no JSON (HTTP '+r.status+')')}
    if(!r.ok)throw Error('HTTP '+r.status);
    if(!data||typeof data!=='object'||Array.isArray(data)) throw Error('Format de resposta invalid');
    return {id:c.id,canal:c.canal,categoria:c.categoria,esperat:c.esperat,message:c.message,
      status:r.status,ms:Math.round(performance.now()-begin),resultat:data};
  } catch(e) {
    return {id:c.id,canal:c.canal,categoria:c.categoria,esperat:c.esperat,message:c.message,
      ms:Math.round(performance.now()-begin),error:String(e?.message||e)};
  }
}
async function main(){
  const cases=readFixtures(),url=endpoint(),result=[];
  for(let i=0;i<cases.length;i+=4) {
    result.push(...await Promise.all(cases.slice(i,i+4).map(c=>one(c,url))));
    console.log('QA50: '+result.length+'/50, errors HTTP/transport: '+result.filter(x=>x.error).length);
  }
  const data={referenceDate:expectedDate,source:'50 casos originals Claude, dades privades',
    total:50,results:result};
  fs.writeFileSync(output,JSON.stringify(data,null,2),{mode:0o600});
  console.log('QA50 completada. Respostes privades al fitxer temporal del runner.');
}
main().catch(e=>{console.error('QA50 no executada:',e.message);process.exitCode=1});
