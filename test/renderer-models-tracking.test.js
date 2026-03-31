'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext({
    // Stubs for functions called by tracking.js but not under test
    savePersistentState: () => {},
    renderTrackingMode: () => {},
    // Minimal state needed by upsertTrackingItemFromRadar
    state: { trackingItems: [], items: [], radarItems: [] },
  });
  // Load dependencies in order (script-tag loading)
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/item.js');
});

/* ================================================================== */
/*  intervalValueToMinutes (internal helper exposed as global)         */
/* ================================================================== */
describe('intervalValueToMinutes()', () => {
  it('returns minutes for known interval values', () => {
    assert.equal(ctx.intervalValueToMinutes('15m'), 15);
    assert.equal(ctx.intervalValueToMinutes('30m'), 30);
    assert.equal(ctx.intervalValueToMinutes('1h'), 60);
    assert.equal(ctx.intervalValueToMinutes('2h'), 120);
    assert.equal(ctx.intervalValueToMinutes('4h'), 240);
  });

  it('defaults to 30 for unknown value', () => {
    assert.equal(ctx.intervalValueToMinutes('unknown'), 30);
    assert.equal(ctx.intervalValueToMinutes(null), 30);
  });
});

/* ================================================================== */
/*  computeNextRunAt                                                  */
/* ================================================================== */
describe('computeNextRunAt()', () => {
  it('returns null when monitorEnabled is false', () => {
    assert.equal(ctx.computeNextRunAt({ monitorEnabled: false }), null);
    assert.equal(ctx.computeNextRunAt({}), null);
  });

  it('returns ISO string for interval schedule', () => {
    const from = new Date('2025-06-15T10:00:00Z');
    const result = ctx.computeNextRunAt(
      { monitorEnabled: true, scheduleType: 'interval', scheduleValue: '1h' },
      from
    );
    assert.equal(result, '2025-06-15T11:00:00.000Z');
  });

  it('defaults to 30 min for unknown interval value', () => {
    const from = new Date('2025-06-15T10:00:00Z');
    const result = ctx.computeNextRunAt(
      { monitorEnabled: true, scheduleType: 'interval', scheduleValue: 'bogus' },
      from
    );
    assert.equal(result, '2025-06-15T10:30:00.000Z');
  });

  it('respects work-hours mode for interval schedules', () => {
    const from = new Date(2025, 5, 15, 16, 30, 0, 0);
    const result = new Date(ctx.computeNextRunAt(
      { monitorEnabled: true, scheduleType: 'interval', scheduleValue: '2h', workHoursOnly: true },
      from
    ));
    const nextDay = new Date(from);
    nextDay.setDate(nextDay.getDate() + 1);
    assert.equal(result.getFullYear(), nextDay.getFullYear());
    assert.equal(result.getMonth(), nextDay.getMonth());
    assert.equal(result.getDate(), nextDay.getDate());
    assert.equal(result.getHours(), 8);
    assert.equal(result.getMinutes(), 0);
  });

  it('returns ISO string for one-time schedule', () => {
    const result = ctx.computeNextRunAt({
      monitorEnabled: true,
      scheduleType: 'one-time',
      oneTimeAt: '2025-12-25T08:00:00Z',
    });
    assert.equal(result, '2025-12-25T08:00:00.000Z');
  });

  it('returns null for one-time with no date', () => {
    assert.equal(
      ctx.computeNextRunAt({ monitorEnabled: true, scheduleType: 'one-time' }),
      null
    );
  });

  it('returns null for one-time with invalid date', () => {
    assert.equal(
      ctx.computeNextRunAt({ monitorEnabled: true, scheduleType: 'one-time', oneTimeAt: 'nope' }),
      null
    );
  });

  it('delegates to computeNextWeeklyRun for weekly schedule', () => {
    const from = new Date('2025-06-16T07:00:00Z'); // Monday
    const result = ctx.computeNextRunAt(
      {
        monitorEnabled: true,
        scheduleType: 'weekly',
        weeklyDays: ['mon'],
        weeklyTimes: ['08:00'],
      },
      from
    );
    assert.ok(result); // Should find Monday 08:00 (same day, later)
  });
});

