// ── Store persistence bridge ─────────────────────────────────────────
// Connects Svelte stores to electron-store via the existing IPC bridge.
import { get } from 'svelte/store';
import {
  items,
  scanners,
  meetings,
  meetingsLastFetched,
  briefingsByMeetingId,
  briefingSeenAt,
  history,
  connected,
  density,
  filter,
  collapsedSections,
  scannerSortPrefs,
  actionProposals,
  deletedItemIds,
} from './stores.js';
import {
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  DEMO_STORAGE_KEY,
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_ENTRIES,
  MAX_EVIDENCE_LINKS_PER_ITEM,
  MAX_ACTIVE_ITEMS,
  COLD_EVICTION_HOURS,
  AUTO_ARCHIVE_DAYS,
  DAY_BRIEFING_KEY,
  DEFAULT_SCANNER_PROMPT,
} from './constants.js';
import { hashString } from './utils.js';
import {
  capItemUpdateHistory,
  filterDeletedItems,
  normalizeDeletedItemIds,
  normalizeItem,
  normalizeItemId,
} from './models/item.js';
import { normalizeScannerDefinition, computeScannerNextRunAt } from './models/scanner.js';
import {
  normalizeActionProposal,
  normalizeActionProposals,
  recoverStaleExecutingActionProposal,
} from './action-proposals.js';
import fixtureData from '../../demo/fixture.json';

// Guard: true only after loadPersistentState completes
let _loaded = false;
let _scheduledSaveTimer = null;
let _activeTransaction = null;
let _writesInFlight = 0;
let _hydrationGeneration = 0;
let _mutationEpoch = 0;
let _hydrationApplying = false;

