'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {makeConsentPolicy}=require('../lib/whatsapp/consent-policy');

const FAMILY_A='00000000-0000-4000-8000-000000000001';
const FAMILY_B='00000000-0000-4000-8000-000000000002';
const BUSINESS='9999900000', NUMBER='8888800000', SENDER='34600000000';
const key=randomBytes(32).toString('base64');

// Synthetic database enforces tenant scoping on the same SQL arguments used
// by the production policy; never uses personal WhatsApp data or Meta.
test('revoking one family cannot purge another family on shared sender',async()=>{
  const retained=new Map([[FAMILY_A,2],[FAMILY_B,4]]);
  const revoked=new Set();
  const traces=[];
  function makeDb(){
    return {query:async()=>{throw Error('unexpected pool query');},
      connect:async()=>({release(){},async query(sql,args){
        traces.push({sql,args});
        if(['BEGIN','COMMIT','ROLLBACK','SET TRANSACTION ISOLATION LEVEL READ COMMITTED'].includes(sql))return {};
        const family=args[3];
        if(sql.includes('FOR UPDATE'))return {rowCount:1,rows:[{authorization_id:'1'}]};
        if(sql.includes('UPDATE nex_whatsapp_sender_authorizations')){
          const count=revoked.has(family)?0:1;
          revoked.add(family);
          return {rowCount:count,rows:count?[{authorization_id:'1'}]:[]};
        }
        if(sql.includes('DELETE FROM nex_whatsapp_inbound')){
          const count=retained.get(family)||0;
          retained.set(family,0);
          return {rowCount:count,rows:Array.from({length:count},(_,i)=>({inbound_id:String(i+1)}))};
        }
        throw Error('unexpected SQL');
      }})};
  }
  function policy(family){
    return makeConsentPolicy({db:makeDb(),senderHmacKey:key,
      currentConsentVersion:'pilot-v1',
      resolveAuthenticatedFamily:async()=>family,
      verifyEnrollment:async()=>{throw Error('unused');},
      verifyExplicitConsent:async()=>{throw Error('unused');}});
  }
  const input={session:{synthetic:true},businessAccountId:BUSINESS,phoneNumberId:NUMBER,senderWaId:SENDER};
  assert.deepEqual(await policy(FAMILY_A).revoke(input),{state:'revoked',deletedMessages:2});
  assert.equal(retained.get(FAMILY_B),4);
  assert.equal(revoked.has(FAMILY_B),false);
  assert.deepEqual(await policy(FAMILY_A).revoke(input),{state:'not_found',deletedMessages:0});
  assert.deepEqual(await policy(FAMILY_B).revoke(input),{state:'revoked',deletedMessages:4});
  for(const {sql,args} of traces.filter(x=>x.args)){
    assert.match(sql,/family_id=\$4/);
    assert.ok([FAMILY_A,FAMILY_B].includes(args[3]));
    assert.equal(args.includes(SENDER),false);
  }
});

test('failed isolation setup rolls back without revoking or purging',async()=>{
  const statements=[];
  let released=false;
  const db={query:async()=>{throw Error('unexpected pool query');},
    connect:async()=>({release(){released=true;},async query(sql){
      statements.push(sql);
      if(sql.startsWith('SET TRANSACTION'))throw Error('isolation unavailable');
      return {};
    }})};
  const policy=makeConsentPolicy({db,senderHmacKey:key,
    currentConsentVersion:'pilot-v1',
    resolveAuthenticatedFamily:async()=>FAMILY_A,
    verifyEnrollment:async()=>{},verifyExplicitConsent:async()=>{}});
  await assert.rejects(policy.revoke({session:{},businessAccountId:BUSINESS,
    phoneNumberId:NUMBER,senderWaId:SENDER}),/isolation unavailable/);
  assert.deepEqual(statements,['BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED','ROLLBACK']);
  assert.equal(released,true);
});

test('purge failure rolls back revocation instead of acknowledging success',async()=>{
  const statements=[];
  let released=false;
  const db={query:async()=>{throw Error('unexpected pool query');},
    connect:async()=>({release(){released=true;},async query(sql){
      statements.push(sql);
      if(sql==='BEGIN'||sql==='SET TRANSACTION ISOLATION LEVEL READ COMMITTED'||sql==='ROLLBACK')return {};
      if(sql.includes('FOR UPDATE'))return {rowCount:1,rows:[{authorization_id:'1'}]};
      if(sql.includes('UPDATE nex_whatsapp_sender_authorizations'))
        return {rowCount:1,rows:[{authorization_id:'1'}]};
      if(sql.includes('DELETE FROM nex_whatsapp_inbound'))throw Error('synthetic purge failure');
      throw Error('unexpected SQL');
    }})};
  const policy=makeConsentPolicy({db,senderHmacKey:key,currentConsentVersion:'pilot-v1',
    resolveAuthenticatedFamily:async()=>FAMILY_A,
    verifyEnrollment:async()=>{},verifyExplicitConsent:async()=>{}});
  await assert.rejects(policy.revoke({session:{},businessAccountId:BUSINESS,
    phoneNumberId:NUMBER,senderWaId:SENDER}),/synthetic purge failure/);
  assert.equal(statements.at(-1),'ROLLBACK');
  assert.equal(statements.includes('COMMIT'),false);
  assert.equal(released,true);
});