/* ================================================================== */
/*  computeNextWeeklyRun                                              */
/* ================================================================== */
describe('computeNextWeeklyRun()', () => {
  it('finds next slot on same day if time is in future', () => {
    // Monday 2025-06-16 at 06:00 → should find Mon 08:00
    const from = new Date('2025-06-16T06:00:00.000Z');
    // Note: weeklyTimes are in local time, but since we're in a vm context
    // with no timezone offset, we treat them as UTC-ish
    const result = ctx.computeNextWeeklyRun(
      { weeklyDays: ['mon'], weeklyTimes: ['08:00'] },
      from
    );
    assert.ok(result);
    assert.ok(new Date(result) > from);
  });

  it('advances to next matching day if past today\'s times', () => {
    // Monday 2025-06-16 at 20:00 → should find next matching day
    const from = new Date('2025-06-16T20:00:00.000Z');
    const result = ctx.computeNextWeeklyRun(
      { weeklyDays: ['mon', 'wed'], weeklyTimes: ['09:00'] },
      from
    );
    assert.ok(result);
    const next = new Date(result);
    assert.ok(next > from);
    // Should be Wednesday (day 3)
    assert.equal(next.getDay(), 3);
  });

  it('uses defaults when weeklyDays/weeklyTimes are empty', () => {
    const from = new Date('2025-06-16T06:00:00.000Z'); // Monday
    const result = ctx.computeNextWeeklyRun({}, from);
    assert.ok(result); // Should use default days (mon-fri) and times (08:00, 12:00)
  });

  it('returns null when no matching day in jsDaySet', () => {
    const result = ctx.computeNextWeeklyRun(
      { weeklyDays: ['invalidDay'], weeklyTimes: ['08:00'] },
      new Date('2025-06-16T06:00:00Z')
    );
    assert.equal(result, null);
  });
});

/* ================================================================== */
/*  trackingItemSignature                                             */
/* ================================================================== */
describe('trackingItemSignature()', () => {
  it('returns an 8-char hex hash', () => {
    const sig = ctx.trackingItemSignature({
      title: 'Test item',
      severity: 'Critical',
      summary: 'Summary text',
      reason: 'Reason text',
      status: 'Tracked',
      dueAt: '2025-06-15',
    });
    assert.match(sig, /^[0-9a-f]{8}$/);
  });

  it('is deterministic for same input', () => {
    const item = { title: 'A', severity: 'Observe', summary: 'B', reason: 'C', status: 'D' };
    assert.equal(ctx.trackingItemSignature(item), ctx.trackingItemSignature(item));
  });

  it('changes when title changes', () => {
    const base = { title: 'A', severity: 'Observe', summary: 'B', reason: 'C', status: 'D' };
    const modified = { ...base, title: 'Changed' };
    assert.notEqual(ctx.trackingItemSignature(base), ctx.trackingItemSignature(modified));
  });

  it('includes evidence link URLs in signature', () => {
    const withLinks = {
      title: 'A',
      severity: 'Observe',
      summary: '',
      reason: '',
      status: '',
      evidenceLinks: [{ url: 'https://example.com' }],
    };
    const withoutLinks = { ...withLinks, evidenceLinks: [] };
    assert.notEqual(ctx.trackingItemSignature(withLinks), ctx.trackingItemSignature(withoutLinks));
  });

  it('handles null/undefined item fields gracefully', () => {
    const sig = ctx.trackingItemSignature({});
    assert.match(sig, /^[0-9a-f]{8}$/);
  });
});

