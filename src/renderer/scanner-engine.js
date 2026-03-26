// ── Scanner run engine ──────────────────────────────────────────────

let scannerIntervalHandle = null;
let scannerCycleInProgress = false;

function logToMain(...args) {
  if (window.workiq && typeof window.workiq.log === 'function') {
    window.workiq.log('[scanner]', ...args);
  }
}

function startScannerEngine() {
  if (scannerIntervalHandle) return;
  logToMain('Engine started');

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

  // Layer 2 dedup: check evidence link URLs against existing inbox
  const deduplicated = deduplicateAgainstInbox(newItems, scanner);

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

    // In-app toast
    const label = deduplicated.length === 1
      ? deduplicated[0].title
      : `${deduplicated.length} items from ${scanner.name}`;
    showToast(label, { icon: '🔍' });

    // Desktop notification
    if (window.workiq && typeof window.workiq.showDesktopNotification === 'function') {
      const title = `Scanner: ${scanner.name}`;
      const body = deduplicated.length === 1
        ? `New item found: ${deduplicated[0].title}`
        : `${deduplicated.length} new items found`;
      window.workiq.showDesktopNotification({ title, body, taskId: deduplicated[0].id }).catch(() => {});
    }

    // Mark new items so they render with persistent glow
    for (const item of deduplicated) {
      item.isNew = true;
    }

    // Re-render radar view
    renderRadarMode();
  }

  savePersistentState();
}

function deduplicateAgainstInbox(newItems, scanner) {
  // Build a set of evidence URLs from existing items for this scanner
  const existingUrls = new Set();
  for (const item of state.items) {
    if (item.scannerId !== scanner.id) continue;
    if (Array.isArray(item.evidenceLinks)) {
      for (const link of item.evidenceLinks) {
        if (link.url) existingUrls.add(link.url);
      }
    }
  }

  // Also check excluded item IDs
  const excludedIds = new Set(scanner.excludedItemIds || []);

  return newItems.filter((item) => {
    if (excludedIds.has(item.id)) return false;

    // Check if any evidence link URL matches an existing item
    if (Array.isArray(item.evidenceLinks) && item.evidenceLinks.length) {
      const allUrlsKnown = item.evidenceLinks.every((link) => link.url && existingUrls.has(link.url));
      if (allUrlsKnown) return false;
    }

    return true;
  });
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
