'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext();
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  // Stubs for globals referenced by buildTrackingCard/buildTrackingRow
  // (only stub functions NOT already defined in constants.js or utils.js)
  ctx.state = { scanners: [], trackingDensity: 'full' };
  ctx.unseenHistoryCount = (item) => {
    if (!Array.isArray(item?.updateHistory)) return 0;
    return item.updateHistory.filter((e) => e.seen === false).length;
  };
  ctx.severityClass = (v) => `severity-${(v || 'observe').toLowerCase()}`;
  ctx.renderMarkdownLinks = (t) => t;
  ctx.buildActivityTimelineHtml = () => '';
  ctx.buildNextStepHintsHtml = () => '';
  ctx.buildWorkHoursToggleHtml = () => '';
  ctx.buildScheduleControlsHtml = () => '';
  ctx.buildSignalFilterHtml = () => '';
  ctx.autoSizeSeveritySelects = () => {};
  ctx.inlineUpdateScheduleControls = () => {};
  loadFile(ctx, 'renderer/renderers/tracking.js');
});

describe('buildTrackerHistoryMarkup()', () => {
  it('renders default empty state when no history exists', () => {
    const html = ctx.buildTrackerHistoryMarkup({ updateHistory: [] });
    assert.match(html, /No history yet — updates appear here after meaningful changes\./);
  });

  it('renders custom empty text when provided', () => {
    const html = ctx.buildTrackerHistoryMarkup({ updateHistory: [] }, 'No history yet.');
    assert.match(html, /No history yet\./);
  });

  it('renders history entries with unseen class, links, and suggestions', () => {
    const item = {
      summary: 'Current summary',
      updateHistory: [
        {
          timestamp: '2026-03-03T12:00:00.000Z',
          changes: ['Status changed', 'Owner changed'],
          summary: 'Updated summary',
          seen: false,
          newLinks: [{ type: 'doc', url: 'https://example.com/doc', label: 'Spec', signalAt: new Date().toISOString() }],
          suggestedNextSteps: ['Reply with status'],
        },
      ],
    };

    const html = ctx.buildTrackerHistoryMarkup(item);
    assert.match(html, /tracker-history-entry unseen/);
    assert.match(html, /Status changed · Owner changed/);
    assert.match(html, /history-summary/);
    assert.match(html, /source-list--inline/);
    assert.match(html, /\(today\)/);
    assert.match(html, /Suggested: Reply with status/);
  });

  it('hides summary when entry summary matches current item summary', () => {
    const item = {
      summary: 'Same summary text',
      updateHistory: [
        {
          timestamp: '2026-03-03T14:00:00.000Z',
          changes: ['Status: Monitoring → In Progress'],
          summary: 'Same summary text',
          seen: false,
          suggestedNextSteps: ['Follow up with team'],
        },
      ],
    };

    const html = ctx.buildTrackerHistoryMarkup(item);
    assert.doesNotMatch(html, /history-summary/, 'summary should be hidden when it matches the current item summary');
    assert.match(html, /Suggested: Follow up with team/);
  });

  it('shows previous summary when it differs from current item summary', () => {
    const item = {
      summary: 'New updated summary',
      updateHistory: [
        {
          timestamp: '2026-03-03T14:00:00.000Z',
          changes: ['Status: Monitoring → In Progress'],
          summary: 'Old previous summary',
          seen: false,
          suggestedNextSteps: ['Follow up with team'],
        },
      ],
    };

    const html = ctx.buildTrackerHistoryMarkup(item);
    assert.match(html, /history-summary/, 'previous summary should render when it differs from current');
    assert.match(html, /Old previous summary/);
    assert.doesNotMatch(html, /New updated summary/);
  });
});

