'use strict';
/**
 * OFFLINE synthetic prototype: drain already verified LOCAL inbox records
 * into isolated family activity cards. Does NOT read mailbox, connect to
 * Mailgun, persist database state, send messages or write Calendar.
 *
 * A production worker MUST validate the trusted queue envelope, use a
 * transactional shared store for claims/acks/state, and encrypt family data.
 * Never pass arbitrary HTTP request JSON into this function as a queue record.
 */
const {processCommunication}=require('./premium-agent-pipeline');
function readOnlyQueueShape(record){
  const p=record&&record.payload;
  const m=p&&p.message;
  return record?.status==='queued'&&typeof record.token==='string'&&
    typeof record.fingerprint==='string'&&record.fingerprint.length===64&&
    typeof p?.familyId==='string'&&typeof p?.activityId==='string'&&
    m?.authorized===true&&m?.activityId===p.activityId&&
    m?.channel==='email-forwarded'&&typeof m?.messageId==='string'&&
    typeof m?.text==='string'&&m.text.length>0&&m.text.length<=8000;
}
async function drainSyntheticInbox({records,state,client,todayLocal,model,max=20}){
  if(!Array.isArray(records)||!state?.families||typeof todayLocal!=='string'||
    !Number.isInteger(max)||max<1||max>100)throw Error('INVALID_QUEUE_INPUT');
  const next=JSON.parse(JSON.stringify(state));
  const outcomes=[];
  const previous=new Set();
  for(const record of records){
    if(outcomes.length>=max)break;
    // Never send unverified or quarantined content to the model.
    if(record?.status!=='queued')continue;
    if(!readOnlyQueueShape(record)){
      outcomes.push({status:'rejected',reason:'INVALID_QUEUE_RECORD'});continue;
    }
    const p=record.payload,m=p.message;
    const tokenKey=record.token+'|'+p.familyId;
    if(previous.has(tokenKey)){
      outcomes.push({status:'duplicate',reason:'REPEATED_RECORD'});continue;
    }
    previous.add(tokenKey);
    const family=next.families[p.familyId];
    const card=family?.cards?.[p.activityId];
    if(!family||!card||card.familyId!==p.familyId||
      card.activityId!==p.activityId){
      outcomes.push({status:'rejected',reason:'TENANT_OR_ACTIVITY_MISMATCH'});continue;
    }
    if(family.seenFingerprints.includes(record.fingerprint)||
      card.processedIds.includes(m.messageId)){
      outcomes.push({status:'duplicate',familyId:p.familyId,
        activityId:p.activityId});continue;
    }
    let result;
    try{
      result=await processCommunication({
        client,state:card,message:m,todayLocal,model
      });
    }catch(_err){
      // Keep this message available for retries; do not leak provider errors.
      outcomes.push({status:'retry',reason:'MODEL_OR_PROCESSING_FAILURE',
        familyId:p.familyId,activityId:p.activityId});continue;
    }
    if(result.outcome==='processed'||result.outcome==='review'){
      family.cards[p.activityId]=result.state;
      family.seenFingerprints.push(record.fingerprint);
      outcomes.push({status:result.outcome,familyId:p.familyId,
        activityId:p.activityId,reviewPending:!!result.review,
        calendarProposals:result.calendarPlans.length});
    }else if(result.outcome==='irrelevant'||result.outcome==='duplicate'){
      family.seenFingerprints.push(record.fingerprint);
      outcomes.push({status:result.outcome,familyId:p.familyId,
        activityId:p.activityId});
    }else{
      outcomes.push({status:'retry',reason:'UNHANDLED_OUTCOME'});
    }
  }
  return {state:next,outcomes,externalWrites:0,
    totalProcessed:outcomes.filter(x=>x.status==='processed').length,
    totalRetried:outcomes.filter(x=>x.status==='retry').length};
}
module.exports={readOnlyQueueShape,drainSyntheticInbox};
