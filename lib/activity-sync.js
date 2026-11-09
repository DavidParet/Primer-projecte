'use strict';

/**
 * NEXLUPA — deterministic "living activity card" pilot.
 * Receives structured interpretations; it DOES NOT read WhatsApp or call
 * OpenAI/Google Calendar. Returned calendarOperations are plans, not writes.
 */
const MIN_AUTO_CONFIDENCE = 0.90;
function copy(v) { return JSON.parse(JSON.stringify(v)); }
function validInstant(iso) {
  return typeof iso === 'string' && /T\d{2}:\d{2}:\d{2}[+-]\d\d:\d\d$/.test(iso) &&
    !Number.isNaN(Date.parse(iso));
}
function operationKey(a) {
  return [a.kind, a.eventId || '', a.start || '', a.material || '', a.title || ''].join('|');
}
function processMessage(previous, envelope, interpretation, policy = {}) {
  const state = copy(previous), changes = [], calendarOperations = [], pending = [];
  const response = ignored => ({state, changes, calendarOperations, pending, ignored});
  if (!envelope || !envelope.authorized || !envelope.messageId || !envelope.activityId)
    return response('not-authorized-or-incomplete');
  if (state.id !== envelope.activityId || state.enabled !== true)
    return response('different-or-disabled-activity');
  state.processedMessageIds ||= [];
  state.pendingReviews ||= [];
  if (state.processedMessageIds.includes(envelope.messageId))
    return response('duplicate-message-id');
  if (!interpretation || interpretation.activityId !== state.id || !Array.isArray(interpretation.actions))
    return response('invalid-interpretation');

  function review(action, reason) {
    const key = operationKey(action);
    if (!state.pendingReviews.some(item => item.key === key)) {
      const item = {key, sourceMessageId: envelope.messageId, action, reason};
      state.pendingReviews.push(item); pending.push(item);
    }
  }
  function calendar(event, operation, extra = {}) {
    if (state.calendarConnected && policy.autoCalendar === true) {
      calendarOperations.push({
        operation, eventId: event.id, calendarEventId: event.calendarEventId || null,
        idempotencyKey: state.id + ':' + event.id + ':' + event.revision + ':' + operation,
        ...extra
      });
    }
  }
  for (const action of interpretation.actions) {
    if (!action || typeof action !== 'object' || action.kind === 'no-op') continue;
    if (Number(action.confidence ?? 0) < MIN_AUTO_CONFIDENCE) {
      review(action, 'low-confidence'); continue;
    }
    if (action.kind === 'event-update') {
      const evt = (state.events || []).find(e => e.id === action.eventId);
      if (!evt || !evt.calendarEventId || !validInstant(action.start) || !validInstant(evt.start)) {
        review(action, 'event-not-identifiable-or-date-invalid'); continue;
      }
      if (!policy.autoUpdateConfirmedEvents) {
        review(action, 'user-confirmation-required'); continue;
      }
      const oldStart = evt.start;
      const durationMs = Date.parse(evt.end) - Date.parse(evt.start);
      const end = action.end || new Date(Date.parse(action.start) + durationMs).toISOString();
      if (!(durationMs > 0) || Number.isNaN(Date.parse(end))) {
        review(action, 'invalid-event-duration'); continue;
      }
      const place = typeof action.place === 'string' ? action.place : evt.place;
      if (Date.parse(oldStart) === Date.parse(action.start) && evt.place === place) continue;
      evt.start = action.start; evt.end = end; evt.place = place;
      evt.revision = (evt.revision || 0) + 1;
      evt.sourceMessageIds = Array.from(new Set([...(evt.sourceMessageIds || []), envelope.messageId]));
      changes.push({kind:'event-updated', eventId:evt.id, previousStart:oldStart, newStart:evt.start});
      calendar(evt, 'update', {start:evt.start, end:evt.end, place:evt.place});
    } else if (action.kind === 'material-add') {
      if (typeof action.material !== 'string' || !action.material.trim()) {
        review(action, 'missing-material'); continue;
      }
      const normalized = action.material.trim().toLocaleLowerCase('ca');
      if (!(state.materials || []).some(m => m.normalized === normalized)) {
        state.materials ||= [];
        state.materials.push({text:action.material.trim(), normalized, sourceMessageId:envelope.messageId});
        changes.push({kind:'material-added', material:action.material.trim()});
      }
    } else if (action.kind === 'event-cancel') {
      review(action, 'cancellation-requires-confirmation');
    } else if (action.kind === 'event-create') {
      review(action, 'new-event-requires-confirmation');
    } else if (action.kind === 'task-add') {
      if (typeof action.title !== 'string' || !action.title.trim()) {
        review(action, 'missing-task-title'); continue;
      }
      const normalized = action.title.trim().toLocaleLowerCase('ca');
      state.tasks ||= [];
      if (!state.tasks.some(t => t.normalized === normalized)) {
        state.tasks.push({title:action.title.trim(), normalized, sourceMessageId:envelope.messageId});
        changes.push({kind:'task-added', title:action.title.trim()});
      }
    } else review(action, 'unsupported-operation');
  }
  state.processedMessageIds.push(envelope.messageId);
  return response(null);
}
module.exports = {processMessage};
