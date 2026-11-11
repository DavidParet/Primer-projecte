'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePilotStartRequest}=require('../lib/gmail/http-guards.cjs');

const familyId='10000000-0000-4000-8000-000000000001';
const origin='https://pilot.nexlupa.example';
const jwt='Bearer abc.def.ghi';
const req=()=>({method:'POST',headers:{
  origin,host:'pilot.nexlupa.example',
  'content-type':'application/json',
  'content-length':'62',
  authorization:jwt
},body:{familyId}});
function denied(changes,code){
  const q=req();
  const updated={...q,...changes,headers:{...q.headers,...changes.headers}};
  const response=validatePilotStartRequest(updated,origin);
  assert.equal(response.ok,false);
  assert.equal(response.status,code);
}
test('accepts only a well-formed family-bound JSON POST from fixed HTTPS origin',()=>{
  assert.deepEqual(validatePilotStartRequest(req(),origin),{ok:true,familyId});
});
test('accepts explicit UTF-8 JSON content type without changing identity',()=>{
  const q=req();q.headers['content-type']='application/json; charset=UTF-8';
  assert.deepEqual(validatePilotStartRequest(q,origin),{ok:true,familyId});
});
test('blocks GET instead of initiating consent in background',()=>denied({method:'GET'},405));
test('blocks forged Origin without touching identity',()=>denied({headers:{origin:'https://attacker.example'}},403));
test('blocks same Origin with forged Host header',()=>denied({headers:{host:'attacker.example'}},403));
test('blocks missing Origin as anti-CSRF defense',()=>denied({headers:{origin:undefined}},403));
test('blocks form-encoded requests',()=>denied({headers:{'content-type':'application/x-www-form-urlencoded'}},415));
test('blocks text/plain requests',()=>denied({headers:{'content-type':'text/plain'}},415));
test('blocks missing JSON content type',()=>denied({headers:{'content-type':undefined}},415));
test('blocks oversized request bodies',()=>denied({headers:{'content-length':'1000000'}},413));
test('blocks negative or malformed Content-Length',()=>{
  for(const size of ['-1','not-a-number','Infinity']){
    denied({headers:{'content-length':size}},413);
  }
});
test('rejects extra keys pretending to verify family membership',()=>denied({body:{familyId,verifiedByServer:true}},400));
test('rejects family selector that is not a UUID',()=>denied({body:{familyId:'any'}},400));
test('rejects array and null request bodies',()=>{
  denied({body:[{familyId}]},400);
  denied({body:null},400);
});
test('rejects missing Authorization bearer',()=>denied({headers:{authorization:undefined}},401));
test('rejects raw or repeated authorization tokens',()=>{
  for(const authorization of ['Basic abc','Bearer a.b.c, Bearer z.x.y','Bearer bad-token','Bearer a.b.c\n']){
    denied({headers:{authorization}},401);
  }
});
test('rejects non-HTTPS or path-bearing expected origin before trusting the client',()=>{
  const a=validatePilotStartRequest(req(),'http://pilot.nexlupa.example');
  const b=validatePilotStartRequest(req(),origin+'/something');
  assert.equal(a.status,503);assert.equal(b.status,503);
});
test('never accepts origin + path injected in the trusted-origin setting',()=>{
  const x=validatePilotStartRequest(req(),'https://pilot.nexlupa.example/?redirect=attacker');
  assert.deepEqual(x,{ok:false,status:503,error:'pilot_not_configured'});
});

test('rejects ambiguous or coerced HTTP Content-Length before OAuth start',()=>{
  for(const value of [undefined,null,'',' ','0x3e','6.2','+62','062','62 ','1e2',62,true,['62'],{},'9007199254740993']) {
    denied({headers:{'content-length':value}},413);
  }
});
test('accepts canonical zero Content-Length only as a numeric wire header',()=>{
  const q=req();q.headers['content-length']='0';
  assert.equal(validatePilotStartRequest(q,origin).ok,true);
});
