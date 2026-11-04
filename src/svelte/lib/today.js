import { isMailboxActive, isMailboxSnoozed } from './mailbox.js';
import { isConfirmedCommunication, isWorkPlanStepCompleted } from './action-proposals.js';

const SEVERITY = { Critical: 0, Elevated: 1, Observe: 2 };
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const severityOrder = (left, right) => (SEVERITY[left.severity] ?? 3) - (SEVERITY[right.severity] ?? 3);

export function formatTodayTitle(title = '') {
  return title.replace(/\s*\u2014\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

export function todayDeadlineAt(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    if (date.getDate() !== Number(value.slice(-2))) return NaN;
    date.setDate(date.getDate() + 1);
    return date.getTime() - 1;
  }
  return timestamp(value);
}

export function buildTodayDashboard(sourceItems, now = Date.now(), deletedIds = []) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const isToday = value => {
    const time = timestamp(value);
    return time >= start.getTime() && time < end.getTime() && time <= now;
  };
  const deleted = new Set(deletedIds);
  const all = [...new Map(sourceItems.filter(item => !deleted.has(item.id)).map(item => [item.id, item])).values()];
  const active = all.filter(item => isMailboxActive(item) && !isMailboxSnoozed(item, now));
  const due = active.filter(item => todayDeadlineAt(item.dueAt) < end.getTime())
    .sort((left, right) => todayDeadlineAt(left.dueAt) - todayDeadlineAt(right.dueAt)
      || severityOrder(left, right) || left.id.localeCompare(right.id));
  const blocked = active.filter(item => ['blocked', 'waiting'].includes(item.lifecycleStatus))
    .sort((left, right) => Number(right.lifecycleStatus === 'blocked') - Number(left.lifecycleStatus === 'blocked')
      || severityOrder(left, right)
      || (timestamp(left.lastChangedAt) || 0) - (timestamp(right.lastChangedAt) || 0)
      || left.id.localeCompare(right.id));
  const ranked = [...active].sort((left, right) => severityOrder(left, right) || left.id.localeCompare(right.id));
  const completionTime = item => {
    const lifecycle = (item.updateHistory || []).filter(entry => entry.kind === 'lifecycle'
      && entry.summary !== 'Status changed to archived')
      .sort((left, right) => (timestamp(right.timestamp) || 0) - (timestamp(left.timestamp) || 0))[0];
    if (lifecycle) return lifecycle.summary === 'Status changed to complete' ? lifecycle.timestamp : null;
    return item.completedAt;
  };
  const completed = all.filter(item => ['complete', 'archived'].includes(item.lifecycleStatus)
    && isToday(completionTime(item)))
    .map(item => ({ item, at: completionTime(item) }))
    .sort((left, right) => timestamp(right.at) - timestamp(left.at));
  const seenActions = new Set();
  const confirmed = all.flatMap(item => (item.updateHistory || []).filter(entry => {
    if (entry.kind !== 'action' || entry.event !== 'succeeded' || !entry.proposalId || !isToday(entry.timestamp)
      || !isConfirmedCommunication({
        state: 'Succeeded', channel: entry.channel,
        executionCode: entry.code, executionVerification: entry.verification,
      }) || seenActions.has(entry.proposalId)) return false;
    seenActions.add(entry.proposalId);
    return true;
  }).map(entry => ({ item, at: entry.timestamp, channel: entry.channel, id: entry.proposalId })))
    .sort((left, right) => timestamp(right.at) - timestamp(left.at));
  return {
    records: all, active, due, blocked, completed, confirmed,
    overdue: due.filter(item => todayDeadlineAt(item.dueAt) < now),
    dueToday: due.filter(item => todayDeadlineAt(item.dueAt) >= start.getTime()),
    nextMove: due[0] || blocked[0] || ranked[0] || null,
  };
}

export function nextUnfinishedMove(item) {
  return (item.suggestedNextSteps || []).find(step => !isWorkPlanStepCompleted(item, step)) || '';
}

