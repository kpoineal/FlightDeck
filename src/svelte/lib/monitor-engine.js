// ── Task-monitoring background engine (Svelte) ─────────────────────
import { get } from 'svelte/store';
import { items, connected, activeOperations } from './stores.js';
import { addHistory } from './actions.js';
import { savePersistentState } from './persistence.js';
import { computeNextRunAt } from './models/item.js';
import { nowIso, cleanDisplayText, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';import { buildMonitorPrompt } from './prompts.js';
import { runWorkiqJson } from './json-parser.js';
const TICK_MS = 30_000; // 30s
let intervalHandle = null;
let cycleInProgress = false;

export function startMonitoringLoop() {
  if (intervalHandle) return;
  logInfo('monitor', 'Monitoring loop started');
  intervalHandle = setInterval(checkDueItems, TICK_MS);
  checkDueItems(); // immediate first check
}

export function stopMonitoringLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function checkDueItems() {
  if (!get(connected) || cycleInProgress) return;

  const nowMs = Date.now();
  const currentItems = get(items);
  const due = currentItems.filter((i) =>
    i.monitorEnabled &&
    i.nextRunAt &&
    new Date(i.nextRunAt).getTime() <= nowMs &&
    i.lifecycleStatus !== 'complete' &&
    i.lifecycleStatus !== 'archived'
  );
  if (!due.length) return;

  cycleInProgress = true;
  try {
    for (const item of due) {
      try {
        logInfo('monitor', `Checking "${item.title}"`, { itemId: item.id });
        await runItemCheck(item);
      } catch (err) {
        logError('monitor', `Check failed for "${item.title}": ${err.message}`, { itemId: item.id });
        // Reschedule on failure
        items.update(($i) =>
          $i.map((i) =>
            i.id === item.id
              ? { ...i, lastRunAt: nowIso(), nextRunAt: computeNextRunAt({ ...i, lastRunAt: nowIso() }) }
              : i
          )
        );
        addHistory('failure', `Task monitor failed for ${item.title}: ${err.message}`, { itemId: item.id });
      }
    }
  } finally {
    cycleInProgress = false;
    savePersistentState();
  }
}



export async function runItemCheck(item) {
  const opKey = `item:${item.id}`;
  activeOperations.update(ops => { const m = new Map(ops); m.set(opKey, { type: 'monitor', id: item.id, label: item.title, startedAt: Date.now() }); return m; });
  try {
  const prompt = buildMonitorPrompt(item);
  const payload = await runWorkiqJson(
    prompt,
    (candidate) => candidate && typeof candidate.summary === 'string' && typeof candidate.status === 'string',
    'task-monitor'
  );

  if (!payload || typeof payload.summary !== 'string') return;

  const isFalseLike = (v) => v === false || (typeof v === 'string' && /^false$/i.test(v.trim()));
  const noUpdate = isFalseLike(payload.hasNewInfo) || /^no\s*update/i.test(cleanDisplayText(payload.status || ''));

  items.update(($items) =>
    $items.map((i) => {
      if (i.id !== item.id) return i;

      const updated = { ...i, lastRunAt: nowIso() };

      if (!noUpdate) {
        updated.summary = cleanDisplayText(payload.summary || i.summary || '');
        updated.reason = cleanDisplayText(payload.reason || i.reason || '');
        updated.status = cleanDisplayText(payload.status || i.status || 'Monitoring');
        updated.severity = normalizeSeverity(payload.severity || i.severity);
        updated.dueAt = payload.dueAt || i.dueAt || null;
        updated.owner = cleanDisplayText(payload.owner || i.owner || 'You');

        if (Array.isArray(payload.counterparties)) {
          updated.counterparties = payload.counterparties.map(cleanDisplayText).filter(Boolean);
        }
        if (Array.isArray(payload.suggestedNextSteps)) {
          updated.suggestedNextSteps = payload.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2);
        }

        // Auto-update lifecycle status
        const statusLower = (updated.status || '').toLowerCase();
        if (statusLower.includes('resolved') || statusLower.includes('complete') || statusLower.includes('closed')) {
          if (updated.lifecycleStatus !== 'complete' && updated.lifecycleStatus !== 'archived') {
            updated.lifecycleStatus = 'complete';
            updated.monitorEnabled = false;
            updated.nextRunAt = null;
            updated.completedAt = updated.completedAt || nowIso();
          }
        } else if (statusLower.includes('blocked') || statusLower.includes('stalled')) {
          if (updated.lifecycleStatus === 'in-progress') updated.lifecycleStatus = 'blocked';
        } else if (statusLower.includes('waiting') || statusLower.includes('pending')) {
          if (updated.lifecycleStatus === 'in-progress') updated.lifecycleStatus = 'waiting';
        }

        updated.lastChangedAt = nowIso();
        updated.hasNewUpdate = true;

        // Record in updateHistory
        const updateHistory = Array.isArray(updated.updateHistory) ? [...updated.updateHistory] : [];
        while (updateHistory.length >= 20) updateHistory.pop();
        const changes = [];
        const oldStatus = (i.status || '').trim().toLowerCase();
        const newStatus = (updated.status || '').trim().toLowerCase();
        const oldSev = (i.severity || '').trim().toLowerCase();
        const newSev = (updated.severity || '').trim().toLowerCase();
        if (oldStatus !== newStatus) changes.push(`Status: ${i.status} → ${updated.status}`);
        if (oldSev !== newSev) changes.push(`Severity: ${i.severity} → ${updated.severity}`);
        if (!changes.length) changes.push('Updated');
        updateHistory.unshift({
          timestamp: nowIso(),
          changes,
          summary: updated.summary || '',
          status: updated.status,
          severity: updated.severity,
          seen: false,
        });
        updated.updateHistory = updateHistory;

        addHistory('scan', `Meaningful change detected: ${updated.title}`, { itemId: updated.id });

        // In-app toast for meaningful changes
        if (updated.notifyEnabled !== false) {
          showToast(`Update: ${updated.title}`, { icon: '📋' });
        }

        // Desktop notification for critical/elevated changes
        if (updated.notifyEnabled !== false
          && (updated.severity === 'Critical' || updated.severity === 'Elevated')
          && window.workiq && typeof window.workiq.showDesktopNotification === 'function') {
          window.workiq.showDesktopNotification({
            title: `${updated.severity}: ${updated.title}`,
            body: updated.summary || 'New activity detected',
            taskId: updated.id,
          }).catch(() => {});
        }
      }

      // Handle one-time monitors
      if (updated.scheduleType === 'one-time') {
        updated.monitorEnabled = false;
        updated.nextRunAt = null;
        if (updated.lifecycleStatus !== 'complete' && updated.lifecycleStatus !== 'archived') {
          updated.lifecycleStatus = 'complete';
          if (!updated.completedAt) updated.completedAt = nowIso();
        }
      } else {
        updated.nextRunAt = computeNextRunAt(updated);
      }

      return updated;
    })
  );
  } finally {
    activeOperations.update(ops => { const m = new Map(ops); m.delete(opKey); return m; });
  }
}
