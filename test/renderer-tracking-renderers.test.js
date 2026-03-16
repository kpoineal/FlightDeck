'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext();
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
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
