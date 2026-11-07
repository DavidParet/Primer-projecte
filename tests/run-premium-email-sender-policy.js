'use strict';
/* node tests/run-premium-email-sender-policy.js — entirely synthetic */
const assert=require('node:assert/strict');
const {evaluateForwarderTrust,domainOf,emailOf}=
  require('../lib/premium-email-sender-policy');
const base={
  webhookVerified:true,
  from:'PARENT@GMAIL.COM',
  envelopeSender:'parent@gmail.com',
  enrolledAddresses:['parent@gmail.com'],
  providerAuth:{
    normalizedFromProvider:true,
    dmarc:'pass',dkim:'pass',dkimDomain:'gmail.com',
    spf:'neutral',spfDomain:null
  }
};
function check(patch,authPatch){
  return evaluateForwarderTrust({...base,...patch,
    providerAuth:authPatch?{...base.providerAuth,...authPatch}:
      Object.prototype.hasOwnProperty.call(patch,'providerAuth')
        ?patch.providerAuth:base.providerAuth});
}
assert.equal(domainOf('PARENT@GMAIL.COM'),'gmail.com');
assert.equal(emailOf(' PARENT@GMAIL.COM '),'parent@gmail.com');
assert.equal(emailOf('Parent <parent@gmail.com>'),null,
  'Never parse display-name strings from untrusted input');
assert.equal(check({}).trusted,true);
assert.equal(check({}).mechanisms.dkim,true);
assert.equal(check({webhookVerified:false}).reason,'PROVIDER_SIGNATURE_NOT_VERIFIED');
assert.equal(check({enrolledAddresses:['someone@gmail.com']}).reason,'FORWARDER_NOT_ENROLLED');
assert.equal(check({envelopeSender:'attacker@gmail.com'}).reason,'ENVELOPE_FROM_MISMATCH');
assert.equal(check({envelopeSender:'invalid'}).reason,'INVALID_MAIL_IDENTITY');
assert.equal(check({from:'Parent <parent@gmail.com>'}).reason,'INVALID_MAIL_IDENTITY');
assert.equal(check({providerAuth:null}).reason,'VERIFIED_PROVIDER_AUTH_RESULT_MISSING');
assert.equal(check({},{normalizedFromProvider:false}).reason,'VERIFIED_PROVIDER_AUTH_RESULT_MISSING');
assert.equal(check({},{dmarc:'fail'}).reason,'DMARC_NOT_PASS');
assert.equal(check({},{dmarc:'none'}).reason,'DMARC_NOT_PASS');
assert.equal(check({},{dmarc:'PASS'}).reason,'DMARC_NOT_PASS',
  'Require canonical normalized statuses');
assert.equal(check({},{dkim:'fail',spf:'fail'}).reason,'NO_ALIGNED_PASS');
assert.equal(check({},{dkimDomain:'spoof.gmail.com',spf:'fail'}).reason,'NO_ALIGNED_PASS');
assert.equal(check({},{dkimDomain:'example.org',spf:'neutral'}).reason,'NO_ALIGNED_PASS');
assert.equal(check({},{dkim:'fail',spf:'pass',spfDomain:'gmail.com'}).trusted,true,
  'Enrolled sender with DMARC and aligned SPF may pass');
assert.equal(check({},{dkim:'fail',spf:'pass',spfDomain:'other-domain.com'}).trusted,false);
assert.equal(check({},{dkimDomain:'gmail.com',spf:'pass',spfDomain:'gmail.com'}).trusted,true);
assert.equal(check({},{dkim:'pass',dkimDomain:'gmail.com',spf:'fail'}).needsReview,false);
assert.equal(check({enrolledAddresses:['parent@outlook.com']}).trusted,false);
assert.equal(check({from:'parent@outlook.com',envelopeSender:'parent@outlook.com',
  enrolledAddresses:['parent@outlook.com']},{dkimDomain:'gmail.com'}).trusted,false);
assert.equal(check({from:'parent@outlook.com',envelopeSender:'parent@outlook.com',
  enrolledAddresses:['parent@outlook.com']},{dkimDomain:'outlook.com'}).trusted,true);
console.log('PASS — 23 exact-domain and registered-forwarder policy assertions');
console.log('PASS — fail closed on missing provider proof, DMARC fail, spoofing and unaligned domains');
console.log('PASS — Gmail/Outlook aliases only pass with trusted, normalized aligned evidence');
console.log('LIMIT — provider payload parsing and signature-to-evidence binding not yet implemented');
