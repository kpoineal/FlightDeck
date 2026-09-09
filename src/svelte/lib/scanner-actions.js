import { get } from 'svelte/store';
import {
  actionProposals,
  coldItems,
  deletedItemIds,
  highlightedItemId,
  history,
  isDemo,
  items,
  scanners,
  selectedProposalId,
} from './stores.js';
import { classifyActionProposalEffect } from './action-proposals.js';
import {
  isDeletedAdministrativeEvent,
  persistLiveColdItems,
  reconcileDeletedEvents,
  restoreRecordsAtStablePositions,
  stableRecordId,
} from './item-actions.js';
import { runPersistentStateTransaction } from './persistence.js';
import {
  itemOperationKey,
  releaseOperationGuards,
  scannerOperationKey,
  tryAcquireOperationGuards,
} from './operation-guards.js';

export function previewScannerDeletion(scannerId) {
  const snapshot = collectScannerDeletionSnapshot(scannerId);
  return snapshot ? toDeletionPreview(snapshot) : { ok: false, code: 'NOT_FOUND' };
}

export async function executeScannerDeletion({
  scannerId,
  disposition,
  targetScannerId = null,
  previewToken,
} = {}) {
  const snapshot = collectScannerDeletionSnapshot(scannerId);
  if (!snapshot) return { ok: false, code: 'NOT_FOUND' };
  if (!['reassign', 'delete-all'].includes(disposition)) {
    return { ok: false, code: 'INVALID_DISPOSITION' };
  }

  const preview = toDeletionPreview(snapshot);
  if (preview.previewToken !== previewToken) return { ok: false, code: 'STALE_PREVIEW' };
  if (
    disposition === 'reassign'
    && targetScannerId !== null
    && !snapshot.reassignmentTargets.some((target) => target.id === targetScannerId)
  ) {
    return { ok: false, code: 'INVALID_TARGET' };
  }

  const setColdItems = globalThis.window?.workiq?.setColdItems;
  if (snapshot.coldItemIds.length && typeof setColdItems !== 'function') {
    return { ok: false, code: 'PERSISTENCE_FAILED' };
  }

  const guardKeys = [
    scannerOperationKey(snapshot.scanner.id),
    ...snapshot.itemIds.map(itemOperationKey),
  ];
  const lease = tryAcquireOperationGuards(guardKeys, {
    type: 'scanner-deletion',
    id: snapshot.scanner.id,
    label: snapshot.scanner.name,
    startedAt: Date.now(),
  });
  if (!lease) return { ok: false, code: 'BUSY' };

  try {
    return await runScannerDeletionTransaction(snapshot, disposition, targetScannerId, setColdItems);
  } finally {
    releaseOperationGuards(lease);
  }
}

