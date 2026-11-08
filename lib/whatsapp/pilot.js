'use strict';

/** Pilot WhatsApp offline: no accedeix a grups ni envia dades a serveis externs. */
const { createHash } = require('node:crypto');
const MAX_INPUT_CHARS = 100000;
const MAX_MESSAGES = 200;

function dateStamp(day, month, year, time) {
  const y = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const m = String(time).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3] || 0);
  const meridian = m[4] ? m[4].toUpperCase() : null;
  if (meridian) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridian === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const dt = new Date(Date.UTC(y, Number(month) - 1, Number(day), hour, minute, second));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== Number(month) - 1 ||
      dt.getUTCDate() !== Number(day)) return null;
  return [String(y).padStart(4,'0'),String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-') +
    'T' + [hour, minute, second].map(v => String(v).padStart(2,'0')).join(':');
}

function parseHeader(line) {
  const clean = line.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  const ios = clean.match(/^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]\s*(.*)$/i);
  const android = clean.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s+-\s+(.*)$/i);
  const m = ios || android;
  if (!m) return null;
  const at = dateStamp(m[1],m[2],m[3],m[4]);
  if (!at) return null;
  const senderMatch = m[5].match(/^([^:]{1,100}):\s*([\s\S]*)$/);
  return { at, sender: senderMatch ? senderMatch[1].trim() : null,
    body: senderMatch ? senderMatch[2] : m[5] };
}

function parseWhatsAppExport(input, opts = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new TypeError('Cal un export de text no buit');
  if (input.length > MAX_INPUT_CHARS) throw new RangeError('Export massa gran per al pilot');
  const maxMessages = Math.max(1, Math.min(Number(opts.maxMessages) || MAX_MESSAGES, MAX_MESSAGES));
  const senders = new Map();
  const messages = [];
  const seen = new Set();
  let skippedSystem = 0;
  let overflow = false;
  let current = null;
  function flush() {
    if (!current) return;
    if (!current.sender) { skippedSystem++; current = null; return; }
    const body = current.body.trim();
    if (!body) { current = null; return; }
    if (!senders.has(current.sender)) senders.set(current.sender, 'P' + (senders.size + 1));
    const sender = senders.get(current.sender);
    const id = createHash('sha256').update([current.at, sender, body].join('\0')).digest('hex').slice(0, 24);
    if (!seen.has(id)) {
      if (messages.length < maxMessages) {
        const mediaOnly = /^(?:<media omitted>|image omitted|video omitted|audio omitted|imatge omesa|fitxer omès|multimèdia omès|imagen omitida|archivo omitido|audio omitido|sticker omitido|‎?\S+\.(?:jpg|png|opus)\s*\(file attached\))$/i.test(body);
        messages.push({ id, at: current.at, sender, text: mediaOnly ? '' : body,
          mediaPending: mediaOnly });
        seen.add(id);
      } else overflow = true;
    }
    current = null;
  }
  for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
    const header = parseHeader(line);
    if (header) { flush(); current = header; }
    else if (current) current.body += '\n' + line;
  }
  flush();
  return { messages, meta: { parsed: messages.length, skippedSystem,
    truncated: overflow, senderCount: senders.size,
    timezone: 'local-not-specified', format: 'whatsapp-export' } };
}

const ALLOWED_FIELDS = new Set(['date','time','location','payment_deadline','payment_amount','materials','status','note']);
function normalizeKey(s) { return String(s || '').trim().toLocaleLowerCase('ca').replace(/\s+/g,' '); }

/** Reconciliació sense inventar dades: només 'correct' substitueix un valor contradictori. */
function reconcileFacts(updates) {
  if (!Array.isArray(updates)) throw new TypeError('updates ha de ser una llista');
  const entries = new Map();
  const ordered = updates.slice().sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')));
  for (const update of ordered) {
    if (!update || update.confidence !== 'explicit' || !ALLOWED_FIELDS.has(update.field)) continue;
    const key = [update.familyId, update.groupId, update.topic, update.field].map(normalizeKey).join('::');
    if (!update.familyId || !update.groupId || !update.topic || !update.sourceId || !update.at || !key) continue;
    const value = update.value == null ? null : String(update.value).trim();
    if (!value && update.operation !== 'cancel') continue;
    const op = update.operation || 'set';
    if (!['set','correct','cancel'].includes(op)) continue;
    let record = entries.get(key);
    if (!record) {
      record = { familyId: update.familyId, groupId: update.groupId, topic: update.topic, field: update.field,
        value: op === 'cancel' ? null : value, status: op === 'cancel' ? 'cancelled' : 'active',
        sourceIds: [], history: [], needsReview: false };
      entries.set(key,record);
    }
    if (record.sourceIds.includes(update.sourceId)) continue;
    record.sourceIds.push(update.sourceId);
    if (record.sourceIds.length === 1) continue;
    if (op === 'cancel') {
      record.history.push({ previous: record.value, next: null, at: update.at, sourceId: update.sourceId });
      record.value = null; record.status = 'cancelled'; record.needsReview = false;
    } else if (op === 'correct') {
      if (record.value !== value || record.status !== 'active') {
        record.history.push({ previous: record.value, next: value, at: update.at, sourceId: update.sourceId });
      }
      record.value = value; record.status = 'active'; record.needsReview = false;
    } else if (record.value !== value) {
      record.needsReview = true;
      record.history.push({ conflicting: value, at: update.at, sourceId: update.sourceId });
    }
  }
  return [...entries.values()];
}

module.exports = { parseWhatsAppExport, reconcileFacts };
