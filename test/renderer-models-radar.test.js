'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext({
    // Stubs for globals that radar.js calls but we don't test here
    state: {
      items: [],
      radarItems: [],
      trackingItems: [],
      actions: [],
      evidence: [],
      selectedRadarItemId: null,
      ledger: { iOwe: [], othersOweMe: [], silentThreads: [] },
    },
    savePersistentState: () => {},
    renderTrackingMode: () => {},
    sortBySeverity: (items) => items,
  });
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/item.js');
});

/* ================================================================== */
/*  radarItemIdentitySeed                                             */
/* ================================================================== */
describe('radarItemIdentitySeed()', () => {
  it('returns pipe-delimited lowercase string', () => {
    const seed = ctx.radarItemIdentitySeed({
      title: 'Test Item',
      sourceType: 'Email',
      dueAt: '2025-06-15',
      owner: 'Alice',
      summary: 'Summary',
      reason: 'Reason',
      counterparties: ['Bob'],
    });
    assert.ok(seed.includes('|'));
    assert.equal(seed, seed.toLowerCase());
  });

  it('is deterministic', () => {
    const item = { title: 'A', sourceType: 'Chat', owner: 'You' };
    assert.equal(ctx.radarItemIdentitySeed(item), ctx.radarItemIdentitySeed(item));
  });

  it('handles null/undefined fields', () => {
    const seed = ctx.radarItemIdentitySeed({});
    assert.equal(typeof seed, 'string');
    // All segments empty → should be '||||||'
    assert.equal(seed, '||||||');
  });

  it('includes counterparties comma-separated', () => {
    const seed = ctx.radarItemIdentitySeed({ counterparties: ['Alice', 'Bob'] });
    assert.ok(seed.includes('alice,bob'));
  });
});

/* ================================================================== */
/*  resolveRadarItemId                                                */
/* ================================================================== */
describe('resolveRadarItemId()', () => {
  it('ignores AI-provided id and uses content hash', () => {
    const id = ctx.resolveRadarItemId({ id: 'my_id', title: 'Test', sourceType: 'Email' });
    assert.ok(id.startsWith('radar_'));
    assert.match(id, /^radar_[0-9a-f]{8}$/);
    assert.notEqual(id, 'my_id');
  });

  it('generates radar_ prefixed id from identity seed', () => {
    const id = ctx.resolveRadarItemId({
      title: 'Test',
      sourceType: 'Email',
      owner: 'You',
    });
    assert.ok(id.startsWith('radar_'));
    assert.match(id, /^radar_[0-9a-f]{8}$/);
  });

  it('is deterministic for same input', () => {
    const item = { title: 'Same', sourceType: 'Chat' };
    assert.equal(ctx.resolveRadarItemId(item), ctx.resolveRadarItemId(item));
  });

  it('generates fallback when item has no useful fields', () => {
    const id = ctx.resolveRadarItemId({});
    assert.ok(id.startsWith('radar_'));
  });
});

