// ── Scanner background engine (Svelte) ──────────────────────────────
import { get } from 'svelte/store';
import { items, scanners, connected } from './stores.js';
import { addHistory } from './actions.js';
import { savePersistentState } from './persistence.js';
import { normalizeItem, computeNextRunAt } from './models/item.js';
import { computeScannerNextRunAt } from './models/scanner.js';
import { nowIso, cleanDisplayText, hashString, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';

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

function buildScannerPromptSimple(scanner) {
  const userPrompt = scanner.prompt || '';
  const lastRunAt = scanner.lastRunAt || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const maxItems = scanner.maxItemsPerScan || 10;

  const currentItems = get(items);
  const dedupLines = [];
  const seen = new Set();
  for (const item of currentItems) {
    if (item.scannerId !== scanner.id) continue;
    if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
    const title = cleanDisplayText(item.title || '');
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    dedupLines.push(`- ${title}`);
    if (dedupLines.length >= 20) break;
  }
  const dedupBlock = dedupLines.length
    ? `\n\nItems already on my radar from this scanner (do NOT re-report these):\n${dedupLines.join('\n')}`
    : '';

  // Signal type filtering
  const signalTypes = Array.isArray(scanner.signalTypes) && scanner.signalTypes.length
    ? scanner.signalTypes
    : ALL_SIGNAL_TYPES;
  const isFiltered = signalTypes.length < ALL_SIGNAL_TYPES.length;
  const signalFilterBlock = isFiltered
    ? `\n\nSignal source filter (IMPORTANT):\n- ONLY search for and consider these signal types: ${signalTypes.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}.`
    : '';

  return `You are a work-signal scanner agent. Analyze recent Microsoft 365 signals and surface new items that need attention.

--- SCANNER MISSION ---
${userPrompt.replace(/\{lastRunAt\}/g, lastRunAt)}

Time window: Last scan was at ${lastRunAt}. Only return items with signals created or updated AFTER this time.${signalFilterBlock}

Return at most ${maxItems} items. Return strict valid JSON only:
{
  "radarItems": [
    {
      "id": "string",
      "title": "string",
      "severity": "Critical|Elevated|Observe",
      "sourceType": "string",
      "dueAt": "ISO-8601 or null",
      "owner": "string",
      "counterparties": ["string"],
      "summary": "string",
      "reason": "string",
      "status": "Inbound",
      "evidenceLinks": [{ "label": "string", "type": "string", "signalAt": "ISO-8601 or null" }],
      "suggestedNextSteps": ["string"],
      "doneCriteria": "string or null"
    }
  ]
}${dedupBlock}`;
}

async function runScanner(scanner) {
  const prompt = buildScannerPromptSimple(scanner);
  const result = await window.workiq.ask(prompt);
  if (!result.success) throw new Error(result.error || 'Scanner query failed');

  let payload;
  try {
    const jsonMatch = result.answer.match(/```json\s*([\s\S]*?)```/) || result.answer.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : result.answer;
    payload = JSON.parse(jsonStr);
  } catch {
    throw new Error('Could not parse scanner response');
  }

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

  // Dedup against existing items
  const currentItems = get(items);
  const existingIds = new Set(currentItems.map((i) => i.id));
  const existingTitles = new Set(
    currentItems
      .filter((i) => i.scannerId === scanner.id)
      .map((i) => cleanDisplayText(i.title || '').toLowerCase())
  );
  const unique = filtered.filter(
    (i) => !existingIds.has(i.id) && !existingTitles.has(cleanDisplayText(i.title || '').toLowerCase())
  );

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
}
