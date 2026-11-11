// ── Scanner background engine (Svelte) ──────────────────────────────
import { get } from 'svelte/store';
import { items, coldItems, scanners, connected, deletedItemIds } from './stores.js';
import { addHistory } from './actions.js';
import * as persistence from './persistence.js';
import { usesRepository, rememberRepositoryThread } from './repository-context.js';
const { savePersistentState } = persistence;
import {
  releaseOperationGuards,
  scannerOperationKey,
  tryAcquireOperationGuards,
} from './operation-guards.js';
import {
  normalizeItem,
  normalizeItemId,
  collectItemSourceIdentities,
  deriveStableItemId,
  computeNextRunAt,
} from './models/item.js';
import { computeScannerNextRunAt } from './models/scanner.js';
import { nowIso, cleanDisplayText, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';
import { buildScannerPrompt } from './prompts.js';
import { runWorkiqJson } from './json-parser.js';
import { hydrateRadarColdItems } from './radar-navigation.js';
import { disconnectWorkiq } from './connection.js';

const TICK_MS = 60_000; // 60s
const MAX_CONCURRENT_SCANS = 5;
let intervalHandle = null;
let cycleInProgress = false;
let engineGeneration = 0;

export function startScannerEngine() {
  if (!get(connected)) return;
  if (intervalHandle) return;
  logInfo('scanner', 'Engine started');
  rescheduleOverdueScanners();
  intervalHandle = setInterval(checkDue, TICK_MS);
  void checkDue();
}

export function resumeScannerEngine() {
  if (!get(connected)) return;
  if (!intervalHandle) {
    startScannerEngine();
    return;
  }
  void checkDue();
}

export function stopScannerEngine() {
  engineGeneration++;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function rescheduleOverdueScanners() {
  const nowMs = Date.now();
  let changed = false;

  const current = get(scanners);
  const updated = current.map((scanner) => {
      if (!scanner.enabled || !scanner.nextRunAt) return scanner;
      const dueAt = new Date(scanner.nextRunAt).getTime();
      if (!Number.isFinite(dueAt) || dueAt > nowMs) return scanner;

      changed = true;
      const policy = scanner.missedRunPolicy || 'run-once';
      if (policy === 'skip') {
        return { ...scanner, nextRunAt: computeScannerNextRunAt(scanner) };
      }
      // run-once / catch-up: set nextRunAt to now so it fires on next tick
      return { ...scanner, nextRunAt: new Date(nowMs).toISOString() };
    });

  if (changed) { scanners.set(updated); void savePersistentState(); }
}

async function checkDue() {
  if (!get(connected) || cycleInProgress) return;

  const nowMs = Date.now();
  const due = get(scanners).filter(
    (s) => s.enabled && s.nextRunAt && new Date(s.nextRunAt).getTime() <= nowMs
  );
  if (!due.length) return;

  cycleInProgress = true;
  try {
    let nextDueIndex = 0;
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SCANS, due.length) }, async () => {
      while (nextDueIndex < due.length && get(connected)) {
        const candidate = due[nextDueIndex++];
        const scanner = get(scanners).find((s) => s.id === candidate.id);
        if (!scanner?.enabled || !scanner.nextRunAt || !(new Date(scanner.nextRunAt).getTime() <= Date.now())) continue;
        try {
          logInfo('scanner', `Running "${scanner.name}"...`, { scannerId: scanner.id });
          await runScanner(scanner, { priority: 'background' });
        } catch (err) {
          if (err.code === 'QUEUE_FULL') continue;
          logError('scanner', `Scanner "${scanner.name}" failed: ${err.message}`, { scannerId: scanner.id });

          // If EULA is not accepted or launcher missing, disconnect so the banner reappears
          const msg = err.message || '';
          if (msg.includes('EULA not accepted') || msg.includes('launcher not found')) {
            void disconnectWorkiq();
            stopScannerEngine();
            addHistory('failure', `Scanner ${scanner.name}: ${msg}`, { scannerId: scanner.id });
            savePersistentState();
            return;
          }

          // Update scanner timestamps on failure and log
          scanners.update(($s) =>
            $s.map((s) =>
              s.id === scanner.id
                ? { ...s, lastRunAt: nowIso(), lastRunStatus: 'failed', nextRunAt: computeScannerNextRunAt(s) }
                : s
            )
          );
          addHistory('failure', `Scanner failed: ${scanner.name}: ${err.message}`, { scannerId: scanner.id });
        }
      }
    }));
  } finally {
    cycleInProgress = false;
    savePersistentState();
  }
}



