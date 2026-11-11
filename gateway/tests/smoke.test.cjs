'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/webhook.js');
const {enabled,ALLOWED_BRANCH,makeHttpHandler}=require('../lib/http-handler.cjs');

function response(){
  const headers={};
  return {
    statusCode:200,headers,body:undefined,
    setHeader(k,v){headers[k.toLowerCase()]=v;},
    end(v){this.body=v;}
  };
}
function request(method){
  let reads=0;
  return {
    method,headers:{},
    get reads(){return reads;},
    get body(){throw new Error('should never parse an incoming body');},
    async *[Symbol.asyncIterator](){reads++;yield Buffer.from('{}');}
  };
}
test('standalone gateway loads raw-body serverless function without secrets',()=>{
  assert.equal(typeof handler,'function');
  assert.deepEqual(handler.config,{api:{bodyParser:false}});
});
test('public GET exposes only safe, disabled metadata',async()=>{
  const req=request('GET'),res=response();
  await handler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(req.reads,0);
  const body=JSON.parse(res.body);
  assert.equal(body.productionEnabled,false);
  assert.equal(body.metadataReceiptsEnabled,false);
  assert.equal(body.emailBodiesFetched,false);
  assert.equal(body.databaseConnectivityVerified,false);
  assert.equal(res.headers['cache-control'],'no-store, private');
  assert.doesNotMatch(res.body,/secret|password|apiKey|familyId|databaseUrl/i);
});
test('public POST is blocked before reading bytes when the feature is off',async()=>{
  const req=request('POST'),res=response();
  await handler(req,res);
  assert.equal(res.statusCode,503);
  assert.deepEqual(JSON.parse(res.body),{error:'pilot_disabled'});
  assert.equal(req.reads,0);
});
test('neither production nor another branch may activate gateway',()=>{
  assert.equal(enabled({vercelEnv:'production',gitRef:ALLOWED_BRANCH,enabled:'true'}),false);
  assert.equal(enabled({vercelEnv:'preview',gitRef:'main',enabled:'true'}),false);
  assert.equal(enabled({vercelEnv:'preview',gitRef:ALLOWED_BRANCH,enabled:'false'}),false);
});
test('signed-looking event still cannot create a DB adapter when public pilot is disabled',async()=>{
  let adapters=0;
  const custom=makeHttpHandler({
    config:{vercelEnv:'preview',gitRef:ALLOWED_BRANCH,enabled:'false',configured:true},
    createAdapters:async()=>{adapters++;throw new Error('should not run');}
  });
  const req=request('POST'),res=response();
  await custom(req,res);
  assert.equal(res.statusCode,503);
  assert.equal(adapters,0);
  assert.equal(req.reads,0);
});
