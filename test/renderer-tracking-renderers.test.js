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
    assert.match(html, /tracker-new-badge/, 'new badge should appear on in-progress items with updates');
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
