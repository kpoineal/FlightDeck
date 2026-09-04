import { get } from 'svelte/store';
import { actionProposals, coldItems, deletedItemIds, highlightedItemId, history, isDemo, items } from './stores.js';
import {
  isAcceptedPersistenceReceipt,
  runPersistentStateTransaction,
  savePersistentState,
} from './persistence.js';
import { markMailboxThreadRead } from './mailbox.js';
import { normalizeItemId, prependItemUpdateHistory } from './models/item.js';
import {
  actionProposalDuplicateKey,
  canPermanentlyDeleteActionProposal,
  classifyActionProposalEffect,
} from './action-proposals.js';

const ACTION_EVENT_LABELS = Object.freeze({
  'proposal-created': 'Action proposal created',
  'review-submitted': 'Action proposal submitted for review',
  approved: 'Action proposal approved',
  queued: 'Action proposal queued',
  'execution-started': 'Action proposal execution started',
  succeeded: 'Action proposal succeeded',
  failed: 'Action proposal failed',
  'action-unconfirmed': 'Action proposal outcome unconfirmed; check Outlook Drafts before trying again',
  rejected: 'Action proposal rejected',
  cancelled: 'Action proposal cancelled before dispatch; no external action occurred',
  archived: 'Action proposal archived',
  restored: 'Action proposal restored',
  'proposal-deleted': 'Action proposal permanently deleted',
});
const ACTION_EVENT_ALIASES = Object.freeze({
  drafted: 'proposal-created',
  'awaiting-review': 'review-submitted',
  executing: 'execution-started',
});
const ACTION_CHANNELS = new Set(['local-chat', 'planner', 'teams', 'email-send', 'outlook-draft']);
const ACTION_OUTCOMES = new Set(['pending', 'succeeded', 'failed', 'rejected', 'cancelled', 'archived', 'restored', 'unverified']);
const ACTION_VERIFICATIONS = new Set(['local-demo', 'runtime-backend-confirmed', 'not-applicable', 'unverified']);
const PROPOSAL_ADMINISTRATIVE_EVENTS = new Set([
  'proposal-created',
  'review-submitted',
  'approved',
  'queued',
  'rejected',
  'archived',
  'restored',
]);
export const ACTION_EVENT_NAMES = Object.freeze(Object.keys(ACTION_EVENT_LABELS));

function updateItem(itemId, updater) {
  let changed = false;
  items.update(($items) => $items.map((item) => {
    if (item.id !== itemId) return item;
    const updated = updater(item);
    changed = updated !== item;
    return updated;
  }));
  if (changed) savePersistentState();
  return changed;
}

export function setItemSeverity(itemId, severity) {
  return updateItem(itemId, (item) => item.severity === severity ? item : { ...item, severity });
}

export function setItemLifecycle(itemId, lifecycleStatus) {
  return updateItem(itemId, (item) => {
    if (item.lifecycleStatus === lifecycleStatus) return item;

    const changedAt = new Date().toISOString();
    const updateHistory = prependItemUpdateHistory(item.updateHistory, {
      kind: 'lifecycle',
      timestamp: changedAt,
      changes: [`Status: ${item.lifecycleStatus || 'unknown'} \u2192 ${lifecycleStatus}`],
      summary: `Status changed to ${lifecycleStatus}`,
      status: item.status,
      severity: item.severity,
      seen: true,
    });

    const updated = { ...item, lifecycleStatus, lastChangedAt: changedAt, updateHistory };
    if (lifecycleStatus === 'complete' && !updated.completedAt) updated.completedAt = changedAt;
    if (lifecycleStatus === 'complete' || lifecycleStatus === 'archived') {
      updated.monitorEnabled = false;
      updated.nextRunAt = null;
    }
    return updated;
  });
}

export function markItemRead(itemId) {
  return updateItem(itemId, markMailboxThreadRead);
}

export function setItemScheduleField(itemId, field, value) {
  return updateItem(itemId, (item) => item[field] === value ? item : { ...item, [field]: value });
}

export function setItemMonitorPrompt(itemId, monitorPrompt) {
  return updateItem(itemId, (item) => item.monitorPrompt === monitorPrompt ? item : { ...item, monitorPrompt });
}

export function setItemField(itemId, field, value) {
  const normalizedValue = field === 'dueAt' ? value || null : value;
  return updateItem(itemId, (item) => item[field] === normalizedValue
    ? item
    : { ...item, [field]: normalizedValue });
}