async function runScannerDeletionTransaction(snapshot, disposition, targetScannerId, setColdItems) {
  const affectedItemIds = new Set(snapshot.itemIds);
  const noEffectProposalIds = new Set(snapshot.noEffectProposalIds);
  const effectfulProposalIds = new Set(snapshot.effectfulProposalIds);
  const removedHistory = disposition === 'delete-all'
    ? snapshot.historyRecords.filter((entry) => isDeletedAdministrativeEvent(entry, noEffectProposalIds))
    : [];
  const deletedAt = new Date().toISOString();
  const deletionEvent = {
    id: `scanner_deleted_${Date.parse(deletedAt)}_${hashToken(snapshot.scanner.id)}`,
    at: deletedAt,
    kind: 'action',
    summary: `Deleted scanner "${snapshot.scanner.name}"`,
    payload: {
      event: 'scanner-deleted',
      scannerId: snapshot.scanner.id,
      scannerName: snapshot.scanner.name,
      disposition,
      targetScannerId: disposition === 'reassign' ? targetScannerId : null,
      affectedItemCount: snapshot.itemIds.length,
      removedProposalCount: disposition === 'delete-all' ? snapshot.noEffectProposalIds.length : 0,
      preservedAuditCount: snapshot.effectfulProposalIds.length,
    },
  };
  const removedScanner = snapshot.scannerRecords.filter((entry) => entry?.id === snapshot.scanner.id);
  const removedHotItems = snapshot.hotRecords.filter((entry) => affectedItemIds.has(entry?.id));
  const removedColdItems = snapshot.coldRecords.filter((entry) => affectedItemIds.has(entry?.id));
  const removedProposals = snapshot.proposalRecords.filter((entry) => noEffectProposalIds.has(entry?.id));
  const originalHighlightedItemId = snapshot.highlightedItemId;
  const originalSelectedProposalId = snapshot.selectedProposalId;
  const originalDeletedItemIds = snapshot.deletedItemIdRecords;
  const originallyDeletedIds = new Set(originalDeletedItemIds);

  const transaction = await runPersistentStateTransaction({
    isDemo: get(isDemo),
    mutate() {
      scanners.set(snapshot.scannerRecords.filter((entry) => entry?.id !== snapshot.scanner.id));
      if (disposition === 'reassign') {
        items.set(reassignRecords(snapshot.hotRecords, affectedItemIds, targetScannerId));
        coldItems.set(reassignRecords(snapshot.coldRecords, affectedItemIds, targetScannerId));
      } else {
        items.set(snapshot.hotRecords.filter((entry) => !affectedItemIds.has(entry?.id)));
        coldItems.set(snapshot.coldRecords.filter((entry) => !affectedItemIds.has(entry?.id)));
        actionProposals.set(snapshot.proposalRecords
          .filter((entry) => !noEffectProposalIds.has(entry?.id))
          .map((entry) => effectfulProposalIds.has(entry?.id) ? { ...entry, auditOnly: true } : entry));
        deletedItemIds.set([...new Set([...originalDeletedItemIds, ...snapshot.itemIds])]);
        if (affectedItemIds.has(originalHighlightedItemId)) highlightedItemId.set(null);
        if (noEffectProposalIds.has(originalSelectedProposalId)) selectedProposalId.set(null);
      }
      history.set([
        deletionEvent,
        ...(disposition === 'delete-all'
          ? snapshot.historyRecords.filter((entry) => !isDeletedAdministrativeEvent(entry, noEffectProposalIds))
          : snapshot.historyRecords),
      ]);
    },
    rollback() {
      const reconciledScanners = restoreRecordsAtStablePositions(
        get(scanners),
        snapshot.scannerRecords,
        removedScanner,
        (entry) => entry?.id
      );
      const reconciledItems = disposition === 'reassign'
        ? restoreScannerAssignments(get(items), snapshot.hotRecords, affectedItemIds, targetScannerId)
        : restoreRecordsAtStablePositions(get(items), snapshot.hotRecords, removedHotItems, (entry) => entry?.id);
      const reconciledColdItems = disposition === 'reassign'
        ? restoreScannerAssignments(get(coldItems), snapshot.coldRecords, affectedItemIds, targetScannerId)
        : restoreRecordsAtStablePositions(
          get(coldItems),
          snapshot.coldRecords,
          removedColdItems,
          (entry) => entry?.id
        );
      const reconciledHistory = reconcileDeletedEvents(
        get(history),
        snapshot.historyRecords,
        removedHistory,
        new Set([deletionEvent.id])
      );
      let reconciledProposals = get(actionProposals);
      if (disposition === 'delete-all') {
        reconciledProposals = restoreRecordsAtStablePositions(
          reconciledProposals,
          snapshot.proposalRecords,
          removedProposals,
          (entry) => entry?.id
        );
        reconciledProposals = restoreAuditMarkers(
          reconciledProposals,
          snapshot.proposalRecords,
          effectfulProposalIds
        );
      }
      if (
        !reconciledScanners
        || !reconciledItems
        || !reconciledColdItems
        || !reconciledHistory
        || !reconciledProposals
      ) {
        return false;
      }

      scanners.set(reconciledScanners);
      items.set(reconciledItems);
      coldItems.set(reconciledColdItems);
      actionProposals.set(reconciledProposals);
      history.set(reconciledHistory);
      if (disposition === 'delete-all') {
        deletedItemIds.update((ids) => ids.filter((id) => (
          originallyDeletedIds.has(id) || !affectedItemIds.has(id)
        )));
        if (affectedItemIds.has(originalHighlightedItemId) && get(highlightedItemId) === null) {
          highlightedItemId.set(originalHighlightedItemId);
        }
        if (noEffectProposalIds.has(originalSelectedProposalId) && get(selectedProposalId) === null) {
          selectedProposalId.set(originalSelectedProposalId);
        }
      }
      return true;
    },
    persistExternal: snapshot.coldItemIds.length
      ? () => persistLiveColdItems(setColdItems)
      : null,
    rollbackExternal: snapshot.coldItemIds.length
      ? () => persistLiveColdItems(setColdItems)
      : null,
  });
  if (!transaction.ok) return transaction;

  return {
    ok: true,
    code: 'OK',
    disposition,
    affectedItemIds: snapshot.itemIds,
    removedProposalCount: disposition === 'delete-all' ? snapshot.noEffectProposalIds.length : 0,
    preservedAuditCount: snapshot.effectfulProposalIds.length,
    recoveryRequired: false,
  };
}

