'use strict';
/* node tests/run-premium-mailgun-local-pilot.js — loopback only; fake email */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {createLocalPilot,readRecords,MAX_POST_BYTES}=
  require('../scripts/premium-mailgun-local-pilot');
const KEY='synthetic-signing-key-not-for-real-mailgun-account';
const registry={families:[
  {id:'family-A',inboundAddresses:['fam-a@inbound.example.test'],
    verifiedForwarders:['parent-a@example.test'],
    activities:[{id:'ball-A',name:'Ball',keywords:['ball']}]},
  {id:'family-B',inboundAddresses:['fam-b@inbound.example.test'],
    verifiedForwarders:['parent-b@example.test'],
    activities:[{id:'ball-B',name:'Ball',keywords:['ball']}]}
]};
function form(fields={},token=crypto.randomBytes(25).toString('hex')){
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=crypto.createHmac('sha256',KEY)
    .update(timestamp+token).digest('hex');
  return {
    timestamp,token,signature,
    sender:'parent-a@example.test',
    from:'Parent A <parent-a@example.test>',
    recipient:'fam-a@inbound.example.test',
    subject:'Fwd: Festival de Ball',
    'body-plain':'El termini per pagar el ball és el 18 de novembre de 2026.',
    'attachment-count':'0',...fields
  };
}
async function ask(server,params={},opts={}){
  const address=server.address(),data=opts.raw||
    new URLSearchParams(params).toString();
  return new Promise((resolve,reject)=>{
    const req=http.request({
      host:'127.0.0.1',port:address.port,
      method:opts.method||'POST',path:opts.path||'/inbound/mailgun',
      headers:{'content-type':opts.contentType||
        'application/x-www-form-urlencoded; charset=utf-8',
        'content-length':Buffer.byteLength(data)}
    },res=>{
      const chunks=[];
      res.on('data',x=>chunks.push(x));
      res.on('end',()=>{
        let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
        catch{return reject(Error('Invalid JSON response'))}
        resolve({httpStatus:res.statusCode,...json});
      });
    });
    req.on('error',reject);req.end(data);
  });
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
}
async function close(server){
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexlupa-mailgun-pilot-'));
  const server=createLocalPilot({
    signingKey:KEY,registry,dataDir:dir,
    // TEST STUB ONLY! It is NOT actual sender authentication.
    senderProof:()=>true
  });
  await listen(server);
  try{
    const firstForm=form();
    const first=await ask(server,firstForm);
    assert.equal(first.httpStatus,200);
    assert.equal(first.status,'queued');
    assert.equal(readRecords(dir).length,1);
    assert.equal(readRecords(dir)[0].familyId,'family-A');
    assert.equal(readRecords(dir)[0].activityId,'ball-A');
    assert.equal(readRecords(dir)[0].payload.message.channel,'email-forwarded');
    assert.ok(readRecords(dir)[0].payload.message.text.includes('18 de novembre'));
    const file=fs.readdirSync(dir).find(x=>x.endsWith('.json'));
    assert.equal(fs.statSync(path.join(dir,file)).mode & 0o777,0o600);

    const replay=await ask(server,firstForm);
    assert.equal(replay.httpStatus,200);
    assert.equal(replay.status,'duplicate');
    assert.equal(readRecords(dir).length,1);

    const newTokenSameText=await ask(server,form());
    assert.equal(newTokenSameText.status,'duplicate-content');
    assert.equal(readRecords(dir).length,2);
    assert.equal(readRecords(dir)[1].payload,null);

    const badSig=await ask(server,form({signature:'0'.repeat(64)}));
    assert.equal(badSig.httpStatus,406);
    assert.equal(badSig.status,'invalid-signature');
    assert.equal(readRecords(dir).length,2);

    const unknownFamily=await ask(server,form({
      recipient:'someone-else@inbound.example.test'
    }));
    assert.equal(unknownFamily.status,'needs-review');
    assert.equal(readRecords(dir).at(-1).payload,null);

    const secondFamily=await ask(server,form({
      recipient:'fam-b@inbound.example.test',
      sender:'parent-b@example.test',
      from:'Parent B <parent-b@example.test>'
    }));
    assert.equal(secondFamily.status,'queued');
    assert.equal(readRecords(dir).at(-1).familyId,'family-B');

    const ambiguous=await ask(server,form({
      subject:'Circular general', 'body-plain':'Una nova circular sense matèria.'
    }));
    assert.equal(ambiguous.status,'needs-review');

    const duplicatedField=await ask(server,{},{
      raw:new URLSearchParams(form()).toString()+'&recipient=spoof@example.test'
    });
    assert.equal(duplicatedField.httpStatus,406);
    assert.equal(duplicatedField.status,'invalid-form');

    assert.equal((await ask(server,form(),{method:'GET'})).httpStatus,405);
    assert.equal((await ask(server,form(),{path:'/other'})).httpStatus,404);
    assert.equal((await ask(server,form(),{contentType:'multipart/form-data'})).httpStatus,415);
    assert.equal((await ask(server,form(),{raw:'x'.repeat(MAX_POST_BYTES+1)})).httpStatus,413);
    await close(server);

    const reopened=createLocalPilot({signingKey:KEY,registry,dataDir:dir,
      senderProof:()=>true});
    await listen(reopened);
    try{
      const persisted=await ask(reopened,firstForm);
      assert.equal(persisted.status,'duplicate','Token replay stays blocked after restart');
    }finally{await close(reopened)}

    const noProof=createLocalPilot({signingKey:KEY,registry,dataDir:dir});
    await listen(noProof);
    try{
      const quarantined=await ask(noProof,form());
      assert.equal(quarantined.status,'needs-review');
      assert.equal(readRecords(dir).at(-1).payload,null);
    }finally{await close(noProof)}
    console.log('PASS — native Node localhost HTTP receives signed form, queues sanitized internal message');
    console.log('PASS — per-family routing and separate family-B activity');
    console.log('PASS — replay remains blocked after server restart, duplicate content suppressed');
    console.log('PASS — unknown activity, unverified sender and unsupported requests safely quarantined/rejected');
    console.log('LIMIT — no live Mailgun service, actual SPF/DKIM, durable shared storage or real messages');
  }finally{
    if(server.listening)await close(server);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});