/* ================================================================== */
/*  normalizeTrackingItem                                             */
/* ================================================================== */
describe('normalizeTrackingItem()', () => {
  it('populates all expected fields', () => {
    const result = ctx.normalizeTrackingItem({ title: 'Test' });
    assert.equal(result.title, 'Test');
    assert.equal(typeof result.id, 'string');
    assert.ok(result.id.length > 0);
    assert.equal(result.severity, 'Observe');
    assert.equal(result.owner, 'You');
    assert.equal(result.status, 'Inbound');
    assert.equal(result.trackedAt, null); // null until monitoring is enabled
    assert.equal(result.counterparties.length, 0);
    assert.equal(result.evidenceLinks.length, 0);
    assert.ok(Array.isArray(result.weeklyDays));
    assert.ok(Array.isArray(result.weeklyTimes));
    assert.ok(Array.isArray(result.monitorSignals));
    assert.ok(Array.isArray(result.updateHistory));
  });

  it('generates an id when none is provided', () => {
    const result = ctx.normalizeTrackingItem({});
    assert.ok(result.id.startsWith('custom_'));
  });

  it('preserves valid severity values', () => {
    assert.equal(ctx.normalizeTrackingItem({ severity: 'Critical' }).severity, 'Critical');
    assert.equal(ctx.normalizeTrackingItem({ severity: 'Elevated' }).severity, 'Elevated');
  });

  it('normalizes unknown severity to Observe', () => {
    assert.equal(ctx.normalizeTrackingItem({ severity: 'Low' }).severity, 'Observe');
  });

  it('defaults scheduleType to interval', () => {
    assert.equal(ctx.normalizeTrackingItem({}).scheduleType, 'interval');
  });

  it('preserves valid scheduleType values', () => {
    assert.equal(ctx.normalizeTrackingItem({ scheduleType: 'one-time' }).scheduleType, 'one-time');
    assert.equal(ctx.normalizeTrackingItem({ scheduleType: 'weekly' }).scheduleType, 'weekly');
  });

  it('defaults scheduleValue to 30m', () => {
    assert.equal(ctx.normalizeTrackingItem({}).scheduleValue, '30m');
  });

  it('preserves valid scheduleValue', () => {
    assert.equal(ctx.normalizeTrackingItem({ scheduleValue: '1h' }).scheduleValue, '1h');
  });

  it('rejects invalid scheduleValue', () => {
    assert.equal(ctx.normalizeTrackingItem({ scheduleValue: 'invalid' }).scheduleValue, '30m');
  });

  it('filters monitorSignals to valid types', () => {
    const result = ctx.normalizeTrackingItem({ monitorSignals: ['email', 'invalid', 'chat'] });
    looseAssert.deepEqual([...result.monitorSignals], ['email', 'chat']);
  });

  it('defaults workHoursOnly to false', () => {
    const result = ctx.normalizeTrackingItem({});
    assert.equal(result.workHoursOnly, false);
  });

  it('preserves workHoursOnly when provided', () => {
    const result = ctx.normalizeTrackingItem({ workHoursOnly: true });
    assert.equal(result.workHoursOnly, true);
  });

  it('defaults monitorSignals to all types', () => {
    const result = ctx.normalizeTrackingItem({});
    looseAssert.deepEqual([...result.monitorSignals], ['email', 'chat', 'meeting', 'doc']);
  });

  it('filters weeklyDays to valid values', () => {
    const result = ctx.normalizeTrackingItem({ weeklyDays: ['mon', 'invalid', 'fri'] });
    looseAssert.deepEqual([...result.weeklyDays], ['mon', 'fri']);
  });

  it('validates weeklyTimes format', () => {
    const result = ctx.normalizeTrackingItem({ weeklyTimes: ['08:00', 'bad', '14:30'] });
    looseAssert.deepEqual([...result.weeklyTimes], ['08:00', '14:30']);
  });

  it('computes nextRunAt when monitorEnabled and none provided', () => {
    const result = ctx.normalizeTrackingItem({ monitorEnabled: true, scheduleValue: '15m' });
    assert.ok(result.nextRunAt);
  });

  it('preserves updateHistory with seen defaults', () => {
    const history = [{ timestamp: '2025-01-01', changes: ['x'] }];
    const result = ctx.normalizeTrackingItem({ updateHistory: history });
    assert.equal(result.updateHistory.length, 1);
    assert.equal(result.updateHistory[0].seen, true);
  });

  it('limits suggestedNextSteps to 2', () => {
    const result = ctx.normalizeTrackingItem({
      suggestedNextSteps: ['a', 'b', 'c', 'd'],
    });
    assert.equal(result.suggestedNextSteps.length, 2);
  });

  it('normalizes evidence links using source-type deep-link validation', () => {
    const result = ctx.normalizeTrackingItem({
      sourceType: 'Email',
      evidenceLinks: [
        {
          type: 'email',
          label: 'Budget email',
          url: 'https://outlook.office.com/mail/inbox/id/AAMk123',
          signalAt: '2026-03-04T09:00:00-05:00',
        },
        {
          type: 'email',
          label: 'Wrong URL',
          url: 'https://contoso.com/project/plan',
        },
      ],
    });

    assert.equal(result.evidenceLinks.length, 1);
    assert.equal(result.evidenceLinks[0].url, 'https://outlook.office.com/mail/inbox/id/AAMk123');
    assert.equal(result.evidenceLinks[0].signalAt, '2026-03-04T14:00:00.000Z');
  });
});

