'use strict';
/**
 * NEXLUPA — internal, memory-only inbox batch orchestrator.
 *
 * Each family keeps separate activity cards and per-family deduplication.
 * All integration responses are fictional unless a trusted mail adapter
 * invokes it. No persistence, external mail receive or Calendar writes.
 */
const {pilot}=require('./premium-agent-pilot');
const {processForwardedEmail,routeForwardedEmail}=require('./premium-forwarded-email');

function initialInboxState(registry,calendarIds={}){
  if(!Array.isArray(registry?.families))throw Error('INVALID_FAMILY_REGISTRY');
  const families={};
  for(const family of registry.families){
    if(!family.id||families[family.id]||!Array.isArray(family.activities))
      throw Error('INVALID_OR_DUPLICATED_FAMILY');
    const cards={};
    for(const a of family.activities){
      if(!a.id||cards[a.id])throw Error('INVALID_OR_DUPLICATED_ACTIVITY');
      cards[a.id]=pilot(a.id,a.name,
        calendarIds[family.id]?.[a.id]||null);
      cards[a.id].familyId=family.id;
    }
    families[family.id]={cards,seenFingerprints:[],reviewQueue:[]};
  }
  return {families};
}
async function processInboxBatch({state,deliveries,registry,client,
  todayLocal,model}){
  if(!state||!state.families||!Array.isArray(deliveries)||deliveries.length>50)
    throw Error('INVALID_INBOX_BATCH');
  const next=JSON.parse(JSON.stringify(state));
  const results=[];
  for(const incoming of deliveries){
    // These flags must come from a trusted sender-authenticating adapter,
    // never from user-controlled mail headers or a browser request.
    const verification=incoming.verification;
    const delivery=incoming.delivery;
    const raw=routeForwardedEmail({delivery,registry,verification});
    if(raw.status!=='accepted'){
      if(raw.status==='needs-review'&&raw.familyId&&next.families[raw.familyId]){
        next.families[raw.familyId].reviewQueue.push({
          providerMessageId:String(delivery?.providerMessageId||'').slice(0,128),
          reason:raw.reason,candidateActivityIds:raw.candidateActivityIds||[]
        });
      }
      results.push({status:raw.status,reason:raw.reason||null,
        familyId:raw.familyId||null});
      continue;
    }
    const family=next.families[raw.familyId];
    const card=family?.cards?.[raw.activityId];
    if(!family||!card||card.familyId!==raw.familyId){
      results.push({status:'rejected',reason:'STATE_IDENTITY_MISMATCH'});
      continue;
    }
    let output;
    try{
      output=await processForwardedEmail({
        delivery,registry,verification,state:card,client,todayLocal,model,
        seenFingerprints:family.seenFingerprints
      });
    }catch(err){
      results.push({status:'error',reason:'UPSTREAM_PROCESSING_FAILED',
        familyId:raw.familyId,activityId:raw.activityId});
      continue; // no dedup mark: retry is possible
    }
    if(output.status==='processed'){
      family.cards[raw.activityId]=output.state;
      family.seenFingerprints.push(raw.fingerprint);
    }else if(output.status==='irrelevant'){
      // Avoid repeatedly charging the LLM for the same irrelevant content.
      family.seenFingerprints.push(raw.fingerprint);
    }else if(output.status==='duplicate'){
      // already seen; do not create a second card
    }else if(output.status==='review'){
      family.cards[raw.activityId]=output.state;
      family.seenFingerprints.push(raw.fingerprint);
    }
    results.push({status:output.status,reason:output.reason||null,
      familyId:raw.familyId,activityId:raw.activityId,
      reviewPending:!!output.review,calendarProposals:output.calendarPlans?.length||0});
  }
  return {state:next,results,externalWrites:0};
}
module.exports={initialInboxState,processInboxBatch};
