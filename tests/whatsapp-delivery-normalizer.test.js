'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeMetaDeliveries,MAX_TEXT_CHARS}=require('../lib/whatsapp/delivery-normalizer');

function makePayload(messages, accountId='1234500000') {
  return {object:'whatsapp_business_account',entry:[{
    id:accountId,changes:[{field:'messages',value:{
      metadata:{phone_number_id:'9876500000'},
      messages,
      statuses:[{id:'synthetic-delivery-status'}]
    }}]
  }]};
}
function item(id='wamid.fictional-1',type='text',extra={}) {
  return {id,type,from:'000000000000',timestamp:'1794150000',
    text:{body:'Recordatori: porteu la samarreta de l’equip.'},...extra};
}

test('Rebutja objectes que no siguin WhatsApp Business',()=>{
  assert.throws(()=>normalizeMetaDeliveries({object:'page',entry:[]}),TypeError);
  assert.throws(()=>normalizeMetaDeliveries({}),TypeError);
});

test('Normalitza text sense assignar família ni grup: consentiment pendent',()=>{
  const result=normalizeMetaDeliveries(makePayload([item()]));
  assert.equal(result.deliveries.length,1);
  const d=result.deliveries[0];
  assert.equal(d.provider,'whatsapp');
  assert.equal(d.phoneNumberId,'9876500000');
  assert.equal(d.businessAccountId,'1234500000');
  assert.equal(d.providerMessageId,'wamid.fictional-1');
  assert.equal(d.senderWaId,'000000000000');
  assert.equal(d.text,'Recordatori: porteu la samarreta de l’equip.');
  assert.equal(d.groupId,null);
  assert.equal(d.familyId,null);
  assert.equal(d.authorization,'unresolved');
  assert.equal(d.contentPending,false);
  assert.equal(result.meta.statusUpdates,1);
});

test('un WhatsApp reenviat no revela el grup original ni autoritza una família',()=>{
  const content=item('wamid.forwarded-synthetic','text',{
    context:{forwarded:true,group_id:'grup-del-collegi-inventat'},
    groupId:'arbitrary-provider-extension',
    familyId:'claimed-by-sender'
  });
  const r=normalizeMetaDeliveries(makePayload([content]));
  assert.equal(r.deliveries.length,1);
  assert.equal(r.deliveries[0].groupId,null);
  assert.equal(r.deliveries[0].familyId,null);
  assert.equal(r.deliveries[0].authorization,'unresolved');
  assert.equal(Object.hasOwn(r.deliveries[0],'context'),false);
  assert.equal(Object.hasOwn(r.deliveries[0],'originalGroup'),false);
});

test('Duplicats dins de la mateixa entrega es descarten',()=>{
  const data=makePayload([item(),item()]);
  assert.equal(normalizeMetaDeliveries(data).deliveries.length,1);
});

test('Multimèdia queda pendent; no es diu que s’hagi llegit',()=>{
  const media=item('wamid.fictional-image','image',{image:{id:'media-file-id'}});
  const result=normalizeMetaDeliveries(makePayload([media]));
  assert.equal(result.deliveries[0].text,null);
  assert.equal(result.deliveries[0].contentPending,true);
});

test('Dades de remitent o identificador malformades no són acceptades',()=>{
  const badSender=item('wamid.invalid','text',{from:'not-a-phone'});
  const badId=item('invalid','text');
  const result=normalizeMetaDeliveries(makePayload([badSender,badId,item()]));
  assert.equal(result.deliveries.length,1);
  assert.equal(result.meta.skipped,2);
});

test('Límit de missatges i text excessivament llarg',()=>{
  const data=makePayload([item(),item('wamid.fictional-2'),item('wamid.fictional-3')]);
  const limited=normalizeMetaDeliveries(data,{maxDeliveries:2});
  assert.equal(limited.deliveries.length,2);
  assert.equal(limited.meta.truncated,true);
  const long=normalizeMetaDeliveries(makePayload([item('wamid.long','text',{
    text:{body:'x'.repeat(MAX_TEXT_CHARS+1)}
  })]));
  assert.equal(long.deliveries.length,0);
  assert.equal(long.meta.skipped,1);
});

test('Mateix id de missatge en comptes empresarials diferents no es barreja',()=>{
  const payload=makePayload([item()]);
  payload.entry.push(makePayload([item()],'2222200000').entry[0]);
  const d=normalizeMetaDeliveries(payload).deliveries;
  assert.equal(d.length,2);
  assert.notEqual(d[0].businessAccountId,d[1].businessAccountId);
});

test('No confon estat de lliurament amb missatge entrant',()=>{
  const p=makePayload([]);
  const r=normalizeMetaDeliveries(p);
  assert.equal(r.deliveries.length,0);
  assert.equal(r.meta.statusUpdates,1);
});
