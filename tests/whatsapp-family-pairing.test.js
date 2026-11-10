'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHmac}=require('node:crypto');
const {createFamilyPairingIssuer,CREATE_PAIRING_SQL}=
  require('../lib/whatsapp/family-pairing-issuer');
const {createMetaPairingConfirmer,ALREADY_RECEIVED_SQL,LOCK_CHALLENGE_SQL,
  CURRENT_ADMIN_SQL,CONSUME_CHALLENGE_SQL,INSERT_CONSENT_SQL,
  INSERT_RECEIPT_SQL}=
  require('../lib/whatsapp/meta-pairing-confirmation');
const {newPairingCode,parseAcceptanceCommand,pairingDigest,CODE_PATTERN,
  CONSENT_VERSION}=require('../lib/whatsapp/family-pairing-protocol');
const {LOCK_MEMBERSHIP_SQL}=
  require('../lib/whatsapp/transactional-family-authorization');

const family='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const business='744441234',phone='844441234',sender='34611111111';
const now=1800000000000;
const pairingHmacKey=randomBytes(32).toString('base64');
const senderHmacKey=randomBytes(32).toString('base64');
const metaAppSecret='synthetic-meta-app-secret';
const session={authenticated:true,userId:'admin-a',
  sessionId:'signed-session-a',expiresAtMs:now+60000,revoked:false};

function metaMessage(text='NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR',overrides={}){
  const raw=Buffer.from(JSON.stringify({
    object:'whatsapp_business_account',
    entry:[{id:business,changes:[{field:'messages',value:{
      metadata:{phone_number_id:phone},
      messages:[{
        id:'wamid.synthetic-pairing-1',from:sender,timestamp:'1794150000',
        type:'text',text:{body:text},...overrides
      }]
    }}]}]
  }));
  const signature='sha256='+createHmac('sha256',metaAppSecret)
    .update(raw).digest('hex');
  return {raw,signature};
}

function confirmationFixture({found=true,permission=true,received=false,
  causeError=null,challengeFamily=family}={}){
  const queries=[],args=[],state={commits:0,rollbacks:0,released:0};
  const client={
    async query(sql,params){
      queries.push(sql);args.push(params);
      if(causeError===sql)throw Error('synthetic SQL error');
      if(sql==='BEGIN')return {};
      if(sql==='ROLLBACK'){state.rollbacks++;return {};}
      if(sql==='COMMIT'){state.commits++;return {};}
      if(sql===ALREADY_RECEIVED_SQL)return {rows:received?[{ok:1}]:[]};
      if(sql===LOCK_CHALLENGE_SQL)return {rows:found?[{
        challenge_id:12,family_id:challengeFamily,requested_by:'admin-a',
        consent_version:CONSENT_VERSION
      }]:[]};
      if(sql===CURRENT_ADMIN_SQL)return {rows:[{allowed:permission}]};
      if(sql===CONSUME_CHALLENGE_SQL)return {rows:[{challenge_id:12}]};
      if(sql===INSERT_CONSENT_SQL)return {rows:[{authorization_id:23}]};
      if(sql===INSERT_RECEIPT_SQL)
        return {rows:[{provider_message_id:'wamid.synthetic-pairing-1'}]};
      throw Error('Unexpected SQL');
    },
    release(){state.released++;}
  };
  const db={async connect(){return client;}};
  const confirm=createMetaPairingConfirmer({
    db,metaAppSecret,senderHmacKey,pairingHmacKey
  });
  return {confirm,queries,args,state};
}

test('pairing challenge is 80-bit formatted code and command requires explicit ACCEPTA',()=>{
  const codes=new Set();
  for(let i=0;i<100;i++){
    const code=newPairingCode();
    assert.match(code,CODE_PATTERN);
    codes.add(code);
    assert.equal(parseAcceptanceCommand('NEXLUPA ACCEPTA '+code),code);
  }
  assert.equal(codes.size,100);
  for(const command of [
    'NEXLUPA VINCULA ABCD-EFGH-JKLM-NPQR',
    'NEXLUPA ACCEPTA NOT_A_CODE',
    'NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR MORE',
    'ABCD-EFGH-JKLM-NPQR',
    'NEXLUPA ACCEPTA ABCD-EFGH-JKLM-NPQR\nOTHER'
  ])assert.equal(parseAcceptanceCommand(command),null);
});
test('database digest binds code to exact WhatsApp business and phone',()=>{
  const args={code:'ABCD-EFGH-JKLM-NPQR',businessAccountId:business,
    phoneNumberId:phone,pairingKey:pairingHmacKey};
  const first=pairingDigest(args);
  assert.equal(first.length,32);
  assert.notDeepEqual(first,pairingDigest({...args,phoneNumberId:'844441235'}));
  assert.notDeepEqual(first,pairingDigest({...args,businessAccountId:'744441235'}));
  assert.notDeepEqual(first,pairingDigest({...args,code:'ABCD-EFGH-JKLM-NPQS'}));
});