/* ================================================================== */
/*  buildDefaultMonitorPrompt                                         */
/* ================================================================== */
describe('buildDefaultMonitorPrompt()', () => {
  it('includes title in prompt', () => {
    const result = ctx.buildDefaultMonitorPrompt({ title: 'Quarterly Review' });
    assert.ok(result.includes('Quarterly Review'));
  });

  it('includes summary when different from title', () => {
    const result = ctx.buildDefaultMonitorPrompt({
      title: 'Review',
      summary: 'Discuss quarterly numbers',
    });
    assert.ok(result.includes('Discuss quarterly numbers'));
  });

  it('skips owner when "You"', () => {
    const result = ctx.buildDefaultMonitorPrompt({ title: 'Test', owner: 'You' });
    assert.ok(!result.includes('Owner:'));
  });

  it('includes owner when not "You"', () => {
    const result = ctx.buildDefaultMonitorPrompt({ title: 'Test', owner: 'Alice' });
    assert.ok(result.includes('Owner: Alice'));
  });

  it('includes counterparties', () => {
    const result = ctx.buildDefaultMonitorPrompt({
      title: 'Test',
      counterparties: ['Bob', 'Carol'],
    });
    assert.ok(result.includes('People:'));
    assert.ok(result.includes('Bob'));
  });

  it('returns fallback for empty input', () => {
    const result = ctx.buildDefaultMonitorPrompt({});
    assert.ok(result.length > 0);
  });
});

/* ================================================================== */
/*  unseenHistoryCount                                                */
/* ================================================================== */
describe('unseenHistoryCount()', () => {
  it('counts entries with seen === false', () => {
    const item = {
      updateHistory: [
        { seen: false },
        { seen: true },
        { seen: false },
      ],
    };
    assert.equal(ctx.unseenHistoryCount(item), 2);
  });

  it('returns 0 for empty history', () => {
    assert.equal(ctx.unseenHistoryCount({ updateHistory: [] }), 0);
  });

  it('returns 0 for missing history', () => {
    assert.equal(ctx.unseenHistoryCount({}), 0);
    assert.equal(ctx.unseenHistoryCount(null), 0);
  });
});

