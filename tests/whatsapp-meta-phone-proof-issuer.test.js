'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomBytes}=require('node:crypto');
const {createMetaPhoneProofIssuer,ISSUE_SQL,formatProofPermit,PURPOSE}=
 require('../lib/whatsapp/meta-phone-proof-issuer');
const {pairingDigest}=require('../lib/whatsapp/family-pairing-protocol');

const NOW=1800000000000;
const CODE='ABCD-EFGH-JKLM-NPQR';
const BUSINESS='755551111',PHONE='855551111',SENDER='34611111111';
const META_SECRET='ci-secret-without-live-meta';
const senderKey=randomBytes(32),pairingKey=randomBytes(32),
 proofKey=randomBytes(32),signingKey=randomBytes(32);
const KEY_ID='phone-proof-ci-v1';
function payload({code=CODE,business=BUSINESS,phone=PHONE,
 message='wamid.ci-meta-123',sender=SENDER,type='text',
 timestamp=Math.floor(NOW/1000),multiple=false,additionalStatus=false}={}){
 const messageObject={from:sender,id:message,timestamp:String(timestamp),
  type,text:{body:'NEXLUPA ACCEPTA '+code}};
 const messages=multiple?[messageObject,{...messageObject,id:'wamid.ci-extra-456'}]:
  [messageObject];
 return Buffer.from(JSON.stringify({
  object:'whatsapp_business_account',
  entry:[{id:business,changes:[{field:'messages',value:{
   metadata:{phone_number_id:phone},messages,
   ...(additionalStatus?{statuses:[{id:'wamid.ci-status'}]}:{})
  }}]}]
 }));
}
function sig(bytes){
 return 'sha256='+createHmac('sha256',META_SECRET).update(bytes).digest('hex');
}
function mock({dbState='verified',keyState='active',keyPurpose=PURPOSE,
  clock=()=>NOW,signing=signingKey}={}){
 const calls=[];let reads=0,releases=0;
 const db={async connect(){return {
  async query(sql,args){
   calls.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql!==ISSUE_SQL)throw new Error('Direct proof INSERT forbidden');
   if(dbState==='throw')throw new Error('CI database unavailable');
   return {rowCount:1,rows:[{result:{state:dbState}}]};
  },release(){releases++;}
 };}};
 const issuer=createMetaPhoneProofIssuer({
  db,metaAppSecret:META_SECRET,
  senderHmacKey:senderKey.toString('base64'),
  pairingHmacKey:pairingKey.toString('base64'),
  proofHmacKey:proofKey.toString('base64'),
  businessAccountId:BUSINESS,phoneNumberId:PHONE,now:clock,
  getActiveSigningKey:async purpose=>{
   reads++;
   assert.equal(purpose,PURPOSE);
   return {state:keyState,purpose:keyPurpose,keyId:KEY_ID,
     keyBase64:signing.toString('base64')};
  }
 });
 return {issuer,calls,get reads(){return reads;},
  get releases(){return releases;}};
}
test('valid RAW Meta HMAC -> signed restricted phone proof, never direct consent',async()=>{
 const f=mock(),raw=payload();
 assert.deepEqual(await f.issuer(raw,sig(raw)),{state:'verified'});
 assert.deepEqual(f.calls.map(x=>x.sql===ISSUE_SQL?'ISSUE':x.sql),
  ['BEGIN','ISSUE','COMMIT']);
 assert.equal(f.reads,1);assert.equal(f.releases,1);
 const args=f.calls[1].args;
 assert.deepEqual(args.slice(0,2),[BUSINESS,PHONE]);
 assert.deepEqual(args[2],pairingDigest({
  code:CODE,businessAccountId:BUSINESS,phoneNumberId:PHONE,pairingKey
 }));
 assert.deepEqual(args[3],createHmac('sha256',senderKey).update(SENDER).digest());
 assert.deepEqual(args[4],createHmac('sha256',proofKey)
  .update('nexlupa:phone-proof:v1:').update(CODE).digest());
 assert.equal(args[5],'wamid.ci-meta-123');
 assert.equal(args[6],KEY_ID);
 assert.equal(args[7],Math.floor(NOW/1000)+45);
 assert.deepEqual(args[9],createHmac('sha256',signingKey).update(
  formatProofPermit({keyId:KEY_ID,businessAccountId:BUSINESS,
    phoneNumberId:PHONE,codeDigest:args[2],senderDigest:args[3],
    proofDigest:args[4],providerMessageId:args[5],
    expiresAt:args[7],nonce:args[8]})).digest());
 assert.ok(!args.includes(CODE)&&!args.includes(SENDER)&&
  !args.includes('NEXLUPA ACCEPTA '+CODE));
});
test('Meta unsigned/modified request never reads keys nor touches database',async()=>{
 const f=mock(),raw=payload();
 assert.deepEqual(await f.issuer(raw,'sha256='+ '0'.repeat(64)),
   {state:'rejected'});
 assert.deepEqual(await f.issuer(Buffer.from(raw.toString().replace('ACCEPTA','ACCEPxA')),
   sig(raw)),{state:'rejected'});
 assert.deepEqual(await f.issuer({},sig(raw)),{state:'rejected'});
 assert.equal(f.reads,0);assert.equal(f.calls.length,0);
});
test('unsupported batch, wrong company and stale provider timestamp fail closed',async()=>{
 const f=mock();
 for(const opts of [
  {multiple:true},{business:'999991111'},{phone:'999991111'},
  {timestamp:Math.floor(NOW/1000)-700},
  {timestamp:Math.floor(NOW/1000)+120},
  {additionalStatus:true},{code:'not-the-right-code'},
  {type:'image'}
 ]){
  const raw=payload(opts);
  const got=await f.issuer(raw,sig(raw));
  assert.ok(['ignored','rejected'].includes(got.state));
 }
 assert.equal(f.reads,0);assert.equal(f.calls.length,0);
});
test('wrong signing purpose or overlapping key never writes',async()=>{
 for(const config of [
  {keyPurpose:'atomic-activate'},
  {keyState:'revoked'},
  {signing:senderKey}
 ]){
  const f=mock(config),raw=payload();
  await assert.rejects(f.issuer(raw,sig(raw)),/signing key|not isolated/i);
  assert.equal(f.calls.length,0);
 }
});
test('SQL rejection triggers rollback; DB error rolls back and releases',async()=>{
 const raw=payload();
 const f=mock({dbState:'rejected'});
 assert.deepEqual(await f.issuer(raw,sig(raw)),{state:'rejected'});
 assert.deepEqual(f.calls.map(x=>x.sql===ISSUE_SQL?'ISSUE':x.sql),
  ['BEGIN','ISSUE','ROLLBACK']);
 const failure=mock({dbState:'throw'});
 await assert.rejects(failure.issuer(raw,sig(raw)),/CI database unavailable/);
 assert.deepEqual(failure.calls.map(x=>x.sql===ISSUE_SQL?'ISSUE':x.sql),
  ['BEGIN','ISSUE','ROLLBACK']);
 assert.equal(failure.releases,1);
});


test('signed oversized body and invalid UTF-8 never issue phone evidence',async()=>{
 const f=mock(),valid=payload();
 // Both inputs are correctly signed to isolate bounds/decoding from HMAC.
 const oversized=Buffer.concat([valid,Buffer.alloc(256*1024,0x20)]);
 assert.deepEqual(await f.issuer(oversized,sig(oversized)),
  {state:'rejected'});
 // A malformed byte sequence in an unrelated JSON field must not silently
 // decode to the replacement character and become a trusted proof.
 const malformed=Buffer.concat([
  valid.subarray(0,valid.length-1),
  Buffer.from(',"untrusted":"'),
  Buffer.from([0xc3,0x28]),
  Buffer.from('"}')
 ]);
 assert.deepEqual(await f.issuer(malformed,sig(malformed)),
  {state:'rejected'});
 assert.equal(f.reads,0);
 assert.equal(f.calls.length,0);
 assert.equal(f.releases,0);
});
