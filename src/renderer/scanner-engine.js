// ── Scanner run engine ──────────────────────────────────────────────

let scannerIntervalHandle = null;
let scannerCycleInProgress = false;

function logToMain(...args) {
  if (window.workiq && typeof window.workiq.log === 'function') {
    window.workiq.log('[scanner]', ...args);
  }
}

function rescheduleOverdueScanners() {
  const nowMs = Date.now();
  let rescheduled = 0;
  const startupScanners = [];
  for (const scanner of getActiveScanners()) {
    // Collect scanners with runOnStartup for immediate execution
    if (scanner.runOnStartup) {
      startupScanners.push(scanner);
    }

    if (!scanner.nextRunAt) continue;
    const dueAt = new Date(scanner.nextRunAt).getTime();
    if (Number.isFinite(dueAt) && dueAt <= nowMs) {
      const policy = scanner.missedRunPolicy || 'run-once';
      if (policy === 'skip') {
        // Skip: just reschedule forward
        scanner.nextRunAt = computeScannerNextRunAt(scanner);
        rescheduled++;
      } else if (policy === 'run-once') {
        // Run once: set nextRunAt to now so it fires immediately on next tick
        scanner.nextRunAt = new Date(nowMs).toISOString();
        rescheduled++;
      } else if (policy === 'catch-up') {
        // Catch up: set to now (engine will run it, then it re-queues; cap at 3)
        scanner._catchUpRemaining = Math.min(3, scanner._catchUpRemaining || 3);
        scanner.nextRunAt = new Date(nowMs).toISOString();
        rescheduled++;
      } else {
        scanner.nextRunAt = computeScannerNextRunAt(scanner);
        rescheduled++;
      }
    }
  }
  if (rescheduled) {
    logToMain(`Rescheduled ${rescheduled} overdue scanner(s) on startup`);
    savePersistentState();
  }
  return startupScanners;
}

function startScannerEngine() {
  if (scannerIntervalHandle) return;
  logToMain('Engine started');
  const startupScanners = rescheduleOverdueScanners();

  // Run-on-startup scanners: set their nextRunAt to now so they fire on the first tick
  if (startupScanners.length) {
    const nowIsoStr = new Date().toISOString();
    for (const scanner of startupScanners) {
      if (!scanner.nextRunAt || new Date(scanner.nextRunAt).getTime() > Date.now()) {
        scanner.nextRunAt = nowIsoStr;
      }
    }
    logToMain(`${startupScanners.length} scanner(s) queued for run-on-startup`);
    savePersistentState();
  }

  scannerIntervalHandle = setInterval(() => {
    checkScannersDue();
  }, SCANNER_ENGINE_TICK_MS);
}

function stopScannerEngine() {
  if (scannerIntervalHandle) {
    clearInterval(scannerIntervalHandle);
    scannerIntervalHandle = null;
  }
}

async function checkScannersDue() {
  if (!state.connected || scannerCycleInProgress) return;

  // Periodic auto-archive and retention (lightweight, runs every tick)
  runScannerAutoArchiveAndRetention();

  const nowMs = Date.now();
  const dueScanners = getActiveScanners().filter((scanner) => {
    if (!scanner.nextRunAt) return false;
    const dueAt = new Date(scanner.nextRunAt).getTime();
    return Number.isFinite(dueAt) && dueAt <= nowMs;
  });

  if (!dueScanners.length) return;

  logToMain(`${dueScanners.length} scanner(s) due:`, dueScanners.map((s) => s.name).join(', '));
  scannerCycleInProgress = true;

  try {
    for (const scanner of dueScanners) {
      try {
        await runScanner(scanner);
      } catch (error) {
        scanner.lastRunAt = nowIso();
        scanner.nextRunAt = computeScannerNextRunAt(scanner);
        logToMain(`Scanner "${scanner.name}" failed:`, error.message);
        addHistory('failure', `Scanner failed: ${scanner.name}: ${error.message}`, { scannerId: scanner.id });
      }
    }
  } finally {
    scannerCycleInProgress = false;
    savePersistentState();
  }
}

