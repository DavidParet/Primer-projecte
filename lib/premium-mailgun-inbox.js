'use strict';
/**
 * INTERNAL synthetic Mailgun -> family inbox pipeline.
 * Never expose processSignedForm directly to untrusted HTTP requests.
 *
 * No network, no DNS, no webhook HTTP handler and no persistent replay store.
 * The caller must own verified sender identity and durable token consumption.
 * A production webhook should enqueue a verified delivery before ACK rather
 * than wait for AI inference inside the request.
 */
const {adaptMailgunRoute}=require('./premium-mailgun-inbound-adapter');
const {processInboxBatch}=require('./premium-family-inbox');
async function processSignedForm({form,signingKey,nowSeconds,usedTokens=[],
  independentlyAuthenticatedSender=false,state,registry,client,todayLocal,model}){
  const mapped=adaptMailgunRoute({
    form,signingKey,nowSeconds,usedTokens,independentlyAuthenticatedSender
  });
  if(mapped.status!=='mapped')return {
    status:mapped.status,reason:mapped.reason||null,
    state,externalWrites:0,processedCount:0,tokenToCommit:null
  };
  const batch=await processInboxBatch({
    state,deliveries:[{delivery:mapped.delivery,verification:mapped.verification}],
    registry,client,todayLocal,model
  });
  const item=batch.results[0]||{status:'error',reason:'EMPTY_INBOX_RESULT'};
  const accepted=['processed','irrelevant','duplicate','review',
    'needs-review'].includes(item.status);
  return {status:item.status,reason:item.reason||null,
    state:batch.state,externalWrites:0,processedCount:accepted?1:0,
    // This token is an ADVISORY output. Caller must atomically persist it
    // with durable delivery/queue handling; never trust an in-memory array.
    tokenToCommit:accepted?mapped.usedWebhookToken:null,
    familyId:item.familyId||null,activityId:item.activityId||null,
    calendarProposals:item.calendarProposals||0
  };
}
module.exports={processSignedForm};