/* ================================================================== */
/*  Rendering guard: no new badges on completed/archived items         */
/* ================================================================== */
describe('rendering guard for completed/archived items', () => {
  function makeItem(overrides) {
    return {
      id: 'test-1',
      title: 'Test Item',
      severity: 'Observe',
      sourceType: 'Signal',
      summary: 'A summary',
      status: 'Complete',
      owner: 'You',
      counterparties: [],
      evidenceLinks: [],
      suggestedNextSteps: [],
      monitorEnabled: false,
      notifyEnabled: false,
      monitorPrompt: '',
      scheduleType: 'interval',
      scheduleValue: '30m',
      weeklyDays: [],
      weeklyTimes: [],
      lifecycleStatus: 'in-progress',
      updateHistory: [],
      hasNewUpdate: false,
      isNew: false,
      trackedAt: '2026-03-01T00:00:00Z',
      lastRunAt: null,
      lastChangedAt: null,
      nextRunAt: null,
      dueAt: null,
      scannerId: null,
      ...overrides,
    };
  }

  it('hides new badge on completed items even if hasNewUpdate is true', () => {
    const item = makeItem({ lifecycleStatus: 'complete', hasNewUpdate: true, isNew: true });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-new-badge/, 'new badge should not appear on completed items');
    assert.doesNotMatch(html, /has-new-update/, 'has-new-update class should not appear on completed items');
  });

  it('hides new badge on archived items even if hasNewUpdate is true', () => {
    const item = makeItem({ lifecycleStatus: 'archived', hasNewUpdate: true, isNew: true });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-new-badge/, 'new badge should not appear on archived items');
    assert.doesNotMatch(html, /has-new-update/, 'has-new-update class should not appear on archived items');
  });

  it('hides Mark as Seen button on completed items', () => {
    const item = makeItem({
      lifecycleStatus: 'complete',
      hasNewUpdate: true,
      isNew: true,
      updateHistory: [{ timestamp: '2026-03-01T00:00:00Z', changes: ['x'], seen: false }],
    });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /data-mark-seen-id/, 'Mark as Seen button should not appear on completed items');
  });

  it('shows new badge on in-progress items when hasNewUpdate is true', () => {
    const item = makeItem({ lifecycleStatus: 'in-progress', hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-badge/, 'updated badge should appear on in-progress items with updates');
  });

  it('hides new badge on completed items in row view', () => {
    const item = makeItem({ lifecycleStatus: 'complete', hasNewUpdate: true, isNew: true });
    const html = ctx.buildTrackingRow(item, null);
    assert.doesNotMatch(html, /badge-pill/, 'new badge pill should not appear on completed row items');
    assert.doesNotMatch(html, /has-new-update/, 'has-new-update class should not appear on completed row items');
    assert.doesNotMatch(html, /data-mark-seen-id/, 'Mark as Seen should not appear on completed row items');
  });
});

/* ================================================================== */
/*  buildActivityTimelineHtml — no synthetic fallback                  */
/* ================================================================== */
describe('buildActivityTimelineHtml() — no synthetic fallback', () => {
  // Re-create context with a real buildActivityTimelineHtml loaded
  let ctx2;
  before(() => {
    ctx2 = createRendererContext();
    loadFile(ctx2, 'renderer/constants.js');
    loadFile(ctx2, 'renderer/utils.js');
    ctx2.state = { scanners: [], trackingDensity: 'full' };
    ctx2.severityClass = (v) => `severity-${(v || 'observe').toLowerCase()}`;
    ctx2.renderMarkdownLinks = (t) => t;
    ctx2.buildNextStepHintsHtml = () => '';
    ctx2.buildWorkHoursToggleHtml = () => '';
    ctx2.buildScheduleControlsHtml = () => '';
    ctx2.buildSignalFilterHtml = () => '';
    ctx2.autoSizeSeveritySelects = () => {};
    ctx2.inlineUpdateScheduleControls = () => {};
    ctx2.unseenHistoryCount = (item) => {
      if (!Array.isArray(item?.updateHistory)) return 0;
      return item.updateHistory.filter((e) => e.seen === false).length;
    };
    loadFile(ctx2, 'renderer/renderers/tracking.js');
  });

  it('returns empty string when history is empty (no synthetic fallback)', () => {
    const result = ctx2.buildActivityTimelineHtml([], { item: { summary: 'Test', severity: 'Observe', status: 'Inbound' } });
    assert.equal(result, '');
  });

  it('renders real history entries normally', () => {
    const entries = [{
      timestamp: '2026-03-01T10:00:00Z',
      changes: ['Discovered'],
      severity: 'Observe',
      status: 'Inbound',
      seen: true,
    }];
    const result = ctx2.buildActivityTimelineHtml(entries, {});
    assert.match(result, /activity-timeline/);
    assert.match(result, /Discovered/);
  });
});

