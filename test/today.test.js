import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildTodayDashboard, buildTodayOverview, formatTodayTitle, nextUnfinishedMove, todayDeadlineAt, todaySelectionItems } from '../src/svelte/lib/today.js';

const now = new Date(2026, 10, 2, 12).getTime();
const at = (offset = 0, hour = 9) => new Date(2026, 10, 2 + offset, hour).toISOString();
const item = (id, fields = {}) => ({ id, severity: 'Observe', lifecycleStatus: 'in-progress', ...fields });
const ids = entries => entries.map(entry => entry.id);
const lifecycle = (status, timestamp) => ({ kind: 'lifecycle', summary: `Status changed to ${status}`, timestamp });
const action = (proposalId, fields = {}) => ({
  kind: 'action', event: 'succeeded', proposalId, channel: 'teams', timestamp: at(),
  verification: 'runtime-backend-confirmed', code: 'SEND_CONFIRMED', ...fields,
});

test('Today removes em dashes from display titles without changing source titles or ordinary hyphens', () => {
  const record = item('source', { title: ' Acme \u2014 Windows lift-and-shift \u2014 next steps ' });
  assert.equal(formatTodayTitle(record.title), 'Acme Windows lift-and-shift next steps');
  assert.equal(record.title, ' Acme \u2014 Windows lift-and-shift \u2014 next steps ');
  assert.equal(formatTodayTitle('Customer\u2014planning'), 'Customer planning');
  assert.equal(formatTodayTitle('Plain title'), 'Plain title');
  assert.equal(formatTodayTitle(), '');
});

test('Today orders recorded deadlines before severity or customer names, with stable severity ties', () => {
  const dashboard = buildTodayDashboard([
    item('meridian', { title: 'Meridian', severity: 'Critical' }),
    item('today', { dueAt: at(0, 17) }),
    item('old-observe', { dueAt: at(-1) }),
    item('old-critical-b', { dueAt: at(-1), severity: 'Critical' }),
    item('old-critical-a', { dueAt: at(-1), severity: 'Critical' }),
    item('tomorrow', { dueAt: at(1) }),
    item('invalid', { dueAt: 'not a date' }),
    item('missing'),
  ], now);
  assert.deepEqual(ids(dashboard.due), ['old-critical-a', 'old-critical-b', 'old-observe', 'today']);
  assert.equal(dashboard.nextMove.id, 'old-critical-a');
  assert.equal(dashboard.overdue.length, 3);
  assert.deepEqual(ids(dashboard.dueToday), ['today']);
});

test('Today excludes snoozed, archived, completed and deleted work from both active queues', () => {
  const candidates = [
    item('active', { dueAt: at(-1), lifecycleStatus: 'waiting' }),
    item('snoozed', { dueAt: at(-1), lifecycleStatus: 'blocked', snoozeUntil: at(1) }),
    item('archived-flag', { dueAt: at(-1), archived: true, lifecycleStatus: 'blocked' }),
    item('archived', { dueAt: at(-1), lifecycleStatus: 'archived' }),
    item('complete', { dueAt: at(-1), lifecycleStatus: 'complete' }),
    item('deleted', { dueAt: at(-1), lifecycleStatus: 'blocked' }),
  ];
  const dashboard = buildTodayDashboard(candidates, now, ['deleted']);
  assert.deepEqual(ids(dashboard.active), ['active']);
  assert.deepEqual(ids(dashboard.due), ['active']);
  assert.deepEqual(ids(dashboard.blocked), ['active']);
});

test('Today uses the latest hot copy and never counts a hot/cold thread twice', () => {
  const dashboard = buildTodayDashboard([
    item('shared', { lifecycleStatus: 'complete', completedAt: at() }),
    item('shared', { lifecycleStatus: 'blocked' }),
  ], now);
  assert.equal(dashboard.completed.length, 0);
  assert.deepEqual(ids(dashboard.blocked), ['shared']);
});