export function isAcceptedPersistenceReceipt(receipt) {
  if (receipt === true) return true;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (Object.getPrototypeOf(receipt) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(receipt);
  if (keys.length !== 1 || keys[0] !== 'success') return false;
  const descriptor = Object.getOwnPropertyDescriptor(receipt, 'success');
  return descriptor !== undefined
    && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    && descriptor.value === true
    && descriptor.writable === true
    && descriptor.enumerable === true
    && descriptor.configurable === true;
}

export function cancelScheduledPersistentStateSave() {
  clearTimeout(_scheduledSaveTimer);
  _scheduledSaveTimer = null;
}

export function schedulePersistentStateSave(isDemo = false, delayMs = 500) {
  if (!_loaded || _hydrationApplying) return;
  if (_activeTransaction) {
    if (_activeTransaction.phase === 'persisting' || _activeTransaction.phase === 'rollback-persisting') {
      _activeTransaction.followUpRequested = true;
      _activeTransaction.followUpDemo = _activeTransaction.followUpDemo || isDemo;
    }
    return;
  }

  cancelScheduledPersistentStateSave();
  _scheduledSaveTimer = setTimeout(() => {
    _scheduledSaveTimer = null;
    savePersistentState(isDemo);
  }, delayMs);
}

export async function runPersistentStateTransaction({
  mutate,
  rollback,
  persistExternal = null,
  rollbackExternal = null,
  isDemo = false,
} = {}) {
  if (_activeTransaction || _writesInFlight > 0) return { ok: false, code: 'BUSY' };
  if (typeof mutate !== 'function' || typeof rollback !== 'function') {
    return { ok: false, code: 'INVALID_TRANSACTION' };
  }

  cancelScheduledPersistentStateSave();
  _mutationEpoch += 1;
  const transaction = {
    phase: 'mutating',
    followUpRequested: false,
    followUpDemo: isDemo,
    saveWaiters: [],
  };
  _activeTransaction = transaction;

  let result;
  let externalAttempted = false;
  let canonicalAttempted = false;
  try {
    mutate();
    if (typeof persistExternal === 'function') {
      externalAttempted = true;
      transaction.phase = 'external-persisting';
      if (await persistExternal() !== true) result = { ok: false, code: 'PERSISTENCE_FAILED' };
    }
    if (!result) {
      transaction.phase = 'persisting';
      canonicalAttempted = true;
      result = await writePersistentState(isDemo)
        ? { ok: true }
        : { ok: false, code: 'PERSISTENCE_FAILED' };
    }
  } catch (_) {
    result = { ok: false, code: 'PERSISTENCE_FAILED' };
  }

  if (!result.ok) {
    transaction.phase = 'rolling-back';
    let restored = false;
    try {
      restored = rollback() !== false;
      if (restored && externalAttempted) {
        transaction.phase = 'external-rollback-persisting';
        restored = typeof rollbackExternal === 'function' && await rollbackExternal() === true;
      }
      if (restored && canonicalAttempted) {
        transaction.followUpRequested = false;
        transaction.phase = 'rollback-persisting';
        restored = await writePersistentState(isDemo);
      }
    } catch (_) {
      restored = false;
    }
    if (!restored) result = { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' };
  }

  transaction.phase = 'finishing';
  if (_activeTransaction === transaction) _activeTransaction = null;
  _mutationEpoch += 1;

  let followUpResult = result.code !== 'PERSISTENCE_RECOVERY_REQUIRED';
  if (transaction.followUpRequested && result.code !== 'PERSISTENCE_RECOVERY_REQUIRED') {
    followUpResult = await writePersistentState(transaction.followUpDemo);
  }
  for (const resolve of transaction.saveWaiters) resolve(followUpResult);
  return result;
}

// ── Demo fixture seeding ────────────────────────────────────────────

/**
 * Seed demo fixture data into the demo storage key if it's empty.
 * Adjusts all dates in the fixture to be relative to now so the demo
 * never looks stale regardless of when it's run.
 */
export async function seedDemoFixture(force = false) {
  try {
    if (!force) {
      const existing = await window.workiq.storeGet(DEMO_STORAGE_KEY);
      if (existing && existing.items && existing.items.length) return; // already seeded
    }

    const fixture = JSON.parse(JSON.stringify(fixtureData)); // deep clone

    // Adjust dates relative to now
    const ANCHOR = new Date('2026-04-17T12:00:00Z').getTime();
    const offset = Date.now() - ANCHOR;
    const shiftDate = (iso) => {
      if (!iso) return iso;
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return iso;
      return new Date(t + offset).toISOString();
    };

    for (const item of fixture.items || []) {
      item.discoveredAt = shiftDate(item.discoveredAt);
      item.trackedAt = shiftDate(item.trackedAt);
      item.lastRunAt = shiftDate(item.lastRunAt);
      item.lastChangedAt = shiftDate(item.lastChangedAt);
      item.completedAt = shiftDate(item.completedAt);
      item.nextRunAt = shiftDate(item.nextRunAt);
      item.dueAt = shiftDate(item.dueAt);
      item.oneTimeAt = shiftDate(item.oneTimeAt);
      item.snoozeUntil = shiftDate(item.snoozeUntil);
      if (Array.isArray(item.updateHistory)) {
        for (const entry of item.updateHistory) {
          entry.timestamp = shiftDate(entry.timestamp);
        }
      }
      if (Array.isArray(item.evidenceLinks)) {
        for (const link of item.evidenceLinks) {
          link.signalAt = shiftDate(link.signalAt);
        }
      }
    }

    for (const scanner of fixture.scanners || []) {
      scanner.lastRunAt = shiftDate(scanner.lastRunAt);
      scanner.nextRunAt = shiftDate(scanner.nextRunAt);
    }

    for (const mtg of fixture.meetings || []) {
      mtg.startAt = shiftDate(mtg.startAt);
      mtg.endAt = shiftDate(mtg.endAt);
      mtg.startTime = mtg.startAt ? new Date(mtg.startAt).getTime() : undefined;
    }

    for (const briefing of Object.values(fixture.briefingsByMeetingId || {})) {
      briefing.generatedAt = shiftDate(briefing.generatedAt);
      if (briefing.upcomingMeeting) {
        briefing.upcomingMeeting.startAt = shiftDate(briefing.upcomingMeeting.startAt);
      }
      if (Array.isArray(briefing.meetingsRequiringPrep)) {
        for (const mp of briefing.meetingsRequiringPrep) {
          mp.startAt = shiftDate(mp.startAt);
        }
      }
    }

    for (const entry of fixture.history || []) {
      entry.at = shiftDate(entry.at);
    }

    fixture.meetingsLastFetched = Date.now();

    const receipt = await window.workiq.storeSet(DEMO_STORAGE_KEY, fixture);
    if (!isAcceptedPersistenceReceipt(receipt)) throw new Error('Demo persistence was not confirmed.');
    console.log('[flightdeck] Demo fixture data seeded');
  } catch (err) {
    console.warn('[flightdeck] Failed to seed demo fixture', err.message);
  }
}

// ── Housekeeping helpers ────────────────────────────────────────────

export function pruneHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  history.update((h) => {
    let pruned = h.filter((entry) => {
      const entryTime = entry.at ? new Date(entry.at).getTime() : 0;
      return Number.isFinite(entryTime) && entryTime > cutoff;
    });
    if (pruned.length > HISTORY_MAX_ENTRIES) {
      pruned = pruned.slice(0, HISTORY_MAX_ENTRIES);
    }
    return pruned;
  });
}

export function pruneStaleBriefings() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();

  briefingsByMeetingId.update((byId) => {
    const updated = { ...byId };
    let changed = false;
    for (const [meetingId, briefing] of Object.entries(updated)) {
      if (meetingId === DAY_BRIEFING_KEY) {
        const generatedAt = briefing?.generatedAt
          ? new Date(briefing.generatedAt).getTime()
          : null;
        if (generatedAt && Number.isFinite(generatedAt) && generatedAt < cutoff) {
          delete updated[meetingId];
          changed = true;
        }
        continue;
      }
      const meetingStart = briefing?.upcomingMeeting?.startAt
        ? new Date(briefing.upcomingMeeting.startAt).getTime()
        : null;
      if (meetingStart && Number.isFinite(meetingStart) && meetingStart < cutoff) {
        delete updated[meetingId];
        changed = true;
      }
    }
    return changed ? updated : byId;
  });

  // Also clean up stale seenAt entries
  briefingSeenAt.update((seenAt) => {
    const currentBriefings = get(briefingsByMeetingId);
    const updated = { ...seenAt };
    let changed = false;
    for (const key of Object.keys(updated)) {
      if (!(key in currentBriefings)) {
        delete updated[key];
        changed = true;
      }
    }
    return changed ? updated : seenAt;
  });
}