export async function runScanner(scanner, { priority = 'interactive' } = {}) {
  if (!get(connected)) return { ok: false, code: 'CONNECTION_NOT_READY' };
  const generation = engineGeneration;
  const lease = tryAcquireOperationGuards(scannerOperationKey(scanner?.id), {
    type: 'scan',
    id: scanner?.id,
    label: scanner?.name,
    startedAt: Date.now(),
  });
  if (!lease) return { ok: false, code: 'BUSY' };
  const engineKey = `scanner:${scanner.id}`;
  let mainLease = false;
  try {
  if (usesRepository()) {
    mainLease = await window.workiq.acquireEngine({ key: engineKey, scheduled: priority === 'background' });
    if (!mainLease) return { ok: false, code: 'BUSY' };
    if (!await persistence.flushPersistentState()) return { ok: false, code: 'PERSISTENCE_FAILED' };
  }
  const prompt = buildScannerPrompt(scanner, get(items), get(scanners));
  const payload = await runWorkiqJson(
    prompt,
    (p) => p && Array.isArray(p.radarItems),
    'scanner',
    { priority, key: `scanner:${scanner.id}` }
  );
  if (!get(connected) || generation !== engineGeneration || !get(scanners).some(entry => entry.id === scanner.id)) {
    return { ok: false, code: 'SUPERSEDED' };
  }

  if (!payload || !Array.isArray(payload.radarItems)) return;
  if (!payload || !Array.isArray(payload.radarItems)) {
    return { ok: false, code: 'INVALID_RESPONSE' };
  }

  // Identity checks must include the authoritative cold store, even when Inbox has not hydrated it yet.
  if (!usesRepository()) await hydrateRadarColdItems();

  const newItems = payload.radarItems.map((item) => {
    const candidateId = normalizeItemId(item?.id) || deriveStableItemId(item, scanner.id);
    return normalizeItem({
      ...item,
      workPlanChoice: undefined,
      ...(candidateId ? { id: candidateId } : {}),
      status: item.status || 'Inbound',
      scannerId: scanner.id,
      isNew: true,
    });
  });

  // Enforce maxItemsPerScan cap
  const maxItems = scanner.maxItemsPerScan || 10;
  const capped = newItems.slice(0, maxItems);

  // Exclude keywords filter
  const excludeKeywords = Array.isArray(scanner.excludeKeywords) ? scanner.excludeKeywords : [];
  const filtered = excludeKeywords.length
    ? capped.filter((item) => {
        const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
        return !excludeKeywords.some((kw) => kw && text.includes(kw.toLowerCase()));
      })
    : capped;

  const currentScanner = get(scanners).find((entry) => entry.id === scanner.id);
  if (!currentScanner || !get(connected) || generation !== engineGeneration) return { ok: false, code: 'SUPERSEDED' };
  const excludedItemIds = new Set(currentScanner.excludedItemIds || []);
  const globallyDeletedItemIds = new Set(get(deletedItemIds));
  const eligible = filtered.filter((item) => !excludedItemIds.has(item.id) && !globallyDeletedItemIds.has(item.id));

  // Prune recentTitles older than 24h
  const RECENT_TITLE_TTL_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - RECENT_TITLE_TTL_MS;
  const recentTitles = (scanner.recentTitles || []).filter(
    (entry) => new Date(entry.at).getTime() > cutoff
  );

  // Dedup against existing items
  const currentItems = [...get(items), ...get(coldItems)];
  const existingIds = new Set();
  const sourceIdentityOwners = new Map();
  const addSourceIdentities = (item, ownerScannerId) => {
    for (const identity of collectItemSourceIdentities(item)) {
      if (!sourceIdentityOwners.has(identity)) sourceIdentityOwners.set(identity, new Set());
      sourceIdentityOwners.get(identity).add(ownerScannerId);
    }
  };

  for (const item of currentItems) {
    if (!item?.id || globallyDeletedItemIds.has(item.id)) continue;
    existingIds.add(item.id);
    addSourceIdentities(item, item.scannerId || null);
  }
  if (usesRepository()) {
    const retained = await window.workiq.stateQuery('sourceOwners', {
      identities: [...new Set(eligible.flatMap(collectItemSourceIdentities))].slice(0, 500),
      ids: eligible.map(item => item.id),
    });
    for (const id of retained.ids) existingIds.add(id);
    for (const owner of retained.rows) {
      if (!sourceIdentityOwners.has(owner.identity)) sourceIdentityOwners.set(owner.identity, new Set());
      sourceIdentityOwners.get(owner.identity).add(owner.scannerId);
    }
  }

  const allowCrossScannerDedup = currentScanner.crossScannerDedup !== false;
  const unique = [];
  for (const candidate of eligible) {
    if (existingIds.has(candidate.id)) continue;

    const sourceIdentities = collectItemSourceIdentities(candidate);
    const sourceMatch = sourceIdentities.some((identity) => {
      const owners = sourceIdentityOwners.get(identity);
      if (!owners) return false;
      return [...owners].some((ownerScannerId) =>
        ownerScannerId === scanner.id || (allowCrossScannerDedup && ownerScannerId !== scanner.id)
      );
    });
    if (sourceMatch) continue;

    unique.push(candidate);
    existingIds.add(candidate.id);
    addSourceIdentities(candidate, scanner.id);
  }

  // Retain recent titles as scanner metadata; title history is not an acceptance filter.
  const existingRecentSet = new Set(recentTitles.map((e) => e.title));
  const newRecentEntries = eligible
    .map((i) => ({ title: cleanDisplayText(i.title || '').toLowerCase(), at: nowIso() }))
    .filter((e) => !existingRecentSet.has(e.title));
  const updatedRecentTitles = [...recentTitles, ...newRecentEntries];

  // Auto-monitor if scanner has autoMonitorNewItems
  if (scanner.autoMonitorNewItems && unique.length) {
    const threshold = scanner.autoMonitorSeverityThreshold || 'all';
    for (const item of unique) {
      const severity = normalizeSeverity(item.severity);
      const meetsThreshold =
        threshold === 'all' ||
        (threshold === 'Critical' && severity === 'Critical') ||
        (threshold === 'Elevated' && (severity === 'Critical' || severity === 'Elevated'));
      if (meetsThreshold) {
        item.monitorEnabled = true;
        item.trackedAt = item.trackedAt || nowIso();
        item.scheduleType = scanner.defaultMonitorScheduleType || 'interval';
        item.scheduleValue = scanner.defaultMonitorSchedule || '4h';
        item.workHoursOnly = scanner.defaultMonitorWorkHoursOnly === true;
        item.notifyEnabled = scanner.defaultMonitorNotifyEnabled !== false;
        item.nextRunAt = computeNextRunAt(item);
      }
    }
  }

  if (usesRepository() && unique.length) {
    if (!await persistence.flushPersistentState()) return { ok: false, code: 'PERSISTENCE_FAILED' };
    const result = await persistence.executeRepositoryCommand('acceptScannerResults', { scannerId: scanner.id, items: unique });
    if (!result.ok) return result;
    const accepted = new Set(result.changedIds);
    for (let index = unique.length - 1; index >= 0; index--) {
      if (!accepted.has(unique[index].id)) unique.splice(index, 1);
      else rememberRepositoryThread(unique[index]);
    }
  }
  if (unique.length) {
    items.update(($i) => [...unique, ...$i]);
  }

  // Update scanner metadata
  const completedAt = nowIso();
  scanners.update(($s) =>
    $s.map((s) => {
      if (s.id !== scanner.id) return s;
      return {
        ...s,
        lastRunAt: completedAt,
        lastRunStatus: 'success',
        nextRunAt: s.scheduleType === 'one-time' ? null : computeScannerNextRunAt({ ...s, lastRunAt: completedAt }),
        itemCount: get(items).filter((i) => i.scannerId === s.id).length,
        enabled: s.scheduleType === 'one-time' ? false : s.enabled,
        recentTitles: updatedRecentTitles,
      };
    })
  );

  if (unique.length) {
    addHistory('scan', `Scanner "${scanner.name}" found ${unique.length} new item(s)`, { scannerId: scanner.id });

    // In-app toast
    const notifMode = scanner.notificationMode || 'all';
    if (notifMode !== 'silent') {
      const shouldNotify = notifMode !== 'critical-only'
        || unique.some((i) => normalizeSeverity(i.severity) === 'Critical');
      if (shouldNotify) {
        const label = unique.length === 1
          ? unique[0].title
          : `${unique.length} items from ${scanner.name}`;
        showToast(label, { icon: '\uD83D\uDD0D' });
      }
    }

    // Desktop notification
    if (notifMode !== 'silent' && window.workiq && typeof window.workiq.showDesktopNotification === 'function') {
      const notifyItems = notifMode === 'critical-only'
        ? unique.filter((i) => normalizeSeverity(i.severity) === 'Critical')
        : unique;
      if (notifyItems.length) {
        const title = `Scanner: ${scanner.name}`;
        const body = notifyItems.length === 1
          ? `New item: ${notifyItems[0].title}`
          : `${notifyItems.length} new items found`;
        window.workiq.showDesktopNotification({ title, body, taskId: notifyItems[0].id }).catch(() => {});
      }
    }
  }
  return { ok: true, code: 'COMPLETED', newItemCount: unique.length, completedAt };
  } finally {
    if (mainLease) {
      try { await savePersistentState(); } finally { await window.workiq.releaseEngine(engineKey); }
    }
    releaseOperationGuards(lease);
  }
}
