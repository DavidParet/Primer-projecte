'use strict';

const {createAnalysisReplyProcessor} = require('./process-analysis-reply');
const {createMetaAnalysisReplySender} = require('./meta-analysis-reply-sender');

// The pilot must supply the same analysis handler as the app version under test.
function createPilotAnalysisReply({analysisHandler, meta, jobs} = {}) {
  if (typeof analysisHandler !== 'function') {
    throw new TypeError('NexLupa analysis handler required');
  }

  async function analyzeText(text) {
    let statusCode = 200;
    let payload;
    let responded = false;
    const response = {
      setHeader() {},
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        responded = true;
        return this;
      }
    };
    // The time of a forward is not the original notice date.
    await analysisHandler({method: 'POST', headers: {}, body: {text}}, response);
    if (!responded || statusCode !== 200) {
      throw new Error('NexLupa inbox analysis failed');
    }
    return payload;
  }

  return createAnalysisReplyProcessor({
    ...jobs,
    analyzeText,
    sendReply: createMetaAnalysisReplySender(meta)
  });
}

module.exports = {createPilotAnalysisReply};
