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
  return {status:String(target).endsWith('/start')?405:503,
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