/* ================================================================== */
/*  isInboundStatus                                                   */
/* ================================================================== */
describe('isInboundStatus()', () => {
  it('returns true for "Inbound"', () => {
    assert.equal(ctx.isInboundStatus('Inbound'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(ctx.isInboundStatus('inbound'), true);
    assert.equal(ctx.isInboundStatus('INBOUND'), true);
  });

  it('defaults to true for falsy input', () => {
    assert.equal(ctx.isInboundStatus(null), true);
    assert.equal(ctx.isInboundStatus(''), true);
  });

  it('returns false for other statuses', () => {
    assert.equal(ctx.isInboundStatus('Tracked'), false);
    assert.equal(ctx.isInboundStatus('Dismissed'), false);
  });
});

/* ================================================================== */
/*  mapLedgerEntryToRadarItem                                         */
/* ================================================================== */
describe('mapLedgerEntryToRadarItem()', () => {
  it('returns object with ledger_ prefixed id', () => {
    const entry = { id: 'test1', title: 'Follow up' };
    const result = ctx.mapLedgerEntryToRadarItem(entry, 'I owe', 'Elevated', 'You');
    assert.ok(result.id.startsWith('ledger_'));
  });

  it('sets expected fields', () => {
    const result = ctx.mapLedgerEntryToRadarItem(
      { id: 'x', title: 'Task', counterparties: ['Bob'], suggestedFollowUp: 'Do it' },
      'Silent',
      'Observe',
      'Counterparty'
    );
    assert.equal(result.severity, 'Observe');
    assert.equal(result.sourceType, 'Ledger');
    assert.equal(result.status, 'Silent');
    assert.ok(result.isLedger);
    assert.ok(result.summary.includes('Do it'));
  });

  it('handles entry with no id', () => {
    const result = ctx.mapLedgerEntryToRadarItem({}, 'I owe', 'Elevated', 'You');
    assert.ok(result.id.startsWith('ledger_'));
  });
});

/* ================================================================== */
/*  applyLedgerPayload                                                */
/* ================================================================== */
describe('applyLedgerPayload()', () => {
  it('normalizes ledger entries into state.ledger', () => {
    ctx.applyLedgerPayload({
      iOwe: [{ id: 'a', title: 'Pay invoice' }],
      othersOweMe: [{ title: 'Waiting on reply' }],
      silentThreads: [],
    });
    assert.equal(ctx.state.ledger.iOwe.length, 1);
    assert.equal(ctx.state.ledger.iOwe[0].id, 'a');
    assert.equal(ctx.state.ledger.othersOweMe.length, 1);
    assert.equal(ctx.state.ledger.silentThreads.length, 0);
  });

  it('handles empty payload', () => {
    ctx.applyLedgerPayload({});
    assert.equal(ctx.state.ledger.iOwe.length, 0);
    assert.equal(ctx.state.ledger.othersOweMe.length, 0);
    assert.equal(ctx.state.ledger.silentThreads.length, 0);
  });

  // ── Evidence-link normalization tests ──

  it('preserves structured {label, type, url} evidence links', () => {
    ctx.applyLedgerPayload({
      iOwe: [{
        id: 'structured1',
        title: 'Follow up on email',
        evidenceLinks: [
          { label: 'Email from Sarah', type: 'email', url: 'https://outlook.office.com/mail/inbox/id/AAMk123' }
        ]
      }],
    });
    const links = ctx.state.ledger.iOwe[0].evidenceLinks;
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://outlook.office.com/mail/inbox/id/AAMk123');
    assert.equal(links[0].type, 'email');
    // label passes through cleanDisplayText so just verify it contains key word
    assert.ok(links[0].label.includes('Sarah'));
  });

  it('converts raw URL strings in evidenceLinks to structured entries', () => {
    ctx.applyLedgerPayload({
      iOwe: [{
        id: 'rawurl1',
        title: 'Check document',
        evidenceLinks: [
          'https://outlook.office.com/mail/inbox/id/AAMk123'
        ]
      }],
    });
    const links = ctx.state.ledger.iOwe[0].evidenceLinks;
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://outlook.office.com/mail/inbox/id/AAMk123');
    assert.equal(typeof links[0].label, 'string');
    assert.ok(links[0].label.length > 0);
    assert.equal(typeof links[0].type, 'string');
  });

  it('handles a mix of structured objects and raw URL strings', () => {
    ctx.applyLedgerPayload({
      othersOweMe: [{
        id: 'mixed1',
        title: 'Mixed links',
        evidenceLinks: [
          { label: 'Teams chat', type: 'chat', url: 'https://teams.microsoft.com/l/message/abc' },
          'https://contoso.sharepoint.com/sites/project/Doc.aspx'
        ]
      }],
    });
    const links = ctx.state.ledger.othersOweMe[0].evidenceLinks;
    assert.equal(links.length, 2);
    // First: structured
    assert.equal(links[0].url, 'https://teams.microsoft.com/l/message/abc');
    assert.equal(links[0].type, 'chat');
    // Second: was raw string, now structured
    assert.ok(links[1].url.includes('sharepoint.com'));
    assert.equal(typeof links[1].label, 'string');
    assert.equal(typeof links[1].type, 'string');
  });

  it('produces empty evidenceLinks when array is empty', () => {
    ctx.applyLedgerPayload({
      iOwe: [{ id: 'empty1', title: 'No links', evidenceLinks: [] }],
    });
    const links = ctx.state.ledger.iOwe[0].evidenceLinks;
    assert.equal(links.length, 0);
  });

  it('produces empty evidenceLinks when field is missing', () => {
    ctx.applyLedgerPayload({
      iOwe: [{ id: 'noprop1', title: 'No evidence property' }],
    });
    const links = ctx.state.ledger.iOwe[0].evidenceLinks;
    assert.equal(links.length, 0);
  });
});

/* ================================================================== */
/*  applyRadarPayload                                                 */
/* ================================================================== */
describe('applyRadarPayload()', () => {

  it('keeps only source-appropriate deep links for typed evidence', () => {
    ctx.applyRadarPayload({
      radarItems: [
        {
          id: 'radar_email_1',
          title: 'Budget follow-up',
          severity: 'Elevated',
          sourceType: 'Email',
          evidenceLinks: [
            { type: 'email', label: 'Correct email', url: 'https://outlook.office.com/mail/inbox/id/AAMk123' },
            { type: 'email', label: 'Wrong external link', url: 'https://contoso.com/projects/123' },
          ],
        },
      ],
    });

    const links = ctx.state.radarItems[0].evidenceLinks;
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://outlook.office.com/mail/inbox/id/AAMk123');
  });

  it('normalizes evidence signalAt to ISO', () => {
    ctx.applyRadarPayload({
      radarItems: [
        {
          id: 'radar_chat_1',
          title: 'Chat thread',
          severity: 'Observe',
          sourceType: 'Chat',
          evidenceLinks: [
            {
              type: 'chat',
              label: 'Teams message',
              url: 'https://teams.microsoft.com/l/message/19:chat_abc',
              signalAt: '2026-03-04T09:30:00-05:00',
            },
          ],
        },
      ],
    });

    const link = ctx.state.radarItems[0].evidenceLinks[0];
    assert.equal(link.signalAt, '2026-03-04T14:30:00.000Z');
  });
});

/* ================================================================== */
/*  applyRadarPayload — inline citation extraction                    */
/* ================================================================== */
describe('applyRadarPayload() inline citation extraction', () => {

  it('extracts inline citations from summary before cleaning', () => {
    const sharePointUrl = 'https://contoso.sharepoint.com/teams/ProjectAlpha/_layouts/15/Doc.aspx?action=edit';
    ctx.applyRadarPayload({
      radarItems: [{
        id: 'radar_inline_1',
        title: 'Budget follow-up',
        severity: 'Elevated',
        sourceType: 'Email',
        summary: `Budget update from the team [1](${sharePointUrl})`,
        reason: 'Direct mention in email thread',
        evidenceLinks: [],
      }],
    });

    const item = ctx.state.radarItems[0];
    // Summary should be clean — no URL fragments or markdown syntax
    assert.ok(!item.summary.includes('https://'), 'summary should not contain URLs');
    assert.ok(!item.summary.includes('[1]'), 'summary should not contain footnote brackets');
    assert.ok(item.summary.includes('Budget'), 'summary should retain substantive text');
    // Inline citation should be extracted into evidenceLinks
    assert.equal(item.evidenceLinks.length, 1);
    assert.ok(item.evidenceLinks[0].url.includes('sharepoint.com'));
    assert.equal(item.evidenceLinks[0].type, 'doc');
  });

  it('structured evidenceLinks take priority over inline duplicates', () => {
    const url = 'https://outlook.office.com/mail/inbox/id/AAMk123';
    ctx.applyRadarPayload({
      radarItems: [{
        id: 'radar_priority_1',
        title: 'Priority test',
        severity: 'Observe',
        sourceType: 'Email',
        summary: `Important update [1](${url})`,
        reason: 'Check inbox',
        evidenceLinks: [{
          type: 'email',
          label: 'Priority email',
          url: url,
          signalAt: '2026-03-04T10:00:00-05:00',
        }],
      }],
    });

    const item = ctx.state.radarItems[0];
    // Only one entry after dedup (structured + inline same URL)
    assert.equal(item.evidenceLinks.length, 1);
    // Structured version should win — it has signalAt metadata
    assert.ok(item.evidenceLinks[0].signalAt, 'structured link with signalAt should take priority');
  });

  it('merges structured and inline links from different URLs', () => {
    const structuredUrl = 'https://outlook.office.com/mail/inbox/id/AAMk789';
    const inlineUrl = 'https://teams.microsoft.com/l/message/19:abc456';
    ctx.applyRadarPayload({
      radarItems: [{
        id: 'radar_merge_1',
        title: 'Merge test',
        severity: 'Observe',
        sourceType: 'Email',
        summary: 'Status update',
        reason: `Per the team chat [1](${inlineUrl})`,
        evidenceLinks: [{
          type: 'email',
          label: 'Email thread',
          url: structuredUrl,
        }],
      }],
    });

    const item = ctx.state.radarItems[0];
    assert.equal(item.evidenceLinks.length, 2);
    assert.ok(item.evidenceLinks.some((l) => l.url.includes('outlook.office.com')), 'should have structured email link');
    assert.ok(item.evidenceLinks.some((l) => l.url.includes('teams.microsoft.com')), 'should have inline chat link');
  });

  it('extracts from both summary and reason fields', () => {
    const summaryUrl = 'https://contoso.sharepoint.com/sites/team/_layouts/15/Doc.aspx';
    const reasonUrl = 'https://outlook.office.com/mail/inbox/id/AAMk456';
    ctx.applyRadarPayload({
      radarItems: [{
        id: 'radar_both_1',
        title: 'Both fields test',
        severity: 'Observe',
        sourceType: 'Email',
        summary: `See doc [report](${summaryUrl})`,
        reason: `Per email [ref](${reasonUrl})`,
        evidenceLinks: [],
      }],
    });

    const item = ctx.state.radarItems[0];
    assert.equal(item.evidenceLinks.length, 2);
    assert.ok(item.evidenceLinks.some((l) => l.url.includes('sharepoint.com')), 'should have doc link from summary');
    assert.ok(item.evidenceLinks.some((l) => l.url.includes('outlook.office.com')), 'should have email link from reason');
    // Both display fields should be clean
    assert.ok(!item.summary.includes('https://'), 'cleaned summary should not contain URLs');
    assert.ok(!item.reason.includes('https://'), 'cleaned reason should not contain URLs');
  });
});
