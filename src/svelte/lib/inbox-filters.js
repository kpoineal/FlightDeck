export const QUICK_FILTER_IDS = [
  'unread',
  'new',
  'updated',
  'critical',
  'blocked',
  'due-soon',
];

export const REFINE_FACET_IDS = [
  'severity',
  'lifecycle',
  'scanner',
  'read',
  'monitoring',
  'due',
  'signal',
  'activity-age',
];

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function timeline(item) {
  return Array.isArray(item?.updateHistory) ? item.updateHistory : [];
}

function isUnread(item) {
  return item?.isNew === true
    || item?.hasNewUpdate === true
    || timeline(item).some((entry) => entry?.seen === false);
}

function dueAt(item) {
  const value = Date.parse(item?.dueAt || '');
  return Number.isFinite(value) ? value : null;
}

function activityAt(item) {
  const value = Date.parse(
    item?.lastChangedAt || item?.lastRunAt || item?.discoveredAt || item?.trackedAt || ''
  );
  return Number.isFinite(value) ? value : null;
}

function nextCalendarDayBoundary(now, days) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function isDueSoon(item, now) {
  const due = dueAt(item);
  return due !== null && due < nextCalendarDayBoundary(now, 8);
}

function signalTypes(item) {
  const values = [item?.sourceType];
  for (const link of Array.isArray(item?.evidenceLinks) ? item.evidenceLinks : []) {
    values.push(link?.type, link?.sourceType);
  }
  return new Set(values.map(normalize).filter(Boolean));
}

function matchesQuickFilter(item, quickFilter, now) {
  switch (normalize(quickFilter)) {
    case 'unread': return isUnread(item);
    case 'new': return item?.isNew === true;
    case 'updated': return item?.hasNewUpdate === true;
    case 'critical': return normalize(item?.severity) === 'critical';
    case 'blocked': return normalize(item?.lifecycleStatus) === 'blocked';
    case 'due-soon': return isDueSoon(item, now);
    default: return true;
  }
}

function matchesFacetValue(item, facetId, value, now) {
  const normalizedValue = normalize(value);
  switch (facetId) {
    case 'severity':
      return normalize(item?.severity) === normalizedValue;
    case 'lifecycle':
      return normalize(item?.lifecycleStatus) === normalizedValue;
    case 'scanner':
      return normalize(item?.scannerId || 'unassigned') === normalizedValue;
    case 'read':
      return normalizedValue === (isUnread(item) ? 'unread' : 'read');
    case 'monitoring':
      if (normalizedValue === 'paused') return item?.monitorPaused === true;
      if (normalizedValue === 'enabled' || normalizedValue === 'monitoring') {
        return item?.monitorEnabled === true && item?.monitorPaused !== true;
      }
      if (normalizedValue === 'disabled' || normalizedValue === 'off') return item?.monitorEnabled !== true;
      return false;
    case 'due': {
      const due = dueAt(item);
      if (normalizedValue === 'none' || normalizedValue === 'no-due') return due === null;
      if (normalizedValue === 'overdue') return due !== null && due < now;
      if (normalizedValue === 'due-soon') return isDueSoon(item, now);
      if (normalizedValue === 'later') return due !== null && due >= nextCalendarDayBoundary(now, 8);
      return false;
    }
    case 'signal':
      return signalTypes(item).has(normalizedValue);
    case 'activity-age': {
      const activity = activityAt(item);
      if (normalizedValue === 'no-activity') return activity === null;
      if (activity === null) return false;
      if (normalizedValue === 'today') return activity >= nextCalendarDayBoundary(now, 0);
      if (normalizedValue === 'last-24-hours') return activity >= now - 24 * 60 * 60 * 1000;
      if (normalizedValue === 'last-7-days') return activity >= now - 7 * 24 * 60 * 60 * 1000;
      if (normalizedValue === 'last-30-days') return activity >= now - 30 * 24 * 60 * 60 * 1000;
      if (normalizedValue === 'older') return activity < now - 30 * 24 * 60 * 60 * 1000;
      return false;
    }
    default:
      return true;
  }
}

export function matchesInboxFilters(item, filters = {}, { now = Date.now() } = {}) {
  if (!matchesQuickFilter(item, filters?.quickFilter, now)) return false;

  const facets = filters?.facets || {};
  return REFINE_FACET_IDS.every((facetId) => {
    const values = Array.isArray(facets[facetId]) ? facets[facetId] : [];
    return values.length === 0 || values.some((value) => matchesFacetValue(item, facetId, value, now));
  });
}

export function filterInboxItems(items, filters = {}, options = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => matchesInboxFilters(item, filters, options));
}