export async function deleteItem(itemId, {
  recordHistory = true,
  at = new Date().toISOString(),
} = {}) {
  const normalizedItemId = normalizeItemId(itemId);
  const deletedAt = normalizeTimestamp(at);
  const currentItems = get(items);
  const currentColdItems = get(coldItems);
  const removedItems = currentItems.filter((item) => item?.id === normalizedItemId);
  const target = currentItems.find((item) => item?.id === normalizedItemId)
    || currentColdItems.find((item) => item?.id === normalizedItemId);
  if (!target || !deletedAt) return { ok: false, code: 'NOT_FOUND' };

  const currentProposals = get(actionProposals);
  const currentHistory = get(history);
  const currentDeletedItemIds = get(deletedItemIds);
  const currentHighlightedItemId = get(highlightedItemId);
  const linkedProposals = currentProposals.filter((proposal) => proposal?.sourceItemId === normalizedItemId);
  const noEffectProposals = linkedProposals.filter((proposal) => classifyActionProposalEffect(proposal, {
    threadEvents: target.updateHistory,
    globalEvents: currentHistory,
  }) === 'no-effect');
  const removedProposalIds = new Set(noEffectProposals.map((proposal) => proposal.id));
  const removedHistory = currentHistory.filter((entry) => isDeletedAdministrativeEvent(entry, removedProposalIds));
  const hadDeletionExclusion = currentDeletedItemIds.includes(normalizedItemId);
  const deletionEntry = recordHistory ? {
    id: `card_deleted_${Date.parse(deletedAt)}_${normalizedItemId}`,
    at: deletedAt,
    kind: 'action',
    summary: 'Deleted card from FlightDeck',
    payload: { event: 'card-deleted' },
  } : null;
  const removedColdItems = currentColdItems.filter((item) => item?.id === normalizedItemId);
  const setColdItems = window.workiq?.setColdItems;
  if (removedColdItems.length && typeof setColdItems !== 'function') {
    return { ok: false, code: 'PERSISTENCE_FAILED' };
  }

  const transaction = await runPersistentStateTransaction({
    isDemo: get(isDemo),
    mutate() {
      items.set(currentItems.filter((item) => item?.id !== normalizedItemId));
      coldItems.set(currentColdItems.filter((item) => item?.id !== normalizedItemId));
      actionProposals.set(currentProposals.filter((proposal) => !removedProposalIds.has(proposal?.id)));
      history.set([
        ...(deletionEntry ? [deletionEntry] : []),
        ...currentHistory.filter((entry) => !isDeletedAdministrativeEvent(entry, removedProposalIds)),
      ]);
      deletedItemIds.set([...new Set([...currentDeletedItemIds, normalizedItemId])]);
      if (currentHighlightedItemId === normalizedItemId) highlightedItemId.set(null);
    },
    rollback() {
      const reconciledItems = restoreRecordsAtStablePositions(get(items), currentItems, removedItems, (item) => item?.id);
      const reconciledColdItems = restoreRecordsAtStablePositions(
        get(coldItems),
        currentColdItems,
        removedColdItems,
        (item) => item?.id
      );
      const reconciledProposals = restoreRecordsAtStablePositions(
        get(actionProposals),
        currentProposals,
        noEffectProposals,
        (proposal) => proposal?.id
      );
      const deletionIds = new Set(deletionEntry ? [deletionEntry.id] : []);
      const reconciledHistory = reconcileDeletedEvents(get(history), currentHistory, removedHistory, deletionIds);
      if (!reconciledItems || !reconciledColdItems || !reconciledProposals || !reconciledHistory) return false;
      items.set(reconciledItems);
      coldItems.set(reconciledColdItems);
      actionProposals.set(reconciledProposals);
      history.set(reconciledHistory);
      if (!hadDeletionExclusion) {
        deletedItemIds.update((currentIds) => currentIds.filter((deletedId) => deletedId !== normalizedItemId));
      }
      if (currentHighlightedItemId === normalizedItemId && get(highlightedItemId) === null) {
        highlightedItemId.set(normalizedItemId);
      }
      return true;
    },
    persistExternal: removedColdItems.length
      ? () => persistLiveColdItems(setColdItems)
      : null,
    rollbackExternal: removedColdItems.length
      ? () => persistLiveColdItems(setColdItems)
      : null,
  });
  if (!transaction.ok) return transaction;

  return {
    ok: true,
    itemId: normalizedItemId,
    removedProposalCount: noEffectProposals.length,
    preservedEffectCount: linkedProposals.length - noEffectProposals.length,
  };
}