async function runScanner(scanner) {
  logToMain(`Running "${scanner.name}"...`);

  // Default radar scanner uses dedicated prompt + merge logic
  if (scanner.isDefault) {
    const prompt = buildRadarScanPrompt(scanner.lastRunAt, scanner.id);

    const payload = await runWorkiqJson(
      prompt,
      (candidate) => candidate && Array.isArray(candidate.radarItems),
      'radar'
    );

    applyRadarPayload(payload, scanner.id);

    // Update scanner metadata
    scanner.lastRunAt = nowIso();
    scanner.nextRunAt = scanner.scheduleType === 'one-time' ? null : computeScannerNextRunAt(scanner);
    scanner.itemCount = state.items.filter((item) => item.scannerId === scanner.id).length;

    if (scanner.scheduleType === 'one-time') {
      scanner.enabled = false;
    }

    logToMain(`"${scanner.name}" (default radar) completed`);
    addHistory('scan', 'Radar scan completed', { scannerId: scanner.id });
    renderRadarMode();
    savePersistentState();
    return;
  }

  const prompt = buildScannerPrompt(scanner);

  const payload = await runWorkiqJson(
    prompt,
    (candidate) => candidate && Array.isArray(candidate.radarItems),
    'scanner'
  );

  const newItems = (payload.radarItems || []).map((item) => normalizeItem({
    ...item,
    id: resolveRadarItemId(item),
    status: item.status || 'Inbound',
    scannerId: scanner.id,
    isNew: true,
  }));

  // Enforce maxItemsPerScan cap
  const maxItems = scanner.maxItemsPerScan || 10;
  if (newItems.length > maxItems) {
    newItems.length = maxItems;
  }

  // Exclude keywords filter — remove items matching any exclude keyword in title or summary
  const excludeKeywords = Array.isArray(scanner.excludeKeywords) ? scanner.excludeKeywords : [];
  const filtered = excludeKeywords.length
    ? newItems.filter((item) => {
      const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
      return !excludeKeywords.some((kw) => kw && text.includes(kw.toLowerCase()));
    })
    : newItems;

  // Layer 2 dedup: check evidence link URLs against existing inbox
  const deduplicated = deduplicateAgainstInbox(filtered, scanner);

  // Auto-monitor: if scanner has autoMonitorNewItems enabled, activate monitoring on each new item
  if (scanner.autoMonitorNewItems) {
    const threshold = scanner.autoMonitorSeverityThreshold || 'all';
    for (const item of deduplicated) {
      const severity = normalizeSeverity(item.severity);
      const meetsThreshold = threshold === 'all'
        || (threshold === 'Critical' && severity === 'Critical')
        || (threshold === 'Elevated' && (severity === 'Critical' || severity === 'Elevated'));
      if (meetsThreshold) {
        item.monitorEnabled = true;
        item.trackedAt = item.trackedAt || nowIso();
        // Apply all monitoring defaults from scanner
        item.scheduleType = scanner.defaultMonitorScheduleType || 'interval';
        item.scheduleValue = scanner.defaultMonitorSchedule || '4h';
        item.workHoursOnly = scanner.defaultMonitorWorkHoursOnly === true;
        item.notifyEnabled = scanner.defaultMonitorNotifyEnabled !== false;
        if (Array.isArray(scanner.defaultMonitorSignals) && scanner.defaultMonitorSignals.length) {
          item.monitorSignals = [...scanner.defaultMonitorSignals];
        }
        if (item.scheduleType === 'weekly') {
          item.weeklyDays = Array.isArray(scanner.defaultMonitorWeeklyDays) && scanner.defaultMonitorWeeklyDays.length
            ? [...scanner.defaultMonitorWeeklyDays] : [...DEFAULT_WEEKLY_DAYS];
          item.weeklyTimes = Array.isArray(scanner.defaultMonitorWeeklyTimes) && scanner.defaultMonitorWeeklyTimes.length
            ? [...scanner.defaultMonitorWeeklyTimes] : [...DEFAULT_WEEKLY_TIMES];
        }
        item.nextRunAt = computeNextRunAt(item);
      }
    }
  }

  // Append new items to unified items array
  for (const item of deduplicated) {
    state.items.push(item);
  }
  // Keep legacy alias in sync
  state.radarItems = state.items;

  // Update scanner metadata
  scanner.lastRunAt = nowIso();
  scanner.nextRunAt = scanner.scheduleType === 'one-time' ? null : computeScannerNextRunAt(scanner);
  scanner.itemCount = state.items.filter((item) => item.scannerId === scanner.id).length;

  if (scanner.scheduleType === 'one-time') {
    scanner.enabled = false;
  }

  logToMain(`"${scanner.name}" returned ${newItems.length} item(s), ${deduplicated.length} new after dedup`);

  if (deduplicated.length) {
    addHistory('scan', `Scanner "${scanner.name}" found ${deduplicated.length} new item(s)`, { scannerId: scanner.id });

    // In-app toast (suppressed in silent mode)
    if (scanner.notificationMode !== 'silent') {
      const shouldNotify = scanner.notificationMode !== 'critical-only'
        || deduplicated.some((item) => normalizeSeverity(item.severity) === 'Critical');
      if (shouldNotify) {
        const label = deduplicated.length === 1
          ? deduplicated[0].title
          : `${deduplicated.length} items from ${scanner.name}`;
        showToast(label, { icon: '🔍' });
      }
    }

    // Desktop notification (respects notificationMode)
    if (scanner.notificationMode !== 'silent' && window.workiq && typeof window.workiq.showDesktopNotification === 'function') {
      const notifyItems = scanner.notificationMode === 'critical-only'
        ? deduplicated.filter((item) => normalizeSeverity(item.severity) === 'Critical')
        : deduplicated;
      if (notifyItems.length) {
        const title = `Scanner: ${scanner.name}`;
        const body = notifyItems.length === 1
          ? `New item found: ${notifyItems[0].title}`
          : `${notifyItems.length} new items found`;
        window.workiq.showDesktopNotification({ title, body, taskId: notifyItems[0].id }).catch(() => {});
      }
    }

    // Mark new items so they render with persistent glow
    for (const item of deduplicated) {
      item.isNew = true;
    }

    // Re-render radar view
    renderRadarMode();
  }

  // Webhook: POST results to external URL if configured
  if (deduplicated.length && scanner.webhookUrl) {
    fireScannerWebhook(scanner, deduplicated);
  }

  // Catch-up: if this scanner is in catch-up mode, decrement and re-queue
  if (scanner._catchUpRemaining && scanner._catchUpRemaining > 1) {
    scanner._catchUpRemaining--;
    scanner.nextRunAt = new Date().toISOString(); // re-queue immediately
  } else {
    delete scanner._catchUpRemaining;
  }

  savePersistentState();
}

