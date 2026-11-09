'use strict';

/**
 * Fitxes vives, només en memòria.
 * Aquesta capa NO connecta a WhatsApp, no persisteix continguts,
 * no identifica automàticament un grup ni executa accions externes.
 */
const { reconcileFacts } = require('./pilot');

function requireScope(scope, keys) {
  if (!scope || typeof scope !== 'object') throw new TypeError('Cal un àmbit familiar');
  for (const key of keys) {
    if (typeof scope[key] !== 'string' || !scope[key].trim()) {
      throw new TypeError('Cal especificar ' + key);
    }
  }
}

/** Aïlla sempre per família i, opcionalment, pel grup autoritzat. */
function listActivityCards(updates, scope) {
  requireScope(scope, ['familyId']);
  const facts = reconcileFacts(updates).filter(f =>
    f.familyId === scope.familyId &&
    (!scope.groupId || f.groupId === scope.groupId)
  );
  const cards = new Map();
  for (const f of facts) {
    const key = JSON.stringify([f.familyId, f.groupId, f.topic]);
    if (!cards.has(key)) {
      cards.set(key, {
        familyId: f.familyId, groupId: f.groupId, topic: f.topic,
        fields: Object.create(null), requiresReview: false
      });
    }
    const card = cards.get(key);
    card.fields[f.field] = {
      value: f.value,
      status: f.status,
      needsReview: f.needsReview,
      sourceIds: f.sourceIds.slice(),
      history: f.history.map(x => ({ ...x }))
    };
    if (f.needsReview) card.requiresReview = true;
  }
  return [...cards.values()].sort((a,b) =>
    (a.groupId + '\0' + a.topic).localeCompare(b.groupId + '\0' + b.topic));
}

/**
 * Consulta determinista per camp: no infereix informació que no consta.
 * Retorna l'estat perquè la UI no presenti contradiccions com a fets ferms.
 */
function getActivityFact(updates, scope) {
  requireScope(scope, ['familyId', 'groupId', 'topic', 'field']);
  const card = listActivityCards(updates, scope).find(c =>
    c.groupId === scope.groupId && c.topic === scope.topic);
  const entry = card && card.fields[scope.field];
  if (!entry) {
    return { state: 'unknown', value: null, sourceIds: [] };
  }
  const state = entry.needsReview ? 'needs_confirmation' :
    entry.status === 'cancelled' ? 'cancelled' : 'confirmed';
  return { state, value: entry.value, sourceIds: entry.sourceIds.slice() };
}

module.exports = { listActivityCards, getActivityFact };
