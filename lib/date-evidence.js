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
const NUMWORD={una:1,u:1,dues:2,dos:2,tres:3,quatre:4,cinc:5,sis:6,set:7,vuit:8,nou:9,deu:10,onze:11,dotze:12};
const CHANGE_CUE=/\b(?:canvi|canvia|canviem|canvien|passa|passem|passen|ara|nova hora|cambio|cambia|ahora|pasa|pasamos)\b/;
// Totes les hores que consten al text: 18:30, 18.30, 18h30, 18h, "les sis de la tarda".
function extractTimes(source){
  const src=clean(source),out=[];let m;
  const push=(h,mi,index,end)=>{if(h>=0&&h<=23&&mi>=0&&mi<=59)out.push({h,m:mi,index,end});};
  const num=/(?<![\d:.,])(\d{1,2})\s*(?:[:.]\s*(\d{2})\s*h?(?:ores)?|h\s*(\d{2})|h(?:ores)?\b)(?!\d)/g;
  while((m=num.exec(src))!==null){const h=+m[1],mi=m[2]!==undefined?+m[2]:(m[3]!==undefined?+m[3]:0);
    // "18.30" sense "h" només compta si el context és d'hora (a les/de les/hora) per no confondre imports.
    if(m[2]!==undefined&&/\.\s*\d{2}/.test(m[0])&&!/h/.test(m[0])&&!/(?:les|las|hora|a|de|fins|sobre)\s*$/.test(src.slice(Math.max(0,m.index-8),m.index)))continue;
    push(h,mi,m.index,m.index+m[0].length);}
  const words=new RegExp('\\b(?:les|la|las|a les|a la)\\s+(una|dues|dos|tres|quatre|cinc|sis|set|vuit|nou|deu|onze|dotze|\\d{1,2})\\s+(?:en punt\\s+)?(?:de la|del|de)\\s+(matinada|mati|tarda|nit|migdia|manana|noche)\\b','g');
  while((m=words.exec(src))!==null){
    let h=/^\d+$/.test(m[1])?+m[1]:NUMWORD[m[1]];if(!h)continue;
    const part=m[2];
    if((part==='tarda'||part==='nit'||part==='noche')&&h<12)h+=12;
    else if(part==='migdia'&&h<=3)h+=12;
    push(h===24?0:h,0,m.index,m.index+m[0].length);}
  return out.sort((a,b)=>a.index-b.index);
}
// Hores substituïdes: «de les 16h a les 18:30» o «no a les 16h» quan hi ha un indici de canvi.
function supersededTimes(source,times){
  const src=clean(source);if(!CHANGE_CUE.test(src))return new Set();
  const old=new Set();
  times.forEach((t,i)=>{
    const before=src.slice(Math.max(0,t.index-14),t.index);
    const next=times[i+1];
    const between=next?src.slice(t.end,next.index):'';
    if(/\bno\s+(?:a\s+)?(?:les|las)?\s*$/.test(before))old.add(i);
    else if(next&&/\b(?:de|desde)\s+(?:les|las)?\s*$/.test(before)&&/^\s*(?:a|->|→|passa a|ara a|pasa a|ahora a)\b/.test(between)&&between.length<24)old.add(i);
  });
  return old;
}
function rebaseVerifiedTime(raw,expected,source){
  if(typeof raw!=='string')return expected;
  const dateTime=/^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})$/.exec(raw);
  if(!dateTime)return expected;
  const h=+dateTime[1], m=+dateTime[2];
  if(h>23||m>59)return expected;
  const times=extractTimes(source);
  if(!times.length)return expected;                 // hora no verificable al text: només data
  const old=supersededTimes(source,times);
  const live=times.filter((t,i)=>!old.has(i));
  const hit=live.find(t=>t.h===h&&t.m===m);
  const pick=hit||(live.length===1?live[0]:null);   // hora vella o inventada: usa l'única hora vigent
  return pick?expected+' '+String(pick.h).padStart(2,'0')+':'+String(pick.m).padStart(2,'0'):expected;
}
// Dia de la setmana + número sense mes («diumenge 13»): propera data real del calendari.
function resolveWeekdayNumber(weekdayName,day,fromISO,maxMonths){
  const w=WD[clean(weekdayName)];if(w===undefined||!(day>=1&&day<=31))return null;
  const base=new Date(fromISO+'T12:00:00Z');
  for(let k=0;k<(maxMonths||18);k++){
    const d=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+k,day,12));
    if(d.getUTCDate()!==day)continue;               // mes sense aquest dia (p. ex. 31 de novembre)
    const isoD=iso(d);
    if(isoD>=fromISO&&d.getUTCDay()===w)return isoD;
  }
  return null;
}
// "18:00 o 19:00" is an unresolved alternative, unlike the range "de 18:00 a 19:00".
function alternativeHours(source){
  const src=clean(source), found=extractTimes(source), alternatives=new Set();
  for(let i=0;i<found.length-1;i++){
    const left=found[i],right=found[i+1];
    const between=src.slice(left.end,right.index);
    if(between.length>28)continue;
    if(/^\s*(?:o|u|\/)(?:\s+be)?(?:\s+(?:a\s+)?(?:les|las))?\s*$/.test(between)){
      alternatives.add(String(left.h).padStart(2,'0')+':'+String(left.m).padStart(2,'0'));
      alternatives.add(String(right.h).padStart(2,'0')+':'+String(right.m).padStart(2,'0'));
    }
  }
  return [...alternatives];
}
module.exports={relativeHints,rebaseVerifiedTime,upcomingWeekday,extractTimes,resolveWeekdayNumber,alternativeHours};
