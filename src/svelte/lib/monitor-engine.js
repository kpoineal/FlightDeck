// ── Task-monitoring background engine (Svelte) ─────────────────────
import { get } from 'svelte/store';
import { items, connected } from './stores.js';
import { addHistory } from './actions.js';
import * as persistence from './persistence.js';
import { usesRepository } from './repository-context.js';
const { savePersistentState } = persistence;
import { resolveRadarItem } from './radar-navigation.js';
import {
  itemOperationKey,
  releaseOperationGuards,
  tryAcquireOperationGuards,
} from './operation-guards.js';
import { computeNextRunAt, prependItemUpdateHistory, reconcileItemEvidenceLinks } from './models/item.js';
import { nowIso, cleanDisplayText, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';import { buildMonitorPrompt } from './prompts.js';
import { runWorkiqJson } from './json-parser.js';
const TICK_MS = 30_000; // 30s
// Bound concurrent WorkIQ requests to keep scheduled monitoring predictable.
const MAX_CONCURRENT_MONITOR_CHECKS = 5;
let intervalHandle = null;
let cycleInProgress = false;
let engineGeneration = 0;

export function startMonitoringLoop() {
  if (!get(connected)) return;
  if (intervalHandle) return;
  logInfo('monitor', 'Monitoring loop started');
  intervalHandle = setInterval(checkDueItems, TICK_MS);
  checkDueItems(); // immediate first check
}

export function stopMonitoringLoop() {
  engineGeneration++;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function isDue(i) {
  return (
    i.monitorEnabled &&
    (!i.snoozeUntil || !Number.isFinite(new Date(i.snoozeUntil).getTime()) || new Date(i.snoozeUntil).getTime() <= Date.now()) &&
    i.nextRunAt &&
    new Date(i.nextRunAt).getTime() <= Date.now() &&
    i.lifecycleStatus !== 'complete' &&
    i.lifecycleStatus !== 'archived'
  );
}

async function checkDueItems() {
  if (!get(connected) || cycleInProgress) return;
  cycleInProgress = true;
  try {
    const due = usesRepository()
      ? (await window.workiq.stateQuery('dueMonitors', { now: Date.now(), limit: 100 })).rows
      : get(items).filter(isDue);
    if (!due.length) return;
    let nextDueIndex = 0;
    const workerCount = Math.min(MAX_CONCURRENT_MONITOR_CHECKS, due.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextDueIndex < due.length && get(connected)) {
        const candidate = due[nextDueIndex++];
        const item = get(items).find((i) => i.id === candidate.id) || (usesRepository() ? candidate : null);
        if (!item || !isDue(item)) continue;
        try {
          logInfo('monitor', `Checking "${item.title}"`, { itemId: item.id });
          await runItemCheck(item, { priority: 'background' });
        } catch (err) {
          if (err.code === 'QUEUE_FULL') continue;
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
    }));
  } catch (error) {
    logError('monitor', `Monitor cycle failed: ${error.message}`);
  } finally {
    cycleInProgress = false;
    savePersistentState();
  }
}



export async function runItemCheck(item, { priority = 'interactive' } = {}) {
  if (!get(connected)) return { ok: false, code: 'CONNECTION_NOT_READY' };
  const generation = engineGeneration;
  const lease = tryAcquireOperationGuards(itemOperationKey(item?.id), {
    type: 'monitor',
    id: item?.id,
    label: item?.title,
    startedAt: Date.now(),
  });
  if (!lease) return { ok: false, code: 'BUSY' };
  const engineKey = `item:${item.id}`;
  let mainLease = false;
  try {
  if (usesRepository()) {
    mainLease = await window.workiq.acquireEngine({ key: engineKey, scheduled: priority === 'background' });
    if (!mainLease) return { ok: false, code: 'BUSY' };
    if (!await persistence.flushPersistentState()) return { ok: false, code: 'PERSISTENCE_FAILED' };
    item = await resolveRadarItem(item.id);
    if (!item) return { ok: false, code: 'NOT_FOUND' };
    if (priority === 'background' && !isDue(item)) return { ok: false, code: 'SUPERSEDED' };
    if (!get(items).some(row => row.id === item.id)) items.update(rows => [item, ...rows]);
  }
  const prompt = buildMonitorPrompt(item);
  const payload = await runWorkiqJson(
    prompt,
    (candidate) => candidate && typeof candidate.summary === 'string' && typeof candidate.status === 'string',
    'task-monitor',
    { priority, key: `item:${item.id}` }
  );
  if (!get(connected) || generation !== engineGeneration || !get(items).some(entry => entry.id === item.id)) {
    return { ok: false, code: 'SUPERSEDED' };
  }

  if (!payload || typeof payload.summary !== 'string') return;

  const isFalseLike = (v) => v === false || (typeof v === 'string' && /^false$/i.test(v.trim()));
  const noUpdate = isFalseLike(payload.hasNewInfo) || /^no\s*update/i.test(cleanDisplayText(payload.status || ''));

  items.update(($items) =>
    $items.map((i) => {
      if (i.id !== item.id) return i;

      const updated = { ...i, lastRunAt: nowIso() };

      if (!noUpdate) {
        const status = cleanDisplayText(payload.status || i.status || 'Monitoring');
        const statusLower = status.toLowerCase();
        const completionConfidence = ['high', 'medium', 'low'].includes(String(payload.completionConfidence || '').toLowerCase())
          ? String(payload.completionConfidence).toLowerCase()
          : null;
        const observation = {
          summary: cleanDisplayText(payload.summary || i.summary || ''),
          reason: cleanDisplayText(payload.reason || i.reason || ''),
          status,
          severity: normalizeSeverity(payload.severity || i.severity),
          dueAt: payload.dueAt || i.dueAt || null,
          owner: cleanDisplayText(payload.owner || i.owner || 'You'),
          counterparties: Array.isArray(payload.counterparties)
            ? payload.counterparties.map(cleanDisplayText).filter(Boolean)
            : (Array.isArray(i.counterparties) ? i.counterparties : []),
          suggestedNextSteps: Array.isArray(payload.suggestedNextSteps)
            ? payload.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
            : (Array.isArray(i.suggestedNextSteps) ? i.suggestedNextSteps : []),
          evidenceLinks: reconcileItemEvidenceLinks(i, payload),
          doneCriteria: cleanDisplayText(payload.doneCriteria || i.doneCriteria || '') || null,
          completionConfidence: statusLower.includes('complete') || statusLower.includes('resolved') || statusLower.includes('closed')
            ? completionConfidence
            : null,
        };
        const currentObservation = {
          summary: i.summary || '',
          reason: i.reason || '',
          status: i.status || 'Monitoring',
          severity: normalizeSeverity(i.severity),
          dueAt: i.dueAt || null,
          owner: i.owner || 'You',
          counterparties: Array.isArray(i.counterparties) ? i.counterparties : [],
          suggestedNextSteps: Array.isArray(i.suggestedNextSteps) ? i.suggestedNextSteps : [],
          evidenceLinks: reconcileItemEvidenceLinks(i, {}),
          doneCriteria: i.doneCriteria || null,
          completionConfidence: i.completionConfidence || null,
        };
        let observedLifecycle = i.lifecycleStatus;
        if (statusLower.includes('resolved') || statusLower.includes('complete') || statusLower.includes('closed')) {
          if (i.lifecycleStatus !== 'archived') observedLifecycle = 'complete';
        } else if ((statusLower.includes('blocked') || statusLower.includes('stalled')) && i.lifecycleStatus === 'in-progress') {
          observedLifecycle = 'blocked';
        } else if ((statusLower.includes('waiting') || statusLower.includes('pending')) && i.lifecycleStatus === 'in-progress') {
          observedLifecycle = 'waiting';
        }
        observation.lifecycleStatus = observedLifecycle;
        currentObservation.lifecycleStatus = i.lifecycleStatus;

        if (JSON.stringify(observation) === JSON.stringify(currentObservation)) {
          if (updated.scheduleType === 'one-time') {
            updated.monitorEnabled = false;
            updated.nextRunAt = null;
            if (updated.lifecycleStatus !== 'complete' && updated.lifecycleStatus !== 'archived') {
              updated.lifecycleStatus = 'complete';
              updated.completedAt = updated.completedAt || nowIso();
            }
          } else {
            updated.nextRunAt = computeNextRunAt(updated);
          }
          return updated;
        }

        Object.assign(updated, observation);

        // Auto-update lifecycle status
        if (statusLower.includes('resolved') || statusLower.includes('complete') || statusLower.includes('closed')) {
          if (updated.lifecycleStatus !== 'archived') {
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
        const changes = [];
        const oldStatus = (i.status || '').trim().toLowerCase();
        const newStatus = (updated.status || '').trim().toLowerCase();
        const oldSev = (i.severity || '').trim().toLowerCase();
        const newSev = (updated.severity || '').trim().toLowerCase();
        const previousUrls = new Set((i.evidenceLinks || []).map((entry) => entry?.url).filter(Boolean));
        const newLinks = (updated.evidenceLinks || []).filter((entry) => entry?.url && !previousUrls.has(entry.url));
        if (oldStatus !== newStatus) changes.push(`Status: ${i.status} → ${updated.status}`);
        if (oldSev !== newSev) changes.push(`Severity: ${i.severity} → ${updated.severity}`);
        if (newLinks.length) changes.push(`Links: +${newLinks.length} new`);
        if (!changes.length) changes.push('Updated');
        updated.updateHistory = prependItemUpdateHistory(updated.updateHistory, {
          kind: 'reply',
          timestamp: nowIso(),
          changes,
          summary: updated.summary || '',
          status: updated.status,
          severity: updated.severity,
          sourceType: updated.sourceType,
          newLinks: newLinks.length ? newLinks : undefined,
          suggestedNextSteps: updated.suggestedNextSteps.length ? [...updated.suggestedNextSteps] : undefined,
          seen: false,
        });

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
    if (mainLease) {
      try { await savePersistentState(); } finally { await window.workiq.releaseEngine(engineKey); }
    }
    releaseOperationGuards(lease);
  }
}
