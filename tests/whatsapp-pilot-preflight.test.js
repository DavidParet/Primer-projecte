'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {REQUIRED_ENV,EXTERNAL_GATES,auditWhatsAppPilotEnvironment}=
  require('../lib/whatsapp/pilot-preflight');
const {formatPilotReport}=
  require('../scripts/whatsapp-pilot-preflight');

test('empty deployment is safely blocked with actionable missing setting names',()=>{
 const report=auditWhatsAppPilotEnvironment({});
 assert.equal(report.mode,'disabled');
 assert.equal(report.safeToKeepDisabled,true);
 assert.equal(report.verifyOnlyConfigured,false);
 assert.equal(report.liveTrafficApproved,false);
 assert.deepEqual(report.missingEnvNames,[...REQUIRED_ENV]);
 assert.deepEqual(report.presentEnvNames,[]);
 assert.ok(report.pendingIndependentVerification.includes(
  'server_verified_identity_provider_and_family_membership_connected'));
});

test('verify-only mode never implies permission to accept POST deliveries',()=>{
 const report=auditWhatsAppPilotEnvironment({
  WHATSAPP_WEBHOOK_MODE:'verify-only',
  WHATSAPP_VERIFY_TOKEN:'sample-only-value',
  WHATSAPP_APP_SECRET:'synthetic-only-value'
 });
 assert.equal(report.mode,'verify-only');
 assert.equal(report.verifyOnlyConfigured,true);
 assert.equal(report.liveTrafficApproved,false);
 assert.ok(report.missingEnvNames.includes('WHATSAPP_DATABASE_URL'));
});

test('even with every configured name, external launch gates remain unverified',()=>{
 const vars=Object.fromEntries(REQUIRED_ENV.map(name=>[name,'CI-SYNTHETIC-PLACEHOLDER']));
 const report=auditWhatsAppPilotEnvironment(vars);
 assert.deepEqual(report.missingEnvNames,[]);
 assert.equal(report.liveTrafficApproved,false);
 assert.equal(report.pendingIndependentVerification.length,EXTERNAL_GATES.length);
});

test('unknown live mode is rejected, not silently treated as activation',()=>{
 for(const value of ['live','enabled','production','true','1','disabled ']){
  const report=auditWhatsAppPilotEnvironment({WHATSAPP_WEBHOOK_MODE:value});
  assert.equal(report.mode,'invalid');
  assert.equal(report.liveTrafficApproved,false);
 }
});

test('preflight never logs environment variable values even if they contain secrets',()=>{
 const synthetic='ci-only-DO-NOT-LOG-secret-marker';
 const env={
  WHATSAPP_WEBHOOK_MODE:'verify-only',
  WHATSAPP_APP_SECRET:synthetic,
  WHATSAPP_VERIFY_TOKEN:synthetic,
  WHATSAPP_DATABASE_URL:synthetic,
  OPENAI_API_KEY:synthetic
 };
 const result=formatPilotReport(env);
 assert.equal(result.includes(synthetic),false);
 assert.match(result,/WHATSAPP_APP_SECRET/);
 assert.match(result,/WHATSAPP_DATABASE_URL/);
 assert.match(result,/Live traffic approved: NO/);
 assert.equal(result.includes('OPENAI_API_KEY'),false);
});

test('undefined, missing or blank credentials are marked as unconfigured',()=>{
 const report=auditWhatsAppPilotEnvironment({
  WHATSAPP_VERIFY_TOKEN:'   ',WHATSAPP_APP_SECRET:null,
  WHATSAPP_WABA_ID:'1234'
 });
 assert.ok(report.missingEnvNames.includes('WHATSAPP_APP_SECRET'));
 assert.ok(report.missingEnvNames.includes('WHATSAPP_VERIFY_TOKEN'));
 assert.deepEqual(report.presentEnvNames,['WHATSAPP_WABA_ID']);
});
