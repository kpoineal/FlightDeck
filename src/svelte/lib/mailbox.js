import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES, UNKNOWN_LIFECYCLE_STATUS } from './constants.js';

const ARCHIVED_LIFECYCLES = new Set(['archived']);
const INACTIVE_LIFECYCLES = new Set(['complete', 'archived']);

function timeline(item) {
  return Array.isArray(item?.updateHistory) ? item.updateHistory : [];
}

export function isMailboxUnread(item) {
  return item?.isNew === true
    || item?.hasNewUpdate === true
    || timeline(item).some((entry) => entry?.seen === false);
}

export function isMailboxArchived(item) {
  return item?.archived === true || ARCHIVED_LIFECYCLES.has(item?.lifecycleStatus);
}

export function isMailboxActive(item) {
  return !isMailboxArchived(item) && !INACTIVE_LIFECYCLES.has(item?.lifecycleStatus);
}

export function isMailboxSnoozed(item, now = Date.now()) {
  const until = Date.parse(item?.snoozeUntil || '');
  return Number.isFinite(until) && until > now;
}

export function isRadarPriority(item, now = Date.now()) {
  return isMailboxActive(item)
    && !isMailboxSnoozed(item, now)
    && (item?.severity === 'Critical' || item?.lifecycleStatus === 'blocked');
}

export function mailboxActivityAt(item) {
  return item?.lastChangedAt || item?.lastRunAt || item?.discoveredAt || item?.trackedAt || '';
}

export function mailboxWorkStatus(item) {
  return LIFECYCLE_LABELS[item?.lifecycleStatus] || LIFECYCLE_LABELS[UNKNOWN_LIFECYCLE_STATUS];
}

export function mailboxWorkStatusClass(item) {
  return LIFECYCLE_STATUSES.includes(item?.lifecycleStatus) ? item.lifecycleStatus : UNKNOWN_LIFECYCLE_STATUS;
}

export function compareInboxThreads(left, right) {
  const leftUpdatedAt = Date.parse(mailboxActivityAt(left));
  const rightUpdatedAt = Date.parse(mailboxActivityAt(right));
  const leftHasUpdate = Number.isFinite(leftUpdatedAt);
  const rightHasUpdate = Number.isFinite(rightUpdatedAt);
  if (leftHasUpdate !== rightHasUpdate) return Number(rightHasUpdate) - Number(leftHasUpdate);
  if (leftHasUpdate && rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt - leftUpdatedAt;

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function compareMailboxThreads(left, right) {
  const unreadDifference = Number(isMailboxUnread(right)) - Number(isMailboxUnread(left));
  if (unreadDifference) return unreadDifference;

  const leftActivity = Date.parse(mailboxActivityAt(left));
  const rightActivity = Date.parse(mailboxActivityAt(right));
  const leftHasActivity = Number.isFinite(leftActivity);
  const rightHasActivity = Number.isFinite(rightActivity);
  if (leftHasActivity !== rightHasActivity) return Number(rightHasActivity) - Number(leftHasActivity);
  if (leftHasActivity && rightActivity !== leftActivity) return rightActivity - leftActivity;

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function getMailboxThreads(items, segment) {
  const uniqueItems = [...new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item])).values()];
  const threads = uniqueItems.filter((item) => {
    if (segment === 'inbox') return isMailboxActive(item) && !isMailboxSnoozed(item);
    if (segment === 'monitored') return isMailboxActive(item) && !isMailboxSnoozed(item) && item?.monitorEnabled === true;
    if (segment === 'archived') return isMailboxArchived(item) || item?.lifecycleStatus === 'complete';
    return !isMailboxArchived(item);
  });
  return threads.sort(segment === 'inbox' ? compareInboxThreads : compareMailboxThreads);
}

export function isMeaningfulThreadEntry(entry) {
  if (!entry || entry.kind === 'lifecycle') return false;
  if (entry.kind === 'discovery' || entry.changes?.includes?.('Discovered')) return false;
  return entry.kind === 'reply' || entry.seen === false;
}

export function latestMailboxUpdate(item) {
  return [...timeline(item)]
    .filter(isMeaningfulThreadEntry)
    .sort((left, right) => Date.parse(right?.timestamp || '') - Date.parse(left?.timestamp || ''))[0]
    || timeline(item)[0]
    || null;
}

export function summariesMatch(left, right) {
  const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedLeft = normalize(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalize(right);
}

export function markMailboxThreadRead(item) {
  if (!isMailboxUnread(item)) return item;
  return {
    ...item,
    isNew: false,
    hasNewUpdate: false,
    updateHistory: timeline(item).map((entry) => ({ ...entry, seen: true })),
  };
}