'use strict';
/** Offline crypto tests, no Resend keys or real emails. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifySvix}=require('../pilot/resend-webhook/lib/verify-svix');
const secret='whsec_'+crypto.randomBytes(32).toString('base64');
const raw=JSON.stringify({type:'email.received',data:{
  email_id:'00000000-0000-0000-0000-000000000000',
  to:['pilot-nexlupa@pibnolee.resend.app']}});
const now=1794067200;
const headers={
 'svix-id':'msg-SYNTHETIC-0001','svix-timestamp':String(now),
 'svix-signature':null
};
const mac=crypto.createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
 .update(headers['svix-id']+'.'+headers['svix-timestamp']+'.'+raw)
 .digest('base64');
headers['svix-signature']='v1,'+mac;
assert.equal(verifySvix(raw,headers,secret,now),true);
assert.equal(verifySvix(raw+' ',headers,secret,now),false);
assert.equal(verifySvix(raw,{...headers,'svix-id':'msg-OTHER'},secret,now),false);
assert.equal(verifySvix(raw,{...headers,'svix-signature':'v1,invalid'},secret,now),false);
assert.equal(verifySvix(raw,headers,secret,now+301),false);
assert.equal(verifySvix(raw,headers,'whsec_invalid',now),false);
assert.equal(verifySvix('x'.repeat(65537),headers,secret,now),false);
console.log('PASS — signed raw Resend notifications, tampering, replay timeout, and oversize protection');
console.log('LIMIT — transport-only pilot; no real email content, persistent state or public agent actions');
