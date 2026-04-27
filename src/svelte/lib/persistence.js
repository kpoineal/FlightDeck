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
import { normalizeItem } from './models/item.js';
import { normalizeScannerDefinition, computeScannerNextRunAt } from './models/scanner.js';
import fixtureData from '../../demo/fixture.json';

// Guard: true only after loadPersistentState completes
let _loaded = false;

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

    await window.workiq.storeSet(DEMO_STORAGE_KEY, fixture);
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

export async function loadPersistentState(isDemo = false) {
  try {
    const useDemo = isDemo;
    let parsed = await window.workiq.storeGet(useDemo ? DEMO_STORAGE_KEY : STORAGE_KEY) ?? null;
    let usedLegacyKey = false;
    if (!parsed && !useDemo) {
      parsed = await window.workiq.storeGet(LEGACY_STORAGE_KEY) ?? null;
      usedLegacyKey = Boolean(parsed);
    }
    if (!parsed) parsed = {};

    if (usedLegacyKey) {
      await window.workiq.storeDelete(LEGACY_STORAGE_KEY);
    }

    // ── Migration: unified items model ──────────────────────────────
    let loadedItems;
    if (Array.isArray(parsed.items)) {
      loadedItems = parsed.items.map((entry) => normalizeItem(entry));
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
      loadedItems = migratedItems;
    }

    // Trim oversized histories + enforce evidence caps + clear stale flags
    for (const item of loadedItems) {
      if (Array.isArray(item.updateHistory) && item.updateHistory.length > 20) {
        item.updateHistory = item.updateHistory.slice(0, 20);
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

    // Populate stores
    items.set(loadedItems);

    briefingsByMeetingId.set(
      parsed.briefingsByMeetingId && typeof parsed.briefingsByMeetingId === 'object'
        ? parsed.briefingsByMeetingId
        : {}
    );
    briefingSeenAt.set(
      parsed.briefingSeenAt && typeof parsed.briefingSeenAt === 'object'
        ? parsed.briefingSeenAt
        : {}
    );

    // Restore cached meetings (filter to today's future meetings)
    if (Array.isArray(parsed.meetings) && parsed.meetings.length) {
      const now = Date.now();
      const cachedMeetings = parsed.meetings.filter(
        (m) => m.startTime && Number.isFinite(m.startTime) && m.startTime >= now
      );
      if (cachedMeetings.length) meetings.set(cachedMeetings);
    }
    if (typeof parsed.meetingsLastFetched === 'number') {
      meetingsLastFetched.set(parsed.meetingsLastFetched);
    }

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

    scanners.set(loadedScanners);
    history.set(Array.isArray(parsed.history) ? parsed.history : []);

    const loadedDensity = parsed.density === 'minimal' ? 'minimal'
      : (parsed.trackingDensity === 'minimal' ? 'minimal' : 'full');
    density.set(loadedDensity);

    const rawFilter = parsed.filter || parsed.trackingFilter || 'all';
    filter.set((rawFilter === 'all' || rawFilter === 'archived') ? rawFilter : 'all');

    collapsedSections.set(Array.isArray(parsed.collapsedSections) ? parsed.collapsedSections : []);
    scannerSortPrefs.set(
      parsed.scannerSortPrefs && typeof parsed.scannerSortPrefs === 'object'
        ? parsed.scannerSortPrefs
        : {}
    );

    if (parsed.connected === true) {
      // Re-validate that EULA is still accepted before restoring connected state.
      // Set connected optimistically; scanner-engine will reset if EULA check fails.
      if (window.workiq && typeof window.workiq.acceptEula === 'function') {
        window.workiq.acceptEula().then((result) => {
          if (!result.success) {
            connected.set(false);
            savePersistentState();
          }
        }).catch(() => {
          connected.set(false);
          savePersistentState();
        });
      }
      connected.set(true);
    }

    pruneHistory();
    pruneStaleBriefings();
    autoArchiveCompletedItems();

    // ── Cold storage migration on load ───────────────────────────────
    try {
      const coldCutoff = Date.now() - COLD_EVICTION_HOURS * 60 * 60 * 1000;
      const currentItems = get(items);
      const migrateToCode = [];
      const keepHot = [];
      for (const item of currentItems) {
        const isCold = item.lifecycleStatus === 'archived' || item.lifecycleStatus === 'complete';
        if (isCold) {
          const ts = item.lastChangedAt || item.lastRunAt || item.trackedAt || item.discoveredAt;
          const t = ts ? new Date(ts).getTime() : 0;
          if (Number.isFinite(t) && t < coldCutoff) {
            migrateToCode.push(item);
            continue;
          }
        }
        keepHot.push(item);
      }
      if (migrateToCode.length) {
        const existingCold = await window.workiq.getColdItems() || [];
        const coldById = new Map(existingCold.map((c) => [c.id, c]));
        for (const item of migrateToCode) coldById.set(item.id, item);
        await window.workiq.setColdItems([...coldById.values()]);
        items.set(keepHot);
        console.log(`[flightdeck] Migrated ${migrateToCode.length} item(s) to cold storage on load`);
      }
    } catch (coldErr) {
      console.warn('[flightdeck] cold storage migration on load failed', coldErr.message);
    }

    _loaded = true;
  } catch (error) {
    _loaded = true;
    console.warn('[flightdeck] persistence read failed', error.message);
  }
}

// ── Save to electron-store ──────────────────────────────────────────

export async function savePersistentState(isDemo = false) {
  if (!_loaded) return;

  pruneHistory();

  let currentItems = get(items);

  // Enforce evidence link cap
  for (const item of currentItems) {
    if (Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > MAX_EVIDENCE_LINKS_PER_ITEM) {
      item.evidenceLinks = item.evidenceLinks.slice(-MAX_EVIDENCE_LINKS_PER_ITEM);
    }
  }

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
      const coldById = new Map(existingCold.map((c) => [c.id, c]));
      for (const item of evictedItems) coldById.set(item.id, item);
      await window.workiq.setColdItems([...coldById.values()]);
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
      const coldById = new Map(existingCold.map((c) => [c.id, c]));
      for (const item of overflow) coldById.set(item.id, item);
      await window.workiq.setColdItems([...coldById.values()]);
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
    trackingDensity: currentDensity,
    radarDensity: currentDensity,
  };

  const key = isDemo ? DEMO_STORAGE_KEY : STORAGE_KEY;

  try {
    await window.workiq.storeSet(key, payload);
  } catch (error) {
    console.warn('[flightdeck] persistence write failed', error.message);
  } finally {
    window.workiq.broadcastStateChanged();
  }
}