export function autoArchiveCompletedItems() {
  const cutoff = Date.now() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  items.update(($items) => {
    for (const item of $items) {
      if (item.lifecycleStatus !== 'complete') continue;
      const completedAt = item.lastChangedAt
        || (Array.isArray(item.updateHistory) && item.updateHistory.length ? item.updateHistory[0].timestamp : null)
        || item.lastRunAt || item.trackedAt;
      if (!completedAt) continue;
      const completedTime = new Date(completedAt).getTime();
      if (Number.isFinite(completedTime) && completedTime < cutoff) {
        item.lifecycleStatus = 'archived';
        item.monitorEnabled = false;
        item.nextRunAt = null;
        changed = true;
      }
    }
    return $items;
  });
  return changed;
}

// ── Load from electron-store ────────────────────────────────────────

function pruneHydratedHistory(entries) {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  return entries
    .filter((entry) => {
      const entryTime = entry.at ? new Date(entry.at).getTime() : 0;
      return Number.isFinite(entryTime) && entryTime > cutoff;
    })
    .slice(0, HISTORY_MAX_ENTRIES);
}

function pruneHydratedBriefings(byId, seenAt) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();
  const briefings = { ...byId };

  for (const [meetingId, briefing] of Object.entries(briefings)) {
    const relevantTime = meetingId === DAY_BRIEFING_KEY
      ? (briefing?.generatedAt ? new Date(briefing.generatedAt).getTime() : null)
      : (briefing?.upcomingMeeting?.startAt ? new Date(briefing.upcomingMeeting.startAt).getTime() : null);
    if (relevantTime && Number.isFinite(relevantTime) && relevantTime < cutoff) delete briefings[meetingId];
  }

  const prunedSeenAt = Object.fromEntries(
    Object.entries(seenAt).filter(([meetingId]) => meetingId in briefings)
  );
  return { briefings, seenAt: prunedSeenAt };
}