test('Today includes canonical blocked and waiting work at any severity, independently of deadlines', () => {
  const dashboard = buildTodayDashboard([
    item('waiting-critical', { lifecycleStatus: 'waiting', severity: 'Critical' }),
    item('blocked-observe', { lifecycleStatus: 'blocked' }),
    item('blocked-critical', { lifecycleStatus: 'blocked', severity: 'Critical' }),
    item('fake-blocked', { isBlocked: true }),
  ], now);
  assert.deepEqual(ids(dashboard.blocked), ['blocked-critical', 'blocked-observe', 'waiting-critical']);
  assert.equal(dashboard.nextMove.id, 'blocked-critical');
  assert.equal(buildTodayDashboard([item('low'), item('high', { severity: 'Critical' })], now).nextMove.id, 'high');
});

test('Today only counts timestamped completions, excluding reopened, future and arbitrary updates', () => {
  const dashboard = buildTodayDashboard([
    item('legacy', { lifecycleStatus: 'complete', completedAt: at() }),
    item('recompleted', { lifecycleStatus: 'complete', completedAt: at(-4),
      updateHistory: [lifecycle('complete', at()), lifecycle('in-progress', at(-1))] }),
    item('reopened', { completedAt: at(), lastChangedAt: at() }),
    item('updated-only', { lifecycleStatus: 'complete', lastChangedAt: at() }),
    item('yesterday', { lifecycleStatus: 'complete', completedAt: at(-1) }),
    item('future', { lifecycleStatus: 'complete', completedAt: at(0, 18) }),
    item('archived-done', { lifecycleStatus: 'archived', completedAt: at(),
      updateHistory: [lifecycle('archived', at(0, 11)), lifecycle('complete', at())] }),
    item('archived-reopened', { lifecycleStatus: 'archived', completedAt: at(),
      updateHistory: [lifecycle('archived', at(0, 11)), lifecycle('in-progress', at(0, 10)), lifecycle('complete', at())] }),
  ], now);
  assert.deepEqual(dashboard.completed.map(entry => entry.item.id).sort(), ['archived-done', 'legacy', 'recompleted']);
});

test('Today counts only dated verified message outcomes, keeping Outlook creation distinct from send', () => {
  const recorded = item('recorded', { updateHistory: [
    action('sent'), action('sent'),
    action('draft', { channel: 'outlook-draft', code: 'DRAFT_SAVED' }),
    action('local-only', { verification: 'local' }),
    action('unconfirmed', { code: 'DELIVERY_UNCONFIRMED' }),
    action('failed', { event: 'failed' }),
    action('yesterday', { timestamp: at(-1) }),
    action('future', { timestamp: at(1) }),
    action('no-time', { timestamp: null }),
    action('wrong-channel', { channel: 'email' }),
  ] });
  const dashboard = buildTodayDashboard([recorded], now);
  assert.deepEqual(dashboard.confirmed.map(entry => [entry.id, entry.channel]), [['sent', 'teams'], ['draft', 'outlook-draft']]);
  assert.equal(dashboard.completed.length, 0, 'Sending a message must not complete its thread');
  assert.equal(buildTodayDashboard([recorded], now, ['recorded']).confirmed.length, 0);
});

test('Today applies local calendar boundaries and treats date-only deadlines as end-of-day', () => {
  const dateOnly = '2026-11-02';
  assert.equal(todayDeadlineAt(dateOnly), new Date(2026, 10, 3).getTime() - 1);
  assert.equal(Number.isNaN(todayDeadlineAt('2026-02-31')), true);
  assert.equal(Number.isNaN(todayDeadlineAt(null)), true);
  const dashboard = buildTodayDashboard([
    item('date-only', { dueAt: dateOnly }),
    item('past-today', { dueAt: at(0, 1) }),
    item('next-midnight', { dueAt: at(1, 0) }),
    item('midnight-complete', { lifecycleStatus: 'complete', completedAt: at(0, 0) }),
  ], now);
  assert.deepEqual(ids(dashboard.due), ['past-today', 'date-only']);
  assert.deepEqual(ids(dashboard.overdue), ['past-today']);
  assert.deepEqual(ids(dashboard.dueToday), ['past-today', 'date-only']);
  assert.equal(dashboard.completed.length, 1);
});