function deduplicateAgainstInbox(newItems, scanner) {
  const strategy = scanner.dedupStrategy || 'evidence-url';
  const checkAllScanners = scanner.crossScannerDedup !== false;

  // Build evidence URL set
  const existingUrls = new Set();
  const existingTitles = [];
  for (const item of state.items) {
    if (!checkAllScanners && item.scannerId !== scanner.id) continue;
    if (Array.isArray(item.evidenceLinks)) {
      for (const link of item.evidenceLinks) {
        if (link.url) existingUrls.add(link.url);
      }
    }
    if (item.title) existingTitles.push(item.title.toLowerCase());
  }

  const excludedIds = new Set(scanner.excludedItemIds || []);
  const useUrlDedup = strategy === 'evidence-url' || strategy === 'both';
  const useTitleDedup = strategy === 'title-similarity' || strategy === 'both';

  return newItems.filter((item) => {
    if (excludedIds.has(item.id)) return false;

    // URL-based dedup
    if (useUrlDedup && Array.isArray(item.evidenceLinks) && item.evidenceLinks.length) {
      const allUrlsKnown = item.evidenceLinks.every((link) => link.url && existingUrls.has(link.url));
      if (allUrlsKnown) return false;
    }

    // Title-similarity dedup
    if (useTitleDedup && item.title) {
      const newTitle = item.title.toLowerCase();
      if (existingTitles.some((t) => titlesSimilar(newTitle, t))) return false;
    }

    return true;
  });
}

/**
 * Check if two titles are similar enough to be considered duplicates.
 * Uses normalized word overlap — if 70%+ of words match, they're similar.
 */
function titlesSimilar(a, b) {
  const wordsA = new Set(a.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (!wordsA.size || !wordsB.size) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const smaller = Math.min(wordsA.size, wordsB.size);
  return smaller > 0 && (overlap / smaller) >= 0.7;
}

/**
 * Fire a webhook POST with scan results (fire-and-forget).
 */
function fireScannerWebhook(scanner, items) {
  const url = scanner.webhookUrl;
  if (!url) return;
  try {
    const payload = {
      scanner: { id: scanner.id, name: scanner.name },
      timestamp: nowIso(),
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: item.status,
        summary: item.summary,
      })),
    };
    // Use fetch if available (Electron renderer has it), fire-and-forget
    if (typeof fetch === 'function') {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((err) => logToMain(`Webhook failed for "${scanner.name}":`, err.message));
    }
  } catch (err) {
    logToMain(`Webhook error for "${scanner.name}":`, err.message);
  }
}