/* ================================================================== */
/*  New vs Updated badge separation — buildTrackingCard                */
/* ================================================================== */
describe('New vs Updated badge separation — buildTrackingCard', () => {
  function makeItem(overrides) {
    return {
      id: 'badge-test-1',
      title: 'Badge Test Item',
      severity: 'Observe',
      sourceType: 'Signal',
      summary: 'A summary',
      status: 'Monitoring',
      owner: 'You',
      counterparties: [],
      evidenceLinks: [],
      suggestedNextSteps: [],
      monitorEnabled: true,
      notifyEnabled: false,
      monitorPrompt: '',
      scheduleType: 'interval',
      scheduleValue: '30m',
      weeklyDays: [],
      weeklyTimes: [],
      lifecycleStatus: 'in-progress',
      updateHistory: [],
      hasNewUpdate: false,
      isNew: false,
      trackedAt: '2026-03-01T00:00:00Z',
      lastRunAt: null,
      lastChangedAt: null,
      discoveredAt: null,
      nextRunAt: null,
      dueAt: null,
      scannerId: null,
      ...overrides,
    };
  }

  // ── (a) New item only ──────────────────────────────────────────────
  it('shows green NEW badge when isNew=true, hasNewUpdate=false', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-new-badge/, 'should show NEW badge');
    assert.match(html, />NEW</, 'badge text should be NEW');
    assert.doesNotMatch(html, /tracker-updated-badge/, 'should NOT show UPDATED badge');
  });

  it('adds is-new CSS class on card when isNew=true', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /is-new/, 'card should have is-new class');
  });

  it('shows Discovered: bar when isNew=true with discoveredAt timestamp', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: false,
      discoveredAt: '2026-04-15T10:30:00Z',
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-at/, 'should show the Discovered bar');
    assert.match(html, /Discovered:/, 'bar should say Discovered:');
  });

  it('falls back to trackedAt for Discovered: bar when discoveredAt is missing', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: false,
      discoveredAt: null,
      trackedAt: '2026-04-10T08:00:00Z',
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-at/, 'should show the Discovered bar using trackedAt');
    assert.match(html, /Discovered:/, 'bar should say Discovered:');
  });

  it('does NOT show Updated: bar when only isNew=true', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-change-at/, 'should not show Updated bar');
  });

  // ── (b) Updated item only ─────────────────────────────────────────
  it('shows amber UPDATED badge when hasNewUpdate=true, isNew=false', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      updateHistory: [{ timestamp: '2026-04-15T12:00:00Z', changes: ['Status changed'], seen: false }],
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-badge/, 'should show UPDATED badge');
    assert.match(html, /UPDATED/, 'badge text should contain UPDATED');
    assert.doesNotMatch(html, /tracker-new-badge/, 'should NOT show NEW badge');
  });

  it('adds is-updated CSS class on card when hasNewUpdate=true', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /is-updated/, 'card should have is-updated class');
    assert.doesNotMatch(html, /is-new/, 'card should NOT have is-new class');
  });

  it('shows Updated: bar when hasNewUpdate=true with lastChangedAt', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      lastChangedAt: '2026-04-16T14:00:00Z',
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-change-at/, 'should show the Updated bar');
    assert.match(html, /Updated:/, 'bar should say Updated:');
  });

  it('falls back to lastRunAt for Updated: bar when lastChangedAt is missing', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      lastChangedAt: null,
      lastRunAt: '2026-04-16T09:00:00Z',
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-change-at/, 'should show the Updated bar using lastRunAt');
  });

  it('does NOT show Discovered: bar when only hasNewUpdate=true', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-updated-at/, 'should not show Discovered bar');
  });

  // ── (c) Both new AND updated ──────────────────────────────────────
  it('shows BOTH badges when isNew=true AND hasNewUpdate=true', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: true,
      discoveredAt: '2026-04-14T08:00:00Z',
      lastChangedAt: '2026-04-16T14:00:00Z',
      updateHistory: [{ timestamp: '2026-04-16T14:00:00Z', changes: ['Changed'], seen: false }],
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-new-badge/, 'should show NEW badge');
    assert.match(html, /tracker-updated-badge/, 'should show UPDATED badge');
  });

  it('shows BOTH timestamp bars when isNew=true AND hasNewUpdate=true', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: true,
      discoveredAt: '2026-04-14T08:00:00Z',
      lastChangedAt: '2026-04-16T14:00:00Z',
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-at/, 'should show Discovered bar');
    assert.match(html, /tracker-change-at/, 'should show Updated bar');
    assert.match(html, /Discovered:/, 'Discovered bar text');
    assert.match(html, /Updated:/, 'Updated bar text');
  });

  it('has both is-new and is-updated CSS classes when both flags set', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /is-new/, 'card should have is-new class');
    assert.match(html, /is-updated/, 'card should have is-updated class');
    assert.match(html, /has-new-update/, 'card should have has-new-update class');
  });

  // ── (d) Neither new nor updated ───────────────────────────────────
  it('shows NO badges when isNew=false AND hasNewUpdate=false', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-new-badge/, 'no NEW badge');
    assert.doesNotMatch(html, /tracker-updated-badge/, 'no UPDATED badge');
    assert.doesNotMatch(html, /has-new-update/, 'no has-new-update class');
    assert.doesNotMatch(html, /is-new/, 'no is-new class');
    assert.doesNotMatch(html, /is-updated/, 'no is-updated class');
  });

  it('shows NO timestamp bars when neither flag is set', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-updated-at/, 'no Discovered bar');
    assert.doesNotMatch(html, /tracker-change-at/, 'no Updated bar');
  });

  // ── (e) Terminal status suppression ────────────────────────────────
  it('suppresses NEW badge on complete items even with isNew=true', () => {
    const item = makeItem({ lifecycleStatus: 'complete', isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-new-badge/, 'no NEW badge on completed item');
    assert.doesNotMatch(html, /tracker-updated-at/, 'no Discovered bar on completed item');
  });

  it('suppresses UPDATED badge on archived items even with hasNewUpdate=true', () => {
    const item = makeItem({ lifecycleStatus: 'archived', isNew: false, hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-updated-badge/, 'no UPDATED badge on archived item');
    assert.doesNotMatch(html, /tracker-change-at/, 'no Updated bar on archived item');
  });

  it('suppresses BOTH badges on complete items when both flags true', () => {
    const item = makeItem({ lifecycleStatus: 'complete', isNew: true, hasNewUpdate: true });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /tracker-new-badge/, 'no NEW badge');
    assert.doesNotMatch(html, /tracker-updated-badge/, 'no UPDATED badge');
    assert.doesNotMatch(html, /tracker-updated-at/, 'no Discovered bar');
    assert.doesNotMatch(html, /tracker-change-at/, 'no Updated bar');
  });

  // ── (f) Mark as Seen availability ──────────────────────────────────
  it('shows Mark as Seen button when isNew=true (even without unseen history)', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /data-mark-seen-id/, 'Mark as Seen should appear for new items');
  });

  it('shows Mark as Seen button when hasNewUpdate=true', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      updateHistory: [{ timestamp: '2026-04-15T12:00:00Z', changes: ['x'], seen: false }],
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /data-mark-seen-id/, 'Mark as Seen should appear for updated items');
  });

  it('hides Mark as Seen button when neither flag set and no unseen history', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: false });
    const html = ctx.buildTrackingCard(item);
    assert.doesNotMatch(html, /data-mark-seen-id/, 'Mark as Seen should not appear');
  });

  // ── Unseen count in UPDATED badge ──────────────────────────────────
  it('includes unseen count > 1 in UPDATED badge label', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      updateHistory: [
        { timestamp: '2026-04-16T14:00:00Z', changes: ['a'], seen: false },
        { timestamp: '2026-04-16T13:00:00Z', changes: ['b'], seen: false },
        { timestamp: '2026-04-16T12:00:00Z', changes: ['c'], seen: false },
      ],
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /3 UPDATED/, 'badge should show "3 UPDATED"');
  });

  it('omits count when only 1 unseen entry in UPDATED badge', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      updateHistory: [{ timestamp: '2026-04-16T14:00:00Z', changes: ['a'], seen: false }],
    });
    const html = ctx.buildTrackingCard(item);
    assert.match(html, /tracker-updated-badge/, 'updated badge should appear');
    assert.doesNotMatch(html, /\d+ UPDATED/, 'should NOT prefix count when only 1 unseen');
  });
});

