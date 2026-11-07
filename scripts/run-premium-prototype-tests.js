'use strict';
/*
 * Manual-only offline runner:
 *   node scripts/run-premium-prototype-tests.js
 * Does not start a web server, connect to services or deploy anything.
 */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.join(__dirname,'..');
const suites=[
  'tests/run-activity-sync.js',
  'tests/run-premium-agent-pilot.js',
  'tests/run-premium-natural-intake.js',
  'tests/run-premium-ai-extractor.js',
  'tests/run-premium-ai-answerer.js',
  'tests/run-premium-forwarded-email.js',
  'tests/run-premium-mailgun-route.js',
  'tests/run-premium-mailgun-inbox.js',
  'tests/run-premium-mailgun-local-pilot.js',
  'tests/run-premium-mailgun-queue-worker.js',
  'tests/run-premium-email-sender-policy.js',
  'tests/run-premium-resend-inbound.js',
  'tests/run-premium-family-inbox.js'
];
let failed=0;
for(const test of suites){
  const r=spawnSync(process.execPath,[path.join(root,test)],{
    cwd:root,encoding:'utf8',timeout:30000,
    env:{...process.env,RUN_LIVE_AGENT_EVAL:'NO'}
  });
  if(r.status===0){
    console.log('PASS '+test);
  }else{
    failed++;
    console.error('FAIL '+test+' (exit '+String(r.status)+')');
    if(r.stderr)console.error(r.stderr.slice(0,2500));
  }
}
console.log('Suites: '+(suites.length-failed)+'/'+suites.length+' passing');
if(failed)process.exitCode=1;
