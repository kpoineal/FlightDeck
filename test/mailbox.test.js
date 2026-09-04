'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let getMailboxThreads;
let isRadarPriority;
let isMailboxUnread;
let isMailboxSnoozed;
let latestMailboxUpdate;
let markMailboxThreadRead;
let mailboxWorkStatus;
let mailboxWorkStatusClass;
let summariesMatch;
let collectItemEvidenceLinks;
let normalizeItem;
let buildMonitorPrompt;
let buildScannerPrompt;

before(async () => {
  const mailbox = await import('../src/svelte/lib/mailbox.js');
  const itemModel = await import('../src/svelte/lib/models/item.js');
  getMailboxThreads = mailbox.getMailboxThreads;
  isRadarPriority = mailbox.isRadarPriority;
  isMailboxUnread = mailbox.isMailboxUnread;
  isMailboxSnoozed = mailbox.isMailboxSnoozed;
  latestMailboxUpdate = mailbox.latestMailboxUpdate;
  markMailboxThreadRead = mailbox.markMailboxThreadRead;
  mailboxWorkStatus = mailbox.mailboxWorkStatus;
  mailboxWorkStatusClass = mailbox.mailboxWorkStatusClass;
  summariesMatch = mailbox.summariesMatch;
  collectItemEvidenceLinks = itemModel.collectItemEvidenceLinks;
  normalizeItem = itemModel.normalizeItem;
  ({ buildMonitorPrompt, buildScannerPrompt } = await import('../src/svelte/lib/prompts.js'));
});

describe('WorkIQ prompt metadata parity', () => {
  it('sends tracked-item context, evidence URLs, signal filters, history, and done criteria', () => {
    const prompt = buildMonitorPrompt({
      title: 'Review launch plan',
      severity: 'Elevated',
      status: 'Waiting',
      dueAt: '2026-09-05T17:00:00Z',
      owner: 'Kyle Poineal',
      counterparties: ['Sofia Martinez', 'James Farquharson'],
      lastRunAt: '2026-09-02T12:00:00Z',
      monitorPrompt: 'Track approval and launch readiness.',
      summary: 'The plan is awaiting final approval.',
      evidenceLinks: [{
        label: 'Approval email',
        type: 'email',
        url: 'https://outlook.office.com/mail/deeplink/read/approval',
        signalAt: '2026-09-02T11:30:00Z',
      }],
      doneCriteria: 'Sofia explicitly approves the final launch plan.',
      monitorSignals: ['email', 'meeting'],
      updateHistory: [{ timestamp: '2026-09-01T10:00:00Z', summary: 'The draft plan was shared.' }],
    });

    for (const expected of [
      'Title: Review launch plan',
      'Severity: Elevated',
      'Status: Waiting',
      'Due: 2026-09-05T17:00:00Z',
      'Owner: Kyle Poineal',
      'People: Sofia Martinez, James Farquharson',
      'Last checked: 2026-09-02T12:00:00Z',
      'Track approval and launch readiness.',
      'Previous summary: The plan is awaiting final approval.',
      '[email] Approval email: https://outlook.office.com/mail/deeplink/read/approval',
      'Sofia explicitly approves the final launch plan.',
      'Email, Meeting',
      'The draft plan was shared.',
      '"url": "https URL for the exact source signal"',
      '"completionConfidence":',
    ]) {
      assert.equal(prompt.includes(expected), true, `Monitor prompt omitted: ${expected}`);
    }
  });

  it('asks scanners for exact source URLs and observable completion criteria', () => {
    const prompt = buildScannerPrompt({
      id: 'scanner-1',
      name: 'Launch readiness',
      prompt: 'Find launch readiness risks.',
      signalTypes: ['email', 'chat', 'meeting', 'doc'],
      maxItemsPerScan: 5,
    }, [], []);

    assert.match(prompt, /--- SCANNER MISSION ---\s+Find launch readiness risks\./);
    for (const field of [
      '"severity":',
      '"sourceType":',
      '"dueAt":',
      '"owner":',
      '"counterparties":',
      '"summary":',
      '"reason":',
      '"status":',
      '"evidenceLinks":',
      '"suggestedNextSteps":',
      '"doneCriteria":',
    ]) {
      assert.equal(prompt.includes(field), true, `Scanner prompt omitted metadata field: ${field}`);
    }
    assert.match(prompt, /"url": "https URL for the exact source signal"/);
    assert.match(prompt, /define what "done" looks like/);
    assert.match(prompt, /"doneCriteria":/);
    assert.match(prompt, /0-2 specific, completable actions/);
  });
});

