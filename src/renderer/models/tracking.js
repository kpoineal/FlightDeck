// ── Tracking-item model logic ──────────────────────────────────────

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

function normalizeTrackingItem(item) {
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

  // IDs must not be cleaned — cleanDisplayText mangles hex hashes by
  // inserting spaces between letters and digits (e.g. "4f2a" → "4 f 2 a").
  const normalizedId = String(item?.id || '').trim() || `custom_${hashString(`${Date.now()}_${Math.random()}`)}`;
  const monitorEnabled = item?.monitorEnabled === true;
  const monitorSignals = Array.isArray(item?.monitorSignals) && item.monitorSignals.length
    ? item.monitorSignals.filter((s) => ALL_SIGNAL_TYPES.includes(s))
    : [...ALL_SIGNAL_TYPES];
  const normalized = {
    id: normalizedId,
    title: cleanDisplayText(item?.title || 'Tracked item'),
    severity: normalizeSeverity(item?.severity || 'Observe'),
    sourceType: cleanDisplayText(item?.sourceType || 'Signal'),
    dueAt: item?.dueAt || null,
    owner: cleanDisplayText(item?.owner || 'You'),
    counterparties: Array.isArray(item?.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
    summary: cleanDisplayText(item?.summary || ''),
    reason: cleanDisplayText(item?.reason || ''),
    status: cleanDisplayText(item?.status || 'Tracked'),
    trackedAt: item?.trackedAt || nowIso(),
    monitorPrompt: cleanDisplayText(item?.monitorPrompt || '') || buildDefaultMonitorPrompt(item),
    evidenceLinks: (() => {
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
    })(),
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
    lastCheckSignature: item?.lastCheckSignature || null,
    lastNotifiedSignature: item?.lastNotifiedSignature || null,
    notifyEnabled: item?.notifyEnabled !== false,
    origin: item?.origin === 'custom' ? 'custom' : 'imported',
    updateHistory: Array.isArray(item?.updateHistory)
      ? item.updateHistory.map((e) => ({ ...e, seen: e.seen ?? true }))
      : [],
    hasNewUpdate: item?.hasNewUpdate === true,
    suggestedNextSteps: Array.isArray(item?.suggestedNextSteps) ? item.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2) : [],
    archived: item?.archived === true,
  };

  if (!normalized.nextRunAt && normalized.monitorEnabled) {
    normalized.nextRunAt = computeNextRunAt(normalized);
  }

  return normalized;
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

function updateTrackingSchedule(itemId, nextScheduleType, nextScheduleValue, nextOneTimeAt, opts = {}) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
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
  savePersistentState();
  if (!opts.skipRender) {
    renderTrackingMode();
  }
}

function setTrackingEnabled(itemId, enabled) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;

  item.monitorEnabled = enabled;
  item.nextRunAt = enabled ? computeNextRunAt(item) : null;
  savePersistentState();
  renderTrackingMode();
}

function upsertTrackingItemFromRadar(item) {
  if (!item || !item.id) return;

  const normalized = normalizeTrackingItem({
    id: item.id,
    title: item.title,
    severity: item.severity,
    sourceType: item.sourceType,
    dueAt: item.dueAt || null,
    owner: item.owner,
    counterparties: Array.isArray(item.counterparties) ? item.counterparties : [],
    summary: item.summary || item.reason || '',
    reason: item.reason || item.summary || '',
    status: item.status || 'Tracked',
    trackedAt: nowIso(),
    origin: 'imported',
    evidenceLinks: Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [],
    suggestedNextSteps: Array.isArray(item.suggestedNextSteps) ? item.suggestedNextSteps : [],
    hasNewUpdate: true,
    monitorPrompt: buildDefaultMonitorPrompt(item),
    monitorEnabled: true,
    scheduleType: 'interval',
    scheduleValue: '2h',
    workHoursOnly: true,
  });

  const existingIndex = state.trackingItems.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    const existing = state.trackingItems[existingIndex];
    state.trackingItems[existingIndex] = {
      ...existing,
      ...normalized,
      updateHistory: existing.updateHistory || [],
      monitorPrompt: existing.monitorPrompt || normalized.monitorPrompt,
      monitorEnabled: typeof existing.monitorEnabled === 'boolean' ? existing.monitorEnabled : normalized.monitorEnabled,
      notifyEnabled: typeof existing.notifyEnabled === 'boolean' ? existing.notifyEnabled : normalized.notifyEnabled,
      workHoursOnly: typeof existing.workHoursOnly === 'boolean' ? existing.workHoursOnly : normalized.workHoursOnly,
      scheduleType: existing.scheduleType || normalized.scheduleType,
      scheduleValue: existing.scheduleValue || normalized.scheduleValue,
      oneTimeAt: existing.oneTimeAt || normalized.oneTimeAt,
      nextRunAt: existing.nextRunAt || normalized.nextRunAt,
      lastRunAt: existing.lastRunAt || normalized.lastRunAt,
      lastCheckSignature: existing.lastCheckSignature || normalized.lastCheckSignature,
      lastNotifiedSignature: existing.lastNotifiedSignature || normalized.lastNotifiedSignature,
      trackedAt: existing.trackedAt || normalized.trackedAt,
    };
  } else {
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
    state.trackingItems.unshift(normalized);
  }

  savePersistentState();
}

function removeTrackingItem(itemId) {
  const before = state.trackingItems.length;
  state.trackingItems = state.trackingItems.filter((entry) => entry.id !== itemId);
  if (state.trackingItems.length !== before) {
    savePersistentState();
  }
}

function dismissRadarItem(itemId) {
  if (!itemId) return null;

  const radarItem = state.radarItems.find((entry) => entry.id === itemId) || null;
  const trackingItem = state.trackingItems.find((entry) => entry.id === itemId) || null;
  const item = radarItem || trackingItem;
  if (!item) return null;

  state.radarItems = state.radarItems.filter((entry) => entry.id !== itemId);
  state.trackingItems = state.trackingItems.filter((entry) => entry.id !== itemId);
  state.actions = state.actions.filter((entry) => entry.radarItemId !== itemId);
  state.evidence = state.evidence.filter((entry) => entry.radarItemId !== itemId);

  if (state.selectedRadarItemId === itemId) {
    state.selectedRadarItemId = state.radarItems[0]?.id || null;
  }

  savePersistentState();
  return item;
}

function updateTrackingItemField(itemId, field, value) {
  const item = state.trackingItems.find((i) => i.id === itemId);
  if (!item) return null;
  
  const oldValue = item[field];
  item[field] = value;
  savePersistentState();

  return { item, oldValue, newValue: value };
}
