'use strict';
// Executa els 50 missatges REALS des d'un fitxer local, sense publicar-los a GitHub.
// Exigeix NEXLUPA_QA_KEY per fixar la data del servidor a 2026-11-12.
// Variables: NEXLUPA_QA_URL, NEXLUPA_QA_KEY i opcional VERCEL_AUTOMATION_BYPASS_SECRET.
const fs=require('node:fs'), path=require('node:path');
const {performance}=require('node:perf_hooks');
const filename=process.argv[2], url=process.env.NEXLUPA_QA_URL;
const qaKey=process.env.NEXLUPA_QA_KEY;
if(!filename||!url||!qaKey){console.error('Ús: NEXLUPA_QA_URL=... NEXLUPA_QA_KEY=... node tests/run-qa50.js qa50.private.json');process.exit(2);}
const cases=JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
if(!Array.isArray(cases)||cases.length<1||cases.some(x=>!x||!x.message)){throw Error('Cal una llista de casos amb message');}
const endpoint=new URL(url);
if(endpoint.protocol!=='https:')throw Error('Utilitza HTTPS');
if(!endpoint.pathname.endsWith('/api/analyze'))endpoint.pathname='/api/analyze';
async function testOne(item){
  const start=performance.now();
  const headers={'Content-Type':'application/json','x-nexlupa-qa-key':qaKey};
  if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const r=await fetch(endpoint,{method:'POST',headers,signal:AbortSignal.timeout(90000),
      body:JSON.stringify({text:item.message,testReferenceDate:'2026-11-12'})});
    const raw=await r.text();let d;
    try{d=JSON.parse(raw)}catch(_){throw Error('HTTP '+r.status+' sense JSON; potser Vercel requereix login');}
    if(!r.ok)throw Error('HTTP '+r.status+': '+JSON.stringify(d));
    const dates=[...(d.esdeveniments||[]),...(d.accions||[]),...(d.recordatoris||[])]
      .filter(x=>x&&x.data).map(x=>x.data);
    return {id:item.id,esperat:item.esperat,ms:Math.round(performance.now()-start),
      status:r.status,dates,avisDates:d.avisDates||null,
      numEsdeveniments:(d.esdeveniments||[]).length,numTasques:(d.accions||[]).length,
      auditoria:'pendent de Claude',resultat:d};
  }catch(e){return{id:item.id,esperat:item.esperat,ms:Math.round(performance.now()-start),
    error:String(e),auditoria:'no verificat'};}
}
async function main(){
 const results=[];
 for(let i=0;i<cases.length;i+=4){
  results.push(...await Promise.all(cases.slice(i,i+4).map(testOne)));
  console.log(results.length+'/'+cases.length+'; errors HTTP '+results.filter(x=>x.error).length);
 }
 results.sort((a,b)=>a.id-b.id);
 const out=path.resolve('qa-result-'+new Date().toISOString().slice(0,10)+'.json');
 fs.writeFileSync(out,JSON.stringify({referenceDate:'2026-11-12',total:results.length,
  okHTTP:results.filter(x=>!x.error).length,notes:'No equival a percentatge d’encerts fins que Claude valori els casos.',
  results},null,2));
 console.log('Resultat:',out);
 if(results.some(x=>x.error))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