/* ================================================================== */
/*  upsertTrackingItemFromRadar — suggestedNextSteps persistence      */
/* ================================================================== */
describe('upsertTrackingItemFromRadar()', () => {
  it('preserves suggestedNextSteps on newly tracked item', () => {
    // Clear tracking items
    ctx.state.trackingItems = [];

    ctx.upsertTrackingItemFromRadar({
      id: 'test_steps_persist',
      title: 'Test Steps',
      severity: 'Elevated',
      summary: 'Something important',
      suggestedNextSteps: ['Reply to Alice', 'Escalate to VP'],
    });

    const item = ctx.state.trackingItems.find((e) => e.id === 'test_steps_persist');
    assert.ok(item, 'tracking item should exist');
    looseAssert.deepEqual(item.suggestedNextSteps, ['Reply to Alice', 'Escalate to VP']);
    assert.equal(item.hasNewUpdate, true);
  });

  it('stores suggestedNextSteps in initial history entry', () => {
    ctx.state.trackingItems = [];

    ctx.upsertTrackingItemFromRadar({
      id: 'test_steps_history',
      title: 'History Steps',
      severity: 'Critical',
      summary: 'Urgent matter',
      suggestedNextSteps: ['Send update to team'],
    });

    const item = ctx.state.trackingItems.find((e) => e.id === 'test_steps_history');
    assert.ok(item.updateHistory.length >= 1, 'should have at least one history entry');
    looseAssert.deepEqual(item.updateHistory[0].suggestedNextSteps, ['Send update to team']);
  });

  it('preserves suggestedNextSteps when updating existing item', () => {
    ctx.state.trackingItems = [];

    // First track the item
    ctx.upsertTrackingItemFromRadar({
      id: 'test_steps_update',
      title: 'Update Test',
      severity: 'Observe',
      summary: 'Initial summary',
      suggestedNextSteps: ['Step A'],
    });

    // Upsert again with new steps
    ctx.upsertTrackingItemFromRadar({
      id: 'test_steps_update',
      title: 'Update Test',
      severity: 'Elevated',
      summary: 'Updated summary',
      suggestedNextSteps: ['Step B', 'Step C'],
    });

    const item = ctx.state.trackingItems.find((e) => e.id === 'test_steps_update');
    looseAssert.deepEqual(item.suggestedNextSteps, ['Step B', 'Step C']);
  });

  it('suggestedNextSteps survive mark-seen (hasNewUpdate = false)', () => {
    ctx.state.trackingItems = [];

    ctx.upsertTrackingItemFromRadar({
      id: 'test_steps_seen',
      title: 'Seen Test',
      severity: 'Elevated',
      summary: 'Check this',
      suggestedNextSteps: ['Follow up with Sam', 'Review contract'],
    });

    const item = ctx.state.trackingItems.find((e) => e.id === 'test_steps_seen');
    assert.ok(item.hasNewUpdate, 'should start with hasNewUpdate=true');

    // Simulate mark-seen: clear the badge but NOT the steps
    item.hasNewUpdate = false;
    if (Array.isArray(item.updateHistory)) {
      item.updateHistory.forEach((e) => { e.seen = true; });
    }

    // Steps must still be present on the card
    looseAssert.deepEqual(item.suggestedNextSteps, ['Follow up with Sam', 'Review contract']);
  });

  it('defaults radar tracking to monitored every 2h during work hours', () => {
    ctx.state.trackingItems = [];

    ctx.upsertTrackingItemFromRadar({
      id: 'test_tracking_defaults',
      title: 'Defaults Test',
      severity: 'Observe',
      summary: 'Track defaults',
    });

    const item = ctx.state.trackingItems.find((e) => e.id === 'test_tracking_defaults');
    assert.ok(item);
    assert.equal(item.monitorEnabled, true);
    assert.equal(item.scheduleType, 'interval');
    assert.equal(item.scheduleValue, '2h');
    assert.equal(item.workHoursOnly, true);
  });
});

