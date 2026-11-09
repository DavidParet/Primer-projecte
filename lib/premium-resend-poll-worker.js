'use strict';
/**
 * NEXLUPA: manual/on-demand Resend inbox polling bridge, INTERNAL PILOT ONLY.
 *
 * Calls authenticated Resend receiving.list/get (no public webhook, DNS or
 * Google Calendar writes). The SDK authenticates the PROVIDER, not the sender.
 * attestSender must use independent trusted authentication evidence: never
 * infer sender authentication from the From field or Resend API success.
 *
 * No production runner, schedules, storage, credentials or real-user intake
 * are configured by this module. State/processed IDs are caller-managed:
 * in-memory demo only; production needs transactional encrypted persistence.
 */
const {email,resolveFamily,processForwardedEmail} = require('./premium-forwarded-email');
const {canonicalFrom,singleRecipient} = require('./premium-resend-inbound');
const RECEIVED_ID=/^[a-f0-9-]{12,80}$/i;
const MAX_TEXT=8000, MAX_LIMIT=20;
function decision(status,reason=null,other={}){
  return {status,reason,externalWrites:0,calendarPlans:[],...other};
}
function plainObject(x){return x&&typeof x==='object'&&!Array.isArray(x);}
async function pollResendPilot({
  resend,registry,state,client,todayLocal,model,
  attestSender=async()=>false,seenResendIds=[],seenFingerprints=[],limit=10
}){
  if(!resend?.emails?.receiving||
    typeof resend.emails.receiving.list!=='function'||
    typeof resend.emails.receiving.get!=='function'||
    !plainObject(registry)||!Array.isArray(registry.families)||
    !plainObject(state)||typeof state.familyId!=='string'||
    !Array.isArray(seenResendIds)||!Array.isArray(seenFingerprints)||
    !Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)
    throw Error('INVALID_PILOT_CONFIGURATION');
  // Restrict page size; caller must persist cursors and IDs before any real use.
  const response=await resend.emails.receiving.list({limit});
  if(response?.error||!Array.isArray(response?.data?.data))
    return {state,seenResendIds,seenFingerprints,
      results:[decision('retry','RECEIVING_LIST_UNAVAILABLE')],externalWrites:0};
  let nextState=JSON.parse(JSON.stringify(state));
  const seenIds=new Set(seenResendIds), fingerprints=new Set(seenFingerprints);
  const results=[];
  for(const item of response.data.data){
    const id=item?.id;
    if(typeof id!=='string'||!RECEIVED_ID.test(id)){
      results.push(decision('rejected','INVALID_RECEIVED_ID'));continue;
    }
    if(seenIds.has(id)){
      results.push(decision('duplicate','ALREADY_PROCESSED',{id}));continue;
    }
    const sender=canonicalFrom(item.from),recipient=singleRecipient(item.to);
    if(!sender||!recipient||typeof item.subject!=='string'||
      item.subject.length>500){
      results.push(decision('rejected','INVALID_INBOUND_METADATA',{id}));continue;
    }
    const familyMatch=resolveFamily(recipient,registry);
    if(familyMatch.error){
      results.push(decision('rejected',familyMatch.error,{id}));continue;
    }
    const family=familyMatch.family;
    if(!Array.isArray(family.verifiedForwarders)||
      !family.verifiedForwarders.some(s=>email(s)===sender)){
      results.push(decision('rejected','UNREGISTERED_FORWARDER',{id}));continue;
    }
    if(state.familyId!==family.id){
      results.push(decision('rejected','STATE_IDENTITY_MISMATCH',{id}));continue;
    }
    // Independently authenticated evidence is required before fetching mail.
    // IMPORTANT: callback output must not be derived from From or Subject.
    let senderVerified=false;
    try{
      senderVerified=typeof attestSender==='function'&&await attestSender({
        id,recipient,from:sender,familyId:family.id
      })===true;
    }catch(_err){senderVerified=false;}
    if(!senderVerified){
      results.push(decision('needs-review','SENDER_AUTHENTICATION_PENDING',{id}));
      continue;
    }
    let itemResult;
    try{
      itemResult=await resend.emails.receiving.get(id);
    }catch(_err){
      results.push(decision('retry','RECEIVING_GET_UNAVAILABLE',{id}));continue;
    }
    const full=itemResult?.data;
    if(itemResult?.error||!full){
      results.push(decision('retry','RECEIVING_GET_UNAVAILABLE',{id}));continue;
    }
    if(full.id!==id||canonicalFrom(full.from)!==sender||
      singleRecipient(full.to)!==recipient||full.subject!==item.subject){
      results.push(decision('needs-review','RETRIEVED_METADATA_MISMATCH',{id}));
      continue;
    }
    if(Array.isArray(full.attachments)&&full.attachments.length){
      results.push(decision('needs-review','ATTACHMENTS_REQUIRE_SEPARATE_PROCESSING',{id}));
      continue;
    }
    if(typeof full.text!=='string'||!full.text.trim()||full.text.length>MAX_TEXT){
      results.push(decision('needs-review','UNSUPPORTED_OR_OVERSIZED_CONTENT',{id}));
      continue;
    }
    const receivedAt=full.created_at||item.created_at||item.received_at;
    if(!Number.isFinite(Date.parse(receivedAt||''))){
      results.push(decision('needs-review','MISSING_RECEIVED_TIMESTAMP',{id}));
      continue;
    }
    let result;
    try{
      result=await processForwardedEmail({
        delivery:{envelopeRecipient:recipient,envelopeSender:sender,
          providerMessageId:id,receivedAt,subject:full.subject,
          textPlain:full.text,attachments:[]},
        registry,verification:{providerAuthenticated:true,senderAuthenticated:true},
        seenFingerprints:[...fingerprints],state:nextState,client,todayLocal,model
      });
    }catch(_err){
      results.push(decision('retry','PILOT_PROCESSING_FAILURE',{id}));continue;
    }
    // No account writes. Only update in-memory demo state after a completed run.
    results.push(decision(result.status,result.reason||null,{id,
      familyId:result.forwardedEmail?.familyId||family.id,
      activityId:result.forwardedEmail?.activityId||null,
      calendarPlans:result.calendarPlans||[]}));
    if(['processed','review','duplicate'].includes(result.status)){
      if(result.state)nextState=result.state;
      if(result.forwardedEmail?.fingerprint)
        fingerprints.add(result.forwardedEmail.fingerprint);
      seenIds.add(id);
    }
  }
  return {state:nextState,seenResendIds:[...seenIds],
    seenFingerprints:[...fingerprints],results,externalWrites:0};
}
module.exports={pollResendPilot};