async function persistLiveColdItems(setColdItems) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snapshot = get(coldItems);
    let result;
    try {
      result = await setColdItems(snapshot);
    } catch (_) {
      return false;
    }
    if (!isAcceptedPersistenceReceipt(result)) return false;
    if (get(coldItems) === snapshot) return true;
  }
  return false;
}

export function createActionEventId({ proposalId, event, timestamp, attempt = 0 } = {}) {
  const normalizedProposalId = sanitizeIdentifier(proposalId);
  const normalizedEvent = normalizeActionEventName(event);
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  const normalizedAttempt = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  if (!normalizedProposalId || !normalizedEvent || !normalizedTimestamp) return null;

  const input = `${normalizedProposalId}|${normalizedEvent}|${normalizedTimestamp}|${normalizedAttempt}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `action:${normalizedEvent}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function recordActionEvent(input) {
  const event = normalizeActionEvent(input);
  if (!event) return false;

  let sourceItemFound = false;
  let threadChanged = false;
  items.update(($items) => $items.map((item) => {
    if (item.id !== event.itemId) return item;
    sourceItemFound = true;
    const updateHistory = Array.isArray(item.updateHistory) ? item.updateHistory : [];
    if (updateHistory.some((entry) => entry?.eventId === event.eventId)) return item;
    threadChanged = true;
    return {
      ...item,
      lastChangedAt: event.timestamp,
      updateHistory: prependItemUpdateHistory(updateHistory, toThreadActionEvent(event)),
    };
  }));
  if (!sourceItemFound) return false;

  let globalChanged = false;
  history.update(($history) => {
    if ($history.some((entry) => entry?.eventId === event.eventId)) return $history;
    globalChanged = true;
    return [toGlobalActionEvent(event), ...$history];
  });

  if (!threadChanged && !globalChanged) return false;
  await savePersistentState(get(isDemo));
  return true;
}

export async function permanentlyDeleteActionProposal(proposalId, {
  includeDuplicates = false,
  at = new Date().toISOString(),
} = {}) {
  const currentProposals = get(actionProposals);
  const currentItems = get(items);
  const currentHistory = get(history);
  const target = currentProposals.find((proposal) => proposal?.id === proposalId);
  const deletedAt = normalizeTimestamp(at);
  if (!canPermanentlyDeleteActionProposal(target) || !deletedAt) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const duplicateKey = actionProposalDuplicateKey(target);
  const deleted = includeDuplicates
    ? currentProposals.filter((proposal) => actionProposalDuplicateKey(proposal) === duplicateKey)
    : [target];
  const deletedIds = new Set(deleted.map((proposal) => proposal.id));
  const threadEvents = currentItems.flatMap((item) => Array.isArray(item?.updateHistory) ? item.updateHistory : []);
  const effects = new Map(deleted.map((proposal) => [
    proposal.id,
    classifyActionProposalEffect(proposal, { threadEvents, globalEvents: currentHistory }),
  ]));
  const overallEffect = [...effects.values()].reduce(strongerEffect, 'no-effect');

  const itemRollbackChanges = [];
  const nextItems = currentItems.map((item) => {
    const updateHistory = Array.isArray(item?.updateHistory) ? item.updateHistory : [];
    const removedEvents = updateHistory.filter((entry) => isDeletedAdministrativeEvent(entry, deletedIds));
    const cleanedHistory = updateHistory.filter((entry) => !isDeletedAdministrativeEvent(entry, deletedIds));
    const tombstones = deleted
      .filter((proposal) => proposal.sourceItemId === item.id && effects.get(proposal.id) !== 'no-effect')
      .map((proposal, index) => toThreadDeletionTombstone(proposal, effects.get(proposal.id), deletedAt, index));
    const validTombstones = tombstones.filter(Boolean);
    if (cleanedHistory.length === updateHistory.length && validTombstones.length === 0) return item;
    itemRollbackChanges.push({
      itemId: item.id,
      originalHistory: updateHistory,
      removedEvents,
      tombstoneIds: validTombstones.map(stableRecordId),
      originalLastChangedAt: item.lastChangedAt,
      deletionChangedLastChangedAt: validTombstones.length > 0,
    });
    return {
      ...item,
      lastChangedAt: validTombstones.length ? deletedAt : item.lastChangedAt,
      updateHistory: [...validTombstones, ...cleanedHistory],
    };
  });
  const cleanedGlobalHistory = currentHistory.filter((entry) => !isDeletedAdministrativeEvent(entry, deletedIds));
  const globalTombstones = deleted
    .map((proposal, index) => toGlobalDeletionTombstone(proposal, effects.get(proposal.id), deletedAt, index))
    .filter(Boolean);

  const transaction = await runPersistentStateTransaction({
    isDemo: get(isDemo),
    mutate() {
      actionProposals.set(currentProposals.filter((proposal) => !deletedIds.has(proposal.id)));
      items.set(nextItems);
      history.set([...globalTombstones, ...cleanedGlobalHistory]);
    },
    rollback() {
      const reconciledProposals = restoreRecordsAtStablePositions(
        get(actionProposals),
        currentProposals,
        deleted,
        (proposal) => proposal?.id
      );
      const reconciledItems = reconcileDeletedItemChanges(
        get(items),
        itemRollbackChanges,
        deletedAt
      );
      const reconciledHistory = reconcileDeletedEvents(
        get(history),
        currentHistory,
        currentHistory.filter((entry) => isDeletedAdministrativeEvent(entry, deletedIds)),
        new Set(globalTombstones.map(stableRecordId))
      );
      if (!reconciledProposals || !reconciledItems || !reconciledHistory) return false;
      actionProposals.set(reconciledProposals);
      items.set(reconciledItems);
      history.set(reconciledHistory);
      return true;
    },
  });
  if (!transaction.ok) return transaction;

  return { ok: true, deletedCount: deleted.length, effect: overallEffect };
}

function reconcileDeletedItemChanges(currentItems, changes, deletedAt) {
  const itemIds = currentItems.map((item) => item?.id).filter(Boolean);
  if (new Set(itemIds).size !== itemIds.length) return null;

  const reconciled = [...currentItems];
  for (const change of changes) {
    const index = reconciled.findIndex((item) => item?.id === change.itemId);
    if (index < 0) continue;
    const currentItem = reconciled[index];
    if (!Array.isArray(currentItem.updateHistory)) return null;
    const updateHistory = reconcileDeletedEvents(
      currentItem.updateHistory,
      change.originalHistory,
      change.removedEvents,
      new Set(change.tombstoneIds)
    );
    if (!updateHistory) return null;
    reconciled[index] = {
      ...currentItem,
      lastChangedAt: change.deletionChangedLastChangedAt && currentItem.lastChangedAt === deletedAt
        ? change.originalLastChangedAt
        : currentItem.lastChangedAt,
      updateHistory,
    };
  }
  return reconciled;
}

function reconcileDeletedEvents(currentEvents, originalEvents, removedEvents, tombstoneIds) {
  if (!Array.isArray(currentEvents) || removedEvents.some((entry) => !stableRecordId(entry))) return null;
  const withoutTombstones = currentEvents.filter((entry) => !tombstoneIds.has(stableRecordId(entry)));
  return restoreRecordsAtStablePositions(withoutTombstones, originalEvents, removedEvents, stableRecordId);
}

function restoreRecordsAtStablePositions(currentRecords, originalRecords, removedRecords, getId) {
  const result = [...currentRecords];
  const resultIds = result.map(getId).filter(Boolean);
  if (new Set(resultIds).size !== resultIds.length) return null;
  if (removedRecords.some((record) => !getId(record))) return null;

  for (const removed of removedRecords) {
    const removedId = getId(removed);
    if (result.some((record) => getId(record) === removedId)) continue;
    const originalIndex = originalRecords.findIndex((record) => getId(record) === removedId);
    if (originalIndex < 0) return null;

    let insertionIndex = -1;
    for (let index = originalIndex - 1; index >= 0; index -= 1) {
      const predecessorId = getId(originalRecords[index]);
      const predecessorIndex = result.findIndex((record) => getId(record) === predecessorId);
      if (predecessorIndex >= 0) {
        insertionIndex = predecessorIndex + 1;
        break;
      }
    }
    if (insertionIndex < 0) {
      for (let index = originalIndex + 1; index < originalRecords.length; index += 1) {
        const successorId = getId(originalRecords[index]);
        const successorIndex = result.findIndex((record) => getId(record) === successorId);
        if (successorIndex >= 0) {
          insertionIndex = successorIndex;
          break;
        }
      }
    }
    result.splice(insertionIndex < 0 ? Math.min(originalIndex, result.length) : insertionIndex, 0, removed);
  }
  return result;
}

function stableRecordId(record) {
  return record?.eventId || record?.id || null;
}

function strongerEffect(current, candidate) {
  const rank = { 'no-effect': 0, uncertain: 1, confirmed: 2 };
  return rank[candidate] > rank[current] ? candidate : current;
}

function isDeletedAdministrativeEvent(entry, deletedIds) {
  const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : entry;
  return deletedIds.has(payload?.proposalId) && PROPOSAL_ADMINISTRATIVE_EVENTS.has(payload?.event);
}

function toThreadDeletionTombstone(proposal, effect, timestamp, attempt) {
  const eventId = createActionEventId({ proposalId: proposal.id, event: 'proposal-deleted', timestamp, attempt });
  if (!eventId) return null;
  return {
    kind: 'action',
    eventId,
    timestamp,
    event: 'proposal-deleted',
    summary: ACTION_EVENT_LABELS['proposal-deleted'],
    itemId: proposal.sourceItemId,
    proposalId: proposal.id,
    effect,
    seen: true,
  };
}

function toGlobalDeletionTombstone(proposal, effect, timestamp, attempt) {
  const eventId = createActionEventId({ proposalId: proposal.id, event: 'proposal-deleted', timestamp, attempt });
  if (!eventId) return null;
  return {
    id: `action_${eventId}`,
    eventId,
    at: timestamp,
    kind: 'action',
    summary: ACTION_EVENT_LABELS['proposal-deleted'],
    payload: {
      itemId: proposal.sourceItemId,
      proposalId: proposal.id,
      event: 'proposal-deleted',
      effect,
    },
  };
}

function normalizeActionEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const eventId = sanitizeIdentifier(input.eventId);
  const itemId = sanitizeIdentifier(input.itemId);
  const proposalId = sanitizeIdentifier(input.proposalId);
  const event = normalizeActionEventName(input.event);
  const timestamp = normalizeTimestamp(input.timestamp);
  if (!eventId || !itemId || !proposalId || !event || !timestamp) return null;

  const channel = ACTION_CHANNELS.has(input.channel) ? input.channel : null;
  const target = sanitizeTarget(input.target);
  const outcome = ACTION_OUTCOMES.has(input.outcome) ? input.outcome : inferredOutcome(event);
  const verification = ACTION_VERIFICATIONS.has(input.verification) ? input.verification : null;
  const code = sanitizeCode(input.code);
  return {
    eventId,
    itemId,
    proposalId,
    event,
    timestamp,
    summary: ACTION_EVENT_LABELS[event],
    channel,
    target,
    outcome,
    verification,
    code,
  };
}

