'use strict';
const assert=require('node:assert/strict');
const fixture=require('./fixtures/premium-agent-ball.json');
const {runPilot}=require('../lib/premium-agent-pilot');
const {askWithAI,assembleAnswer,FORMAT,safeState}=require('../lib/premium-ai-answerer');
const data=runPilot(fixture).state;
function fake(intent,flags={}){
  const calls=[];
  return {calls,chat:{completions:{create:async opts=>{
    calls.push(opts);
    if(flags.error)throw Error('MOCK_PROVIDER_UNAVAILABLE');
    return {choices:[{finish_reason:flags.finish||'stop',message:{
      refusal:flags.refusal||null,
      content:flags.raw!==undefined?flags.raw:JSON.stringify(intent)}}]};
  }}}};
}
const i=(field,eventId='festival-001',needsClarification=false)=>({field,eventId,needsClarification});
async function main(){
  const c=fake(i('paymentDeadline'));
  const payment=await askWithAI({client:c,state:data,question:'Quin era l’últim dia per pagar?'});
  assert.equal(payment.known,true);
  assert.ok(payment.text.includes('18 de novembre'));
  assert.equal(payment.sources[0].channel,'gmail');
  assert.equal(payment.autoActionPerformed,false);
  assert.equal(payment.thirdPartyMessageSent,false);
  assert.equal(c.calls[0].response_format.type,'json_schema');
  assert.equal(c.calls[0].response_format.json_schema.strict,true);
  const userPayload=JSON.parse(c.calls[0].messages[1].content);
  assert.equal(userPayload.question,'Quin era l’últim dia per pagar?');
  assert.equal(userPayload.activity.id,fixture.activity.id);
  assert.ok(!c.calls[0].messages[1].content.includes('Circular:'),
    'Do not send entire source message to model for intent classification');
  assert.equal(FORMAT.json_schema.name,'nexlupa_family_question_intent_v1');

  const arrival=await askWithAI({client:fake(i('arrival')),state:data,question:'I a quina hora hem de ser-hi?',
    history:['Quan és la sortida?']});
  assert.equal(arrival.known,true);
  assert.ok(arrival.text.includes('16:15'));
  assert.equal(arrival.requiresReview,true);
  assert.equal(arrival.sources[0].channel,'whatsapp');

  const material=await askWithAI({client:fake(i('material')),state:data,question:'Què portem?'});
  assert.ok(material.text.includes('Vestuari'));
  assert.equal(material.known,true);
  const start=await askWithAI({client:fake(i('start')),state:data,question:'Quan comença?'});
  assert.ok(start.text.includes('17:00'));

  const noProof=await askWithAI({client:fake(i('paymentStatus')),state:data,question:'Ja hem pagat?'});
  assert.equal(noProof.known,false);
  assert.ok(noProof.text.includes('comprovant'));
  assert.equal(noProof.sources.length,0);

  const calendar=await askWithAI({client:fake(i('calendarStatus',null)),state:data,
    question:'Canvia el calendari a les vuit'});
  assert.equal(calendar.known,false);
  assert.equal(calendar.autoActionPerformed,false);
  assert.ok(calendar.text.includes('propostes'));

  const unknownEvent=await askWithAI({client:fake(i('start','unauthorized-event')),
    state:data,question:'A quina hora és el futbol?'});
  assert.equal(unknownEvent.known,false);
  assert.equal(unknownEvent.sources.length,0);

  const unknown=await askWithAI({client:fake(i('unknown',null,true)),state:data,question:'I què passa?'});
  assert.equal(unknown.known,false);
  assert.equal(unknown.requiresReview,true);

  const withoutSource=JSON.parse(JSON.stringify(data));
  withoutSource.sources=[];
  const unsupported=assembleAnswer(withoutSource,i('paymentDeadline'));
  assert.equal(unsupported.known,false);
  assert.equal(unsupported.requiresReview,true);

  const unlinked=JSON.parse(JSON.stringify(data));
  unlinked.sources.push({id:'out-01',channel:'gmail',receivedAt:'2026-11-16T10:00:00+01:00'});
  unlinked.reviews.push({messageId:'out-01',reason:'different-event-needs-linking'});
  const separate=await askWithAI({client:fake(i('otherEvent',null)),state:unlinked,
    question:'Què se sap de la sortida?'});
  assert.equal(separate.known,false);
  assert.equal(separate.requiresReview,true);
  assert.equal(separate.sources[0].id,'out-01');

  assert.equal(safeState(data,'Hola',[]).events.length,1);
  assert.throws(()=>safeState(data,'Hola',new Array(5).fill('x')),/INVALID_AGENT_QUESTION/);
  assert.throws(()=>safeState(data,'',[]),/INVALID_AGENT_QUESTION/);
  await assert.rejects(askWithAI({client:fake(i('start'),{raw:'not json'}),
    state:data,question:'Quan comença?'}),/INVALID_MODEL_JSON/);
  await assert.rejects(askWithAI({client:fake(i('start'),{finish:'length'}),
    state:data,question:'Quan comença?'}),/INCOMPLETE_OR_REFUSED_MODEL_RESULT/);
  await assert.rejects(askWithAI({client:fake(i('start'),{refusal:'not available'}),
    state:data,question:'Quan comença?'}),/INCOMPLETE_OR_REFUSED_MODEL_RESULT/);
  await assert.rejects(askWithAI({client:fake(i('start'),{error:true}),
    state:data,question:'Quan comença?'}),/MOCK_PROVIDER_UNAVAILABLE/);
  console.log('PASS — model routes 9 family questions to source-backed facts or honest unknowns');
  console.log('PASS — WhatsApp corrections noted, payment not claimed without receipt');
  console.log('PASS — no cross-event answer, source absence forces unknown, unlinked event review');
  console.log('PASS — all answers composed from stored facts, NOT model-written arbitrary claims');
  console.log('PASS — structured schema, bounded context and safe failure handling');
  console.log('NOTE — no live model invocation; no website, calendar, WhatsApp or Gmail changes');
}
main().catch(error=>{console.error(error);process.exitCode=1});
