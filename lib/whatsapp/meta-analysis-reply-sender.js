'use strict';

const {MAX_REPLY_LENGTH} = require('./format-analysis-reply');

const MESSAGE_ID = /^wamid\.[A-Za-z0-9._=-]{1,256}$/;

function createMetaAnalysisReplySender({apiVersion, phoneNumberId, accessToken, fetchImpl = fetch} = {}) {
  if (typeof apiVersion !== 'string' || !/^v\d{1,3}\.0$/.test(apiVersion) ||
      typeof phoneNumberId !== 'string' || !/^\d{5,30}$/.test(phoneNumberId) ||
      typeof accessToken !== 'string' || !/^\S+$/.test(accessToken) ||
      typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid WhatsApp reply sender configuration');
  }

  const url = 'https://graph.facebook.com/' + apiVersion + '/' + phoneNumberId + '/messages';

  return async function sendReply(reply) {
    const {phoneNumberId: senderPhoneId, to, replyTo, body} = reply;
    if (senderPhoneId !== phoneNumberId ||
        typeof to !== 'string' || !/^\d{7,15}$/.test(to) ||
        typeof replyTo !== 'string' || !MESSAGE_ID.test(replyTo) ||
        typeof body !== 'string' || !body.trim() || body.length > MAX_REPLY_LENGTH) {
      throw new TypeError('Invalid WhatsApp reply');
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          context: {message_id: replyTo},
          type: 'text',
          text: {body, preview_url: false}
        })
      });
      if (response.ok) {
        const result = await response.json();
        const id = result?.messages?.[0]?.id;
        if (typeof id === 'string' && MESSAGE_ID.test(id)) return id;
      }
    } catch {
      // A request can reach Meta even when we cannot read its response.
    }
    throw new Error('WhatsApp reply dispatch not confirmed');
  };
}

module.exports = {createMetaAnalysisReplySender};
