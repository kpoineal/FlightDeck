// ── Task-monitoring engine ─────────────────────────────────────────

let monitorIntervalHandle = null;
let monitorCycleInProgress = false;

/**
 * Extract the last 2 update history summaries to include in the monitoring
 * prompt. This prevents the LLM from oscillating between the same signals
 * by showing it what it already reported in recent cycles.
 */
function buildPreviousSummariesContext(item) {
  const history = Array.isArray(item?.updateHistory) ? item.updateHistory : [];
  if (!history.length) return '';

  const recent = history.slice(0, 2);
  const lines = recent.map((entry, i) => {
    const timestamp = safeDate(entry.timestamp, 'Unknown time');
    const summary = cleanDisplayText(entry.summary || '').trim();
    return `  ${i + 1}. [${timestamp}] ${summary}`;
  });

  return `\nPrevious update summaries (for de-duplication — do NOT re-report the same information described here as "new"):\n${lines.join('\n')}\nIf the signals you find are already covered by these previous summaries, set hasNewInfo to false and return the current summary verbatim.\n`;
}

function isFalseLike(value) {
  if (value === false || value === 0) return true;
  if (typeof value === 'string') return /^false$/i.test(value.trim());
  return false;
}

async function monitorTaskItem(item, { manual = false } = {}) {
  if (!item) {
    return;
  }

  const payload = await runWorkiqJson(
    buildTaskMonitorPrompt(item),
    (candidate) => candidate && typeof candidate.summary === 'string' && typeof candidate.status === 'string',
    'task-monitor'
  );

  const previousSignature = item.lastCheckSignature || trackingItemSignature(item);
  const prevRunAt = item.lastRunAt || item.trackedAt;
  const prevSummary = item.summary;
  const prevStatus = item.status;
  const prevSeverity = item.severity;

  // Determine if the LLM found genuinely new information
  const llmSaysNoUpdate = isFalseLike(payload.hasNewInfo)
    || /^no\s*update/i.test(cleanDisplayText(payload.status || ''));

  if (llmSaysNoUpdate) {
    // Preserve existing summary/reason/links to prevent signature drift from LLM rephrasing
    item.lastRunAt = nowIso();
  } else {
    item.summary = cleanDisplayText(payload.summary || item.summary || '');
    item.reason = cleanDisplayText(payload.reason || item.reason || '');
    item.status = cleanDisplayText(payload.status || item.status || 'Monitoring');

    // Auto-update lifecycle status based on AI-reported status
    const statusLower = (item.status || '').toLowerCase();
    if (statusLower.includes('blocked') || statusLower.includes('stalled')) {
      if (item.lifecycleStatus === 'in-progress') {
        item.lifecycleStatus = 'blocked';
      }
    } else if (statusLower.includes('waiting') || statusLower.includes('pending')) {
      if (item.lifecycleStatus === 'in-progress') {
        item.lifecycleStatus = 'waiting';
      }
    } else if (statusLower.includes('resolved') || statusLower.includes('complete') || statusLower.includes('closed')) {
      if (item.lifecycleStatus !== 'complete' && item.lifecycleStatus !== 'archived') {
        item.lifecycleStatus = 'complete';
        item.monitorEnabled = false;
        item.nextRunAt = null;
      }
    } else if (statusLower.includes('in progress') || statusLower.includes('active') || statusLower.includes('ongoing')) {
      if (item.lifecycleStatus === 'blocked' || item.lifecycleStatus === 'waiting') {
        item.lifecycleStatus = 'in-progress';
      }
    }

    item.severity = normalizeSeverity(payload.severity || item.severity);
    item.dueAt = payload.dueAt || item.dueAt || null;
    item.owner = cleanDisplayText(payload.owner || item.owner || 'You');
    item.counterparties = Array.isArray(payload.counterparties)
      ? payload.counterparties.map(cleanDisplayText).filter(Boolean)
      : item.counterparties;
    item.suggestedNextSteps = Array.isArray(payload.suggestedNextSteps)
      ? payload.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
      : [];
    item.lastRunAt = nowIso();
  }

  // Replace evidence links with the LLM's curated response, but only when
  // there is genuinely new information.  When the LLM says nothing changed we
  // must leave the existing links untouched to avoid signature drift that
  // could cause false-positive notifications on subsequent cycles.
  const prevLinks = item.evidenceLinks || [];
  let discoveredLinks = [];
  if (!llmSaysNoUpdate && Array.isArray(payload.evidenceLinks)) {
    const curatedLinks = [];
    const seenUrls = new Set();
    for (const link of payload.evidenceLinks) {
      const normalized = normalizeEvidenceLink(link, item.sourceType || 'source');
      if (!normalized || seenUrls.has(normalized.url)) continue;
      curatedLinks.push(normalized);
      seenUrls.add(normalized.url);
    }
    // Supplement with inline citations from summary/reason text
    const inlineLinks = [
      ...extractInlineCitations(payload.summary || ''),
      ...extractInlineCitations(payload.reason || ''),
    ];
    // Fallback: extract bare URLs if no markdown citations found
    if (!inlineLinks.length) {
      inlineLinks.push(
        ...extractBareUrlCitations(payload.summary || ''),
        ...extractBareUrlCitations(payload.reason || ''),
      );
    }
    // Adopt descriptive labels from structured evidenceLinks
    adoptStructuredLabels(inlineLinks, payload.evidenceLinks);
    for (const link of inlineLinks) {
      if (!link.url || seenUrls.has(link.url)) continue;
      curatedLinks.push(link);
      seenUrls.add(link.url);
    }
    // Merge: preserve previous links not in the new set, then add new ones
    const mergedLinks = [...curatedLinks];
    const curatedUrls = new Set(curatedLinks.map((e) => e.url));
    for (const prev of prevLinks) {
      if (prev.url && !curatedUrls.has(prev.url)) {
        mergedLinks.push(prev);
      }
    }
    item.evidenceLinks = mergedLinks;
    // Identify truly new links for change-tracking purposes
    const prevUrls = new Set(prevLinks.map((e) => e.url));
    discoveredLinks = curatedLinks.filter((e) => !prevUrls.has(e.url));
  }

  const nextSignature = trackingItemSignature(item);
  // Detect changes — new links count as meaningful even when LLM says no update
  const linksChanged = discoveredLinks.length > 0;
  const fieldsChanged = !llmSaysNoUpdate && Boolean(previousSignature && previousSignature !== nextSignature);
  const changed = fieldsChanged || linksChanged;
  item.lastCheckSignature = nextSignature;

  if (changed) {
    item.lastChangedAt = nowIso();
    // Build a list of what changed for the history entry
    const changes = [];
    const statusChanged = prevStatus !== item.status;
    const severityChanged = prevSeverity !== item.severity;
    const summaryChanged = prevSummary !== item.summary;

    // Only flag "Summary updated" when it's the sole substantive change.
    // When status, severity, or links also changed the LLM naturally rewrites
    // the summary to incorporate the new info — that rewrite is expected, not
    // an independent update worth calling out.
    if (summaryChanged && !statusChanged && !severityChanged && !linksChanged) {
      changes.push('Summary updated');
    }
    if (statusChanged) changes.push(`Status: ${prevStatus} → ${item.status}`);
    if (discoveredLinks.length) changes.push(`Links: +${discoveredLinks.length} new`);
    // Severity changes are tracked in a separate dedicated entry below
    if (!severityChanged && !changes.length) changes.push('Details changed');

    if (!Array.isArray(item.updateHistory)) item.updateHistory = [];

    // Record severity change as its own dedicated history entry so it
    // stands out in the timeline and isn't conflated with content updates.
    if (severityChanged) {
      item.updateHistory.unshift({
        timestamp: nowIso(),
        changes: [`Severity: ${prevSeverity} → ${item.severity}`],
        summary: '',
        status: item.status,
        severity: item.severity,
        seen: false,
      });
    }

    // Record the content/links update entry (skip if severity was the only change)
    if (changes.length) {
      item.updateHistory.unshift({
        timestamp: nowIso(),
        changes,
        summary: prevSummary || '',
        status: item.status,
        severity: item.severity,
        newLinks: discoveredLinks.length ? discoveredLinks : undefined,
        suggestedNextSteps: item.suggestedNextSteps.length ? [...item.suggestedNextSteps] : undefined,
        seen: false,
      });
    }

    // Keep history to a reasonable size
    if (item.updateHistory.length > 20) {
      item.updateHistory = item.updateHistory.slice(0, 20);
    }

    // Only flag "New Update" for substantive field changes (status, severity,
    // or summary-only).  Links-only discoveries are logged in history but
    // don't warrant the prominent badge / notification.
    const substantiveChange = statusChanged || severityChanged || (summaryChanged && !linksChanged);
    if (substantiveChange) {
      item.hasNewUpdate = true;
    }

    addHistory('scan', `Meaningful change detected: ${item.title}`, { itemId: item.id, newLinks: discoveredLinks.length ? discoveredLinks : undefined });
    if (substantiveChange && item.notifyEnabled !== false && item.lastNotifiedSignature !== nextSignature) {
      const changeSummary = changes.length ? changes.join(' · ') : 'Details changed';
      const updateLabel = item.scheduleType === 'one-time' ? 'Check Complete' : 'New Update';
      await window.workiq.showDesktopNotification({
        title: `${item.title} — ${updateLabel}`,
        body: changeSummary,
        taskId: item.id,
      });
      item.lastNotifiedSignature = nextSignature;
    }
  } else if (manual) {
    addHistory('scan', `No meaningful change: ${item.title}`, { itemId: item.id });
  }

  if (item.scheduleType === 'one-time') {
    item.monitorEnabled = false;
    item.nextRunAt = null;
  } else {
    item.nextRunAt = computeNextRunAt(item);
  }

  savePersistentState();
}

