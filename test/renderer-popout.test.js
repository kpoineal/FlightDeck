'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

function buildDocumentStub(popoutContainer) {
  return {
    title: '',
    body: { innerHTML: '' },
    getElementById(id) {
      if (id === 'popoutContainer') return popoutContainer;
      return null;
    },
    querySelector() {
      return null;
    },
    createElement() {
      return {
        id: '',
        classList: { add: () => {} },
      };
    },
  };
}

describe('renderPopoutMode() integration', () => {
  let ctx;
  let popoutContainer;

  beforeEach(() => {
    popoutContainer = {
      innerHTML: '',
      querySelector: () => null,
    };

    ctx = createRendererContext({
      CSS: { escape: (value) => String(value) },
      POPOUT_ITEM_ID: 'track-1',
      state: {
        trackingItems: [
          {
            id: 'track-1',
            title: 'Critical Renewal',
            severity: 'Critical',
            summary: 'Awaiting customer signoff',
            sourceType: 'Signal',
            dueAt: '2026-03-10T09:00:00.000Z',
            owner: 'Merlin',
            counterparties: ['Jordan Chen'],
            trackedAt: '2026-03-03T08:00:00.000Z',
            lastRunAt: '2026-03-03T12:00:00.000Z',
            monitorEnabled: true,
            notifyEnabled: true,
            scheduleType: 'interval',
            scheduleValue: '30m',
            monitorPrompt: 'Monitor renewal risk.',
            monitorSignals: ['email'],
            nextRunAt: '2026-03-03T12:30:00.000Z',
            updateHistory: [
              {
                timestamp: '2026-03-03T12:01:00.000Z',
                changes: ['Status changed'],
                summary: 'Status moved to at risk',
                seen: false,
                newLinks: [{ type: 'doc', label: 'Thread', url: 'https://example.com/thread' }],
                suggestedNextSteps: ['Send reminder'],
              },
            ],
            hasNewUpdate: true,
            evidenceLinks: [],
            suggestedNextSteps: [],
          },
        ],
      },
      document: buildDocumentStub(popoutContainer),
      autoSizeSeveritySelects: () => {},
    });

    loadFile(ctx, 'renderer/constants.js');
    loadFile(ctx, 'renderer/utils.js');
    loadFile(ctx, 'renderer/models/item.js');
    loadFile(ctx, 'renderer/renderers/tracking.js');
    ctx.severityClass = (value) => `severity-${String(value || '').toLowerCase()}`;
    loadFile(ctx, 'renderer/popout.js');
  });

  it('renders popout with unified activity timeline', () => {
    ctx.renderPopoutMode();

    const html = popoutContainer.innerHTML;
    // Unified timeline replaces separate summary + change history
    assert.match(html, /activity-timeline/);
    assert.match(html, /at-event--newest/);
    assert.match(html, /at-event--unseen/);
    assert.match(html, /Status changed/);
    assert.match(html, /at-summary/);
    // Current badge and severity pill removed from newest entry (redundant with card header)
    assert.doesNotMatch(html, /at-current-badge/);
    // Next steps removed from timeline entries; citation links kept
    assert.doesNotMatch(html, /at-suggestions/);
    // Right panel (Change History) removed — single-panel layout
    assert.match(html, /popout-single-panel/);
    assert.doesNotMatch(html, /popout-panel-right/);
    assert.doesNotMatch(html, /Change History/);
  });
});
