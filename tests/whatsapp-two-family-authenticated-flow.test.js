'use strict';
// Synthetic authenticated two-family flow. No production IdP, Neon or Meta.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createVerifiedServerSessionResolver}=
  require('../lib/whatsapp/verified-server-session');
const {createRequestBoundConsentRevoker}=
  require('../lib/whatsapp/request-bound-consent-revoker');
const {LOCK_MEMBERSHIP_SQL}=
  require('../lib/whatsapp/transactional-family-authorization');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const NOW=1800000000000;
const issuer='https://example-idp.test', audience='nexlupa-backend';

function setup() {
  const key=randomBytes(32).toString('base64');
  const members=[
    {userId:'admin-a',familyId:A,role:'admin',active:true,revoked:false},
    {userId:'admin-b',familyId:B,role:'admin',active:true,revoked:false},
    {userId:'member-b',familyId:B,role:'member',active:true,revoked:false}
  ];
  const binding=[
    {familyId:A,authorizationId:101,businessAccountId:'555551111',
      phoneNumberId:'666661111',senderWaId:'34611111111'},
    {familyId:B,authorizationId:202,businessAccountId:'555552222',
      phoneNumberId:'666662222',senderWaId:'34622222222'}
  ].map(x=>({...x,
    digest:createHmac('sha256',Buffer.from(key,'base64')).update(x.senderWaId).digest('hex'),
    revoked:false,content:2
  }));
  const persisted=binding.map(x=>({...x}));
  const sessions={
    'request-a':{subject:'admin-a',sessionId:'session-a'},
    'request-b':{subject:'admin-b',sessionId:'session-b'},
    'request-b-member':{subject:'member-b',sessionId:'session-member-b'}
  };
  const log=[];

  const db={async connect(){
    let working=null;
    return {
      async query(sql,params) {
        log.push({sql,params});
        if(sql==='BEGIN'){working=persisted.map(x=>({...x}));return {};}
        if(sql==='ROLLBACK'){working=null;return {};}
        if(sql==='COMMIT'){
          if(!working)throw Error('commit without transaction');
          for(let i=0;i<persisted.length;i++)Object.assign(persisted[i],working[i]);
          working=null;return {};
        }
        if(!working)throw Error('operation outside transaction');
        if(sql===LOCK_MEMBERSHIP_SQL) {
          const [userId,familyId,action]=params;
          const m=members.find(x=>x.userId===userId && x.familyId===familyId &&
            x.active && !x.revoked);
          return {rows:[{allowed:Boolean(m && action==='revoke_whatsapp_consent' &&
            ['owner','admin'].includes(m.role))}]};
        }
        if(sql.includes('UPDATE nex_whatsapp_sender_authorizations')){
          const [authorizationId,familyId,businessAccountId,phoneNumberId,digest]=params;
          const row=working.find(x=>x.authorizationId===authorizationId &&
            x.familyId===familyId && x.businessAccountId===businessAccountId &&
            x.phoneNumberId===phoneNumberId && x.digest===digest.toString('hex') &&
            !x.revoked);
          if(row)row.revoked=true;
          return {rowCount:row?1:0};
        }
        if(sql.includes('DELETE FROM nex_whatsapp_inbound')){
          const [familyId,businessAccountId,phoneNumberId,digest]=params;
          const row=working.find(x=>x.familyId===familyId &&
            x.businessAccountId===businessAccountId &&
            x.phoneNumberId===phoneNumberId && x.digest===digest.toString('hex'));
          const count=row?row.content:0;
          if(row)row.content=0;
          return {rowCount:count};
        }
        throw Error('Unexpected query');
      },
      release(){}
    };
  }};

  function request(id) {
    const context=Object.freeze({opaqueServerRequestId:id});
    const getAuthenticatedSession=createVerifiedServerSessionResolver({
      requestContext:context,issuer,audience,now:()=>NOW,
      verifyRequestSession:async c=>{
        const s=sessions[c.opaqueServerRequestId];
        return s?{verified:true,issuer,audience,subject:s.subject,
          sessionId:s.sessionId,issuedAtMs:NOW-10000,expiresAtMs:NOW+10000}:null;
      }
    });
    const revoke=createRequestBoundConsentRevoker({
      db,senderHmacKey:key,getAuthenticatedSession,now:()=>NOW,
      getMembership:async({userId,familyId})=>
        members.find(m=>m.userId===userId&&m.familyId===familyId)||null
    });
    return revoke;
  }

  return {
    request,persisted,log,members,sessions,
    consentA:{...binding[0]},consentB:{...binding[1]},
    input:x=>({familyId:x.familyId,authorizationId:x.authorizationId,
      businessAccountId:x.businessAccountId,phoneNumberId:x.phoneNumberId,
      senderWaId:x.senderWaId})
  };
}

test('two independently verified families revoke their own records only',async()=>{
  const e=setup();
  const a=e.request('request-a'), b=e.request('request-b');
  assert.deepEqual(await a(e.input(e.consentA)),{state:'revoked',deletedMessages:2});
  assert.equal(e.persisted[0].revoked,true);
  assert.equal(e.persisted[0].content,0);
  assert.equal(e.persisted[1].revoked,false,'A changed B consent');
  assert.equal(e.persisted[1].content,2,'A deleted B messages');
  assert.deepEqual(await b(e.input(e.consentB)),{state:'revoked',deletedMessages:2});
  assert.equal(e.persisted[1].revoked,true);
  assert.equal(e.persisted[1].content,0);
});
test('forged actor role and family cannot authorize cross-family consent changes',async()=>{
  const e=setup();
  await assert.rejects(e.request('request-a')({
    ...e.input(e.consentB),actor:{authenticated:true,role:'owner',userId:'admin-b'},
    userId:'admin-b',sessionId:'session-b'
  }),/verified family administrator/);
  assert.equal(e.persisted[0].revoked,false);
  assert.equal(e.persisted[1].revoked,false);
  assert.equal(e.log.length,0,'Denied before DB transaction');
});
test('ordinary family B member cannot revoke consent',async()=>{
  const e=setup();
  await assert.rejects(e.request('request-b-member')(e.input(e.consentB)),
    /verified family administrator/);
  assert.equal(e.persisted[1].content,2);
  assert.equal(e.log.length,0);
});
test('revoked family membership refuses reauthorization without changing either family',async()=>{
  const e=setup();
  const admin=e.members.find(x=>x.userId==='admin-a');
  admin.active=false;admin.revoked=true;
  await assert.rejects(e.request('request-a')(e.input(e.consentA)),
    /verified family administrator/);
  assert.equal(e.persisted[0].revoked,false);
  assert.equal(e.persisted[1].revoked,false);
});
test('session replacement stops the request before mutation',async()=>{
  const e=setup();
  const a=e.request('request-a');
  // Simulate IdP denying the still-open request before a fresh operation.
  e.sessions['request-a']=undefined;
  await assert.rejects(a(e.input(e.consentA)),/Verified active server session required/);
  assert.equal(e.log.length,0);
});
