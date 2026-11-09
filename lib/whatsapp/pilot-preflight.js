'use strict';

/**
 * TTP 239: local, read-only WhatsApp pilot readiness inventory.
 * Presence of environment variable names NEVER proves cryptographic validity,
 * authorization, migration correctness or permission to enable live traffic.
 * This module performs no SQL, network calls, deployments or Meta API calls.
 */
const REQUIRED_ENV = Object.freeze([
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_DATABASE_URL',
  'WHATSAPP_SENDER_HMAC_KEY',
  'WHATSAPP_PAIRING_HMAC_KEY',
  'WHATSAPP_ISSUE_SIGNING_KEY',
  'WHATSAPP_CONFIRM_SIGNING_KEY'
]);

const EXTERNAL_GATES = Object.freeze([
  'meta_app_and_official_business_number_verified',
  'server_verified_identity_provider_and_family_membership_connected',
  'neon_isolated_migration_and_restricted_roles_audited',
  'signer_key_custody_rotation_and_replay_ledger_verified',
  'durable_webhook_persistence_retry_and_unknown_sender_policy_verified',
  'consent_privacy_retention_and_withdrawal_reviewed',
  'vercel_legacy_credential_revocation_confirmed',
  'supervised_two_family_real_provider_pilot_completed'
]);

function auditWhatsAppPilotEnvironment(env={}) {
  if (!env || typeof env!=='object' || Array.isArray(env))
    throw new TypeError('Server environment snapshot required');

  const requestedMode = Object.prototype.hasOwnProperty.call(env,'WHATSAPP_WEBHOOK_MODE') ?
    String(env.WHATSAPP_WEBHOOK_MODE) : 'disabled';
  const supportedMode = requestedMode==='disabled' || requestedMode==='verify-only';
  const missingEnv = REQUIRED_ENV.filter(key=>
    typeof env[key]!=='string' || env[key].length===0 ||
    env[key].trim().length===0
  );
  const verifyOnlyConfigured = requestedMode==='verify-only' &&
    !missingEnv.includes('WHATSAPP_VERIFY_TOKEN') &&
    !missingEnv.includes('WHATSAPP_APP_SECRET');

  return Object.freeze({
    mode:supportedMode?requestedMode:'invalid',
    safeToKeepDisabled:requestedMode==='disabled',
    verifyOnlyConfigured,
    presentEnvNames:Object.freeze(REQUIRED_ENV.filter(key=>!missingEnv.includes(key))),
    missingEnvNames:Object.freeze(missingEnv),
    pendingIndependentVerification:Object.freeze([...EXTERNAL_GATES]),
    // A static environment audit can NEVER grant approval for real traffic.
    liveTrafficApproved:false,
    reason:'Meta, IdP, Neon and consent require separate real-world verification'
  });
}

module.exports={REQUIRED_ENV,EXTERNAL_GATES,auditWhatsAppPilotEnvironment};
