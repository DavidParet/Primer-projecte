'use strict';

/**
 * Offline readiness report. Outputs setting NAMES and static gates ONLY.
 * Does not print environment values, log secrets or contact external systems.
 * Does not enable a deployment even if all variables are present.
 */
const {auditWhatsAppPilotEnvironment}=require('../lib/whatsapp/pilot-preflight');

function formatPilotReport(env={}){
  const report=auditWhatsAppPilotEnvironment(env);
  const lines=[
    'NexLupa WhatsApp pilot: read-only preflight',
    'Webhook mode: '+report.mode,
    'Live traffic approved: NO (requires verified deployment gates)',
    'Present configuration names: '+(report.presentEnvNames.join(', ') || '(none)'),
    'Missing configuration names: '+(report.missingEnvNames.join(', ') || '(none)'),
    'Independent validations still required:'
  ];
  for(const check of report.pendingIndependentVerification)
    lines.push('- '+check);
  return lines.join('\n');
}

if(require.main===module){
  // A misconfigured unsupported mode must fail the CI gate; missing
  // credentials alone do not fail CI while this integration is intentionally
  // disabled. No build activation takes place.
  const assessment=auditWhatsAppPilotEnvironment(process.env);
  process.stdout.write(formatPilotReport(process.env)+'\n');
  if(assessment.mode==='invalid')process.exitCode=1;
}

module.exports={formatPilotReport};
