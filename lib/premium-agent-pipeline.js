'use strict';
/**
 * Internal-only Premium pipeline: an authorized message -> LLM-extraction ->
 * reconciled activity card -> calendar UPDATE PROPOSALS.
 * No channel OAuth, no DB, no notification listener, NO calendar writes.
 */
const {extractWithAI,toPilotFacts}=require('./premium-ai-extractor');
const {ingest,getCalendarPlans}=require('./premium-agent-pilot');
function makeContext(state,todayLocal){
  const events=Object.values(state.events||{}).map(e=>({
    id:e.id,title:e.title||'Festival / activitat de '+state.activityName,
    start:e.facts?.start?.value||null,venue:e.facts?.venue?.value||null
  }));
  return {activityId:state.activityId,activityName:state.activityName,
    todayLocal,events};
}
async function processCommunication({client,state,message,todayLocal,model}){
  if(!state||!message||message.authorized!==true||message.activityId!==state.activityId||
    state.activityId===undefined||!['gmail','whatsapp','email-forwarded'].includes(message.channel))
    return {state,outcome:'ignored-source',calendarPlans:[],review:null,extraction:null};
  if((state.processedIds||[]).includes(message.messageId))
    return {state,outcome:'duplicate',calendarPlans:[],review:null,extraction:null};
  const extracted=await extractWithAI({client,message,context:makeContext(state,todayLocal),model});
  if(!extracted.relatedToActivity)
    return {state,outcome:'irrelevant',calendarPlans:[],review:null,extraction:extracted};
  const compatible={
    activityId:state.activityId,authorized:true,channel:message.channel,
    messageId:message.messageId,receivedAt:message.receivedAt,
    text:message.text,facts:toPilotFacts(extracted)
  };
  const reconciled=ingest(state,compatible);
  const next=reconciled.state;
  let review=null;
  if(extracted.requiresReview&&reconciled.outcome==='processed'){
    review={sourceMessageId:message.messageId,reason:extracted.reviewReason||
      (extracted.rejected.length?'source-evidence-or-format-rejected':'ambiguous-or-conflicting'),
      proposals:extracted.accepted.map(f=>({field:f.field,value:f.value,eventId:f.eventId})),
      rejected:extracted.rejected};
    next.reviews.push({messageId:message.messageId,reason:review.reason,extractionReview:true});
    next.metrics.needsReview++;
  }
  return {state:next,outcome:reconciled.outcome,extraction:extracted,review,
    calendarPlans:getCalendarPlans(next),externalWrites:0};
}
module.exports={makeContext,processCommunication};