test('Today refresh projections expire snoozes and reset recorded progress across midnight', () => {
  const candidates = [
    item('snoozed', { dueAt: at(), snoozeUntil: at(0, 13) }),
    item('done', { lifecycleStatus: 'complete', completedAt: at() }),
  ];
  assert.equal(buildTodayDashboard(candidates, now).due.length, 0);
  assert.equal(buildTodayDashboard(candidates, new Date(2026, 10, 2, 14).getTime()).due.length, 1);
  const tomorrow = buildTodayDashboard(candidates, new Date(2026, 10, 3, 0).getTime());
  assert.equal(tomorrow.completed.length, 0);
  assert.equal(tomorrow.overdue.length, 1);
});

test('Today handles a 25-hour DST day without dropping early-morning completions', () => {
  const helperUrl = new URL('../src/svelte/lib/today.js', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { buildTodayDashboard, buildTodayOverview, todayDeadlineAt } from ${JSON.stringify(helperUrl)};
    const now = new Date(2026, 10, 1, 23, 45).getTime();
    const completedAt = new Date(2026, 10, 1, 0, 30).toISOString();
    const dashboard = buildTodayDashboard([{ id: 'dst', lifecycleStatus: 'complete', completedAt }], now);
    const overview = buildTodayOverview([{ id: 'dst', updateHistory: [{
      kind: 'lifecycle', summary: 'Status changed to complete', timestamp: completedAt,
    }] }], { now });
    console.log(JSON.stringify({
      count: dashboard.completed.length,
      hours: (todayDeadlineAt('2026-11-01') + 1 - new Date(2026, 10, 1).getTime()) / 3600000,
      events: overview.activity.at(-1).counts.lifecycle,
    }));
  `], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result.trim()), { count: 1, hours: 25, events: 1 });
});

test('Today recommends an unfinished work-plan move without fabricating a draft', () => {
  assert.equal(nextUnfinishedMove(item('moves', {
    suggestedNextSteps: ['Already done', 'Follow up with owner'],
    completedNextSteps: ['Already done'],
  })), 'Follow up with owner');
  assert.equal(nextUnfinishedMove(item('empty')), '');
  const dashboard = buildTodayDashboard([], now);
  assert.equal(dashboard.nextMove, null);
  assert.deepEqual(dashboard.completed, []);
});

test('Overview status and deadline buckets partition active work without overlapping counts', () => {
  const overview = buildTodayOverview([
    item('late-today', { dueAt: at(0, 9), lifecycleStatus: 'blocked' }),
    item('later-today', { dueAt: at(0, 17) }),
    item('next-week', { dueAt: at(7), lifecycleStatus: 'waiting' }),
    item('later', { dueAt: at(8) }),
    item('unknown', { lifecycleStatus: 'unknown', dueAt: 'bad date' }),
    item('done', { lifecycleStatus: 'complete' }),
    item('snoozed', { snoozeUntil: at(1) }),
  ], { now });
  assert.equal(overview.active.length, 5);
  for (const buckets of [overview.statuses, overview.deadlines]) {
    const bucketItems = buckets.flatMap(bucket => ids(bucket.items));
    assert.equal(bucketItems.length, overview.active.length);
    assert.equal(new Set(bucketItems).size, overview.active.length);
  }
  assert.deepEqual(ids(todaySelectionItems(overview, { kind: 'deadline', key: 'today' })), ['later-today']);
  assert.deepEqual(ids(todaySelectionItems(overview, { kind: 'deadline', key: 'overdue' })), ['late-today']);
  assert.deepEqual(ids(todaySelectionItems(overview, { kind: 'deadline', key: 'week' })), ['next-week']);
  assert.deepEqual(ids(todaySelectionItems(overview, { kind: 'status', key: 'unknown' })), ['unknown']);
  assert.deepEqual(todaySelectionItems(overview, null), []);
  assert.deepEqual(todaySelectionItems(overview, { kind: 'scanner', key: 'missing' }), []);
});

test('Overview uses scanner assignments, groups the long tail, and never infers accounts from titles', () => {
  const scanners = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, name: `Scanner ${index}` }));
  const records = scanners.map(scanner => item(scanner.id, { scannerId: scanner.id }));
  records.push(item('missing', { scannerId: 'deleted-scanner', title: 'Customer X work' }));
  const overview = buildTodayOverview(records, { now, scanners });
  assert.equal(overview.groups.length, 6);
  assert.equal(overview.groups.flatMap(group => group.items).length, 9);
  assert.equal(overview.groups.at(-1).key, 'other');
  assert.equal(overview.groups.some(group => group.label.includes('Customer X')), false);
  assert.equal(todaySelectionItems(overview, { kind: 'scanner', key: 'other' }).length, 4);
  assert.equal(buildTodayOverview([item('unassigned')], { now }).groups[0].label, 'Unassigned / unavailable scanner');
});

test('Overview activity uses dated history, deduplicates sends and excludes unconfirmed/future/deleted events', () => {
  const events = [
    { kind: 'discovery', timestamp: at(), summary: 'Discovered' },
    { kind: 'reply', timestamp: at(), summary: 'Customer replied' },
    lifecycle('complete', at()),
    action('confirmed'), action('confirmed'),
    action('unconfirmed', { code: 'DELIVERY_UNCONFIRMED' }),
    action('failed', { event: 'failed' }),
    { kind: 'reply', timestamp: at(1), summary: 'Future' },
    { kind: 'reply', timestamp: 'invalid', summary: 'Invalid' },
    { kind: 'reply', timestamp: at(-7), summary: 'Outside the window' },
  ];
  const overview = buildTodayOverview([
    item('recorded', { updateHistory: events }),
    item('deleted', { updateHistory: [action('deleted')] }),
    item('timestamp-only', { lastChangedAt: at() }),
  ], { now, deletedIds: ['deleted'] });
  assert.equal(overview.activity.length, 7);
  assert.deepEqual(overview.activity.at(-1).counts, { discovery: 1, update: 1, lifecycle: 1, communication: 1 });
  assert.equal(overview.activity.flatMap(day => day.events).length, 4);
  assert.deepEqual(ids(todaySelectionItems(overview, { kind: 'activity', key: overview.activity.at(-1).key })), ['recorded']);
});

test('Overview attention is unique and prioritizes deadlines still ahead today over ancient overdue work', () => {
  const overview = buildTodayOverview([
    item('ancient', { dueAt: at(-70), severity: 'Critical', lifecycleStatus: 'blocked' }),
    item('today', { dueAt: at(0, 17) }),
    item('critical', { severity: 'Critical' }),
    item('waiting', { lifecycleStatus: 'waiting' }),
  ], { now });
  assert.equal(overview.attention.length, 3);
  assert.equal(overview.attention[0].item.id, 'today');
  assert.equal(overview.attention[1].item.id, 'ancient');
  assert.equal(overview.attention[1].needsDeadlineReview, true);
  assert.equal(new Set(overview.attention.map(entry => entry.item.id)).size, 3);
});

test('Overview schedule includes only this local calendar day and sorts actual meeting starts', () => {
  const overview = buildTodayOverview([], { now, meetings: [
    { id: 'later', startAt: at(0, 15) },
    { id: 'earlier', startAt: at(0, 9) },
    { id: 'tomorrow', startAt: at(1, 0) },
    { id: 'yesterday', startAt: at(-1, 23) },
    { id: 'invalid', startAt: 'bad date' },
  ] });
  assert.deepEqual(ids(overview.schedule), ['earlier', 'later']);
  assert.equal(overview.attention.length, 0);
  assert.equal(overview.groups.length, 0);
  assert.equal(overview.activity.every(day => day.events.length === 0), true);
});