test('only verified family admin can issue a challenge; phone is never stored',async()=>{
  const queries=[],args=[];
  const client={
    async query(sql,params){
      queries.push(sql);args.push(params);
      if(sql==='BEGIN'||sql==='COMMIT')return {};
      if(sql===LOCK_MEMBERSHIP_SQL)return {rows:[{allowed:true}]};
      if(sql===CREATE_PAIRING_SQL)
        return {rows:[{challenge_id:21,expires_at:new Date('2027-01-15T12:00:00Z')}]};
      throw Error('Unexpected query');
    },release(){}
  };
  const issue=createFamilyPairingIssuer({
    db:{connect:async()=>client},pairingHmacKey,
    getAuthenticatedSession:async()=>session,
    getMembership:async({userId,familyId})=>({
      userId,familyId,role:'admin',active:true,revoked:false
    }),now:()=>now
  });
  const result=await issue({familyId:family,businessAccountId:business,
    phoneNumberId:phone});
  assert.match(result.code,CODE_PATTERN);
  assert.match(result.instruction,/NEXLUPA ACCEPTA/);
  assert.equal(result.consentVersion,CONSENT_VERSION);
  assert.deepEqual(queries,['BEGIN',LOCK_MEMBERSHIP_SQL,CREATE_PAIRING_SQL,'COMMIT']);
  assert.deepEqual(args[2].slice(0,3),[family,business,phone]);
  assert.equal(Buffer.isBuffer(args[2][3]),true);
  assert.equal(args[2][3].length,32);
  assert.equal(args[2].includes(result.code),false);
  assert.equal(args[2].includes(sender),false);
});

test('cross-family or ordinary member cannot issue a pairing code',async()=>{
  for(const allowedRole of ['member','revoked']){
    let connected=0;
    const issue=createFamilyPairingIssuer({
      db:{connect:async()=>{connected++;throw Error('should not connect');}},
      pairingHmacKey,getAuthenticatedSession:async()=>session,
      getMembership:async()=>allowedRole==='member'?
        {userId:'admin-a',familyId:family,role:'member',active:true,revoked:false}:
        {userId:'admin-a',familyId:family,role:'admin',active:false,revoked:true},
      now:()=>now
    });
    await assert.rejects(issue({familyId:family,businessAccountId:business,
      phoneNumberId:phone}),/administrator/);
    assert.equal(connected,0);
  }
});

test('signed WhatsApp acceptance enrolls exactly one sender with no phone plaintext',async()=>{
  const f=confirmationFixture();
  const {raw,signature}=metaMessage();
  const result=await f.confirm(raw,signature);
  assert.deepEqual(result,{state:'paired'});
  assert.deepEqual(f.queries,[
    'BEGIN',ALREADY_RECEIVED_SQL,LOCK_CHALLENGE_SQL,CURRENT_ADMIN_SQL,
    CONSUME_CHALLENGE_SQL,INSERT_CONSENT_SQL,INSERT_RECEIPT_SQL,'COMMIT'
  ]);
  assert.deepEqual(f.args[3],['admin-a',family]);
  const enrollArgs=f.args[5];
  assert.equal(enrollArgs[0],family);
  assert.equal(enrollArgs[4],CONSENT_VERSION);
  assert.equal(enrollArgs[3].length,32);
  assert.equal(enrollArgs.includes(sender),false);
  assert.equal(enrollArgs.includes('ABCD-EFGH-JKLM-NPQR'),false);
  assert.equal(f.state.commits,1);assert.equal(f.state.released,1);
});

test('unsigned, altered and malformed requests cannot reach the pairing database',async()=>{
  const f=confirmationFixture(),{raw,signature}=metaMessage();
  assert.deepEqual(await f.confirm(raw,'sha256='+('0'.repeat(64))),
    {state:'rejected'});
  assert.deepEqual(await f.confirm(Buffer.from('{}'),signature),
    {state:'rejected'});
  assert.deepEqual(await f.confirm(Buffer.from('invalid JSON'),
    'sha256='+('0'.repeat(64))),{state:'rejected'});
  const forward=metaMessage('Missatge reenviat sobre colònies');
  assert.deepEqual(await f.confirm(forward.raw,forward.signature),
    {state:'ignored'});
  assert.equal(f.queries.length,0);
});

test('replayed provider message is handled without a second consent write',async()=>{
  const f=confirmationFixture({received:true});
  const {raw,signature}=metaMessage();
  assert.deepEqual(await f.confirm(raw,signature),
    {state:'already_processed'});
  assert.deepEqual(f.queries,['BEGIN',ALREADY_RECEIVED_SQL,'ROLLBACK']);
});

test('expired/consumed code and revoked admin cannot enroll',async()=>{
  const {raw,signature}=metaMessage();
  for(const f of [
    confirmationFixture({found:false}),
    confirmationFixture({permission:false})
  ]){
    assert.deepEqual(await f.confirm(raw,signature),{state:'rejected'});
    assert.equal(f.queries.includes(INSERT_CONSENT_SQL),false);
    assert.equal(f.state.rollbacks,1);
  }
});

test('database write failure rolls back used-code and consent in same transaction',async()=>{
  const f=confirmationFixture({causeError:INSERT_RECEIPT_SQL});
  const {raw,signature}=metaMessage();
  await assert.rejects(f.confirm(raw,signature),/synthetic SQL error/);
  assert.equal(f.state.rollbacks,1);assert.equal(f.state.commits,0);
  assert.equal(f.state.released,1);
});

test('sender and pairing secret must be independent',()=>{
  assert.throws(()=>createMetaPairingConfirmer({
    db:{connect:async()=>null},metaAppSecret,
    senderHmacKey,pairingHmacKey:senderHmacKey
  }),/Separate/);
});