function collectScannerDeletionSnapshot(scannerId) {
  const normalizedScannerId = String(scannerId || '').trim();
  const scannerRecords = get(scanners);
  const scanner = scannerRecords.find((entry) => entry?.id === normalizedScannerId);
  if (!scanner) return null;

  const hotRecords = get(items);
  const coldRecords = get(coldItems);
  const proposalRecords = get(actionProposals);
  const historyRecords = get(history);
  const hotItemIds = [];
  const coldItemIds = [];
  const itemIds = [];
  const itemIdSet = new Set(itemIds);
  const itemRecords = [];
  collectAffectedItems(hotRecords, normalizedScannerId, hotItemIds, itemIds, itemIdSet, itemRecords);
  collectAffectedItems(coldRecords, normalizedScannerId, coldItemIds, itemIds, itemIdSet, itemRecords);

  const threadEventsByItemId = new Map();
  const threadEventsByProposalId = new Map();
  for (const entry of itemRecords) {
    if (!Array.isArray(entry?.updateHistory)) continue;
    const threadEvents = threadEventsByItemId.get(entry.id);
    if (threadEvents) threadEvents.push(...entry.updateHistory);
    else threadEventsByItemId.set(entry.id, [...entry.updateHistory]);
    indexEventsByProposalId(entry.updateHistory, threadEventsByProposalId);
  }
  const globalEventsByProposalId = new Map();
  indexEventsByProposalId(historyRecords, globalEventsByProposalId);

  const linkedProposals = [];
  const noEffectProposalIds = [];
  const effectfulProposalIds = [];
  for (const proposal of proposalRecords) {
    if (!itemIdSet.has(proposal?.sourceItemId)) continue;
    linkedProposals.push(proposal);
    const effect = classifyActionProposalEffect(proposal, {
      threadEvents: threadEventsByItemId.get(proposal.sourceItemId) || [],
      globalEvents: globalEventsByProposalId.get(proposal.id) || [],
    });
    (effect === 'no-effect' ? noEffectProposalIds : effectfulProposalIds).push(proposal.id);
  }
  const auditIds = collectAuditIds(
    effectfulProposalIds,
    threadEventsByProposalId,
    globalEventsByProposalId
  );
  const currentHighlightedItemId = get(highlightedItemId);
  const currentSelectedProposalId = get(selectedProposalId);
  const reassignmentTargets = [
    { id: null, name: 'Unassigned Inbox' },
    ...scannerRecords
      .filter((entry) => entry?.id !== normalizedScannerId)
      .map((entry) => ({ id: entry.id, name: entry.name })),
  ];

  return {
    scanner: { id: scanner.id, name: scanner.name },
    scannerRecord: scanner,
    scannerRecords,
    hotRecords,
    coldRecords,
    proposalRecords,
    historyRecords,
    deletedItemIdRecords: get(deletedItemIds),
    highlightedItemId: currentHighlightedItemId,
    selectedProposalId: currentSelectedProposalId,
    hotItemIds,
    coldItemIds,
    itemIds,
    proposalIds: linkedProposals.map((proposal) => proposal.id),
    noEffectProposalIds,
    effectfulProposalIds,
    auditIds,
    reassignmentTargets,
  };
}

