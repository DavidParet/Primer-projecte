'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {normalizeAnalysis}=require('../lib/nexlupa-result');
const source=fs.readFileSync(path.join(__dirname,'../app/script.js'),'utf8');
function functionSource(name){
  const m=source.match(new RegExp('^function '+name+'\\([^]*?^\\}', 'm'));
  assert.ok(m,'Falta la funcio real de frontend: '+name);
  return m[0];
}
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.textContent='';this.className='';}
  appendChild(child){this.children.push(child);return child}
}
function dom(){
  const ids=new Map();
  const ctx={
    document:{
      createElement:tag=>new Element(tag),
      getElementById:id=>{if(!ids.has(id))ids.set(id,new Element('div'));return ids.get(id)}
    },
    splitDateTime:date=>date?{date:'14 novembre',time:null}:{date:null,time:null},
    calcDiesRestants:()=>null,
    canOpenMaps:()=>false,
    formatActionDate:v=>v,
    _buildLlocLink:lloc=>{const el=new Element('span');el.textContent=lloc;return el},
    _lastData:null
  };
  vm.createContext(ctx);
  for(const name of ['addActionToCalendar','_buildCalBtn','buildEventCard','buildActionCard','renderUsefulData'])
    vm.runInContext(functionSource(name),ctx,{filename:'app/script.js'});
  return ctx;
}
function labels(el){
  return [el.textContent,...el.children.flatMap(labels)].filter(Boolean).join(' | ');
}
function hasCalendarButton(el){
  return el.children.some(c=>/cal/.test(c.className)&&c.tagName==='BUTTON' || hasCalendarButton(c));
}
test('F1 · suspensió es mostra sense botó de Google Calendar',()=>{
  const ctx=dom();
  const el=ctx.buildEventCard({title:'Partit',data:null,dataOriginal:'2026-11-14',estat:'suspes'});
  assert.match(labels(el),/Activitat suspesa/);
  assert.match(labels(el),/2026-11-14/);
  assert.equal(hasCalendarButton(el),false);
});
test('F2 · recurrència no es presenta com a cita única',()=>{
  const ctx=dom();
  const el=ctx.buildEventCard({title:'Ball',data:null,estat:'recurrent'});
  assert.match(labels(el),/Activitat recurrent/);
  assert.equal(hasCalendarButton(el),false);
});
test('F3 · dates interpretades i passades no permeten exportar calendari',()=>{
  const ctx=dom();
  for(const flags of [{dataDubtosa:true},{passada:true}]){
    const el=ctx.buildEventCard({title:'Assaig',data:'2026-12-13 10:00',...flags});
    assert.equal(hasCalendarButton(el),false);
    assert.match(labels(el),/confirm/);
  }
});
test('F4 · terminis vençuts i dates dubtoses bloquegen exportació de tasques',()=>{
  const ctx=dom();
  const a=ctx.buildActionCard({accio:'Pagar',tipus:'tasca',data:'2026-11-11',vençut:true},'nx-p1-card');
  assert.equal(hasCalendarButton(a),false);
  const b=ctx.buildActionCard({accio:'Portar bata',tipus:'tasca',data:'2026-11-13',dataDubtosa:true},'nx-p2-card');
  assert.equal(hasCalendarButton(b),false);
  assert.match(labels(b),/confirm/);
});
test('F5 · imatges i IBAN sospitosos mostren avís sense amagar dades',()=>{
  const ctx=dom();
  ctx.renderUsefulData({origenImatge:true,avisos:['IBAN no valid'],imports:['30 €']});
  const container=ctx.document.getElementById('nx-utils-content');
  assert.match(labels(container),/Dades llegides d’una imatge/);
  assert.match(labels(container),/IBAN no valid/);
  assert.match(labels(container),/30 €/);
});
test('B1 · si la IA oblida dir suspès en el títol, la data no es publica',()=>{
  const d=normalizeAnalysis({resum:'x',accions:[],esdeveniments:[{title:'Partit',data:'2026-11-14'}]},
    'Aquest dissabte el partit queda suspès. Ja us avisarem de la nova data.','2026-11-12');
  assert.equal(d.esdeveniments[0].estat,'suspes');
  assert.equal(d.esdeveniments[0].data,null);
  assert.equal(d.esdeveniments[0].dataOriginal,'2026-11-14');
});
test('B2 · una recurrència amb data al·lucinada queda sense cita única',()=>{
  const d=normalizeAnalysis({resum:'x',accions:[],esdeveniments:[{title:'Ball',data:'2026-11-17'}]},
    'Tots els dimarts, classe de ball a les 17h','2026-11-12');
  assert.equal(d.esdeveniments[0].estat,'recurrent');
  assert.equal(d.esdeveniments[0].data,null);
});
test('B3 · una data corregida a partir de dia+numero és provisional',()=>{
  const d=normalizeAnalysis({resum:'x',accions:[],esdeveniments:[{title:'Assaig',data:'2026-11-13'}]},
    'Assaig diumenge 13 a les 10h','2026-11-12');
  assert.equal(d.esdeveniments[0].data,'2026-12-13');
  assert.equal(d.esdeveniments[0].dataDubtosa,true);
  assert.equal(d.revisioDates.requereixRevisio,true);
});
test('B4 · les dates passades sense any activen revisió',()=>{
  const d=normalizeAnalysis({resum:'x',accions:[],esdeveniments:[{title:'Excursió',data:'2026-05-04'}]},
    'Excursió el 4 de maig','2026-11-12');
  assert.equal(d.esdeveniments[0].passada,true);
  assert.equal(d.revisioDates.requereixRevisio,true);
});
