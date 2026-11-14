'use strict';

const MAX_REPLY_LENGTH = 4096;
const TRUNCATED = '\n\nEl missatge és llarg i s’ha escurçat.';

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function datedLine(label, item) {
  // Dates flagged for review must not appear as confirmed in the chat.
  if (item.dataDubtosa || item.passada || item.vençut) {
    return item.vençut ? label + ' (termini vençut)' : label + ' (revisa la data)';
  }
  const location = clean(item.lloc);
  const date = clean(item.data);
  const endDate = clean(item.dataFi);
  const details = [date && endDate && endDate !== date ? date + ' – ' + endDate : date, location]
    .filter(Boolean);
  return details.length ? label + ' · ' + details.join(' · ') : label;
}

function formatAnalysisReply(analysis) {
  const summary = clean(analysis?.resum);
  if (!summary || !Array.isArray(analysis.accions)) {
    throw new TypeError('Invalid NexLupa analysis');
  }

  const warnings = clean(analysis.avisDates);
  const decision = clean(analysis.decisio);
  const events = Array.isArray(analysis.esdeveniments) && analysis.esdeveniments.length
    ? analysis.esdeveniments : [analysis.mainEvent];
  const eventLines = events.filter(item => clean(item?.title))
    .map(item => '• ' + datedLine(clean(item.title), item));
  const actionLines = analysis.accions.filter(item => clean(item?.accio))
    .map(item => '• ' + datedLine(clean(item.accio), item));

  const reply = [
    '🔍 NexLupa',
    warnings && 'Revisa les dades\n' + warnings,
    decision && decision !== summary && 'Què cal fer\n' + decision,
    summary,
    eventLines.length && 'Esdeveniments\n' + eventLines.join('\n'),
    actionLines.length && 'Accions\n' + actionLines.join('\n')
  ].filter(Boolean).join('\n\n');

  if (reply.length <= MAX_REPLY_LENGTH) return reply;
  // Avoid splitting a Unicode surrogate pair at the message limit.
  const excerpt = reply.slice(0, MAX_REPLY_LENGTH - TRUNCATED.length)
    .replace(/[\uD800-\uDBFF]$/, '').trimEnd();
  return excerpt + TRUNCATED;
}

module.exports = {formatAnalysisReply, MAX_REPLY_LENGTH};