/* ================================================================== */
/*  New vs Updated badge separation — buildTrackingRow                 */
/* ================================================================== */
describe('New vs Updated badge separation — buildTrackingRow', () => {
  function makeItem(overrides) {
    return {
      id: 'row-badge-1',
      title: 'Row Badge Test',
      severity: 'Observe',
      sourceType: 'Signal',
      summary: 'A summary',
      status: 'Monitoring',
      owner: 'You',
      counterparties: [],
      evidenceLinks: [],
      suggestedNextSteps: [],
      monitorEnabled: true,
      notifyEnabled: false,
      monitorPrompt: '',
      scheduleType: 'interval',
      scheduleValue: '30m',
      weeklyDays: [],
      weeklyTimes: [],
      lifecycleStatus: 'in-progress',
      updateHistory: [],
      hasNewUpdate: false,
      isNew: false,
      trackedAt: '2026-03-01T00:00:00Z',
      lastRunAt: null,
      lastChangedAt: null,
      discoveredAt: null,
      nextRunAt: null,
      dueAt: null,
      scannerId: null,
      ...overrides,
    };
  }

  it('shows NEW pill when isNew=true in row view', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingRow(item, null);
    assert.match(html, /badge-pill/, 'should show badge pill');
    assert.match(html, />NEW</, 'pill text should be NEW');
    assert.doesNotMatch(html, /badge-pill--updated/, 'should NOT show updated pill');
  });

  it('shows UPDATED pill when hasNewUpdate=true in row view', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      updateHistory: [{ timestamp: '2026-04-16T14:00:00Z', changes: ['x'], seen: false }],
    });
    const html = ctx.buildTrackingRow(item, null);
    assert.match(html, /badge-pill--updated/, 'should show updated pill');
    assert.match(html, /UPDATED/, 'pill text should contain UPDATED');
  });

  it('shows BOTH pills when isNew=true AND hasNewUpdate=true in row view', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: true,
      updateHistory: [{ timestamp: '2026-04-16T14:00:00Z', changes: ['x'], seen: false }],
    });
    const html = ctx.buildTrackingRow(item, null);
    assert.match(html, />NEW</, 'should show NEW pill');
    assert.match(html, /badge-pill--updated/, 'should show UPDATED pill');
  });

  it('shows NO pills when neither flag set in row view', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: false });
    const html = ctx.buildTrackingRow(item, null);
    assert.doesNotMatch(html, /badge-pill/, 'no badge pill');
    assert.doesNotMatch(html, /has-new-update/, 'no has-new-update class');
  });

  it('adds is-new wrapper class when isNew=true in row view', () => {
    const item = makeItem({ isNew: true, hasNewUpdate: false });
    const html = ctx.buildTrackingRow(item, null);
    assert.match(html, /is-new/, 'wrapper should have is-new class');
  });

  it('adds is-updated wrapper class when hasNewUpdate=true in row view', () => {
    const item = makeItem({ isNew: false, hasNewUpdate: true });
    const html = ctx.buildTrackingRow(item, null);
    assert.match(html, /is-updated/, 'wrapper should have is-updated class');
  });

  it('suppresses all pills on completed items in row view', () => {
    const item = makeItem({ lifecycleStatus: 'complete', isNew: true, hasNewUpdate: true });
    const html = ctx.buildTrackingRow(item, null);
    assert.doesNotMatch(html, /badge-pill/, 'no badge pill on complete row');
    assert.doesNotMatch(html, /has-new-update/, 'no has-new-update on complete row');
  });

  it('shows Discovered: bar in expanded row detail when isNew=true', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: false,
      discoveredAt: '2026-04-15T10:30:00Z',
    });
    const html = ctx.buildTrackingRow(item, item.id); // expanded
    assert.match(html, /tracker-updated-at/, 'should show Discovered bar in row detail');
    assert.match(html, /Discovered:/, 'bar should say Discovered:');
  });

  it('shows Updated: bar in expanded row detail when hasNewUpdate=true', () => {
    const item = makeItem({
      isNew: false,
      hasNewUpdate: true,
      lastChangedAt: '2026-04-16T14:00:00Z',
    });
    const html = ctx.buildTrackingRow(item, item.id); // expanded
    assert.match(html, /tracker-change-at/, 'should show Updated bar in row detail');
    assert.match(html, /Updated:/, 'bar should say Updated:');
  });

  it('shows BOTH bars in expanded row detail when both flags set', () => {
    const item = makeItem({
      isNew: true,
      hasNewUpdate: true,
      discoveredAt: '2026-04-14T08:00:00Z',
      lastChangedAt: '2026-04-16T14:00:00Z',
    });
    const html = ctx.buildTrackingRow(item, item.id);
    assert.match(html, /tracker-updated-at/, 'Discovered bar in row');
    assert.match(html, /tracker-change-at/, 'Updated bar in row');
  });
});
