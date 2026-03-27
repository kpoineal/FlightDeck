// ── Unified item model ─────────────────────────────────────────────
// Consolidates radar.js + tracking.js into a single item shape.
// Every item has ALL tracking fields; monitoring defaults to OFF for
// freshly discovered (inbound) items.

// ── Schedule / monitoring helpers ──────────────────────────────────

function intervalValueToMinutes(value) {
  const matched = SCHEDULE_INTERVAL_OPTIONS.find((entry) => entry.value === value);
  return matched ? matched.minutes : 30;
}

function applyWorkHoursWindow(nextDate, workHoursOnly) {
  const candidate = new Date(nextDate);
  if (!Number.isFinite(candidate.getTime())) {
    return candidate;
  }

  if (!workHoursOnly) {
    return candidate;
  }

  const hour = candidate.getHours();
  if (hour < WORK_HOURS_START_HOUR) {
    candidate.setHours(WORK_HOURS_START_HOUR, 0, 0, 0);
  } else if (hour >= WORK_HOURS_END_HOUR) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(WORK_HOURS_START_HOUR, 0, 0, 0);
  }

  return candidate;
}

function computeNextRunAt(item, fromDate = new Date()) {
  if (!item?.monitorEnabled) {
    return null;
  }

  if (item.scheduleType === 'one-time') {
    if (!item.oneTimeAt) {
      return null;
    }

    const parsed = new Date(item.oneTimeAt);
    if (!Number.isFinite(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  if (item.scheduleType === 'weekly') {
    const nextWeeklyRun = computeNextWeeklyRun(item, fromDate);
    if (!nextWeeklyRun) {
      return null;
    }
    return applyWorkHoursWindow(new Date(nextWeeklyRun), item.workHoursOnly === true).toISOString();
  }

  const minutes = intervalValueToMinutes(item.scheduleValue);
  const nextDate = applyWorkHoursWindow(new Date(fromDate.getTime() + minutes * 60 * 1000), item.workHoursOnly === true);
  return nextDate.toISOString();
}

function computeNextWeeklyRun(item, fromDate = new Date()) {
  const days = Array.isArray(item.weeklyDays) && item.weeklyDays.length ? item.weeklyDays : DEFAULT_WEEKLY_DAYS;
  const times = Array.isArray(item.weeklyTimes) && item.weeklyTimes.length ? item.weeklyTimes : DEFAULT_WEEKLY_TIMES;

  const jsDaySet = new Set();
  for (const d of days) {
    const opt = WEEKLY_DAY_OPTIONS.find((o) => o.value === d);
    if (opt) jsDaySet.add(opt.jsDay);
  }
  if (!jsDaySet.size) return null;

  // Build candidate timestamps for the next 8 days (covers a full week + today)
  const candidates = [];
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(fromDate);
    candidate.setDate(candidate.getDate() + offset);
    if (!jsDaySet.has(candidate.getDay())) continue;
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const slot = new Date(candidate);
      slot.setHours(hh, mm, 0, 0);
      if (slot > fromDate) {
        candidates.push(slot);
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return candidates[0].toISOString();
}

function trackingItemSignature(item) {
  const linkUrls = Array.isArray(item?.evidenceLinks)
    ? item.evidenceLinks
        .map((e) => `${e?.url || ''}|${e?.signalAt || ''}`)
        .sort()
        .join(',')
    : '';
  const normalized = [
    cleanDisplayText(item?.title || '').toLowerCase(),
    normalizeSeverity(item?.severity || '').toLowerCase(),
    cleanDisplayText(item?.summary || '').toLowerCase(),
    cleanDisplayText(item?.reason || '').toLowerCase(),
    cleanDisplayText(item?.status || '').toLowerCase(),
    String(item?.dueAt || '').trim().toLowerCase(),
    linkUrls,
  ].join('|');

  return hashString(normalized);
}

function unseenHistoryCount(item) {
  if (!Array.isArray(item?.updateHistory)) return 0;
  return item.updateHistory.filter((e) => e.seen === false).length;
}

function buildDefaultMonitorPrompt(item) {
  const parts = [];
  const title = cleanDisplayText(item?.title || '');
  const summary = cleanDisplayText(item?.summary || '');
  const reason = cleanDisplayText(item?.reason || '');
  const owner = cleanDisplayText(item?.owner || '');
  const people = Array.isArray(item?.counterparties) && item.counterparties.length
    ? item.counterparties.map(cleanDisplayText).join(', ')
    : '';
  const source = cleanDisplayText(item?.sourceType || '');

  if (title) parts.push(title);
  if (summary && summary !== title) parts.push(`Summary: ${summary}`);
  if (reason && reason !== summary && reason !== title) parts.push(`Reason: ${reason}`);
  if (owner && owner !== 'You') parts.push(`Owner: ${owner}`);
  if (people) parts.push(`People: ${people}`);
  if (source && source !== 'Signal' && source !== 'Custom') parts.push(`Source: ${source}`);

  return parts.join('\n') || title || 'Tracked task';
}

// ── Evidence link processing (consolidated) ────────────────────────

function _buildEvidenceLinks(item, inlineLinks) {
  const links = [];
  const seenUrls = new Set();

  // Structured evidenceLinks first (they have signalAt metadata)
  const structured = Array.isArray(item?.evidenceLinks)
    ? item.evidenceLinks.map((entry) => normalizeEvidenceLink(entry, item?.sourceType || 'source')).filter(Boolean)
    : [];
  for (const entry of structured) {
    if (seenUrls.has(entry.url)) continue;
    links.push(entry);
    seenUrls.add(entry.url);
  }

  // Then inline-extracted links (fill gaps)
  for (const entry of inlineLinks) {
    if (!entry.url || seenUrls.has(entry.url)) continue;
    links.push(entry);
    seenUrls.add(entry.url);
  }

  // Last resort: accept structured links with generic URLs or label-embedded citations
  if (!links.length) {
    for (const entry of (Array.isArray(item?.evidenceLinks) ? item.evidenceLinks : [])) {
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
        type: normalizeSignalType(entry.type || item?.sourceType || 'source'),
        url,
        ...(toIsoOrNull(entry.signalAt) ? { signalAt: toIsoOrNull(entry.signalAt) } : {}),
      });
    }
  }

  return links;
}

// ── Unified normalizer ─────────────────────────────────────────────

function normalizeItem(item) {
  // Extract inline citations from raw text BEFORE cleaning strips them
  const inlineLinks = [
    ...extractInlineCitations(item?.summary || ''),
    ...extractInlineCitations(item?.reason || ''),
  ];
  // Fallback: extract bare URLs if no markdown citations found
  if (!inlineLinks.length) {
    inlineLinks.push(
      ...extractBareUrlCitations(item?.summary || ''),
      ...extractBareUrlCitations(item?.reason || ''),
    );
  }
  // Adopt descriptive labels from structured evidenceLinks
  adoptStructuredLabels(inlineLinks, item?.evidenceLinks);

  // IDs must not be cleaned — cleanDisplayText mangles hex hashes
  const normalizedId = String(item?.id || '').trim() || `custom_${hashString(`${Date.now()}_${Math.random()}`)}`;
  const monitorEnabled = item?.monitorEnabled === true;
  const monitorSignals = Array.isArray(item?.monitorSignals) && item.monitorSignals.length
    ? item.monitorSignals.filter((s) => ALL_SIGNAL_TYPES.includes(s))
    : [...ALL_SIGNAL_TYPES];

  const normalized = {
    id: normalizedId,
    title: cleanDisplayText(item?.title || 'Untitled item'),
    severity: normalizeSeverity(item?.severity || 'Observe'),
    sourceType: cleanDisplayText(item?.sourceType || 'Signal'),
    dueAt: item?.dueAt || null,
    owner: cleanDisplayText(item?.owner || 'You'),
    counterparties: Array.isArray(item?.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
    summary: cleanDisplayText(item?.summary || ''),
    reason: cleanDisplayText(item?.reason || ''),
    status: cleanDisplayText(item?.status || 'Inbound'),
    evidenceLinks: _buildEvidenceLinks(item, inlineLinks),
    suggestedNextSteps: Array.isArray(item?.suggestedNextSteps)
      ? item.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
      : [],

    // Discovery timestamp — set once when the item is first seen, never overwritten
    discoveredAt: item?.discoveredAt || nowIso(),

    // Tracking / monitoring fields — default to OFF for inbound items
    trackedAt: item?.trackedAt || null,
    monitorPrompt: cleanDisplayText(item?.monitorPrompt || '') || buildDefaultMonitorPrompt(item),
    monitorEnabled,
    workHoursOnly: item?.workHoursOnly === true,
    monitorSignals,
    scheduleType: item?.scheduleType === 'one-time' ? 'one-time' : item?.scheduleType === 'weekly' ? 'weekly' : 'interval',
    scheduleValue: SCHEDULE_INTERVAL_OPTIONS.some((entry) => entry.value === item?.scheduleValue) ? item.scheduleValue : '30m',
    oneTimeAt: item?.oneTimeAt || null,
    weeklyDays: Array.isArray(item?.weeklyDays) && item.weeklyDays.length
      ? item.weeklyDays.filter((d) => WEEKLY_DAY_OPTIONS.some((o) => o.value === d))
      : [...DEFAULT_WEEKLY_DAYS],
    weeklyTimes: Array.isArray(item?.weeklyTimes) && item.weeklyTimes.length
      ? item.weeklyTimes.filter((t) => /^\d{2}:\d{2}$/.test(t))
      : [...DEFAULT_WEEKLY_TIMES],
    nextRunAt: item?.nextRunAt || null,
    lastRunAt: item?.lastRunAt || null,
    lastChangedAt: item?.lastChangedAt
      || (Array.isArray(item?.updateHistory) && item.updateHistory.length > 0 ? item.updateHistory[0].timestamp : null)
      || null,
    lastCheckSignature: item?.lastCheckSignature || null,
    lastNotifiedSignature: item?.lastNotifiedSignature || null,
    notifyEnabled: item?.notifyEnabled !== false,
    origin: item?.origin === 'custom' ? 'custom' : 'imported',
    lifecycleStatus: (() => {
      if (item?.archived === true || item?.completed === true) return 'archived';
      // Always check the status field — it reflects the latest AI-reported state
      const s = String(item?.status || '').toLowerCase();
      if (s.includes('complete') || s.includes('resolved') || s.includes('closed') || s.includes('done')) return 'complete';
      if (s.includes('block') || s.includes('stalled')) return 'blocked';
      if (s.includes('wait') || s.includes('pending')) return 'waiting';
      // Fall back to explicit lifecycleStatus if set
      if (LIFECYCLE_STATUSES.includes(item?.lifecycleStatus)) return item.lifecycleStatus;
      return 'in-progress';
    })(),
    scannerId: item?.scannerId || null,
    isNew: item?.isNew === true,
    updateHistory: Array.isArray(item?.updateHistory)
      ? item.updateHistory.map((e) => ({ ...e, seen: e.seen ?? true }))
      : [],
    hasNewUpdate: item?.hasNewUpdate === true,
    archived: item?.archived === true,

    // Ledger source markers (preserved for ledger-sourced items)
    ledgerEvidenceLinks: Array.isArray(item?.ledgerEvidenceLinks) ? item.ledgerEvidenceLinks : [],
    isLedger: item?.isLedger === true,
  };

  if (!normalized.nextRunAt && normalized.monitorEnabled) {
    normalized.nextRunAt = computeNextRunAt(normalized);
  }

  return normalized;
}

// Legacy alias — other files still reference this name
function normalizeTrackingItem(item) {
  return normalizeItem(item);
}

// ── Radar identity helpers ─────────────────────────────────────────

function radarItemIdentitySeed(item) {
  const title = cleanDisplayText(item?.title || '').toLowerCase();
  const sourceType = cleanDisplayText(item?.sourceType || '').toLowerCase();
  const dueAt = String(item?.dueAt || '').trim().toLowerCase();
  const owner = cleanDisplayText(item?.owner || '').toLowerCase();
  const summary = cleanDisplayText(item?.summary || '').toLowerCase();
  const reason = cleanDisplayText(item?.reason || '').toLowerCase();
  const counterparties = Array.isArray(item?.counterparties)
    ? item.counterparties.map((name) => cleanDisplayText(name).toLowerCase()).join(',')
    : '';

  return [title, sourceType, dueAt, owner, summary, reason, counterparties].join('|');
}

function resolveRadarItemId(item) {
  // Always use content-based hashing — AI-provided ids like "radar-001"
  // are not globally unique and cause cross-scan collisions.
  const stableSeed = radarItemIdentitySeed(item);
  if (!stableSeed.replace(/\|/g, '')) {
    return `radar_${hashString(nowIso())}`;
  }

  return `radar_${hashString(stableSeed)}`;
}

function primaryEvidenceLinkForRadar(item) {
  if (!item) return null;

  const linkedByRadar = state.evidence.filter((entry) => entry.radarItemId === item.id && entry.citationUrl);
  if (linkedByRadar.length) {
    return linkedByRadar[0];
  }

  if (Array.isArray(item.evidenceIds) && item.evidenceIds.length) {
    const linkedById = state.evidence.find((entry) => item.evidenceIds.includes(entry.id) && entry.citationUrl);
    if (linkedById) {
      return linkedById;
    }
  }

  return null;
}

function collectRadarSourceLinks(item) {
  const links = [];

  // 1. Evidence from state.evidence (if populated)
  const evidence = primaryEvidenceLinkForRadar(item);
  if (evidence?.citationUrl) {
    links.push({
      label: evidence.label || 'source',
      type: evidence.type || 'source',
      url: evidence.citationUrl,
      ...(toIsoOrNull(evidence.signalAt || evidence.timestamp) ? { signalAt: toIsoOrNull(evidence.signalAt || evidence.timestamp) } : {}),
    });
  }

  // 2. Structured evidenceLinks on the item itself
  if (Array.isArray(item.evidenceLinks)) {
    for (const entry of item.evidenceLinks) {
      if (entry && entry.url && !links.some((l) => l.url === entry.url)) {
        links.push({
          label: entry.label || 'source',
          type: entry.type || 'source',
          url: entry.url,
          ...(entry.signalAt ? { signalAt: entry.signalAt } : {}),
        });
      }
    }
  }

  // 3. Ledger evidence links (for ledger-sourced items)
  if (Array.isArray(item.ledgerEvidenceLinks)) {
    for (const entry of item.ledgerEvidenceLinks) {
      const entryUrl = (entry && typeof entry === 'object') ? entry.url : entry;
      const entryLabel = (entry && typeof entry === 'object') ? (entry.label || 'source') : compactLinkLabel(entryUrl, 'source');
      const entryType = (entry && typeof entry === 'object') ? (entry.type || 'source') : 'source';
      const entrySignalAt = (entry && typeof entry === 'object') ? entry.signalAt : null;
      if (entryUrl && !links.some((l) => l.url === entryUrl)) {
        links.push({
          label: entryLabel,
          type: entryType,
          url: entryUrl,
          ...(entrySignalAt ? { signalAt: entrySignalAt } : {}),
        });
      }
    }
  }

  return links;
}

function isInboundStatus(status) {
  return String(status || 'Inbound').toLowerCase() === 'inbound';
}

// ── Ledger helpers ─────────────────────────────────────────────────

function mapLedgerEntryToRadarItem(entry, bucketLabel, severity, owner) {
  const normalizedId = `${bucketLabel.toLowerCase().replace(/\s+/g, '_')}_${entry.id || Math.random().toString(16).slice(2, 8)}`;
  return {
    id: `ledger_${normalizedId}`,
    title: cleanDisplayText(entry.title || 'Ledger item'),
    severity,
    sourceType: 'Ledger',
    dueAt: entry.dueAt || null,
    owner: cleanDisplayText(owner),
    counterparties: Array.isArray(entry.counterparties) ? entry.counterparties.map(cleanDisplayText) : [],
    summary: cleanDisplayText(entry.suggestedFollowUp || 'Commitment requires tracking.'),
    reason: `Ledger item (${bucketLabel})`,
    status: bucketLabel,
    ledgerEvidenceLinks: Array.isArray(entry.evidenceLinks) ? entry.evidenceLinks : [],
    isLedger: true,
  };
}

function getUnifiedRadarItems() {
  const items = Array.isArray(state.items) ? state.items : [];
  // Include non-monitored items (they are the "radar" view)
  const radarItems = items.filter((entry) => !entry.monitorEnabled || isInboundStatus(entry.status));

  const ledgerItems = [
    ...(state.ledger.iOwe || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'I owe', 'Elevated', 'You')),
    ...(state.ledger.othersOweMe || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'Owed to me', 'Elevated', 'Counterparty')),
    ...(state.ledger.silentThreads || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'Silent', 'Observe', 'Counterparty')),
  ];

  return [...radarItems, ...ledgerItems];
}