async function runDueMonitoringChecks() {
  if (!state.connected || monitorCycleInProgress) {
    return;
  }

  const nowMs = Date.now();
  const dueItems = state.items.filter((item) => {
    if (!item.monitorEnabled || !item.nextRunAt) return false;
    const dueAt = new Date(item.nextRunAt).getTime();
    return Number.isFinite(dueAt) && dueAt <= nowMs;
  });

  if (!dueItems.length) {
    return;
  }

  monitorCycleInProgress = true;
  setStatus('Monitoring checks running...');

  try {
    for (const item of dueItems) {
      try {
        await monitorTaskItem(item);
      } catch (error) {
        item.lastRunAt = nowIso();
        item.nextRunAt = computeNextRunAt(item);
        addHistory('failure', `Task monitor failed for ${item.title}: ${error.message}`, { itemId: item.id });
      }
      // Incremental DOM update — patch only the item that changed
      // instead of rebuilding the entire list (avoids visible flash).
      patchSingleItem(item.id);
      renderKpis();
    }
  } finally {
    monitorCycleInProgress = false;
    setStatus('Updated');
    setUpdatedNow();
    savePersistentState();
    // Final KPI sync — individual items were already patched in-place.
    renderKpis();
  }
}

function startMonitoringLoop() {
  if (monitorIntervalHandle) {
    return;
  }

  monitorIntervalHandle = setInterval(() => {
    runDueMonitoringChecks();
  }, MONITOR_TICK_MS);
}
