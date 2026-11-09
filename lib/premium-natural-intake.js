'use strict';
/**
 * Experimental Catalan-text baseline for NEXLUPA Premium.
 * Works on synthetic, already-authorized messages. Not an LLM, WhatsApp
 * connection, Gmail sync or Google Calendar writer.
 */
const {pilot,ingest,answer,getCalendarPlans}=require('./premium-agent-pilot');
const MONTH={gener:1,febrer:2,marc:3,abril:4,maig:5,juny:6,juliol:7,agost:8,setembre:9,octubre:10,novembre:11,desembre:12};
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const p=x=>String(x).padStart(2,'0');
function dateFrom(t,year=2026){
  const s=norm(t),num=/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  const word=/\b(\d{1,2}) de (gener|febrer|marc|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)(?: de (\d{4}))?/.exec(s);
  if(!num&&!word)return null;
  let day=+(num?num[1]:word[1]),month=num?+num[2]:MONTH[word[2]];
  let y=num?(num[3]?+num[3]:year):(word[3]?+word[3]:year); if(y<100)y+=2000;
  const dt=new Date(Date.UTC(y,month-1,day));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===month-1&&dt.getUTCDate()===day?
    y+'-'+p(month)+'-'+p(day):null;
}
function timeFrom(t,re){
  const m=re.exec(t);if(!m)return null;
  const h=+m[1],min=+(m[2]||0);
  return h<=23&&min<=59?p(h)+':'+p(min):null;
}
function parseText(text,knownStart,year=2026){
  const s=norm(text),facts=[],warnings=[];
  const eventId='festival-001';
  const add=(field,value,confidence=0.98)=>facts.push({eventId,field,value,confidence});
  const existingDate=knownStart?.slice(0,10);
  if(s.includes('?'))return {facts,warnings,kind:'question'};
  if(/\bsortida\b/.test(s)&&dateFrom(s,year)){
    warnings.push('different-event-needs-linking');return {facts,warnings,kind:'other-event'};
  }
  if(/cancel|anul|ajorn|suspen/.test(s)){
    warnings.push('cancellation-requires-confirmation');return {facts,warnings,kind:'possible-cancellation'};
  }
  const uncertain=/potser|crec|sembla|no esta confirmat|encara no sabem/.test(s);
  const conf=uncertain?0.48:0.98;
  const due=/(termini|ultim dia|darrer dia|fins al)/.test(s)&&/(pagar|pagament|quota)/.test(s);
  if(due){
    const date=dateFrom(s,year);
    if(date)add('paymentDeadline',date,conf);else warnings.push('missing-deadline-date');
  }
  const arrival=timeFrom(s,/\b(?:arribar|ser-hi|convocatoria)\b[^!?\n]{0,75}?\ba les\s+(\d{1,2})(?:[.:](\d{2}))?\s*h?/);
  if(arrival){
    const d=dateFrom(s,year)||existingDate;
    if(d)add('arrival',d+'T'+arrival+':00+01:00',conf);else warnings.push('missing-arrival-date');
  }
  if(s.includes('festival')){
    const st=timeFrom(s,/\bcomenca\s+a les\s+(\d{1,2})(?:[.:](\d{2}))?\s*h?/)||
      timeFrom(s,/\bfestival\b[^!?\n]{0,150}?\ba les\s+(\d{1,2})(?:[.:](\d{2}))?\s*h?/);
    if(st){
      const d=(due?null:dateFrom(s,year))||existingDate;
      if(d)add('start',d+'T'+st+':00+01:00',conf);else warnings.push('missing-event-date');
    }
  }
  if(s.includes('teatre municipal'))add('venue','Teatre Municipal',conf);
  if(s.includes('vestuari de ball')&&s.includes('posat'))add('material','Vestuari de ball posat',conf);
  // A family member saying "ja he pagat" is not a verified payment receipt.
  return {facts,warnings,kind:facts.length?'facts':'no-action'};
}
function ingestText(previous,item,year=2026){
  const state=JSON.parse(JSON.stringify(previous));
  const interpretation=parseText(item.text,state.events['festival-001'].facts.start?.value,year);
  const r=ingest(state,{...item,facts:interpretation.facts});
  if(r.outcome==='processed'){
    for(const warning of interpretation.warnings){
      r.state.reviews.push({messageId:item.messageId,eventId:'festival-001',reason:warning});
      r.state.metrics.needsReview++;
    }
  }
  return {...r,interpretation};
}
function friendlyDate(iso){
  if(!iso)return '';
  const d=iso.slice(0,10),names=['gener','febrer','març','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];
  const [y,m,day]=d.split('-').map(Number);
  const out=day+' de '+names[m-1]+' de '+y;
  return iso.includes('T')?out+' a les '+iso.slice(11,16):out;
}
function ask(state,question){
  const q=norm(question);
  if(/canvi|rectific|modificat/.test(q)){
    const reviews=state.reviews.filter(r=>/conflicting|low-confidence|cancellation/.test(r.reason));
    return {known:true,pendingReview:reviews.length>0,
      text:reviews.length?'Hi ha '+reviews.length+' possible(s) canvi(s) pendent(s) de verificar. No s’ha actualitzat Calendar.':
        'No consten rectificacions pendents en la informació rebuda.',
      sources:reviews.map(r=>state.sources.find(s=>s.id===r.messageId)).filter(Boolean)};
  }
  if(/sortida/.test(q)){
    const review=state.reviews.find(x=>x.reason==='different-event-needs-linking');
    const source=review&&state.sources.find(s=>s.id===review.messageId);
    return {known:false,pendingReview:!!review,
      text:source?'He trobat una comunicació sobre una sortida'+
        (dateFrom(source.summary)?' el '+friendlyDate(dateFrom(source.summary)):'')+
        ', però falta confirmar si correspon a aquesta activitat. Encara no és al calendari.':
        'No consta una sortida verificada entre les comunicacions rebudes.',
      sources:source?[source]:[]};
  }
  const r=answer(state,question);
  if(!r.known)return r;
  const f=state.events['festival-001'].facts,value=key=>f[key]?.value;
  if(/pagar|termin|ultim dia/.test(q)&&value('paymentDeadline'))
    r.text='El termini per pagar és el '+friendlyDate(value('paymentDeadline'))+'.';
  else if(/arrib|hem de ser|convocatori/.test(q)&&value('arrival'))
    r.text='Cal arribar el '+friendlyDate(value('arrival'))+(r.pendingReview?' (possible rectificació pendent de confirmar).':'.');
  else if(/comenc|inici|a quina hora es/.test(q)&&value('start'))
    r.text='L’acte comença el '+friendlyDate(value('start'))+(r.pendingReview?' (possible canvi pendent de confirmar).':'.');
  else if(/quin dia|quan es/.test(q)&&value('start'))
    r.text='L’acte és el '+friendlyDate(value('start'))+
      (r.pendingReview?' (hi ha un possible canvi d’horari pendent de confirmar).':'.');
  return r;
}
function run(fixture){
  let state=pilot(fixture.activity.id,fixture.activity.name,fixture.activity.calendarEventId);
  const entries=[];
  for(const item of fixture.messages){
    const r=ingestText(state,item,fixture.activity.year);
    state=r.state;entries.push({messageId:item.messageId,outcome:r.outcome,interpretation:r.interpretation});
  }
  const qa=fixture.questions.map(q=>({question:q,...ask(state,q)}));
  return {state,entries,qa,calendarPlans:getCalendarPlans(state),
    metrics:{...state.metrics,questionsAnswered:qa.filter(q=>q.known).length,questionsTotal:qa.length,
      calendarProposals:getCalendarPlans(state).length}};
}
module.exports={dateFrom,parseText,ingestText,ask,run};
