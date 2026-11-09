'use strict';
/**
 * Optional paid LLM evaluation for NEXLUPA Agent. NEVER runs by default.
 *
 *   node scripts/eval-premium-ai.js               # free dry-run, no API
 *   RUN_LIVE_AGENT_EVAL=YES OPENAI_API_KEY=... \
 *      node scripts/eval-premium-ai.js            # 20 synthetic messages
 *
 * Use local environment/approved secrets. Never commit keys.
 * No Gmail, WhatsApp, Google Calendar, database writes or website changes.
 */
const fs=require('node:fs');
const path=require('node:path');
const {extractWithAI}=require('../lib/premium-ai-extractor');

function compareSets(actual,expected){
  const a=new Set(actual),e=new Set(expected);
  return {truePositive:[...a].filter(x=>e.has(x)).length,
    falsePositive:[...a].filter(x=>!e.has(x)).length,
    falseNegative:[...e].filter(x=>!a.has(x)).length,
    exact:[...a].sort().join('|')===[...e].sort().join('|')};
}
function metrics(results){
  const totals={examples:results.length,completed:0,errors:0,exactFieldMatches:0,
    truePositive:0,falsePositive:0,falseNegative:0,reviewMatches:0,relationMatches:0};
  for(const row of results){
    if(row.error){totals.errors++;continue}
    totals.completed++;
    if(row.exactFields)totals.exactFieldMatches++;
    totals.truePositive+=row.fieldScores.truePositive;
    totals.falsePositive+=row.fieldScores.falsePositive;
    totals.falseNegative+=row.fieldScores.falseNegative;
    if(row.reviewMatch)totals.reviewMatches++;
    if(row.relatedMatch)totals.relationMatches++;
  }
  totals.fieldPrecision=totals.truePositive+totals.falsePositive?
    totals.truePositive/(totals.truePositive+totals.falsePositive):null;
  totals.fieldRecall=totals.truePositive+totals.falseNegative?
    totals.truePositive/(totals.truePositive+totals.falseNegative):null;
  return totals;
}
async function evaluate({client,fixture,model='gpt-4o-mini'}){
  const context={
    activityId:fixture.metadata.activityId,
    activityName:fixture.metadata.activityName,
    todayLocal:fixture.metadata.todayLocal,
    events:[fixture.metadata.baselineExistingEvent]
  };
  const results=[];
  for(const test of fixture.cases){
    try{
      const result=await extractWithAI({client,message:test.message,context,model});
      const fields=[...new Set(result.accepted.map(x=>x.field))],scored=compareSets(fields,test.expectedFields);
      results.push({caseId:test.caseId,exactFields:scored.exact,fieldScores:scored,
        reviewMatch:result.requiresReview===test.expectedNeedsReview,
        relatedMatch:result.relatedToActivity===test.expectedRelatedToActivity,
        rejectedEvidenceCount:result.rejected.length});
    }catch(err){
      // Do not echo message contents or third-party provider response payloads.
      results.push({caseId:test.caseId,error:err?.name||'ExtractionError'});
    }
  }
  return {model,syntheticOnly:true,externalWrites:0,
    totals:metrics(results),cases:results};
}
async function main(){
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'..','tests','fixtures',
    'premium-ai-eval-challenge.json'),'utf8'));
  if(fixture.synthetic!==true||fixture.cases.length!==20)throw Error('INVALID_EVAL_FIXTURE');
  if(process.env.RUN_LIVE_AGENT_EVAL!=='YES'){
    console.log(JSON.stringify({status:'DRY_RUN',syntheticOnly:true,
      cases:fixture.cases.length,apiCalls:0,externalWrites:0,
      message:'To execute billed LLM tests, explicitly set RUN_LIVE_AGENT_EVAL=YES with an authorized OPENAI_API_KEY.'},null,2));
    return;
  }
  if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY_REQUIRED');
  const OpenAI=require('openai');
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:20000,maxRetries:1});
  const report=await evaluate({client,fixture,model:process.env.EVAL_MODEL||'gpt-4o-mini'});
  console.log(JSON.stringify(report,null,2));
  if(report.totals.errors>0)process.exitCode=2;
}
if(require.main===module)main().catch(err=>{
  console.error('Evaluation failed:',err?.name||'Error');
  process.exitCode=1;
});
module.exports={compareSets,metrics,evaluate};