function autoArchiveHydratedItems(loadedItems) {
  const cutoff = Date.now() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const item of loadedItems) {
    if (item.lifecycleStatus !== 'complete') continue;
    const completedAt = item.lastChangedAt
      || (Array.isArray(item.updateHistory) && item.updateHistory.length ? item.updateHistory[0].timestamp : null)
      || item.lastRunAt || item.trackedAt;
    if (!completedAt) continue;
    const completedTime = new Date(completedAt).getTime();
    if (Number.isFinite(completedTime) && completedTime < cutoff) {
      item.lifecycleStatus = 'archived';
      item.monitorEnabled = false;
      item.nextRunAt = null;
      changed = true;
    }
  }
  return changed;
}

function canApplyHydration(generation, epoch) {
  return generation === _hydrationGeneration
    && epoch === _mutationEpoch
    && !_activeTransaction
    && _writesInFlight === 0
    && !_hydrationApplying;
}

export async function loadPersistentState(isDemo = false) {
  const generation = ++_hydrationGeneration;
  const epoch = _mutationEpoch;
  const useDemo = isDemo;

  try {
    let parsed = await window.workiq.storeGet(useDemo ? DEMO_STORAGE_KEY : STORAGE_KEY) ?? null;
    let usedLegacyKey = false;
    if (!parsed && !useDemo) {
      parsed = await window.workiq.storeGet(LEGACY_STORAGE_KEY) ?? null;
      usedLegacyKey = Boolean(parsed);
    }
    if (!parsed) parsed = {};

    const loadedDeletedItemIds = normalizeDeletedItemIds(parsed.deletedItemIds);
    const loadedDeletedItemIdSet = new Set(loadedDeletedItemIds);

    // ── Migration: unified items model ──────────────────────────────
    let loadedItems;
    if (Array.isArray(parsed.items)) {
      loadedItems = parsed.items
        .map((entry) => normalizeItem(entry))
        .filter((entry) => !loadedDeletedItemIdSet.has(entry.id));
    } else {
      const trackingById = new Map();
      const migratedItems = [];
      if (Array.isArray(parsed.trackingItems)) {
        for (const entry of parsed.trackingItems) {
          const normalized = normalizeItem(entry);
          trackingById.set(normalized.id, true);
          migratedItems.push(normalized);
        }
      }
      if (Array.isArray(parsed.radarItems)) {
        for (const entry of parsed.radarItems) {
          if (trackingById.has(entry.id)) continue;
          migratedItems.push(normalizeItem(entry));
        }
      }
      loadedItems = migratedItems.filter((entry) => !loadedDeletedItemIdSet.has(entry.id));
    }

    // Trim oversized histories + enforce evidence caps + clear stale flags
    for (const item of loadedItems) {
      if (Array.isArray(item.updateHistory) && item.updateHistory.length > 20) {
        item.updateHistory = capItemUpdateHistory(item.updateHistory);
      }
      if (Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > MAX_EVIDENCE_LINKS_PER_ITEM) {
        item.evidenceLinks = item.evidenceLinks.slice(-MAX_EVIDENCE_LINKS_PER_ITEM);
      }
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') {
        item.hasNewUpdate = false;
        item.isNew = false;
        item.monitorEnabled = false;
        item.nextRunAt = null;
        if (!item.completedAt && item.lifecycleStatus === 'complete') {
          item.completedAt = item.lastChangedAt || new Date().toISOString();
        }
        if (Array.isArray(item.updateHistory)) {
          item.updateHistory.forEach((e) => { e.seen = true; });
        }
      }
    }

    const loadedBriefings = parsed.briefingsByMeetingId && typeof parsed.briefingsByMeetingId === 'object'
      ? parsed.briefingsByMeetingId
      : {};
    const loadedBriefingSeenAt = parsed.briefingSeenAt && typeof parsed.briefingSeenAt === 'object'
      ? parsed.briefingSeenAt
      : {};
    const prunedBriefings = pruneHydratedBriefings(loadedBriefings, loadedBriefingSeenAt);

    // Restore cached meetings (filter to today's future meetings)
    let loadedMeetings = [];
    if (Array.isArray(parsed.meetings) && parsed.meetings.length) {
      const now = Date.now();
      loadedMeetings = parsed.meetings.filter(
        (m) => m.startTime && Number.isFinite(m.startTime) && m.startTime >= now
      );
    }
    const loadedMeetingsLastFetched = typeof parsed.meetingsLastFetched === 'number'
      ? parsed.meetingsLastFetched
      : 0;

    let loadedScanners = Array.isArray(parsed.scanners)
      ? parsed.scanners.map((entry) => normalizeScannerDefinition(entry))
      : [];

    // Strip legacy isDefault flag
    for (const scanner of loadedScanners) {
      if ('isDefault' in scanner) delete scanner.isDefault;
    }

    // Seed scanner on first run
    if (!loadedScanners.length) {
      let radarPrompt = DEFAULT_SCANNER_PROMPT;
      try {
        const result = await window.workiq.readPromptFile('radar-scan.md');
        if (result.success && result.content) radarPrompt = result.content.trim();
      } catch (_) {}
      const seed = normalizeScannerDefinition({
        id: `scanner_${hashString(`${Date.now()}_${Math.random()}`)}`,
        name: 'Radar',
        prompt: radarPrompt,
        enabled: true,
        scheduleType: 'interval',
        scheduleValue: '4h',
      });
      seed.nextRunAt = computeScannerNextRunAt(seed);
      loadedScanners.push(seed);
    }

    const loadedHistory = pruneHydratedHistory(Array.isArray(parsed.history) ? parsed.history : []);
    let recoveredStaleExecution = false;
    const loadedActionProposals = (Array.isArray(parsed.actionProposals) ? parsed.actionProposals : [])
      .map((persistedProposal) => {
        const proposal = normalizeActionProposal(persistedProposal);
        if (!proposal || persistedProposal?.state !== 'Executing') return proposal;
        recoveredStaleExecution = true;
        return recoverStaleExecutingActionProposal(proposal);
      })
      .filter(Boolean);

    const loadedDensity = parsed.density === 'minimal' ? 'minimal'
      : (parsed.trackingDensity === 'minimal' ? 'minimal' : 'full');

    const rawFilter = parsed.filter || parsed.trackingFilter || 'all';
    const loadedFilter = (rawFilter === 'all' || rawFilter === 'archived') ? rawFilter : 'all';
    const loadedCollapsedSections = Array.isArray(parsed.collapsedSections) ? parsed.collapsedSections : [];
    const loadedScannerSortPrefs = parsed.scannerSortPrefs && typeof parsed.scannerSortPrefs === 'object'
      ? parsed.scannerSortPrefs
      : {};

    let loadedConnected = parsed.connected === true;
    let connectionChanged = false;
    if (loadedConnected) {
      if (window.workiq && typeof window.workiq.acceptEula === 'function') {
        try {
          const result = await window.workiq.acceptEula();
          loadedConnected = result?.success === true;
        } catch (_) {
          loadedConnected = false;
        }
        connectionChanged = !loadedConnected;
      }
    }

    const autoArchived = autoArchiveHydratedItems(loadedItems);
    const coldCutoff = Date.now() - COLD_EVICTION_HOURS * 60 * 60 * 1000;
    const hasColdMigrationCandidate = loadedItems.some((item) => {
      if (item.lifecycleStatus !== 'archived' && item.lifecycleStatus !== 'complete') return false;
      const timestamp = item.lastChangedAt || item.lastRunAt || item.trackedAt || item.discoveredAt;
      const time = timestamp ? new Date(timestamp).getTime() : 0;
      return Number.isFinite(time) && time < coldCutoff;
    });

    if (!canApplyHydration(generation, epoch)) return false;

    _hydrationApplying = true;
    try {
      deletedItemIds.set(loadedDeletedItemIds);
      items.set(loadedItems);
      briefingsByMeetingId.set(prunedBriefings.briefings);
      briefingSeenAt.set(prunedBriefings.seenAt);
      meetings.set(loadedMeetings);
      meetingsLastFetched.set(loadedMeetingsLastFetched);
      scanners.set(loadedScanners);
      history.set(loadedHistory);
      actionProposals.set(loadedActionProposals);
      density.set(loadedDensity);
      filter.set(loadedFilter);
      collapsedSections.set(loadedCollapsedSections);
      scannerSortPrefs.set(loadedScannerSortPrefs);
      connected.set(loadedConnected);
      _loaded = true;
    } finally {
      _hydrationApplying = false;
    }

    if (usedLegacyKey) await window.workiq.storeDelete(LEGACY_STORAGE_KEY);
    if (recoveredStaleExecution || autoArchived || hasColdMigrationCandidate || connectionChanged) {
      await savePersistentState(useDemo);
    }
    return true;
  } catch (error) {
    if (canApplyHydration(generation, epoch)) _loaded = true;
    console.warn('[flightdeck] persistence read failed', error.message);
    return false;
  }
}