describe('mailbox predicates and segments', () => {
  it('maps lifecycle values to the canonical work-status pill labels', () => {
    assert.deepEqual(
      ['in-progress', 'blocked', 'waiting', 'complete', 'archived'].map((status) => ({
        label: mailboxWorkStatus({ lifecycleStatus: status }),
        className: mailboxWorkStatusClass({ lifecycleStatus: status }),
      })),
      [
        { label: 'In Progress', className: 'in-progress' },
        { label: 'Blocked', className: 'blocked' },
        { label: 'Waiting', className: 'waiting' },
        { label: 'Complete', className: 'complete' },
        { label: 'Archived', className: 'archived' },
      ]
    );
    assert.equal(mailboxWorkStatus({ lifecycleStatus: 'legacy-status' }), 'Unknown');
    assert.equal(mailboxWorkStatusClass({ lifecycleStatus: 'legacy-status' }), 'unknown');
  });

  it('keeps missing and unrecognized normalized statuses truthful', () => {
    const missing = normalizeItem({ id: 'missing-status' });
    const unknown = normalizeItem({ id: 'unknown-status', status: 'Mystery state' });

    assert.equal(missing.lifecycleStatus, 'unknown');
    assert.equal(mailboxWorkStatus(missing), 'Unknown');
    assert.equal(mailboxWorkStatusClass(missing), 'unknown');
    assert.equal(unknown.lifecycleStatus, 'unknown');
    assert.equal(mailboxWorkStatus(unknown), 'Unknown');
    assert.equal(mailboxWorkStatusClass(unknown), 'unknown');
  });

  it('includes active blocked Elevated and Observe items in Radar Priority', () => {
    assert.equal(isRadarPriority({ severity: 'Elevated', lifecycleStatus: 'blocked' }), true);
    assert.equal(isRadarPriority({ severity: 'Observe', lifecycleStatus: 'blocked' }), true);
    assert.equal(isRadarPriority(normalizeItem({ severity: 'Elevated', status: 'Blocked' })), true);
    assert.equal(isRadarPriority({ severity: 'Elevated', lifecycleStatus: 'in-progress' }), false);
    assert.equal(isRadarPriority({ severity: 'Elevated', lifecycleStatus: 'complete' }), false);
    assert.equal(isRadarPriority({ severity: 'Elevated', lifecycleStatus: 'blocked', snoozeUntil: '2099-01-01T00:00:00Z' }), false);
  });

  it('treats item flags and unseen timeline entries as unread', () => {
    assert.equal(isMailboxUnread({ isNew: true }), true);
    assert.equal(isMailboxUnread({ hasNewUpdate: true }), true);
    assert.equal(isMailboxUnread({ updateHistory: [{ seen: false }] }), true);
    assert.equal(isMailboxUnread({ updateHistory: [{ seen: true }] }), false);
  });

  it('filters Inbox, Monitored, All, and Archived using mailbox lifecycle rules', () => {
    const items = [
      { id: 'inbox-unread', lifecycleStatus: 'in-progress', isNew: true },
      { id: 'inbox-read', lifecycleStatus: 'waiting' },
      { id: 'monitored', lifecycleStatus: 'waiting', monitorEnabled: true },
      { id: 'complete', lifecycleStatus: 'complete' },
      { id: 'archived', lifecycleStatus: 'archived' },
    ];

    assert.deepEqual(getMailboxThreads(items, 'inbox').map((item) => item.id), ['inbox-read', 'inbox-unread', 'monitored']);
    assert.deepEqual(getMailboxThreads(items, 'monitored').map((item) => item.id), ['monitored']);
    assert.deepEqual(getMailboxThreads(items, 'all').map((item) => item.id), ['inbox-unread', 'complete', 'inbox-read', 'monitored']);
    assert.deepEqual(getMailboxThreads(items, 'archived').map((item) => item.id), ['archived', 'complete']);
  });

  it('temporarily removes snoozed threads from inbox and monitored projections', () => {
    const snoozed = {
      id: 'snoozed',
      lifecycleStatus: 'in-progress',
      isNew: true,
      monitorEnabled: true,
      snoozeUntil: '2099-01-01T00:00:00Z',
    };
    assert.equal(isMailboxSnoozed(snoozed, Date.parse('2098-12-31T00:00:00Z')), true);
    assert.equal(isMailboxSnoozed(snoozed, Date.parse('2099-01-02T00:00:00Z')), false);
    assert.deepEqual(getMailboxThreads([snoozed], 'inbox'), []);
    assert.deepEqual(getMailboxThreads([snoozed], 'monitored'), []);
    assert.deepEqual(getMailboxThreads([snoozed], 'all').map((item) => item.id), ['snoozed']);
  });

  it('keeps Inbox newest-first by last update when the newest thread is marked read', () => {
    const newer = {
      id: 'newer',
      lifecycleStatus: 'in-progress',
      lastChangedAt: '2026-08-27T11:00:00Z',
      isNew: true,
    };
    const older = {
      id: 'older',
      lifecycleStatus: 'in-progress',
      lastChangedAt: '2026-08-27T08:00:00Z',
      isNew: true,
    };

    assert.deepEqual(getMailboxThreads([older, newer], 'inbox').map((item) => item.id), ['newer', 'older']);

    const openedNewer = markMailboxThreadRead(newer);
    assert.equal(openedNewer.lastChangedAt, newer.lastChangedAt);
    assert.deepEqual(getMailboxThreads([older, openedNewer], 'inbox').map((item) => item.id), ['newer', 'older']);
  });

  it('sorts a newly discovered scanner notification above older changed threads', () => {
    const scannerDiscovery = {
      id: 'scanner-discovery',
      lifecycleStatus: 'in-progress',
      discoveredAt: '2026-09-03T12:00:00Z',
      lastChangedAt: null,
      isNew: true,
    };
    const olderUpdate = {
      id: 'older-update',
      lifecycleStatus: 'in-progress',
      lastChangedAt: '2026-09-03T11:00:00Z',
    };

    assert.deepEqual(getMailboxThreads([olderUpdate, scannerDiscovery], 'inbox').map((item) => item.id), [
      'scanner-discovery',
      'older-update',
    ]);
  });

  it('deduplicates threads and sorts unread first, then activity descending, then stable id', () => {
    const items = [
      { id: 'read-newer', lastChangedAt: '2026-08-27T10:00:00Z' },
      { id: 'unread-older', lastChangedAt: '2026-08-27T08:00:00Z', isNew: true },
      { id: 'b', lastChangedAt: '2026-08-27T09:00:00Z' },
      { id: 'a', lastChangedAt: '2026-08-27T09:00:00Z' },
      { id: 'read-newer', lastChangedAt: '2026-08-27T11:00:00Z' },
    ];

    assert.deepEqual(
      getMailboxThreads(items, 'all').map((item) => item.id),
      ['unread-older', 'read-newer', 'a', 'b']
    );
  });

  it('sorts valid activity timestamps before missing or invalid timestamps', () => {
    const items = [
      { id: 'a-missing' },
      { id: 'b-invalid', lastChangedAt: 'not-a-date' },
      { id: 'z-valid', lastChangedAt: '2026-08-27T09:00:00Z' },
    ];

    assert.deepEqual(
      getMailboxThreads(items, 'all').map((item) => item.id),
      ['z-valid', 'a-missing', 'b-invalid']
    );
  });

  it('keeps Inbox chronological regardless of work status', () => {
    const items = [
      { id: 'waiting-newer', lifecycleStatus: 'waiting', lastChangedAt: '2026-08-27T11:00:00Z' },
      { id: 'unknown-middle', lifecycleStatus: 'unknown', lastChangedAt: '2026-08-27T10:00:00Z' },
      { id: 'blocked-older', lifecycleStatus: 'blocked', lastChangedAt: '2026-08-27T09:00:00Z' },
    ];

    assert.deepEqual(getMailboxThreads(items, 'inbox').map((item) => item.id), [
      'waiting-newer',
      'unknown-middle',
      'blocked-older',
    ]);
  });
});

