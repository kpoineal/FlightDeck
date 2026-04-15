// ── Task-monitoring background engine (Svelte) ─────────────────────
import { get } from 'svelte/store';
import { items, connected } from './stores.js';
import { addHistory } from './actions.js';
import { savePersistentState } from './persistence.js';
import { computeNextRunAt } from './models/item.js';
import { nowIso, cleanDisplayText, normalizeSeverity } from './utils.js';
import { ALL_SIGNAL_TYPES } from './constants.js';
import { logInfo, logWarn, logError } from './logger.js';
import { showToast } from '../components/Toast.svelte';

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

function buildMonitorPrompt(item) {
  const title = item?.title || 'Tracked task';
  const context = item?.monitorPrompt || item?.summary || item?.reason || 'No extra context provided';
  const owner = item?.owner || 'Unknown';
  const people = Array.isArray(item?.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'None listed';
  const dueInfo = item?.dueAt ? `Due: ${item.dueAt}` : 'No due date set';
  const severity = item?.severity || 'Observe';
  const lastStatus = item?.status || 'Unknown';
  const lastSummary = item?.summary || '';
  const lastCheckTime = item?.lastRunAt || item?.trackedAt || null;
  const lastCheckInfo = lastCheckTime
    ? `Last checked: ${lastCheckTime}`
    : 'This is the first monitoring check';

  const activeSignals = Array.isArray(item?.monitorSignals) && item.monitorSignals.length
    ? item.monitorSignals
    : ALL_SIGNAL_TYPES;
  const isFiltered = activeSignals.length < ALL_SIGNAL_TYPES.length;
  const signalFilterInstruction = isFiltered
    ? `\n\nSignal source filter: ONLY consider these signal types: ${activeSignals.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}.`
    : '';

  // Previous summaries for de-dup
  const history = Array.isArray(item?.updateHistory) ? item.updateHistory : [];
  let previousSummaries = '';
  if (history.length) {
    const recent = history.slice(0, 2);
    const lines = recent.map((entry, i) => {
      const ts = entry.timestamp || 'Unknown time';
      const summary = cleanDisplayText(entry.summary || '');
      return `  ${i + 1}. [${ts}] ${summary}`;
    });
    previousSummaries = `\nPrevious update summaries (do NOT re-report the same information):\n${lines.join('\n')}\n`;
  }

  return `You are a work-tracking monitor agent. Review the latest Microsoft 365 signals and provide an updated status report for the task below.

Task to monitor:
- Title: ${title}
- Severity: ${severity}
- Status: ${lastStatus}
- ${dueInfo}
- Owner: ${owner}
- People: ${people}
- ${lastCheckInfo}

--- MONITORING CONTEXT ---
${context}${lastSummary ? `\n\nPrevious summary: ${lastSummary}` : ''}${signalFilterInstruction}
${previousSummaries}
Return strict valid JSON only:
{
  "hasNewInfo": true | false,
  "status": "In Progress|Blocked|Waiting|Complete|No Update",
  "summary": "string",
  "reason": "string",
  "severity": "Critical|Elevated|Observe",
  "dueAt": "ISO-8601 or null",
  "owner": "string",
  "counterparties": ["string"],
  "evidenceLinks": [{ "label": "string", "type": "string", "signalAt": "ISO-8601 or null" }],
  "suggestedNextSteps": ["string"],
  "doneCriteria": "string or null",
  "completionConfidence": "high|medium|low|null"
}`;
}

async function runItemCheck(item) {
  const prompt = buildMonitorPrompt(item);
  const result = await window.workiq.ask(prompt);
  if (!result.success) throw new Error(result.error || 'Monitor query failed');

  let payload;
  try {
    const jsonMatch = result.answer.match(/```json\s*([\s\S]*?)```/) || result.answer.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : result.answer;
    payload = JSON.parse(jsonStr);
  } catch {
    throw new Error('Could not parse monitor response');
  }

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
        if (i.status !== updated.status) changes.push(`Status: ${i.status} → ${updated.status}`);
        if (i.severity !== updated.severity) changes.push(`Severity: ${i.severity} → ${updated.severity}`);
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
}
