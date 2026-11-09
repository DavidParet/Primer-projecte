'use strict';

/**
 * First controlled Gmail read for NexLupa.
 *
 * Server-only, explicitly invoked from the post-OAuth authorization callback.
 * No persistence, AI calls, message mutations, replies or Calendar actions.
 * Data returned are UNTRUSTED email excerpts for a human-only preview.
 */
const { createHash } = require('node:crypto');
const { listLabelMessageIds, readTextMessage } = require('./pilot.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = /^Label_[A-Za-z0-9_-]{1,80}$/;
const MESSAGE_LIMIT = 3;

function validateServerInputs({ familySession, googleAccount, pilotLabelId, maxResults }) {
  if (familySession?.kind !== 'family-session' ||
      familySession.verifiedByServer !== true ||
      !UUID.test(familySession.authUserId || '') ||
      !UUID.test(familySession.familyId || '') ||
      typeof familySession.sessionId !== 'string' || familySession.sessionId.length < 10) {
    throw new Error('family_auth_required');
  }
  if (!googleAccount || typeof googleAccount.sub !== 'string' ||
      !/^[0-9]{5,50}$/.test(googleAccount.sub) ||
      typeof googleAccount.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleAccount.email)) {
    throw new Error('verified_google_account_required');
  }
  if (!LABEL.test(pilotLabelId || '') ||
      !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MESSAGE_LIMIT) {
    throw new Error('invalid_pilot_constraints');
  }
}
function stableSourceHash({ familyId, googleSubject, gmailMessageId }) {
  return createHash('sha256').update(
    JSON.stringify(['gmail', familyId, googleSubject, gmailMessageId]), 'utf8'
  ).digest('hex');
}
async function previewLabeledMail({
  familySession, googleAccount, accessToken, pilotLabelId, maxResults = MESSAGE_LIMIT,
  checkCurrentFamilyConsent, fetchImpl = fetch
}) {
  validateServerInputs({ familySession, googleAccount, pilotLabelId, maxResults });
  if (typeof checkCurrentFamilyConsent !== 'function') {
    throw new Error('secure_consent_checker_required');
  }
  const familyId = familySession.familyId.toLowerCase();
  const authUserId = familySession.authUserId.toLowerCase();
  async function ensureStillAllowed() {
    const allowed = await checkCurrentFamilyConsent({ familyId, authUserId });
    if (allowed !== true) throw new Error('gmail_consent_revoked');
  }

  await ensureStillAllowed();
  const ids = await listLabelMessageIds({
    accessToken, labelId: pilotLabelId, maxResults, fetchImpl
  });
  await ensureStillAllowed();

  const drafts = [], seen = new Set();
  let unsupported = 0;
  for (const { id } of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    await ensureStillAllowed();
    let email;
    try {
      email = await readTextMessage({
        accessToken, labelId: pilotLabelId, messageId: id, fetchImpl
      });
    } catch (error) {
      // An email removed from the dedicated label, an attachment, HTML-only
      // or an oversized message is not eligible. Other Gmail failures abort.
      if ([
        'message_outside_pilot_label',
        'message_not_eligible',
        'plain_text_required',
        'message_too_long',
        'invalid_plain_text'
      ].includes(error?.message)) {
        unsupported++;
        continue;
      }
      throw error;
    }
    await ensureStillAllowed();
    drafts.push({
      source: 'gmail',
      sourceEventHash: stableSourceHash({
        familyId, googleSubject: googleAccount.sub, gmailMessageId: email.id
      }),
      title: email.subject || '(Sense assumpte)',
      from: email.from,
      bodyExcerpt: email.text.slice(0, 600),
      status: 'pending_review',
      hasBeenAnalyzedByAI: false,
      trustedInstructions: false
    });
  }
  // Nothing is returned if access was revoked during the workflow.
  await ensureStillAllowed();
  return {
    status: 'preview_only',
    familyId,
    googleEmail: googleAccount.email.toLowerCase(),
    reviewedMessages: drafts.length,
    skippedUnsupported: unsupported,
    drafts,
    sideEffects: {
      databaseWrites: false, gmailWrites: false, calendarWrites: false, aiCalls: false
    }
  };
}
module.exports = { previewLabeledMail, stableSourceHash, MESSAGE_LIMIT };