describe('mailbox timeline behavior', () => {
  it('recognizes duplicate summaries while preserving materially different evidence', () => {
    assert.equal(summariesMatch('Customer requested a decision.', '  customer  requested a DECISION.  '), true);
    assert.equal(summariesMatch('Customer requested a decision.', 'SRE mitigation started.'), false);
    assert.equal(summariesMatch('', ''), false);
  });

  it('uses the newest meaningful reply and falls back to the first timeline entry', () => {
    const reply = { kind: 'reply', timestamp: '2026-08-27T09:00:00Z', summary: 'Reply' };
    const item = {
      updateHistory: [
        { kind: 'lifecycle', timestamp: '2026-08-27T10:00:00Z', summary: 'Lifecycle' },
        reply,
      ],
    };

    assert.equal(latestMailboxUpdate(item), reply);
    assert.equal(latestMailboxUpdate({ updateHistory: [item.updateHistory[0]] }), item.updateHistory[0]);
  });

  it('marks only the returned thread read without mutating the source item', () => {
    const source = {
      id: 'thread-1',
      isNew: true,
      hasNewUpdate: true,
      updateHistory: [{ kind: 'reply', seen: false }],
    };

    const result = markMailboxThreadRead(source);

    assert.equal(isMailboxUnread(result), false);
    assert.equal(isMailboxUnread(source), true);
    assert.notEqual(result.updateHistory, source.updateHistory);
    assert.deepEqual(getMailboxThreads([result], 'inbox').map((item) => item.id), ['thread-1']);
  });
});