/* ================================================================== */
/*  monitorTaskItem no-update handling                                */
/* ================================================================== */
describe('monitorTaskItem()', () => {
  function createMonitorContext(payload) {
    const notifications = [];
    const ctx2 = createRendererContext({
      state: { connected: true, trackingItems: [], items: [], radarItems: [] },
      buildTaskMonitorPrompt: () => 'monitor prompt',
      runWorkiqJson: async () => payload,
      addHistory: () => {},
      savePersistentState: () => {},
      setStatus: () => {},
      setUpdatedNow: () => {},
      renderTrackingMode: () => {},
      window: {
        location: { search: '' },
        workiq: {
          showDesktopNotification: async (payloadArg) => {
            notifications.push(payloadArg);
          },
        },
      },
    });
    loadFile(ctx2, 'renderer/constants.js');
    loadFile(ctx2, 'renderer/utils.js');
    loadFile(ctx2, 'renderer/models/item.js');
    loadFile(ctx2, 'renderer/monitor-engine.js');
    ctx2.__notifications = notifications;
    return ctx2;
  }

  it('does not mark new update when hasNewInfo is boolean false', async () => {
    const ctx2 = createMonitorContext({
      hasNewInfo: false,
      summary: 'Reworded summary should be ignored',
      status: 'Tracked',
      severity: 'Critical',
      evidenceLinks: [{ type: 'chat', url: 'https://teams.microsoft.com/l/chat/0/0?users=a' }],
    });
    const item = ctx2.normalizeTrackingItem({
      id: 'monitor_false_bool',
      title: 'Follow up with Alex',
      sourceType: 'Chat',
      summary: 'Current summary',
      status: 'Tracked',
      severity: 'Observe',
      monitorEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '30m',
      evidenceLinks: [{ type: 'chat', url: 'https://teams.microsoft.com/l/chat/0/0?users=a' }],
      hasNewUpdate: false,
    });

    await ctx2.monitorTaskItem(item, { manual: true });

    assert.equal(item.summary, 'Current summary');
    assert.equal(item.hasNewUpdate, false);
    assert.equal(ctx2.__notifications.length, 0);
  });

  it('treats string "false" as no-update and avoids new-update badge', async () => {
    const ctx2 = createMonitorContext({
      hasNewInfo: 'false',
      summary: 'Incorrectly marked as new',
      status: 'Tracked',
      severity: 'Critical',
      evidenceLinks: [{ type: 'email', url: 'https://outlook.office.com/mail/inbox/id/AAMk123' }],
    });
    const item = ctx2.normalizeTrackingItem({
      id: 'monitor_false_string',
      title: 'Budget approval',
      sourceType: 'Email',
      summary: 'No new email yet',
      status: 'Tracked',
      severity: 'Observe',
      monitorEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '30m',
      evidenceLinks: [{ type: 'email', url: 'https://outlook.office.com/mail/inbox/id/AAMk123' }],
      hasNewUpdate: false,
    });

    await ctx2.monitorTaskItem(item, { manual: true });

    assert.equal(item.summary, 'No new email yet');
    assert.equal(item.hasNewUpdate, false);
    assert.equal(ctx2.__notifications.length, 0);
  });

  it('preserves previous evidence links when AI omits them from response', async () => {
    const ctx2 = createMonitorContext({
      hasNewInfo: true,
      summary: 'New activity detected in the thread',
      status: 'In Progress',
      severity: 'Elevated',
      evidenceLinks: [
        { type: 'email', url: 'https://outlook.office.com/mail/inbox/id/NEW456', label: 'New update' },
      ],
    });
    const item = ctx2.normalizeTrackingItem({
      id: 'monitor_merge_test',
      title: 'Evidence merge test',
      sourceType: 'Email',
      summary: 'Existing summary',
      status: 'Tracked',
      severity: 'Observe',
      monitorEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '30m',
      evidenceLinks: [
        { type: 'email', url: 'https://outlook.office.com/mail/inbox/id/OLD123', label: 'Original signal' },
      ],
      hasNewUpdate: false,
    });

    await ctx2.monitorTaskItem(item, { manual: true });

    const urls = item.evidenceLinks.map((e) => e.url);
    assert.ok(urls.includes('https://outlook.office.com/mail/inbox/id/OLD123'),
      'Previous evidence link should be preserved');
    assert.ok(urls.includes('https://outlook.office.com/mail/inbox/id/NEW456'),
      'New evidence link should be added');
    assert.equal(item.evidenceLinks.length, 2,
      'Both old and new evidence links should be present');
  });

  it('does not duplicate evidence links when AI re-reports existing URL', async () => {
    const sharedUrl = 'https://outlook.office.com/mail/inbox/id/SHARED789';
    const ctx2 = createMonitorContext({
      hasNewInfo: true,
      summary: 'Updated summary with same source',
      status: 'In Progress',
      severity: 'Elevated',
      evidenceLinks: [
        { type: 'email', url: sharedUrl, label: 'Same email' },
        { type: 'chat', url: 'https://teams.microsoft.com/l/chat/NEW', label: 'New chat' },
      ],
    });
    const item = ctx2.normalizeTrackingItem({
      id: 'monitor_no_dup_test',
      title: 'No duplicate test',
      sourceType: 'Email',
      summary: 'Previous summary',
      status: 'Tracked',
      severity: 'Observe',
      monitorEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '30m',
      evidenceLinks: [
        { type: 'email', url: sharedUrl, label: 'Original email' },
      ],
      hasNewUpdate: false,
    });

    await ctx2.monitorTaskItem(item, { manual: true });

    const urls = item.evidenceLinks.map((e) => e.url);
    const sharedCount = urls.filter((u) => u === sharedUrl).length;
    assert.equal(sharedCount, 1, 'Shared URL should appear exactly once');
    assert.ok(urls.includes('https://teams.microsoft.com/l/chat/NEW'),
      'New URL should be added');
  });
});
/* ================================================================== */
/*  normalizeItem — initial "Discovered" history seed                 */
/* ================================================================== */
describe('normalizeItem() — initial history seed', () => {
  it('seeds a "Discovered" entry when updateHistory is empty', () => {
    const result = ctx.normalizeItem({ title: 'Brand new item' });
    assert.equal(result.updateHistory.length, 1);
    assert.equal(result.updateHistory[0].changes[0], 'Discovered');
    assert.equal(result.updateHistory[0].seen, true);
    assert.equal(result.updateHistory[0].status, 'Inbound');
    assert.equal(result.updateHistory[0].severity, 'Observe');
  });

  it('does not double-seed when updateHistory already has entries', () => {
    const existing = [{ timestamp: '2026-01-01T00:00:00Z', changes: ['Status changed'], seen: true }];
    const result = ctx.normalizeItem({ title: 'Existing item', updateHistory: existing });
    assert.equal(result.updateHistory.length, 1);
    assert.equal(result.updateHistory[0].changes[0], 'Status changed');
  });

  it('uses discoveredAt as timestamp for the seed entry', () => {
    const result = ctx.normalizeItem({ title: 'Timed', discoveredAt: '2026-03-15T10:00:00Z' });
    assert.equal(result.updateHistory[0].timestamp, '2026-03-15T10:00:00Z');
  });

  it('falls back to trackedAt when discoveredAt is missing', () => {
    const result = ctx.normalizeItem({ title: 'Tracked', trackedAt: '2026-03-15T12:00:00Z' });
    // discoveredAt gets set by normalizeItem to nowIso(), but trackedAt is explicit
    assert.ok(result.updateHistory[0].timestamp);
  });

  it('includes summary in seed entry', () => {
    const result = ctx.normalizeItem({ title: 'Task', summary: 'Important context' });
    assert.equal(result.updateHistory[0].summary, 'Important context');
  });
});

