'use strict';
// Executa els 50 missatges REALS des d'un fitxer local, sense publicar-los a GitHub.
// Exigeix NEXLUPA_QA_KEY per fixar la data del servidor a 2026-11-12.
// Variables: NEXLUPA_QA_URL, NEXLUPA_QA_KEY i opcional VERCEL_AUTOMATION_BYPASS_SECRET.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {performance}=require('node:perf_hooks');
const filename=process.argv[2], url=process.env.NEXLUPA_QA_URL;
const qaKey=process.env.NEXLUPA_QA_KEY;
if(!filename||!url||!qaKey){console.error('Ús: NEXLUPA_QA_URL=... NEXLUPA_QA_KEY=... node tests/run-qa.js qa50.private.json');process.exit(2);}
const cases=JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
if(!Array.isArray(cases)||cases.length<1||cases.some(x=>!x||!x.message)){throw Error('Cal una llista de casos amb message');}
const endpoint=new URL(url);
if(endpoint.protocol!=='https:')throw Error('Utilitza HTTPS');
if(!/^primer-projecte-(?:[a-z0-9]{9}|git-fix-qa96-[a-z0-9-]+)-davidparets-projects\.vercel\.app$/.test(endpoint.hostname))
  throw Error('QA50: URL de preview NexLupa no reconeguda; no s’enviarà cap missatge ni clau');
if(endpoint.search)throw Error('QA50: URL amb paràmetres no permesa: protegeix tokens i dades');
endpoint.pathname='/api/analyze';
async function testOne(item){
  const start=performance.now();
  const headers={'Content-Type':'application/json','x-nexlupa-qa-key':qaKey};
  if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const r=await fetch(endpoint,{method:'POST',headers,redirect:'manual',signal:AbortSignal.timeout(90000),
      body:JSON.stringify({text:item.message,testReferenceDate:'2026-11-12'})});
    if([301,302,303,307,308].includes(r.status))
      throw Error('Vercel SSO bloqueja POST (HTTP '+r.status+'); no s’ha seguit cap redirecció');
    if(r.status===401||r.status===403)
      throw Error('Accés QA denegat (HTTP '+r.status+'); cal autenticació autoritzada');
    const raw=await r.text();let d;
    try{d=JSON.parse(raw)}catch(_){throw Error('HTTP '+r.status+' sense JSON; potser Vercel requereix login');}
    if(!r.ok)throw Error('HTTP '+r.status+' a /api/analyze');
    if(d.dataReferencia!=='2026-11-12')throw Error('Data QA no acceptada: cap percentatge vàlid');
    if(typeof d.resum!=='string'||!Array.isArray(d.accions)||!Array.isArray(d.esdeveniments))
      throw Error('Resposta HTTP 200 però contracte semàntic invàlid');
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
  console.log(results.length+'/'+cases.length+'; incidències '+results.filter(x=>x.error).length);
  if(i===0 && results.every(x=>x.error)) {
    console.error('QA50 aturada: els primers quatre casos han fallat; no es faran més peticions.');
    break;
  }
 }
 results.sort((a,b)=>a.id-b.id);
 const folder=path.resolve(process.env.NEXLUPA_QA_OUTPUT_DIR||os.tmpdir());
 fs.mkdirSync(folder,{recursive:true});
 const out=path.join(folder,'nexlupa-qa-result-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 fs.writeFileSync(out,JSON.stringify({referenceDate:'2026-11-12',total:results.length,
  okHTTP:results.filter(x=>!x.error).length,notes:'Proves HTTP reals sense puntuació: la revisió semàntica independent continua pendent.',
  results},null,2));
 console.log('Resultat:',out);
 if(results.some(x=>x.error))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