// ── Save to electron-store ──────────────────────────────────────────

export async function savePersistentState(isDemo = false) {
  if (_hydrationApplying) return true;
  if (_activeTransaction) {
    _activeTransaction.followUpRequested = true;
    _activeTransaction.followUpDemo = _activeTransaction.followUpDemo || isDemo;
    return new Promise((resolve) => _activeTransaction.saveWaiters.push(resolve));
  }
  return writePersistentState(isDemo);
}

async function writePersistentState(isDemo = false) {
  if (!_loaded) return false;

  _writesInFlight += 1;
  _mutationEpoch += 1;

  pruneHistory();

  const normalizedDeletedItemIds = normalizeDeletedItemIds(get(deletedItemIds));
  const deletedIds = new Set(normalizedDeletedItemIds);
  let currentItems = get(items).filter((item) => !deletedIds.has(normalizeItemId(item?.id))).map((item) => (
    Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > MAX_EVIDENCE_LINKS_PER_ITEM
      ? { ...item, evidenceLinks: item.evidenceLinks.slice(-MAX_EVIDENCE_LINKS_PER_ITEM) }
      : item
  ));

  // ── Tiered storage eviction ─────────────────────────────────────
  const evictionCutoff = Date.now() - COLD_EVICTION_HOURS * 60 * 60 * 1000;
  const hotItems = [];
  const evictedItems = [];

  for (const item of currentItems) {
    const isColdCandidate = item.lifecycleStatus === 'archived' || item.lifecycleStatus === 'complete';
    if (isColdCandidate) {
      const transitionedAt = item.lastChangedAt || item.lastRunAt || item.trackedAt || item.discoveredAt;
      const transitionTime = transitionedAt ? new Date(transitionedAt).getTime() : 0;
      if (Number.isFinite(transitionTime) && transitionTime < evictionCutoff) {
        evictedItems.push(item);
        continue;
      }
    }
    hotItems.push(item);
  }

  if (evictedItems.length) {
    try {
      const existingCold = await window.workiq.getColdItems() || [];
      const coldById = new Map(filterDeletedItems(existingCold, normalizedDeletedItemIds).map((c) => [c.id, c]));
      for (const item of evictedItems) coldById.set(item.id, item);
      const receipt = await window.workiq.setColdItems([...coldById.values()]);
      if (!isAcceptedPersistenceReceipt(receipt)) throw new Error('Cold persistence was not confirmed.');
      items.set(hotItems);
      currentItems = hotItems;
      console.log(`[flightdeck] Evicted ${evictedItems.length} item(s) to cold storage`);
    } catch (err) {
      console.warn('[flightdeck] cold storage eviction failed, keeping items hot', err.message);
    }
  }

  // Enforce global active items cap
  if (currentItems.length > MAX_ACTIVE_ITEMS) {
    const sortedForEviction = [...currentItems].sort((a, b) => {
      const aIsOld = a.lifecycleStatus === 'archived' || a.lifecycleStatus === 'complete' ? 0 : 1;
      const bIsOld = b.lifecycleStatus === 'archived' || b.lifecycleStatus === 'complete' ? 0 : 1;
      if (aIsOld !== bIsOld) return aIsOld - bIsOld;
      const aTime = new Date(a.discoveredAt || 0).getTime() || 0;
      const bTime = new Date(b.discoveredAt || 0).getTime() || 0;
      return aTime - bTime;
    });
    const overflow = sortedForEviction.slice(0, currentItems.length - MAX_ACTIVE_ITEMS);
    const overflowIds = new Set(overflow.map((i) => i.id));
    try {
      const existingCold = await window.workiq.getColdItems() || [];
      const coldById = new Map(filterDeletedItems(existingCold, normalizedDeletedItemIds).map((c) => [c.id, c]));
      for (const item of overflow) coldById.set(item.id, item);
      const receipt = await window.workiq.setColdItems([...coldById.values()]);
      if (!isAcceptedPersistenceReceipt(receipt)) throw new Error('Cold persistence was not confirmed.');
      currentItems = currentItems.filter((i) => !overflowIds.has(i.id));
      items.set(currentItems);
      console.log(`[flightdeck] Cap overflow: evicted ${overflow.length} item(s) to cold storage`);
    } catch (err) {
      console.warn('[flightdeck] cap overflow eviction failed', err.message);
    }
  }

  const currentDensity = get(density);
  const payload = {
    items: currentItems,
    trackingItems: currentItems,
    scanners: get(scanners),
    radarItems: currentItems,
    briefingsByMeetingId: get(briefingsByMeetingId),
    briefingSeenAt: get(briefingSeenAt),
    meetings: get(meetings),
    meetingsLastFetched: get(meetingsLastFetched),
    history: get(history),
    connected: get(connected),
    density: currentDensity,
    filter: get(filter),
    collapsedSections: get(collapsedSections),
    scannerSortPrefs: get(scannerSortPrefs),
    actionProposals: normalizeActionProposals(get(actionProposals)),
    deletedItemIds: normalizedDeletedItemIds,
    trackingDensity: currentDensity,
    radarDensity: currentDensity,
  };

  const key = isDemo ? DEMO_STORAGE_KEY : STORAGE_KEY;

  try {
    const receipt = await window.workiq.storeSet(key, payload);
    return isAcceptedPersistenceReceipt(receipt);
  } catch (error) {
    console.warn('[flightdeck] persistence write failed', error.message);
    return false;
  } finally {
    _writesInFlight -= 1;
    _mutationEpoch += 1;
    try {
      window.workiq.broadcastStateChanged();
    } catch (_) {}
  }
}