export function buildTodayOverview(sourceItems, { now = Date.now(), deletedIds = [], scanners = [], meetings = [] } = {}) {
  const dashboard = buildTodayDashboard(sourceItems, now, deletedIds);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(tomorrow);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const oldDeadline = new Date(start);
  oldDeadline.setDate(oldDeadline.getDate() - 7);
  const statuses = [
    { key: 'in-progress', label: 'In progress' }, { key: 'blocked', label: 'Blocked' },
    { key: 'waiting', label: 'Waiting' }, { key: 'unknown', label: 'Unclassified' },
  ].map(bucket => ({
    ...bucket,
    items: dashboard.active.filter(item => (['in-progress', 'blocked', 'waiting'].includes(item.lifecycleStatus)
      ? item.lifecycleStatus : 'unknown') === bucket.key),
  }));
  const deadlineKey = item => {
    const due = todayDeadlineAt(item.dueAt);
    if (!Number.isFinite(due)) return 'undated';
    if (due < now) return 'overdue';
    if (due < tomorrow.getTime()) return 'today';
    if (due < weekEnd.getTime()) return 'week';
    return 'later';
  };
  const deadlines = [
    { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Due today' },
    { key: 'week', label: 'Next 7 days' }, { key: 'later', label: 'Later' },
    { key: 'undated', label: 'No valid deadline' },
  ].map(bucket => ({ ...bucket, items: dashboard.active.filter(item => deadlineKey(item) === bucket.key) }));

  const scannerNames = new Map(scanners.map(scanner => [scanner.id, scanner.name]));
  const grouped = new Map();
  for (const item of dashboard.active) {
    const key = scannerNames.has(item.scannerId) ? `scanner:${item.scannerId}` : 'unassigned';
    if (!grouped.has(key)) grouped.set(key, {
      key, label: scannerNames.get(item.scannerId) || 'Unassigned / unavailable scanner', items: [],
    });
    grouped.get(key).items.push(item);
  }
  const sortedGroups = [...grouped.values()].sort((left, right) => right.items.length - left.items.length
    || left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
  const groups = sortedGroups.length <= 6 ? sortedGroups : [
    ...sortedGroups.slice(0, 5),
    { key: 'other', label: 'Other scanners', items: sortedGroups.slice(5).flatMap(group => group.items) },
  ];

  const activity = Array.from({ length: 7 }, (_, index) => {
    const from = new Date(start);
    from.setDate(from.getDate() - 6 + index);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return {
      key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`,
      label: from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      from: from.getTime(), to: to.getTime(), items: [], events: [],
      counts: { discovery: 0, update: 0, lifecycle: 0, communication: 0 },
    };
  });
  const seenEvents = new Set();
  for (const item of dashboard.records) {
    for (const entry of item.updateHistory || []) {
      const time = timestamp(entry.timestamp);
      if (!Number.isFinite(time) || time > now) continue;
      const bucket = activity.find(day => time >= day.from && time < day.to);
      if (!bucket) continue;
      let kind;
      if (entry.kind === 'action') {
        if (entry.event !== 'succeeded' || !entry.proposalId || !isConfirmedCommunication({
          state: 'Succeeded', channel: entry.channel, executionCode: entry.code, executionVerification: entry.verification,
        })) continue;
        kind = 'communication';
      } else if (entry.kind === 'lifecycle') kind = 'lifecycle';
      else if (entry.kind === 'discovery' || entry.changes?.includes('Discovered')) kind = 'discovery';
      else if (entry.kind === 'reply' || entry.summary || entry.changes?.length) kind = 'update';
      else continue;
      const key = kind === 'communication' ? `action:${entry.proposalId}`
        : `${item.id}:${entry.eventId || `${kind}:${entry.timestamp}:${entry.summary || (entry.changes || []).join('|')}`}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      bucket.counts[kind] += 1;
      bucket.events.push({ item, at: entry.timestamp, kind, summary: entry.summary || 'Thread updated' });
      if (!bucket.items.some(existing => existing.id === item.id)) bucket.items.push(item);
    }
  }
  const attentionRank = item => {
    if (deadlineKey(item) === 'today') return 0;
    if (item.lifecycleStatus === 'blocked' && item.severity === 'Critical') return 1;
    if (item.severity === 'Critical') return 2;
    if (item.lifecycleStatus === 'blocked') return 3;
    if (deadlineKey(item) === 'overdue' && todayDeadlineAt(item.dueAt) >= oldDeadline.getTime()) return 4;
    if (item.lifecycleStatus === 'waiting') return 5;
    if (deadlineKey(item) === 'overdue') return 6;
    return 7;
  };
  const attention = dashboard.active.filter(item => attentionRank(item) < 7)
    .sort((left, right) => attentionRank(left) - attentionRank(right) || severityOrder(left, right)
      || (todayDeadlineAt(left.dueAt) - todayDeadlineAt(right.dueAt))
      || (timestamp(right.lastChangedAt) || 0) - (timestamp(left.lastChangedAt) || 0)
      || left.id.localeCompare(right.id))
    .slice(0, 3).map(item => ({
      item,
      reason: ['Due today', 'Critical and blocked', 'Critical priority', 'Blocked work', 'Recently overdue', 'Waiting for follow-up', 'Older deadline to review'][attentionRank(item)],
      needsDeadlineReview: todayDeadlineAt(item.dueAt) < oldDeadline.getTime(),
    }));
  const schedule = meetings.filter(meeting => {
    const time = timestamp(meeting.startAt);
    return time >= start.getTime() && time < tomorrow.getTime();
  }).sort((left, right) => timestamp(left.startAt) - timestamp(right.startAt) || left.id.localeCompare(right.id));
  return { ...dashboard, statuses, deadlines, groups, activity, attention, schedule };
}

export function todaySelectionItems(overview, selection) {
  const collections = { status: overview.statuses, deadline: overview.deadlines, scanner: overview.groups, activity: overview.activity };
  return collections[selection?.kind]?.find(bucket => bucket.key === selection.key)?.items || [];
}
