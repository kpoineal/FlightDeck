// ── Unified item model (ES module) ─────────────────────────────────
import {
  SCHEDULE_INTERVAL_OPTIONS,
  WEEKLY_DAY_OPTIONS,
  DEFAULT_WEEKLY_DAYS,
  DEFAULT_WEEKLY_TIMES,
  WORK_HOURS_START_HOUR,
  WORK_HOURS_END_HOUR,
  LIFECYCLE_STATUSES,
  ALL_SIGNAL_TYPES,
  MAX_EVIDENCE_LINKS_PER_ITEM,
} from '../constants.js';
import {
  hashString,
  nowIso,
  cleanDisplayText,
  normalizeSeverity,
  toIsoOrNull,
  normalizeSignalType,
  normalizeExternalUrl,
  isGenericUrl,
  isHallucinatedUrl,
  isDeepLink,
  compactLinkLabel,
  normalizeEvidenceLink,
  extractInlineCitations,
  extractBareUrlCitations,
  adoptStructuredLabels,
  extractLabelEmbeddedUrl,
} from '../utils.js';

// ── Schedule / monitoring helpers ──────────────────────────────────

function intervalValueToMinutes(value) {
  const matched = SCHEDULE_INTERVAL_OPTIONS.find((entry) => entry.value === value);
  return matched ? matched.minutes : 30;
}

function applyWorkHoursWindow(nextDate, workHoursOnly) {
  const candidate = new Date(nextDate);
  if (!Number.isFinite(candidate.getTime())) return candidate;
  if (!workHoursOnly) return candidate;
  const hour = candidate.getHours();
  if (hour < WORK_HOURS_START_HOUR) {
    candidate.setHours(WORK_HOURS_START_HOUR, 0, 0, 0);
  } else if (hour >= WORK_HOURS_END_HOUR) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(WORK_HOURS_START_HOUR, 0, 0, 0);
  }
  return candidate;
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
  const candidates = [];
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(fromDate);
    candidate.setDate(candidate.getDate() + offset);
    if (!jsDaySet.has(candidate.getDay())) continue;
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const slot = new Date(candidate);
      slot.setHours(hh, mm, 0, 0);
      if (slot > fromDate) candidates.push(slot);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return candidates[0].toISOString();
}

export function computeNextRunAt(item, fromDate = new Date()) {
  if (!item?.monitorEnabled) return null;
  if (item.scheduleType === 'one-time') {
    if (!item.oneTimeAt) return null;
    const parsed = new Date(item.oneTimeAt);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  if (item.scheduleType === 'weekly') {
    const nextWeeklyRun = computeNextWeeklyRun(item, fromDate);
    if (!nextWeeklyRun) return null;
    return applyWorkHoursWindow(new Date(nextWeeklyRun), item.workHoursOnly === true).toISOString();
  }
  const minutes = intervalValueToMinutes(item.scheduleValue);
  const nextDate = applyWorkHoursWindow(new Date(fromDate.getTime() + minutes * 60 * 1000), item.workHoursOnly === true);
  return nextDate.toISOString();
}

// ── Evidence link processing ────────────────────────────────────────

function _buildEvidenceLinks(item, inlineLinks) {
  const links = [];
  const seenUrls = new Set();

  const structured = Array.isArray(item?.evidenceLinks)
    ? item.evidenceLinks.map((entry) => normalizeEvidenceLink(entry, item?.sourceType || 'source')).filter(Boolean)
    : [];
  for (const entry of structured) {
    if (seenUrls.has(entry.url)) continue;
    links.push(entry);
    seenUrls.add(entry.url);
  }

  for (const entry of inlineLinks) {
    if (!entry.url || seenUrls.has(entry.url)) continue;
    links.push(entry);
    seenUrls.add(entry.url);
  }

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
  if (item.doneCriteria) parts.push(`Done when: ${item.doneCriteria}`);

  return parts.join('\n') || title || 'Tracked task';
}

// ── Unified normalizer ─────────────────────────────────────────────

export function normalizeItem(item) {
  const inlineLinks = [
    ...extractInlineCitations(item?.summary || ''),
    ...extractInlineCitations(item?.reason || ''),
  ];
  if (!inlineLinks.length) {
    inlineLinks.push(
      ...extractBareUrlCitations(item?.summary || ''),
      ...extractBareUrlCitations(item?.reason || ''),
    );
  }
  adoptStructuredLabels(inlineLinks, item?.evidenceLinks);

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
    doneCriteria: cleanDisplayText(item?.doneCriteria || '') || null,
    evidenceLinks: _buildEvidenceLinks(item, inlineLinks).slice(0, MAX_EVIDENCE_LINKS_PER_ITEM),
    suggestedNextSteps: Array.isArray(item?.suggestedNextSteps)
      ? item.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
      : [],
    discoveredAt: item?.discoveredAt || nowIso(),
    trackedAt: item?.trackedAt || null,
    monitorPrompt: cleanDisplayText(item?.monitorPrompt || '') || buildDefaultMonitorPrompt(item),
    monitorEnabled,
    workHoursOnly: item?.workHoursOnly === true,
    monitorSignals,
    scheduleType: item?.scheduleType === 'one-time' ? 'one-time' : item?.scheduleType === 'weekly' ? 'weekly' : 'interval',
    scheduleValue: SCHEDULE_INTERVAL_OPTIONS.some((entry) => entry.value === item?.scheduleValue) ? item.scheduleValue : '4h',
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
    completedAt: item?.completedAt || null,
    lastCheckSignature: item?.lastCheckSignature || null,
    lastNotifiedSignature: item?.lastNotifiedSignature || null,
    notifyEnabled: item?.notifyEnabled !== false,
    origin: item?.origin === 'custom' ? 'custom' : 'imported',
    lifecycleStatus: (() => {
      if (item?.archived === true || item?.completed === true) return 'archived';
      if (item?.lifecycleStatus === 'complete' || item?.lifecycleStatus === 'archived') return item.lifecycleStatus;
      if (item?.lifecycleStatus === 'snoozed') return 'snoozed';
      const s = String(item?.status || '').toLowerCase();
      if (s.includes('complete') || s.includes('resolved') || s.includes('closed') || s.includes('done')) return 'complete';
      if (s.includes('block') || s.includes('stalled')) return 'blocked';
      if (s.includes('wait') || s.includes('pending')) return 'waiting';
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
    snoozeUntil: item?.snoozeUntil || null,
    ledgerEvidenceLinks: Array.isArray(item?.ledgerEvidenceLinks) ? item.ledgerEvidenceLinks : [],
    isLedger: item?.isLedger === true,
  };

  if (!normalized.updateHistory.length) {
    normalized.updateHistory.push({
      timestamp: normalized.discoveredAt || normalized.trackedAt || nowIso(),
      changes: ['Discovered'],
      summary: normalized.summary || normalized.title || '',
      status: normalized.status,
      severity: normalized.severity,
      newLinks: normalized.evidenceLinks.length ? [...normalized.evidenceLinks] : undefined,
      suggestedNextSteps: normalized.suggestedNextSteps.length ? [...normalized.suggestedNextSteps] : undefined,
      seen: true,
    });
  }

  if (!normalized.nextRunAt && normalized.monitorEnabled) {
    normalized.nextRunAt = computeNextRunAt(normalized);
  }

  return normalized;
}
