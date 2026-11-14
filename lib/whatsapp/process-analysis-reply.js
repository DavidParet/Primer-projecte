'use strict';

const {MAX_TEXT_CHARS} = require('./delivery-normalizer');
const {formatAnalysisReply} = require('./format-analysis-reply');

const MESSAGE_ID = /^wamid\.[A-Za-z0-9._=-]{1,256}$/;
const DIGITS = /^\d{5,30}$/;
const RECIPIENT = /^\d{7,15}$/;

// The caller provides a trusted inbox job and durable, atomic job transitions.
// beginDispatch must check the claim and current consent in the same transaction.
// Once dispatch starts, only reconciliation may resolve an unknown send outcome.
function createAnalysisReplyProcessor({
  claim, analyzeText, beginDispatch, sendReply, markSent, releaseForRetry
}) {
  if (![claim, analyzeText, beginDispatch, sendReply, markSent, releaseForRetry]
    .every(dependency => typeof dependency === 'function')) {
    throw new TypeError('WhatsApp analysis reply dependencies are required');
  }

  return async function processAnalysisReply(messageKey) {
    const job = await claim(messageKey);
    if (!job) return {state: 'unavailable'};

    let body;
    try {
      if (!DIGITS.test(job.phoneNumberId) || !RECIPIENT.test(job.senderWaId) ||
          !MESSAGE_ID.test(job.providerMessageId) || typeof job.text !== 'string' ||
          !job.text.trim() || job.text.length > MAX_TEXT_CHARS) {
        throw new TypeError('Invalid authorized WhatsApp inbox job');
      }
      body = formatAnalysisReply(await analyzeText(job.text));
    } catch {
      await releaseForRetry(job);
      return {state: 'analysis_failed'};
    }

    if (await beginDispatch(job) !== true) return {state: 'not_dispatched'};

    try {
      const outgoingId = await sendReply({
        phoneNumberId: job.phoneNumberId,
        to: job.senderWaId,
        replyTo: job.providerMessageId,
        body
      });
      if (typeof outgoingId !== 'string' || !MESSAGE_ID.test(outgoingId)) return {state: 'delivery_unknown'};
      await markSent(job, outgoingId);
      return {state: 'sent'};
    } catch {
      // A timeout or a failed local write may follow a successful remote send.
      return {state: 'delivery_unknown'};
    }
  };
}

module.exports = {createAnalysisReplyProcessor};