/**
 * Run auto-archive and retention pruning for all scanners.
 * Called periodically from the engine tick.
 */
function runScannerAutoArchiveAndRetention() {
  const nowMs = Date.now();
  let changed = false;

  for (const scanner of state.scanners) {
    const autoArchiveDays = scanner.autoArchiveAfterDays || 0;
    const retentionDays = scanner.retentionDays || 30;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i];
      if (item.scannerId !== scanner.id) continue;

      const discoveredMs = item.discoveredAt ? new Date(item.discoveredAt).getTime() : 0;
      const lastActivityMs = item.lastChangedAt ? new Date(item.lastChangedAt).getTime() : discoveredMs;
      const ageMs = nowMs - discoveredMs;
      const staleDays = (nowMs - lastActivityMs) / (24 * 60 * 60 * 1000);

      // Auto-archive: items with no activity for N days
      if (autoArchiveDays > 0 && staleDays >= autoArchiveDays && item.lifecycleStatus !== 'archived' && item.lifecycleStatus !== 'complete') {
        item.lifecycleStatus = 'archived';
        item.monitorEnabled = false;
        item.nextRunAt = null;
        changed = true;
      }

      // Retention: remove items older than retentionDays (only archived/complete)
      if (ageMs > retentionMs && (item.lifecycleStatus === 'archived' || item.lifecycleStatus === 'complete')) {
        state.items.splice(i, 1);
        changed = true;
      }
    }
  }

  if (changed) {
    state.radarItems = state.items;
    savePersistentState();
  }
}

function normalizeRadarItemFromScanner(item, scannerId) {
  // Extract inline citations from raw text BEFORE cleaning strips them
  const inlineLinks = [
    ...extractInlineCitations(item.summary || ''),
    ...extractInlineCitations(item.reason || ''),
  ];
  if (!inlineLinks.length) {
    inlineLinks.push(
      ...extractBareUrlCitations(item.summary || ''),
      ...extractBareUrlCitations(item.reason || ''),
    );
  }
  adoptStructuredLabels(inlineLinks, item.evidenceLinks);

  return {
    id: resolveRadarItemId(item),
    title: cleanDisplayText(item.title || 'Untitled item'),
    severity: normalizeSeverity(item.severity),
    sourceType: item.sourceType || 'Signal',
    dueAt: item.dueAt || null,
    owner: cleanDisplayText(item.owner || 'You'),
    counterparties: Array.isArray(item.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
    summary: cleanDisplayText(item.summary || ''),
    reason: cleanDisplayText(item.reason || ''),
    status: item.status || 'Inbound',
    evidenceLinks: (() => {
      const links = [];
      const seenUrls = new Set();
      for (const entry of (Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [])) {
        const normalized = normalizeEvidenceLink(entry, item.sourceType || 'source');
        if (!normalized || seenUrls.has(normalized.url)) continue;
        links.push(normalized);
        seenUrls.add(normalized.url);
      }
      for (const entry of inlineLinks) {
        if (!entry.url || seenUrls.has(entry.url)) continue;
        links.push(entry);
        seenUrls.add(entry.url);
      }
      if (!links.length) {
        for (const entry of (Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [])) {
          if (!entry || typeof entry !== 'object') continue;
          let url = normalizeExternalUrl(entry.url);
          let label = cleanDisplayText(entry.label || '');
          if (!url && entry.label) {
            const embedded = extractLabelEmbeddedUrl(entry.label);
            if (embedded) {
              url = embedded.url;
              if (embedded.cleanLabel) label = cleanDisplayText(embedded.cleanLabel);
            }
          }
          if (!url || isHallucinatedUrl(url) || seenUrls.has(url)) continue;
          label = label || compactLinkLabel(url, 'source');
          seenUrls.add(url);
          links.push({
            label,
            type: normalizeSignalType(entry.type || item.sourceType || 'source'),
            url,
            ...(toIsoOrNull(entry.signalAt) ? { signalAt: toIsoOrNull(entry.signalAt) } : {}),
          });
        }
      }
      return links;
    })(),
    suggestedNextSteps: Array.isArray(item.suggestedNextSteps)
      ? item.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
      : [],
    scannerId,
    discoveredAt: nowIso(),
  };
}
