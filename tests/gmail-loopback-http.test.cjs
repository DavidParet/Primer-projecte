'use strict';
// Real loopback HTTP contract for the disabled Gmail pilot. No external traffic,
// OAuth credentials, Gmail messages or database connection are ever used.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const preflight=require('../api/gmail/pilot-auth.js');
const start=require('../api/gmail/pilot/start.js');
const callback=require('../api/gmail/pilot/callback.js');

function adapter(res) {
  res.status=function(code){res.statusCode=code;return res;};
  res.json=function(value){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify(value));return res;
  };
  return res;
}
function readRequest(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>{
      body+=chunk;
      if(body.length>2048) {req.destroy();reject(new Error('oversized_fixture'));}
    });
    req.on('end',()=>resolve(body));
    req.on('error',reject);
  });
}
test('loopback HTTP: disabled Gmail endpoints deny unauthorized requests without leaking data',async t=>{
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      const handlers={
        '/api/gmail/pilot-auth':preflight,
        '/api/gmail/pilot/start':start,
        '/api/gmail/pilot/callback':callback
      };
      const handler=handlers[url.pathname];
      if(!handler){res.writeHead(404);res.end();return;}
      const raw=await readRequest(req);
      const body=raw?JSON.parse(raw):undefined;
      await handler(Object.assign(req,{
        body,query:Object.fromEntries(url.searchParams)
      }),adapter(res));
    }catch(error){res.statusCode=500;res.end('fixture_failure');}
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve())));
  const address=server.address();
  const origin='http://127.0.0.1:'+address.port;
  const cases=[
    {path:'/api/gmail/pilot-auth',method:'POST',expected:503,code:'pilot_disabled'},
    {path:'/api/gmail/pilot/start',method:'GET',expected:405,code:'method_not_allowed'},
    {path:'/api/gmail/pilot/callback?code=synthetic-secret&state=synthetic-state',
      method:'POST',expected:405,code:'method_not_allowed'},
    {path:'/api/gmail/pilot/callback?code=synthetic-secret&state=synthetic-state',
      method:'GET',expected:503,code:'gmail_pilot_unavailable'}
  ];
  for(const entry of cases){
    const response=await fetch(origin+entry.path,{
      method:entry.method,
      headers:{'Content-Type':'application/json','Authorization':'Bearer synthetic-token'},
      ...(entry.method==='POST'?{body:JSON.stringify({familyId:'synthetic-family'})}:{})
    });
    const body=await response.text();
    assert.equal(response.status,entry.expected,entry.path);
    assert.equal(JSON.parse(body).error,entry.code,entry.path);
    assert.match(response.headers.get('cache-control')||'',/no-store/);
    assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
    assert.doesNotMatch(body,/synthetic-secret|synthetic-token|synthetic-family/);
    if(entry.path.startsWith('/api/gmail/pilot/callback')){
      assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/);
    }
  }
});
