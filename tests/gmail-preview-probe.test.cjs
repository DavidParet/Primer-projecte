'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {probe,probeExitCode}=require('../scripts/probe-gmail-preview.cjs');
const url='https://primer-projecte-7c7ybte0k-davidparets-projects.vercel.app';

function mocked(status,body,contentType='application/json; charset=utf-8'){
  return {status,headers:{get:()=>contentType},json:async()=>body};
}
function fullResponse(target){
  const path=new URL(target).pathname;
  if(path.endsWith('/start')) return mocked(405,{error:'method_not_allowed'});
  if(path.endsWith('/callback')) return mocked(400,{error:'invalid_oauth_return'});
  return mocked(200,{ready:true,real_email_access:false});
}
function disabledResponse(target){
  const path=new URL(target).pathname;
  if(path.endsWith('/start')) return mocked(405,{error:'method_not_allowed'});
  if(path.endsWith('/callback')) return mocked(503,{error:'gmail_pilot_unavailable'});
  return mocked(503,{ready:false,error:'pilot_not_ready'});
}

test('rejects unsafe preview targets before network',async()=>{
  for(const target of [
    'http://primer-projecte-x.vercel.app','https://evil.example',
    'https://primer-projecte-x.vercel.app/path',
    'https://primer-projecte-x.vercel.app/?token=secret',
    'https://user:pass@primer-projecte-x.vercel.app'
  ]){
    await assert.rejects(probe(target,()=>{throw Error('network must not run');}),/not_allowed/);
  }
});

test('performs only unauthenticated GET requests and checks response contracts',async()=>{
  const calls=[];
  const result=await probe(url,async (target,options)=>{
    calls.push({target:String(target),options});
    return fullResponse(target);
  });
  assert.equal(calls.length,3);
  assert.equal(result.routeReachable,true);
  assert.equal(result.fullyVerified,true);
  assert.equal(result.phase,'configured_readiness');
  assert.ok(result.results.every(x=>x.ready && x.routeVerified));
  for(const {target,options} of calls){
    assert.ok(target.startsWith(url+'/api/gmail/'));
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.credentials,'omit');
    assert.equal(options.headers.Authorization,undefined);
    assert.ok(options.signal);
  }
});

test('guarded routes are reachable without falsely claiming Gmail is ready',async()=>{
  const result=await probe(url,async target=>disabledResponse(target));
  assert.equal(result.routeReachable,true);
  assert.equal(result.fullyVerified,false);
  assert.equal(result.phase,'guarded_not_ready');
  assert.equal(result.results[0].status,503);
  assert.equal(result.results[1].status,405);
  assert.equal(result.results[2].status,503);
  assert.equal(result.results[0].guarded,true);
  assert.equal(result.results[1].ready,true);
  assert.equal(result.results[2].guarded,true);
});

test('Vercel access wall is not counted as reachable HTTP',async()=>{
  const result=await probe(url,async()=>mocked(401,null,'text/html'));
  assert.equal(result.routeReachable,false);
  assert.equal(result.fullyVerified,false);
  assert.equal(result.phase,'deployment_protected');
  assert.equal(result.deploymentProtected,true);
  assert.ok(result.results.every(x=>x.protectedByVercel));
});

test('a generic 503, even as JSON, is not proof of a safely guarded route',async()=>{
  const result=await probe(url,async target=>{
    const path=new URL(target).pathname;
    return path.endsWith('/start')?fullResponse(target):mocked(503,{error:'server_error'});
  });
  assert.equal(result.routeReachable,false);
  assert.equal(result.fullyVerified,false);
  assert.equal(result.results[0].routeVerified,false);
  assert.equal(result.results[1].routeVerified,true);
  assert.equal(result.results[2].routeVerified,false);
});

test('invalid JSON, HTML, and missing routes fail closed',async()=>{
  const fixtures=[
    async target=>new URL(target).pathname.endsWith('/callback')
      ?mocked(503,{error:'gmail_pilot_unavailable'},'text/html')
      :disabledResponse(target),
    async target=>new URL(target).pathname.endsWith('/callback')
      ?{status:503,headers:{get:()=> 'application/json'},json:async()=>{throw Error('invalid_json');}}
      :disabledResponse(target),
    async target=>new URL(target).pathname.endsWith('/pilot-auth')
      ?mocked(404,{error:'not_found'})
      :disabledResponse(target)
  ];
  for(const fetchImpl of fixtures){
    const result=await probe(url,fetchImpl);
    assert.equal(result.routeReachable,false);
    assert.equal(result.fullyVerified,false);
  }
});

test('does not accept a 200 preflight lacking strict safe readiness fields',async()=>{
  const result=await probe(url,async target=>{
    const path=new URL(target).pathname;
    return path.endsWith('/pilot-auth')?mocked(200,{ready:true}):fullResponse(target);
  });
  assert.equal(result.routeReachable,false);
  assert.equal(result.fullyVerified,false);
});

test('results never copy response bodies or credentials',async()=>{
  const body={error:'server_error',accessToken:'synthetic_secret_do_not_show'};
  const result=await probe(url,async target=>{
    const path=new URL(target).pathname;
    return path.endsWith('/start')?fullResponse(target):mocked(503,body);
  });
  assert.doesNotMatch(JSON.stringify(result),/synthetic_secret_do_not_show/);
});

test('network failure on one route does not hide the other HTTP results',async()=>{
  const calls=[];
  const result=await probe(url,async target=>{
    const path=new URL(target).pathname;
    calls.push(path);
    if(path.endsWith('/start')) throw Error('synthetic_secret_must_not_leak');
    return fullResponse(target);
  });
  assert.equal(calls.length,3);
  assert.equal(result.results.length,3);
  assert.equal(result.results[0].ready,true);
  assert.equal(result.results[1].failure,'network_error');
  assert.equal(result.results[1].routeVerified,false);
  assert.equal(result.results[2].ready,true);
  assert.equal(result.routeReachable,false);
  assert.equal(result.fullyVerified,false);
  assert.equal(result.phase,'unverified');
  assert.doesNotMatch(JSON.stringify(result),/synthetic_secret_must_not_leak/);
});



test('partially protected or mixed HTTP responses stay unverified',async()=>{
  const result=await probe(url,async target=>
    new URL(target).pathname.endsWith('/callback')
      ?mocked(401,null,'text/html')
      :fullResponse(target));
  assert.equal(result.deploymentProtected,false);
  assert.equal(result.routeReachable,false);
  assert.equal(result.phase,'unverified');
});


test('CLI probe exit codes separate SSO and inactive pilot from unknown errors',async()=>{
  const tests=[
    [async()=>mocked(401,null,'text/html'),3,'deployment_protected'],
    [async target=>disabledResponse(target),4,'guarded_not_ready'],
    [async target=>fullResponse(target),0,'configured_readiness'],
    [async()=>mocked(502,{error:'bad_gateway'}),2,'unverified']
  ];
  for(const [fetchImpl,expected,phase] of tests){
    const result=await probe(url,fetchImpl);
    assert.equal(result.phase,phase);
    assert.equal(probeExitCode(result),expected);
  }
});
