'use strict';
/**
 * NEXLUPA Premium — offline multichannel pilot.
 * Inputs must already be authorized and interpreted. No Gmail/WhatsApp/OAuth/LLM calls.
 * Calendar plans are proposals only: NO external writes.
 */
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, ' ').trim();
}
function pilot(activityId, activityName, calendarEventId) {
  return {
    activityId, activityName, calendarAuthorized: false,
    events: {'festival-001': {id:'festival-001', calendarEventId, facts:{}, revision:0}},
    processedIds: [], sources: [], reviews: [], modifiedEventIds: [],
    metrics: {received:0, accepted:0, ignored:0, duplicate:0, factsCreated:0, factsReconfirmed:0, needsReview:0}
  };
}
const fields = new Set(['start','arrival','venue','material','paymentDeadline','paymentStatus']);
function ingest(previous, message) {
  const state=clone(previous);
  state.metrics.received++;
  if (!message || message.authorized !== true || message.activityId !== state.activityId ||
    !['gmail','whatsapp','email-forwarded'].includes(message.channel) || !message.messageId) {
    state.metrics.ignored++; return {state, outcome:'ignored'};
  }
  if (state.processedIds.includes(message.messageId)) {
    state.metrics.duplicate++; return {state, outcome:'duplicate'};
  }
  state.processedIds.push(message.messageId);
  state.metrics.accepted++;
  state.sources.push({id:message.messageId, channel:message.channel, receivedAt:message.receivedAt, summary:message.text});
  if (!Array.isArray(message.facts)) {
    state.reviews.push({messageId:message.messageId, reason:'no-structured-interpretation'});
    state.metrics.needsReview++;
    return {state, outcome:'review'};
  }
  for (const fact of message.facts) {
    if (!fact || !fields.has(fact.field) || !fact.eventId || fact.value === undefined) {
      state.reviews.push({messageId:message.messageId, reason:'unsupported-fact'});
      state.metrics.needsReview++; continue;
    }
    const event=state.events[fact.eventId];
    if (!event) {
      state.reviews.push({messageId:message.messageId, eventId:fact.eventId, reason:'event-not-linked'});
      state.metrics.needsReview++; continue;
    }
    const confidence=Number(fact.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.9) {
      state.reviews.push({messageId:message.messageId, eventId:event.id, field:fact.field, proposal:fact.value, reason:'low-confidence'});
      state.metrics.needsReview++; continue;
    }
    const value=String(fact.value).trim();
    if (!value) continue;
    const current=event.facts[fact.field];
    if (!current) {
      event.facts[fact.field]={value, sourceIds:[message.messageId], lastReceivedAt:message.receivedAt};
      event.revision++;
      if (!state.modifiedEventIds.includes(event.id)) state.modifiedEventIds.push(event.id);
      state.metrics.factsCreated++;
    } else if (current.value === value) {
      if (!current.sourceIds.includes(message.messageId)) current.sourceIds.push(message.messageId);
      state.metrics.factsReconfirmed++;
    } else {
      // High-confidence contradictory messages MUST NOT silently override a confirmed date or time.
      state.reviews.push({messageId:message.messageId, eventId:event.id, field:fact.field,
        existing:current.value, proposal:value, reason:'conflicting-sources'});
      state.metrics.needsReview++;
    }
  }
  return {state, outcome:'processed'};
}
function getCalendarPlans(state) {
  return state.modifiedEventIds.map(id=>{
    const event=state.events[id];
    return {
      operation:event.calendarEventId?'update-proposal':'create-proposal',
      activityId:state.activityId, eventId:event.id,
      calendarEventId:event.calendarEventId || null,
      version:event.revision,
      fields:Object.fromEntries(Object.entries(event.facts).map(([k,v])=>[k,v.value])),
      needsUserApproval:true,
      externalWritePerformed:false
    };
  });
}
function answer(state, question) {
  const q=normalize(question);
  const event=state.events['festival-001'];
  const facts=event.facts;
  let field;
  if (/ja.*pagat|hem pagat|esta pagat|pagament fet/.test(q)) field='paymentStatus';
  else if (/pagar|termin|data limit|ultim dia/.test(q)) field='paymentDeadline';
  else if (/arrib|hem de ser|convocatori/.test(q)) field='arrival';
  else if (/comenc|inici|a quina hora es/.test(q)) field='start';
  else if (/portar|vestuari|material/.test(q)) field='material';
  else if (/on es|on sera|lloc|adreca/.test(q)) field='venue';
  else if (/quin dia|quan es|data de la sortida/.test(q)) field='start';
  else if (/calendari|apuntat/.test(q)) {
    return {known:!!event.calendarEventId, text:event.calendarEventId?
      'Hi ha un esdeveniment vinculat; els canvis del pilot són només propostes, encara no aplicades.':
      'No hi ha cap esdeveniment de Calendar vinculat.', sources:[], pendingReview:false};
  } else return {known:false,text:'No he identificat la pregunta. Pots concretar l’activitat o el que necessites?',sources:[],pendingReview:false};
  const fact=facts[field], conflicts=state.reviews.filter(r=>r.eventId===event.id && r.field===field);
  if (!fact) return {
    known:false,
    text:field==='paymentStatus'?'No tinc cap comprovant que confirmi si està pagat.':
      'Aquesta dada no consta a les comunicacions disponibles.',
    sources:[],pendingReview:conflicts.length>0
  };
  const sourceIds=fact.sourceIds;
  const first=field==='start' && /quin dia|quan es/.test(q) ?
    'La data i hora registrades són ' : ({arrival:'L’hora d’arribada és ',start:'L’inici és ',venue:'El lloc és ',material:'Cal portar ',paymentDeadline:'El termini per pagar és ',paymentStatus:'L’estat del pagament és '})[field];
  return {known:true,text:first+fact.value+(conflicts.length?' (hi ha una possible rectificació pendent de confirmar).':'.'),
    sources:sourceIds.map(id=>state.sources.find(s=>s.id===id)).filter(Boolean),
    pendingReview:conflicts.length>0};
}
function runPilot(fixture) {
  let state=pilot(fixture.activity.id,fixture.activity.name,fixture.activity.calendarEventId);
  const outcomes=[];
  for (const message of fixture.messages) {
    const r=ingest(state,message);
    state=r.state; outcomes.push({id:message.messageId,outcome:r.outcome});
  }
  const answers=(fixture.questions||[]).map(q=>({question:q,...answer(state,q)}));
  const plans=getCalendarPlans(state);
  return {state, outcomes, answers, plans, metrics:{...state.metrics, calendarProposals:plans.length, queriesAnswered:answers.filter(x=>x.known).length, queriesTotal:answers.length}};
}
module.exports={pilot,ingest,getCalendarPlans,answer,runPilot};