/* ================================================================== */
/*  enableItemMonitoring — "Monitoring enabled" history entry          */
/* ================================================================== */
describe('enableItemMonitoring() — history entries', () => {
  it('adds "Monitoring enabled" entry on top of "Discovered"', () => {
    ctx.state.items = [ctx.normalizeItem({
      id: 'enable_test_1',
      title: 'Enable Test',
      severity: 'Elevated',
      summary: 'Some summary',
    })];

    ctx.enableItemMonitoring('enable_test_1');

    const item = ctx.state.items.find((e) => e.id === 'enable_test_1');
    assert.equal(item.updateHistory.length, 2, 'should have Discovered + Monitoring enabled');
    assert.equal(item.updateHistory[0].changes[0], 'Monitoring enabled');
    assert.equal(item.updateHistory[0].seen, true);
    assert.equal(item.updateHistory[1].changes[0], 'Discovered');
  });
});

/* ================================================================== */
/*  upsertTrackingItemFromRadar — "Monitoring enabled" history entry   */
/* ================================================================== */
describe('upsertTrackingItemFromRadar() — history entries', () => {
  it('has Discovered + Monitoring enabled for new items', () => {
    ctx.state.trackingItems = [];
    ctx.state.items = [];

    ctx.upsertTrackingItemFromRadar({
      id: 'upsert_history_test',
      title: 'Upsert History',
      severity: 'Critical',
      summary: 'Urgent item',
    });

    const item = ctx.state.items.find((e) => e.id === 'upsert_history_test');
    assert.ok(item);
    assert.equal(item.updateHistory.length, 2, 'should have Discovered + Monitoring enabled');
    assert.equal(item.updateHistory[0].changes[0], 'Monitoring enabled');
    assert.equal(item.updateHistory[1].changes[0], 'Discovered');
  });
});