function toDeletionPreview(snapshot) {
  const itemIdSet = new Set(snapshot.itemIds);
  const proposalIdSet = new Set(snapshot.proposalIds);
  const hotItemIdSet = new Set(snapshot.hotItemIds);
  const coldItemIdSet = new Set(snapshot.coldItemIds);
  const selectedItemIds = itemIdSet.has(snapshot.highlightedItemId)
    ? [snapshot.highlightedItemId]
    : [];
  const selectedProposalIds = proposalIdSet.has(snapshot.selectedProposalId)
    ? [snapshot.selectedProposalId]
    : [];
  const preview = {
    scanner: snapshot.scanner,
    hotItemIds: snapshot.hotItemIds,
    coldItemIds: snapshot.coldItemIds,
    itemIds: snapshot.itemIds,
    proposalIds: snapshot.proposalIds,
    noEffectProposalIds: snapshot.noEffectProposalIds,
    effectfulProposalIds: snapshot.effectfulProposalIds,
    auditIds: snapshot.auditIds,
    tombstoneItemIds: snapshot.itemIds,
    selectedItemIds,
    selectedProposalIds,
    counts: {
      hotItems: snapshot.hotItemIds.length,
      coldItems: snapshot.coldItemIds.length,
      uniqueItems: snapshot.itemIds.length,
      linkedProposals: snapshot.proposalIds.length,
      noEffectProposals: snapshot.noEffectProposalIds.length,
      effectfulProposals: snapshot.effectfulProposalIds.length,
      audits: snapshot.auditIds.length,
      tombstones: snapshot.itemIds.length,
      selections: selectedItemIds.length + selectedProposalIds.length,
    },
    reassignmentTargets: snapshot.reassignmentTargets,
  };
  return {
    ...preview,
    previewToken: `scanner-deletion-${hashToken(stableSerialize({
      preview,
      scannerRecord: snapshot.scannerRecord,
      hotRecords: snapshot.hotRecords.filter((entry) => hotItemIdSet.has(entry?.id)),
      coldRecords: snapshot.coldRecords.filter((entry) => coldItemIdSet.has(entry?.id)),
      proposalRecords: snapshot.proposalRecords.filter((entry) => proposalIdSet.has(entry?.id)),
      historyRecords: snapshot.historyRecords.filter((entry) => (
        proposalIdSet.has(proposalIdForEvent(entry))
      )),
      existingTombstones: snapshot.deletedItemIdRecords.filter((id) => itemIdSet.has(id)),
    }))}`,
  };
}

function collectAuditIds(effectfulProposalIds, threadEventsByProposalId, globalEventsByProposalId) {
  const result = [];
  const seen = new Set();
  for (const proposalId of effectfulProposalIds) {
    const proposalIds = new Set([proposalId]);
    collectAuditEvents(threadEventsByProposalId.get(proposalId), proposalIds, seen, result);
    collectAuditEvents(globalEventsByProposalId.get(proposalId), proposalIds, seen, result);
  }
  return result;
}

function collectAuditEvents(events, proposalIds, seen, result) {
  for (const event of events || []) {
    if (isDeletedAdministrativeEvent(event, proposalIds)) continue;
    const eventId = stableRecordId(event);
    if (!eventId || seen.has(eventId)) continue;
    seen.add(eventId);
    result.push(eventId);
  }
}

function collectAffectedItems(records, scannerId, storageItemIds, itemIds, itemIdSet, itemRecords) {
  const storageItemIdSet = new Set();
  for (const entry of records) {
    if (entry?.scannerId !== scannerId) continue;
    itemRecords.push(entry);
    const id = entry?.id;
    if (!id) continue;
    if (!storageItemIdSet.has(id)) {
      storageItemIdSet.add(id);
      storageItemIds.push(id);
    }
    if (!itemIdSet.has(id)) {
      itemIdSet.add(id);
      itemIds.push(id);
    }
  }
}

function indexEventsByProposalId(events, eventsByProposalId) {
  for (const event of events) {
    const proposalId = proposalIdForEvent(event);
    if (!proposalId) continue;
    const indexedEvents = eventsByProposalId.get(proposalId);
    if (indexedEvents) indexedEvents.push(event);
    else eventsByProposalId.set(proposalId, [event]);
  }
}

function restoreScannerAssignments(currentRecords, originalRecords, affectedItemIds, targetScannerId) {
  if (!Array.isArray(currentRecords)) return null;
  const ids = currentRecords.map((entry) => entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return null;
  const originals = new Map(originalRecords.map((entry) => [entry?.id, entry]));
  return currentRecords.map((entry) => {
    const original = originals.get(entry?.id);
    if (!original || !affectedItemIds.has(entry.id) || entry.scannerId !== targetScannerId) return entry;
    return { ...entry, scannerId: original.scannerId };
  });
}

function restoreAuditMarkers(currentRecords, originalRecords, effectfulProposalIds) {
  if (!Array.isArray(currentRecords)) return null;
  const ids = currentRecords.map((entry) => entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return null;
  const originals = new Map(originalRecords.map((entry) => [entry?.id, entry]));
  return currentRecords.map((entry) => {
    if (!effectfulProposalIds.has(entry?.id) || entry.auditOnly !== true) return entry;
    const original = originals.get(entry.id);
    if (!original) return entry;
    if (original.auditOnly === true) return entry;
    const { auditOnly: _auditOnly, ...restored } = entry;
    return restored;
  });
}

function reassignRecords(records, affectedItemIds, targetScannerId) {
  return records.map((entry) => affectedItemIds.has(entry?.id)
    ? { ...entry, scannerId: targetScannerId }
    : entry);
}

function proposalIdForEvent(entry) {
  const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : entry;
  return payload?.proposalId || null;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashToken(value) {
  const input = String(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}