'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const requireFromHere=createRequire(__filename);
const callbackPath=requireFromHere.resolve('../api/gmail/pilot/callback.js');
const oauthPath=requireFromHere.resolve('../lib/gmail/browser-oauth.cjs');
const previewPath=requireFromHere.resolve('../lib/gmail/preview-import.cjs');
const serverPath=requireFromHere.resolve('../lib/gmail/private-server.cjs');

function response(){
  const headers={};
  return {
    headers,code:null,body:null,
    setHeader(name,value){headers[name.toLowerCase()]=value;return this;},
    status(code){this.code=code;return this;},
    json(body){this.body=body;return this;}
  };
}
function withSyntheticHandler(stubs,fn){
  const paths=[callbackPath,oauthPath,previewPath,serverPath];
  const saved=new Map(paths.map(path=>[path,require.cache[path]]));
  try{
    // Only this local process uses the temporary mock dependencies.
    // No Google OAuth, Neon, external fetch, or credentials are accessed.
    delete require.cache[callbackPath];
    require.cache[oauthPath]={id:oauthPath,filename:oauthPath,loaded:true,exports:{
      clearStateCookie:()=> '__Host-nxl_gmail_state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
      completeBrowserOAuth:stubs.completeBrowserOAuth
    }};
    require.cache[previewPath]={id:previewPath,filename:previewPath,loaded:true,exports:{
      previewLabeledMail:stubs.previewLabeledMail
    }};
    require.cache[serverPath]={id:serverPath,filename:serverPath,loaded:true,exports:{
      config:()=>({
        clientId:'synthetic-client',clientSecret:'synthetic-secret',
        redirectUri:'https://pilot.example/api/gmail/pilot/callback',
        origin:'https://pilot.example'
      }),
      takeBrowserIntent:async()=>{throw Error('unexpected real intent lookup');},
      currentFamilyConsent:async()=>true
    }};
    const handler=require(callbackPath);
    return fn(handler);
  }finally{
    for(const path of paths){
      const item=saved.get(path);
      if(item)require.cache[path]=item;
      else delete require.cache[path];
    }
  }
}
const preview=()=>({
  status:'preview_only',familyId:'10000000-0000-4000-8000-000000000001',
  googleEmail:'pilot@example.invalid',reviewedMessages:2,skippedUnsupported:0,
  drafts:[
    {source:'gmail',sourceEventHash:'a'.repeat(64),title:'Sortida escolar',
      from:'escola@example.invalid',bodyExcerpt:'Sortida el dia 14 de març.',
      status:'pending_review',hasBeenAnalyzedByAI:false,trustedInstructions:false},
    {source:'gmail',sourceEventHash:'b'.repeat(64),title:'Pagament colònies',
      from:'escola@example.invalid',bodyExcerpt:'Pagament abans del 15 de maig.',
      status:'pending_review',hasBeenAnalyzedByAI:false,trustedInstructions:false}
  ],
  sideEffects:{databaseWrites:false,gmailWrites:false,calendarWrites:false,aiCalls:false}
});
const validRequest=()=>({
  method:'GET',headers:{host:'pilot.example',cookie:'synthetic-browser-cookie'},
  query:{state:'synthetic-state',code:'synthetic-code'}
});
test('real HTTP callback returns exactly two synthetic preview drafts after authorized callback',async()=>{
  const calls=[];
  await withSyntheticHandler({
    async completeBrowserOAuth(input){
      calls.push('oauth');
      assert.equal(input.code,'synthetic-code');
      await input.onAuthorized({
        familySession:{kind:'family-session',verifiedByServer:true,
          familyId:preview().familyId,authUserId:'20000000-0000-4000-8000-000000000001',
          sessionId:'synthetic-session'},
        googleAccount:{sub:'123456789012',email:'pilot@example.invalid'},
        accessToken:'ephemeral-synthetic-token'
      });
      return {status:'authorized_for_single_pilot_action'};
    },
    async previewLabeledMail(input){
      calls.push('preview');
      assert.equal(input.accessToken,'ephemeral-synthetic-token');
      return preview();
    }
  },async handler=>{
    const res=response();
    await handler(validRequest(),res);
    assert.equal(res.code,200);
    assert.deepEqual(res.body,preview());
    assert.deepEqual(calls,['oauth','preview']);
    assert.equal(res.headers['cache-control'],'no-store, private');
    assert.equal(res.headers['referrer-policy'],'no-referrer');
    assert.equal(res.headers['x-robots-tag'],'noindex, nofollow');
    assert.match(res.headers['set-cookie'],/Max-Age=0/);
    assert.doesNotMatch(JSON.stringify(res.body),/ephemeral-synthetic-token|synthetic-secret/);
  });
});
test('HTTP callback refuses cross-origin host before consuming OAuth or reading Gmail',async()=>{
  let invoked=false;
  await withSyntheticHandler({
    async completeBrowserOAuth(){invoked=true;throw Error('must not be called');},
    async previewLabeledMail(){invoked=true;throw Error('must not be called');}
  },async handler=>{
    const res=response();
    await handler({...validRequest(),headers:{host:'attacker.example'}},res);
    assert.equal(res.code,403);
    assert.equal(res.body.error,'origin_not_allowed');
    assert.equal(invoked,false);
  });
});
test('HTTP callback denies revoked consent without leaking preview or token',async()=>{
  await withSyntheticHandler({
    async completeBrowserOAuth(input){
      await input.onAuthorized({
        familySession:{kind:'family-session',verifiedByServer:true,
          familyId:preview().familyId,authUserId:'20000000-0000-4000-8000-000000000001',
          sessionId:'synthetic-session'},
        googleAccount:{sub:'123456789012',email:'pilot@example.invalid'},
        accessToken:'secret-synthetic-token'
      });
      return {status:'authorized_for_single_pilot_action'};
    },
    async previewLabeledMail(){throw Error('gmail_consent_revoked');}
  },async handler=>{
    const res=response();
    await handler(validRequest(),res);
    assert.equal(res.code,403);
    assert.deepEqual(res.body,{error:'oauth_denied_or_expired'});
    assert.doesNotMatch(JSON.stringify(res.body),/secret-synthetic-token|Sortida escolar/);
  });
});
test('HTTP callback returns generic error when preview is unavailable, never partial email',async()=>{
  await withSyntheticHandler({
    async completeBrowserOAuth(){return {status:'authorized_for_single_pilot_action'};},
    async previewLabeledMail(){throw Error('unexpected preview');}
  },async handler=>{
    const res=response();
    await handler(validRequest(),res);
    assert.equal(res.code,503);
    assert.deepEqual(res.body,{error:'pilot_preview_unavailable'});
  });
});