describe('normalizeItem mailbox history', () => {
  it('collects validated structured and ledger evidence without duplicates', () => {
    const links = collectItemEvidenceLinks({
      sourceType: 'Email',
      evidenceLinks: [
        { label: 'Customer email', type: 'email', url: 'https://outlook.office.com/mail/deeplink/read/example' },
        { label: 'Duplicate email', type: 'email', url: 'https://outlook.office.com/mail/deeplink/read/example' },
        { label: 'Unsafe', type: 'doc', url: 'javascript:alert(1)' },
      ],
      ledgerEvidenceLinks: [
        { label: 'Review meeting', type: 'meeting', url: 'https://teams.microsoft.com/l/meetup-join/example' },
        { label: 'Planning document', type: 'doc', url: 'https://contoso.sharepoint.com/sites/project/Documents/document.docx' },
      ],
    });

    assert.deepEqual(links.map(({ label, type }) => ({ label, type })), [
      { label: 'Customer email', type: 'email' },
      { label: 'Review meeting', type: 'meeting' },
      { label: 'Planning document', type: 'doc' },
    ]);
  });

  it('preserves known status labels while normalizing raw completed and archived values', () => {
    assert.equal(normalizeItem({ id: 'in-progress-status', status: 'In Progress' }).lifecycleStatus, 'in-progress');
    assert.equal(normalizeItem({ id: 'completed-status', status: 'Completed' }).lifecycleStatus, 'complete');
    assert.equal(normalizeItem({ id: 'archived-status', status: 'Archived' }).lifecycleStatus, 'archived');
    assert.equal(mailboxWorkStatus({ lifecycleStatus: 'complete' }), 'Complete');
    assert.equal(mailboxWorkStatusClass({ lifecycleStatus: 'complete' }), 'complete');
    assert.equal(mailboxWorkStatus({ lifecycleStatus: 'archived' }), 'Archived');
    assert.equal(mailboxWorkStatusClass({ lifecycleStatus: 'archived' }), 'archived');
  });

  it('normalizes legacy meaningful monitor entries to reply kind', () => {
    const normalized = normalizeItem({
      id: 'legacy-thread',
      title: 'Legacy thread',
      updateHistory: [{
        timestamp: '2026-08-27T09:00:00Z',
        changes: ['Updated'],
        summary: 'A meaningful monitor result',
        seen: false,
      }],
    });

    assert.equal(normalized.updateHistory[0].kind, 'reply');
  });
});