// ── Scanner background engine (Svelte) ──────────────────────────────
import { get } from 'svelte/store';
import { items, scanners, connected, activeOperations } from './stores.js';
import { addHistory } from './actions.js';
import { savePersistentState } from './persistence.js';
import { normalizeItem, computeNextRunAt } from './models/item.js';
import { computeScannerNextRunAt } from './models/scanner.js';
import { nowIso, cleanDisplayText, hashString, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';
import { buildScannerPrompt } from './prompts.js';
import { runWorkiqJson } from './json-parser.js';

const TICK_MS = 60_000; // 60s
let intervalHandle = null;
let cycleInProgress = false;

export function startScannerEngine() {
  if (intervalHandle) return;
  logInfo('scanner', 'Engine started');
  rescheduleOverdueScanners();
  intervalHandle = setInterval(checkDue, TICK_MS);
}

export function stopScannerEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function rescheduleOverdueScanners() {
  const nowMs = Date.now();
  let changed = false;

  scanners.update(($scanners) =>
    $scanners.map((scanner) => {
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
    })
  );

  if (changed) savePersistentState();
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
    for (const scanner of due) {
      try {
        logInfo('scanner', `Running "${scanner.name}"...`, { scannerId: scanner.id });
        await runScanner(scanner);
      } catch (err) {
        logError('scanner', `Scanner "${scanner.name}" failed: ${err.message}`, { scannerId: scanner.id });

        // If EULA is not accepted or launcher missing, disconnect so the banner reappears
        const msg = err.message || '';
        if (msg.includes('EULA not accepted') || msg.includes('launcher not found')) {
          connected.set(false);
          stopScannerEngine();
          addHistory('failure', `Scanner ${scanner.name}: ${msg}`, { scannerId: scanner.id });
          savePersistentState();
          return;
        }

        // Update scanner timestamps on failure and log
        scanners.update(($s) =>
          $s.map((s) =>
            s.id === scanner.id
              ? { ...s, lastRunAt: nowIso(), nextRunAt: computeScannerNextRunAt(s) }
              : s
          )
        );
        addHistory('failure', `Scanner failed: ${scanner.name}: ${err.message}`, { scannerId: scanner.id });
      }
    }
  } finally {
    cycleInProgress = false;
    savePersistentState();
  }
}



export async function runScanner(scanner) {
  const opKey = `scanner:${scanner.id}`;
  activeOperations.update(ops => { const m = new Map(ops); m.set(opKey, { type: 'scan', id: scanner.id, label: scanner.name, startedAt: Date.now() }); return m; });
  try {
  const prompt = buildScannerPrompt(scanner, get(items), get(scanners));
  const payload = await runWorkiqJson(
    prompt,
    (p) => p && Array.isArray(p.radarItems),
    'scanner'
  );

  if (!payload || !Array.isArray(payload.radarItems)) return;

  const newItems = payload.radarItems.map((item) =>
    normalizeItem({
      ...item,
      id: item.id || `radar_${hashString(cleanDisplayText(item.title || '') + nowIso())}`,
      status: item.status || 'Inbound',
      scannerId: scanner.id,
      isNew: true,
    })
  );

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

  // Prune recentTitles older than 24h
  const RECENT_TITLE_TTL_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - RECENT_TITLE_TTL_MS;
  const recentTitles = (scanner.recentTitles || []).filter(
    (entry) => new Date(entry.at).getTime() > cutoff
  );

  // Dedup against existing items
  const currentItems = get(items);
  const existingIds = new Set(currentItems.map((i) => i.id));
  const existingTitles = new Set(
    currentItems
      .filter((i) => i.scannerId === scanner.id)
      .map((i) => cleanDisplayText(i.title || '').toLowerCase())
  );

  // Add recent titles to dedup set
  for (const entry of recentTitles) {
    existingTitles.add(entry.title);
  }

  const unique = filtered.filter(
    (i) => !existingIds.has(i.id) && !existingTitles.has(cleanDisplayText(i.title || '').toLowerCase())
  );

  // Record discovered titles in scanner's recentTitles for cross-move dedup
  const existingRecentSet = new Set(recentTitles.map((e) => e.title));
  const newRecentEntries = filtered
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

  if (unique.length) {
    items.update(($i) => [...unique, ...$i]);
  }

  // Update scanner metadata
  scanners.update(($s) =>
    $s.map((s) => {
      if (s.id !== scanner.id) return s;
      const updatedLastRunAt = nowIso();
      return {
        ...s,
        lastRunAt: updatedLastRunAt,
        nextRunAt: s.scheduleType === 'one-time' ? null : computeScannerNextRunAt({ ...s, lastRunAt: updatedLastRunAt }),
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
  } finally {
    activeOperations.update(ops => { const m = new Map(ops); m.delete(opKey); return m; });
  }
}