function toThreadActionEvent(event) {
  return compactObject({
    kind: 'action',
    eventId: event.eventId,
    timestamp: event.timestamp,
    event: event.event,
    summary: event.summary,
    itemId: event.itemId,
    proposalId: event.proposalId,
    channel: event.channel,
    target: event.target,
    outcome: event.outcome,
    verification: event.verification,
    code: event.code,
    seen: true,
  });
}

function toGlobalActionEvent(event) {
  return {
    id: `action_${event.eventId}`,
    eventId: event.eventId,
    at: event.timestamp,
    kind: 'action',
    summary: event.summary,
    payload: compactObject({
      itemId: event.itemId,
      proposalId: event.proposalId,
      event: event.event,
      channel: event.channel,
      target: event.target,
      outcome: event.outcome,
      verification: event.verification,
      code: event.code,
    }),
  };
}

function normalizeActionEventName(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const canonical = ACTION_EVENT_ALIASES[normalized] || normalized;
  return Object.hasOwn(ACTION_EVENT_LABELS, canonical) ? canonical : null;
}

function inferredOutcome(event) {
  if (ACTION_OUTCOMES.has(event)) return event;
  return event === 'archived' || event === 'restored' ? event : 'pending';
}

function sanitizeIdentifier(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : null;
}

function sanitizeTarget(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!normalized || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : null;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function normalizeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

