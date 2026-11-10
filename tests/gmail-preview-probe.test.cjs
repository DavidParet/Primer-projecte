'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {probe}=require('../scripts/probe-gmail-preview.cjs');
const url='https://primer-projecte-7c7ybte0k-davidparets-projects.vercel.app';
test('rejects unsafe preview targets before network',async()=>{
 for(const target of ['http://primer-projecte-x.vercel.app','https://evil.example',
  'https://primer-projecte-x.vercel.app/path',
  'https://primer-projecte-x.vercel.app/?token=secret',
  'https://user:pass@primer-projecte-x.vercel.app']){
  await assert.rejects(probe(target,()=>{throw Error('network must not run');}),/not_allowed/);
 }
});
test('only performs unauthenticated GET requests with redirects disabled',async()=>{
 const calls=[];
 const result=await probe(url,async (target,options)=>{
  calls.push({target:String(target),options});
  return {status:String(target).endsWith('/start')?405:String(target).endsWith('/callback')?400:200,
    headers:{get:()=> 'application/json; charset=utf-8'}};
 });
 assert.equal(calls.length,3);
 assert.equal(result.fullyVerified,true);
 for(const {target,options} of calls){
  assert.ok(target.startsWith(url+'/api/gmail/'));
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'manual');
  assert.equal(options.credentials,'omit');
  assert.equal(options.headers.Authorization,undefined);
 }
});
test('Vercel access wall is not counted as functional HTTP proof',async()=>{
 const result=await probe(url,async()=>({
  status:401,headers:{get:()=> 'text/html'}
 }));
 assert.equal(result.fullyVerified,false);
 assert.ok(result.results.every(x=>x.protectedByVercel));
});

test('preview probe does not claim success when preflight is unavailable',async()=>{
 const result=await probe(url,async target=>({
  status:String(target).endsWith('/start')?405:503,
  headers:{get:()=> 'application/json'}
 }));
 assert.equal(result.fullyVerified,false);
 assert.equal(result.results[0].routeVerified,false);
 assert.equal(result.results[1].routeVerified,true);
 assert.equal(result.results[2].routeVerified,false);
});
test('preview probe requires all three routes, not just a working method guard',async()=>{
 const result=await probe(url,async target=>({
  status:String(target).endsWith('/start')?405:
    String(target).endsWith('/callback')?400:404,
  headers:{get:()=> 'application/json'}
 }));
 assert.equal(result.fullyVerified,false);
});
