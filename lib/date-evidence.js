'use strict';
// Conservative date evidence: never guess when a message contains multiple timelines.
const WD={diumenge:0,dilluns:1,dimarts:2,dimecres:3,dijous:4,divendres:5,dissabte:6,
  domingo:0,lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6};
const DAY_PATTERN='(?:diumenge|dilluns|dimarts|dimecres|dijous|divendres|dissabte|domingo|lunes|martes|miercoles|jueves|viernes|sabado)';
const RELATIVE=new RegExp('\\b(passat dema|pasado manana|dema|manana|avui|hoy|(?:(?:el|la)\\s+)?(?:(?:aquest|aquesta|este|esta|proper|proxim|proximo|siguiente)\\s+)?'+DAY_PATTERN+'(?:\\s+(?:que ve|vinent|proximo|siguiente))?)\\b','g');
const MONTH_PATTERN='(?:gener|febrer|marc|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)';
const WEEKDAY_NUMBER=new RegExp('\\b'+DAY_PATTERN+'\\s+(?:dia\\s+)?\\d{1,2}\\b','i');
const ABSOLUTE=new RegExp('\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s*[/]\\s*\\d{1,2}(?:\\s*[/]\\s*\\d{2,4})?|\\d{1,2}\\s+(?:de\\s+)?'+MONTH_PATTERN+')\\b','i');
function clean(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function iso(d){return d.toISOString().slice(0,10)}
function addDays(date,days){const v=new Date(date+'T12:00:00Z');v.setUTCDate(v.getUTCDate()+days);return iso(v)}
function upcomingWeekday(reference,weekday,nextWeek){const day=new Date(reference+'T12:00:00Z').getUTCDay();
  if(nextWeek){const elapsed=(day+6)%7;const target=(weekday+6)%7;return addDays(reference,7-elapsed+target)}
  const offset=(weekday-day+7)%7;
  return addDays(reference,offset===0?7:offset);
}
function relativeHints(source,reference){
  const src=clean(source);if(!/^\d{4}-\d{2}-\d{2}$/.test(reference))return {date:null,ambiguous:false};
  // Explicit dates require per-clause interpretation; never apply one global correction.
  if(ABSOLUTE.test(src)||WEEKDAY_NUMBER.test(src))return {date:null,ambiguous:false};
  const hits=[];let match;
  RELATIVE.lastIndex=0;
  while((match=RELATIVE.exec(src))!==null){
    const token=match[1];
    const before=src.slice(Math.max(0,match.index-20),match.index);
    if(token==='manana'&&/\b(?:por la|de la|a la)\s*$/.test(before))continue;
    let target=null;
    if(token==='avui'||token==='hoy')target=reference;
    else if(token==='dema'||token==='manana')target=addDays(reference,1);
    else if(token==='passat dema'||token==='pasado manana')target=addDays(reference,2);
    else {
      const day=(token.match(new RegExp(DAY_PATTERN))||[])[0];
      const nextWeek=/\b(?:que ve|vinent|proper|proxim|proximo|siguiente)\b/.test(token);
      const sameWeek=/\b(?:aquest|aquesta|este|esta)\b/.test(token);
      if(day){target=upcomingWeekday(reference,WD[day],nextWeek);
        if(sameWeek){const today=new Date(reference+'T12:00:00Z').getUTCDay();
          const delta=WD[day]-today;
          if(delta<0)target=null;
          else target=addDays(reference,delta);
        }
      }
    }
    if(target)hits.push(target);
  }
  const unique=[...new Set(hits)];
  return {date:unique.length===1?unique[0]:null,ambiguous:unique.length>1,hasRelative:hits.length>0};
}
function rebaseVerifiedTime(raw,expected,source){
  if(typeof raw!=='string')return expected;
  const dateTime=/^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})$/.exec(raw);
  if(!dateTime)return expected;
  const h=+dateTime[1], m=+dateTime[2];
  if(h>23||m>59)return expected;
  const src=clean(source),hh=String(h),mm=String(m).padStart(2,'0');
  const explicit=src.includes(hh+':'+mm)||src.includes(hh+'.'+mm)||(m===0&&new RegExp('\\b'+hh+'\\s*h(?:ores)?\\b').test(src));
  return explicit?expected+' '+dateTime[1]+':'+dateTime[2]:expected;
}
module.exports={relativeHints,rebaseVerifiedTime,upcomingWeekday};