function applyLedgerPayload(payload) {
  const normalizeLedgerEntry = (item, index, prefix) => ({
    id: item.id || `${prefix}_${index + 1}`,
    title: cleanDisplayText(item.title || 'Untitled'),
    counterparties: Array.isArray(item.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
    dueAt: item.dueAt || null,
    lastSignalAt: item.lastSignalAt || null,
    daysSilent: Number(item.daysSilent || 0),
    evidenceLinks: Array.isArray(item.evidenceLinks)
      ? (() => {
          const links = [];
          const seenUrls = new Set();
          for (const value of item.evidenceLinks) {
            const normalized = normalizeEvidenceLink(value, 'source');
            if (!normalized || seenUrls.has(normalized.url)) continue;
            links.push(normalized);
            seenUrls.add(normalized.url);
          }
          return links;
        })()
      : [],
    suggestedFollowUp: cleanDisplayText(item.suggestedFollowUp || ''),
  });

  state.ledger = {
    iOwe: Array.isArray(payload.iOwe) ? payload.iOwe.map((entry, index) => normalizeLedgerEntry(entry, index, 'iowe')) : [],
    othersOweMe: Array.isArray(payload.othersOweMe)
      ? payload.othersOweMe.map((entry, index) => normalizeLedgerEntry(entry, index, 'others'))
      : [],
    silentThreads: Array.isArray(payload.silentThreads)
      ? payload.silentThreads.map((entry, index) => normalizeLedgerEntry(entry, index, 'silent'))
      : [],
  };
}

// ── Payload application (radar scan results → state.items) ─────────

function applyRadarPayload(payload, scannerId = null) {
  const kpis = payload.kpis || {};
  state.kpis = {
    critical: Number(kpis.critical || 0),
    elevated: Number(kpis.elevated || 0),
    observe: Number(kpis.observe || kpis.monitor || 0),
  };

  const mappedItems = (payload.radarItems || []).map((raw) => {
    const id = resolveRadarItemId(raw);
    return normalizeItem({
      ...raw,
      id,
      status: raw.status || 'Inbound',
    });
  });

  // Build a map of existing items keyed by id for O(1) merge lookup
  const existingById = new Map();
  for (const existing of (state.items || [])) {
    existingById.set(existing.id, existing);
  }

  // Merge: keep monitoring state for items that already exist, add new ones with monitoring OFF
  const mergedItems = [];
  const processedIds = new Set();

  for (const incoming of mappedItems) {
    const existing = existingById.get(incoming.id);
    if (existing) {
      // Merge: keep existing monitoring state, update radar fields
      mergedItems.push({
        ...incoming,
        // Preserve all monitoring/tracking state from existing item
        discoveredAt: existing.discoveredAt || incoming.discoveredAt,
        trackedAt: existing.trackedAt || incoming.trackedAt,
        monitorPrompt: existing.monitorPrompt || incoming.monitorPrompt,
        monitorEnabled: existing.monitorEnabled,
        workHoursOnly: existing.workHoursOnly,
        monitorSignals: existing.monitorSignals,
        scheduleType: existing.scheduleType,
        scheduleValue: existing.scheduleValue,
        oneTimeAt: existing.oneTimeAt,
        weeklyDays: existing.weeklyDays,
        weeklyTimes: existing.weeklyTimes,
        nextRunAt: existing.nextRunAt,
        lastRunAt: existing.lastRunAt,
        lastChangedAt: existing.lastChangedAt,
        lastCheckSignature: existing.lastCheckSignature,
        lastNotifiedSignature: existing.lastNotifiedSignature,
        notifyEnabled: existing.notifyEnabled,
        updateHistory: existing.updateHistory,
        hasNewUpdate: existing.hasNewUpdate,
        archived: existing.archived,
        origin: existing.origin,
        // Merge evidence links from new scan into existing
        evidenceLinks: (() => {
          const mergedLinks = [...existing.evidenceLinks];
          const existingUrls = new Set(mergedLinks.map((e) => e.url));
          for (const link of incoming.evidenceLinks) {
            if (link && link.url && !existingUrls.has(link.url)) {
              mergedLinks.push(link);
              existingUrls.add(link.url);
            }
          }
          return mergedLinks;
        })(),
      });
    } else {
      // New item — monitoring defaults already set by normalizeItem (OFF)
      mergedItems.push(incoming);
    }
    processedIds.add(incoming.id);
  }

  // Keep existing items that weren't in this payload (they might be from
  // a different scanner, manually added, or previously tracked)
  for (const existing of (state.items || [])) {
    if (!processedIds.has(existing.id)) {
      mergedItems.push(existing);
    }
  }

  // Stamp items with scannerId if provided (for default radar scanner integration)
  if (scannerId) {
    for (const item of mergedItems) {
      if (!item.scannerId) {
        item.scannerId = scannerId;
      }
    }
  }

  state.items = mergedItems;
  // Legacy aliases kept in sync for any code still referencing them
  state.radarItems = mergedItems;
  state.actions = [];
  state.evidence = [];

  applyLedgerPayload(payload);

  if (state.selectedRadarItemId && !state.items.some((item) => item.id === state.selectedRadarItemId)) {
    state.selectedRadarItemId = null;
  }

  if (!state.selectedRadarItemId) {
    const inbound = getInboundItems();
    if (inbound.length) {
      state.selectedRadarItemId = inbound[0].id;
    }
  }
}

// ── Item queries ───────────────────────────────────────────────────

function getInboundItems() {
  const items = Array.isArray(state.items) ? state.items : [];
  const filtered = items.filter((item) => !item.monitorEnabled && isInboundStatus(item.status));
  return sortBySeverity(filtered);
}

// Legacy alias
function getInboundRadarItems() {
  return getInboundItems();
}

function getMonitoredItems() {
  const items = Array.isArray(state.items) ? state.items : [];
  return items.filter((item) => item.monitorEnabled);
}

// ── Item mutations ─────────────────────────────────────────────────

function enableItemMonitoring(itemId) {
  const item = (state.items || []).find((entry) => entry.id === itemId);
  if (!item) return;

  item.monitorEnabled = true;
  item.trackedAt = item.trackedAt || nowIso();
  item.scheduleType = item.scheduleType || 'interval';
  item.scheduleValue = item.scheduleValue || '2h';
  item.workHoursOnly = typeof item.workHoursOnly === 'boolean' ? item.workHoursOnly : true;
  item.origin = item.origin || 'imported';
  item.status = item.status === 'Inbound' ? 'Tracked' : item.status;
  item.monitorPrompt = item.monitorPrompt || buildDefaultMonitorPrompt(item);
  item.hasNewUpdate = true;

  if (!item.updateHistory.length) {
    item.updateHistory.push({
      timestamp: item.trackedAt,
      changes: ['Initial tracking'],
      summary: item.summary || item.title || 'Tracking started.',
      status: item.status,
      severity: item.severity,
      suggestedNextSteps: item.suggestedNextSteps.length ? [...item.suggestedNextSteps] : undefined,
    });
  }

  item.nextRunAt = computeNextRunAt(item);
  savePersistentState();
}

// Legacy alias — callers still use this name
function upsertTrackingItemFromRadar(radarItem) {
  if (!radarItem || !radarItem.id) return;

  // If the item doesn't exist in state.items yet, add it first
  const existing = (state.items || []).find((entry) => entry.id === radarItem.id);
  if (!existing) {
    const normalized = normalizeItem({
      id: radarItem.id,
      title: radarItem.title,
      severity: radarItem.severity,
      sourceType: radarItem.sourceType,
      dueAt: radarItem.dueAt || null,
      owner: radarItem.owner,
      counterparties: Array.isArray(radarItem.counterparties) ? radarItem.counterparties : [],
      summary: radarItem.summary || radarItem.reason || '',
      reason: radarItem.reason || radarItem.summary || '',
      status: radarItem.status || 'Tracked',
      trackedAt: nowIso(),
      origin: 'imported',
      evidenceLinks: Array.isArray(radarItem.evidenceLinks) ? radarItem.evidenceLinks : [],
      suggestedNextSteps: Array.isArray(radarItem.suggestedNextSteps) ? radarItem.suggestedNextSteps : [],
      hasNewUpdate: true,
      monitorPrompt: buildDefaultMonitorPrompt(radarItem),
      monitorEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '2h',
      workHoursOnly: true,
    });

    if (!normalized.updateHistory.length) {
      normalized.updateHistory.push({
        timestamp: normalized.trackedAt || nowIso(),
        changes: ['Initial tracking'],
        summary: normalized.summary || normalized.title || 'Tracking started.',
        status: normalized.status,
        severity: normalized.severity,
        suggestedNextSteps: normalized.suggestedNextSteps.length ? [...normalized.suggestedNextSteps] : undefined,
      });
    }
    state.items.unshift(normalized);
    // Keep legacy alias in sync
    state.trackingItems = state.items;
    savePersistentState();
    return;
  }

  // Item already exists — enable monitoring and update fields
  const mergedItem = {
    ...existing,
    title: radarItem.title || existing.title,
    severity: radarItem.severity || existing.severity,
    sourceType: radarItem.sourceType || existing.sourceType,
    dueAt: radarItem.dueAt || existing.dueAt,
    owner: radarItem.owner || existing.owner,
    counterparties: Array.isArray(radarItem.counterparties) && radarItem.counterparties.length
      ? radarItem.counterparties : existing.counterparties,
    summary: radarItem.summary || radarItem.reason || existing.summary,
    reason: radarItem.reason || radarItem.summary || existing.reason,
    status: existing.status === 'Inbound' ? 'Tracked' : existing.status,
    trackedAt: existing.trackedAt || nowIso(),
    monitorPrompt: existing.monitorPrompt || buildDefaultMonitorPrompt(radarItem),
    monitorEnabled: typeof existing.monitorEnabled === 'boolean' ? existing.monitorEnabled : true,
    notifyEnabled: typeof existing.notifyEnabled === 'boolean' ? existing.notifyEnabled : true,
    workHoursOnly: typeof existing.workHoursOnly === 'boolean' ? existing.workHoursOnly : true,
    scheduleType: existing.scheduleType || 'interval',
    scheduleValue: existing.scheduleValue || '2h',
    oneTimeAt: existing.oneTimeAt || null,
    nextRunAt: existing.nextRunAt || null,
    lastRunAt: existing.lastRunAt || null,
    lastChangedAt: existing.lastChangedAt || null,
    lastCheckSignature: existing.lastCheckSignature || null,
    lastNotifiedSignature: existing.lastNotifiedSignature || null,
    hasNewUpdate: true,
    suggestedNextSteps: Array.isArray(radarItem.suggestedNextSteps) && radarItem.suggestedNextSteps.length
      ? radarItem.suggestedNextSteps : existing.suggestedNextSteps,
  };

  // Merge evidence links
  if (Array.isArray(radarItem.evidenceLinks) && radarItem.evidenceLinks.length) {
    const existingUrls = new Set((existing.evidenceLinks || []).map((e) => e.url));
    mergedItem.evidenceLinks = [...(existing.evidenceLinks || [])];
    for (const link of radarItem.evidenceLinks) {
      if (link && link.url && !existingUrls.has(link.url)) {
        mergedItem.evidenceLinks.push(link);
        existingUrls.add(link.url);
      }
    }
  }

  if (!mergedItem.monitorEnabled) {
    mergedItem.monitorEnabled = true;
  }
  mergedItem.nextRunAt = mergedItem.nextRunAt || computeNextRunAt(mergedItem);

  const idx = state.items.findIndex((entry) => entry.id === radarItem.id);
  if (idx >= 0) {
    state.items[idx] = normalizeItem(mergedItem);
  }
  // Keep legacy alias in sync
  state.trackingItems = state.items;
  savePersistentState();
}

function removeItem(itemId) {
  const before = state.items.length;
  state.items = state.items.filter((entry) => entry.id !== itemId);
  if (state.items.length !== before) {
    // Keep legacy aliases in sync
    state.trackingItems = state.items;
    savePersistentState();
  }
}

// Legacy alias
function removeTrackingItem(itemId) {
  removeItem(itemId);
}

function dismissItem(itemId) {
  if (!itemId) return null;

  const item = (state.items || []).find((entry) => entry.id === itemId) || null;
  if (!item) return null;

  state.items = state.items.filter((entry) => entry.id !== itemId);
  state.actions = state.actions.filter((entry) => entry.radarItemId !== itemId);
  state.evidence = state.evidence.filter((entry) => entry.radarItemId !== itemId);

  if (state.selectedRadarItemId === itemId) {
    state.selectedRadarItemId = state.items[0]?.id || null;
  }

  // Keep legacy aliases in sync
  state.radarItems = state.items;
  state.trackingItems = state.items;
  savePersistentState();
  return item;
}

// Legacy alias
function dismissRadarItem(itemId) {
  return dismissItem(itemId);
}

function updateItemField(itemId, field, value) {
  const item = (state.items || []).find((i) => i.id === itemId);
  if (!item) return null;

  const oldValue = item[field];
  item[field] = value;
  // Keep legacy alias in sync
  state.trackingItems = state.items;
  savePersistentState();

  return { item, oldValue, newValue: value };
}

// Legacy alias
function updateTrackingItemField(itemId, field, value) {
  return updateItemField(itemId, field, value);
}

function setItemMonitorEnabled(itemId, enabled) {
  const item = (state.items || []).find((entry) => entry.id === itemId);
  if (!item) return;

  item.monitorEnabled = enabled;
  item.nextRunAt = enabled ? computeNextRunAt(item) : null;
  // Keep legacy alias in sync
  state.trackingItems = state.items;
  savePersistentState();
  renderTrackingMode();
}

// Legacy alias
function setTrackingEnabled(itemId, enabled) {
  setItemMonitorEnabled(itemId, enabled);
}

function updateItemSchedule(itemId, nextScheduleType, nextScheduleValue, nextOneTimeAt, opts = {}) {
  const item = (state.items || []).find((entry) => entry.id === itemId);
  if (!item) return;

  item.scheduleType = nextScheduleType === 'one-time' ? 'one-time' : nextScheduleType === 'weekly' ? 'weekly' : 'interval';
  item.scheduleValue = SCHEDULE_INTERVAL_OPTIONS.some((entry) => entry.value === nextScheduleValue)
    ? nextScheduleValue
    : item.scheduleValue;
  item.oneTimeAt = item.scheduleType === 'one-time' ? nextOneTimeAt : null;

  if (opts.weeklyDays !== undefined) {
    item.weeklyDays = opts.weeklyDays;
  }
  if (opts.weeklyTimes !== undefined) {
    item.weeklyTimes = opts.weeklyTimes;
  }

  item.nextRunAt = computeNextRunAt(item);
  // Keep legacy alias in sync
  state.trackingItems = state.items;
  savePersistentState();
  if (!opts.skipRender) {
    renderTrackingMode();
  }
}

// Legacy alias
function updateTrackingSchedule(itemId, nextScheduleType, nextScheduleValue, nextOneTimeAt, opts = {}) {
  updateItemSchedule(itemId, nextScheduleType, nextScheduleValue, nextOneTimeAt, opts);
}

function setItemLifecycleStatus(id, newStatus) {
  const item = (state.items || []).find((entry) => entry.id === id);
  if (!item || !LIFECYCLE_STATUSES.includes(newStatus)) return;
  const oldStatus = item.lifecycleStatus;
  if (oldStatus === newStatus) return;
  item.lifecycleStatus = newStatus;
  // Stop monitoring when complete or archived
  if (newStatus === 'complete' || newStatus === 'archived') {
    item.monitorEnabled = false;
    item.nextRunAt = null;
  }
  if (!Array.isArray(item.updateHistory)) item.updateHistory = [];
  item.updateHistory.unshift({
    timestamp: nowIso(),
    changes: [`Status: ${oldStatus} \u2192 ${newStatus}`],
    summary: item.summary || item.title,
    status: newStatus,
    severity: item.severity,
    seen: true,
  });
  if (item.updateHistory.length > 20) {
    item.updateHistory = item.updateHistory.slice(0, 20);
  }
  state.trackingItems = state.items;
  savePersistentState();
  renderRadarMode();
}

// Legacy alias
function setTrackingLifecycleStatus(id, newStatus) {
  setItemLifecycleStatus(id, newStatus);
}

function moveItemToScanner(itemId, targetScannerId) {
  const item = (state.items || []).find((entry) => entry.id === itemId);
  if (!item) return null;

  const oldScannerId = item.scannerId || null;
  const newScannerId = targetScannerId || null;
  if (oldScannerId === newScannerId) return item;

  // Update source scanner itemCount
  if (oldScannerId) {
    const oldScanner = getScannerById(oldScannerId);
    if (oldScanner) oldScanner.itemCount = Math.max(0, (oldScanner.itemCount || 0) - 1);
  }

  item.scannerId = newScannerId;

  // Update target scanner itemCount
  if (newScannerId) {
    const newScanner = getScannerById(newScannerId);
    if (newScanner) newScanner.itemCount = (newScanner.itemCount || 0) + 1;
  }

  state.trackingItems = state.items;
  state.radarItems = state.items;
  savePersistentState();

  const oldLabel = oldScannerId ? (getScannerById(oldScannerId)?.name || 'Scanner') : 'Radar';
  const newLabel = newScannerId ? (getScannerById(newScannerId)?.name || 'Scanner') : 'Radar';
  addHistory('move', `Moved "${item.title}" from ${oldLabel} to ${newLabel}`, { itemId });

  return item;
}
