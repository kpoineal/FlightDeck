'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const fixtureStub = 'data:text/javascript,export default {}';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../../demo/fixture.json' && context.parentURL?.endsWith('/src/svelte/lib/persistence.js')) {
      return { url: fixtureStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let actionForState;
let actionProposalDuplicateKey;
let archiveActionProposal;
let applyOutlookDraftResult;
let buildOutlookDraftPayload;
let canArchiveActionProposal;
let canInsertActionProposal;
let canPermanentlyDeleteActionProposal;
let canRestoreActionProposal;
let classifyActionProposalEffect;
let classifyActionProposalView;
let countActionProposalViews;
let createActionEventId;
let findActionProposalDuplicateGroups;
let filterActionProposalsByView;
let actionProposals;
let actionsQueueOpen;
let createActionProposal;
let density;
let get;
let history;
let items;
let loadPersistentState;
let recordActionEvent;
let restoreActionProposal;
let runPersistentStateTransaction;
let savePersistentState;
let schedulePersistentStateSave;
let selectedProposalId;
let transitionActionProposal;
let executeOutlookDraftAction;
let isConcreteActionTarget;
let isReviewableActionProposal;
let normalizeActionProposal;
let permanentlyDeleteActionProposal;
let recoverStaleExecutingActionProposal;
let updateActionProposal;
let storedState;
let storeSetCalls;
let storeSetFailure;

function persistedFixture(overrides = {}) {
  return {
    items: [],
    scanners: [{
      id: 'scanner-1',
      name: 'Radar',
      prompt: 'Find important work.',
      enabled: true,
      scheduleType: 'interval',
      scheduleValue: '4h',
    }],
    ...overrides,
  };
}

before(async () => {
  ({ get } = await import('svelte/store'));
  ({
    actionProposals,
    actionsQueueOpen,
    density,
    history,
    items,
    selectedProposalId,
  } = await import('../src/svelte/lib/stores.js'));
  ({
    actionForState,
    actionProposalDuplicateKey,
    archiveActionProposal,
    applyOutlookDraftResult,
    buildOutlookDraftPayload,
    canArchiveActionProposal,
    canInsertActionProposal,
    canPermanentlyDeleteActionProposal,
    canRestoreActionProposal,
    classifyActionProposalEffect,
    classifyActionProposalView,
    countActionProposalViews,
    findActionProposalDuplicateGroups,
    filterActionProposalsByView,
    createActionProposal,
    executeOutlookDraftAction,
    restoreActionProposal,
    transitionActionProposal,
    isConcreteActionTarget,
    isReviewableActionProposal,
    normalizeActionProposal,
    recoverStaleExecutingActionProposal,
    updateActionProposal,
  } = await import('../src/svelte/lib/action-proposals.js'));
  ({
    createActionEventId,
    permanentlyDeleteActionProposal,
    recordActionEvent,
  } = await import('../src/svelte/lib/item-actions.js'));
  ({
    loadPersistentState,
    runPersistentStateTransaction,
    savePersistentState,
    schedulePersistentStateSave,
  } = await import('../src/svelte/lib/persistence.js'));
});

beforeEach(() => {
  storedState = persistedFixture();
  storeSetCalls = 0;
  storeSetFailure = null;
  actionProposals.set([]);
  history.set([]);
  items.set([]);
  actionsQueueOpen.set(false);
  selectedProposalId.set(null);
  globalThis.window = {
    workiq: {
      storeGet: async () => storedState,
      storeSet: async (_key, payload) => {
        storeSetCalls += 1;
        if (storeSetFailure) throw storeSetFailure;
        storedState = structuredClone(payload);
        return { success: true };
      },
      storeDelete: async () => {},
      readPromptFile: async () => ({ success: false }),
      getColdItems: async () => [],
      setColdItems: async () => ({ success: true }),
      broadcastStateChanged: () => {},
    },
  };
});

describe('local action proposal lifecycle', () => {
  it('keeps approval distinct from queueing and execution', () => {
    const drafted = createActionProposal({ id: '1', title: 'Escalation', severity: 'Critical' }, 'Draft an update', {
      id: 'proposal-1',
      createdAt: '2026-08-28T12:00:00Z',
      target: 'sofia@example.com',
    });
    const review = transitionActionProposal(drafted, 'Awaiting review');
    const approved = transitionActionProposal(review, 'Approved');

    assert.equal(approved.state, 'Approved');
    assert.equal(actionForState(approved).state, 'Queued');
    assert.equal(approved.outcome, null);
  });

  it('rejects skipped transitions and labels channel-specific authorization', () => {
    const drafted = createActionProposal({ id: '1', title: 'Escalation' }, 'Post to Teams channel', { target: 'Support triage' });

    assert.equal(transitionActionProposal(drafted, 'Executing'), drafted);
    assert.equal(actionForState(transitionActionProposal(drafted, 'Awaiting review')).label, 'Approve content');
    const approved = transitionActionProposal(transitionActionProposal(drafted, 'Awaiting review'), 'Approved');
    assert.equal(actionForState(approved).label, 'Queue Teams post');
    const queued = transitionActionProposal(approved, 'Queued');
    assert.equal(actionForState(queued).label, 'Post to channel');
  });

  it('records only a clearly local demo outcome', () => {
    let proposal = createActionProposal({ id: '1', title: 'Escalation' }, 'Create Planner task');
    for (const state of ['Awaiting review', 'Approved', 'Queued', 'Executing', 'Succeeded']) {
      proposal = transitionActionProposal(proposal, state);
    }

    assert.equal(proposal.state, 'Succeeded');
    assert.match(proposal.outcome, /local demo state/);
    assert.equal(proposal.localOnly, true);
  });

  it('blocks review until the proposal has a concrete target', () => {
    const proposal = createActionProposal({ id: '1', title: 'Unknown target' }, 'Draft an update');
    assert.equal(proposal.target, 'Target to confirm');
    assert.equal(isConcreteActionTarget(proposal.target), false);
    assert.equal(actionForState(proposal), null);
    assert.equal(isConcreteActionTarget('Sofia Martinez'), true);
  });

  it('preserves originating destination and context for return navigation', () => {
    const proposal = createActionProposal({ id: 'meeting-1', title: 'Review' }, 'Prepare follow-up', {
      target: 'Diana Chowdhury',
      sourceDestination: 'Briefings',
      sourceContextId: 'meeting-1',
    });
    assert.equal(proposal.sourceDestination, 'Briefings');
    assert.equal(proposal.sourceContextId, 'meeting-1');
  });

  it('creates collision-resistant local ids for rapid proposals', () => {
    const item = { id: 'thread-1', title: 'Escalation' };
    const options = { createdAt: '2026-08-28T12:00:00Z', target: 'Sofia Martinez' };
    assert.notEqual(
      createActionProposal(item, 'First update', options).id,
      createActionProposal(item, 'Second update', options).id
    );
  });

  it('allows drafted target and content edits before review, then locks reviewed content', () => {
    const drafted = createActionProposal({ id: '1', title: 'Escalation' }, '', {
      target: 'Target to confirm',
      content: '',
    });
    assert.equal(isReviewableActionProposal(drafted), false);

    const edited = updateActionProposal(drafted, {
      target: 'sofia@example.com',
      content: 'Confirm the hotfix deployment window.',
    }, '2026-08-28T12:05:00Z');
    assert.equal(isReviewableActionProposal(edited), true);
    assert.equal(actionForState(edited).state, 'Awaiting review');

    const reviewed = transitionActionProposal(edited, 'Awaiting review');
    assert.equal(updateActionProposal(reviewed, { content: 'Changed after review' }), reviewed);
  });

  it('invokes the narrow draft API once with the typed payload', async () => {
    const calls = [];
    const proposal = createActionProposal({ id: '1', title: 'Escalation' }, 'Confirm the deployment window.', {
      channel: 'outlook-draft',
      target: 'sofia@example.com; alex@example.com',
    });

    const completed = await executeOutlookDraftAction(proposal, async (payload) => {
      calls.push(payload);
      return { ok: true, action: 'outlook-draft-created' };
    }, '2026-08-28T12:10:00Z');

    assert.deepEqual(calls, [{
      to: ['sofia@example.com', 'alex@example.com'],
      subject: 'Escalation',
      body: 'Confirm the deployment window.',
    }]);
    assert.equal(completed.state, 'Succeeded');
    assert.equal(completed.outcome, 'Outlook draft saved in Outlook Drafts. Nothing was sent.');
    assert.equal(completed.executionVerification, 'runtime-backend-confirmed');
  });

  it('keeps cancel and backend errors honest and retryable', async () => {
    const proposal = {
      ...createActionProposal({ id: '1', title: 'Escalation' }, 'Confirm the deployment window.', {
        channel: 'outlook-draft',
        target: 'sofia@example.com',
      }),
      state: 'Executing',
    };

    const cancelled = applyOutlookDraftResult(proposal, { ok: false, code: 'CANCELLED', dispatched: false });
    assert.equal(cancelled.state, 'Queued');
    assert.equal(cancelled.outcome, 'Outlook draft creation cancelled before dispatch. No external action occurred.');
    assert.equal(cancelled.executionVerification, null);
    assert.equal(cancelled.executionCode, 'CANCELLED');
    assert.deepEqual(cancelled.executionAudit, {
      event: 'cancelled',
      outcome: 'cancelled',
      verification: 'not-applicable',
      code: 'CANCELLED',
    });

    const failed = applyOutlookDraftResult(proposal, { ok: false, code: 'AUTH_REQUIRED', dispatched: false });
    assert.equal(failed.state, 'Failed');
    assert.match(actionForState(failed).label, /Retry Outlook draft/);
    assert.doesNotMatch(failed.outcome, /sofia|deployment/i);
  });

  it('records native Outlook cancellation exactly once in thread and global ledgers', async () => {
    const proposal = {
      ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Confidential message body.', {
        id: 'proposal-cancel-audit',
        channel: 'outlook-draft',
        target: 'sofia@example.com',
      }),
      state: 'Executing',
    };
    items.set([{ id: 'thread-1', title: 'Escalation', updateHistory: [] }]);

    const completed = applyOutlookDraftResult(
      proposal,
      { ok: false, code: 'CANCELLED', dispatched: false, backendEntityId: 'secret-backend-id', rawError: 'token=secret' },
      '2026-08-31T12:10:00Z'
    );
    const eventId = createActionEventId({
      proposalId: completed.id,
      event: completed.executionAudit.event,
      timestamp: completed.updatedAt,
    });
    const event = {
      eventId,
      itemId: completed.sourceItemId,
      proposalId: completed.id,
      channel: completed.channel,
      target: completed.target,
      timestamp: completed.updatedAt,
      ...completed.executionAudit,
    };

    assert.equal(await recordActionEvent(event), true);
    assert.equal(await recordActionEvent(event), false);
    const [threadEvent] = get(items)[0].updateHistory.filter((entry) => entry.eventId === eventId);
    const [globalEvent] = get(history).filter((entry) => entry.eventId === eventId);
    assert.equal(get(items)[0].updateHistory.filter((entry) => entry.eventId === eventId).length, 1);
    assert.equal(get(history).filter((entry) => entry.eventId === eventId).length, 1);
    assert.equal(threadEvent.summary, 'Action proposal cancelled before dispatch; no external action occurred');
    assert.equal(globalEvent.summary, 'Action proposal cancelled before dispatch; no external action occurred');
    const normalized = normalizeActionProposal(completed);
    assert.equal(normalized.state, 'Queued');
    assert.equal(normalized.outcome, 'Outlook draft creation cancelled before dispatch. No external action occurred.');
    assert.equal(normalized.executionCode, 'CANCELLED');
    assert.equal(Object.hasOwn(normalized, 'executionAudit'), false);
    const serialized = JSON.stringify({ thread: get(items)[0].updateHistory[0], global: get(history)[0] });
    assert.match(serialized, /no external action occurred/i);
    assert.doesNotMatch(serialized, /Confidential|secret-backend|token=|backendEntityId|rawError/);
  });

  it('does not call the API or claim success for invalid or unconfirmed results', async () => {
    let calls = 0;
    const invalid = createActionProposal({ id: '1', title: 'Escalation' }, 'Draft body', {
      channel: 'outlook-draft',
      target: 'Sofia Martinez',
    });
    assert.equal(buildOutlookDraftPayload(invalid).ok, false);
    const rejected = await executeOutlookDraftAction(invalid, async () => {
      calls += 1;
      return { ok: true, action: 'outlook-draft-created' };
    });
    assert.equal(calls, 0);
    assert.equal(rejected.state, 'Failed');

    const unconfirmed = applyOutlookDraftResult(invalid, { ok: true, action: 'different-action' });
    assert.equal(unconfirmed.state, 'Failed');
    assert.notEqual(unconfirmed.outcome, 'Outlook draft created');
  });

  it('records an unrecognized runtime success as unconfirmed exactly once in both ledgers', async () => {
    const proposal = {
      ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Confidential message body.', {
        id: 'proposal-unconfirmed-audit',
        channel: 'outlook-draft',
        target: 'sofia@example.com',
      }),
      state: 'Executing',
    };
    items.set([{ id: 'thread-1', title: 'Escalation', updateHistory: [] }]);

    const completed = applyOutlookDraftResult(
      proposal,
      {
        ok: true,
        action: 'unknown-success',
        backendEntityId: 'secret-backend-id',
        rawContent: 'Confidential message body.',
      },
      '2026-08-31T12:11:00Z'
    );
    assert.equal(completed.state, 'Failed');
    assert.equal(completed.outcome, 'Outlook draft result could not be confirmed. Check Outlook Drafts before trying again.');
    assert.equal(completed.executionVerification, 'unverified');
    assert.equal(completed.executionCode, 'ACTION_UNCONFIRMED');
    assert.equal(actionForState(completed), null);
    assert.equal(classifyActionProposalView(completed), 'open');
    assert.deepEqual(completed.executionAudit, {
      event: 'action-unconfirmed',
      outcome: 'unverified',
      verification: 'unverified',
      code: 'ACTION_UNCONFIRMED',
    });

    const eventId = createActionEventId({
      proposalId: completed.id,
      event: completed.executionAudit.event,
      timestamp: completed.updatedAt,
    });
    const event = {
      eventId,
      itemId: completed.sourceItemId,
      proposalId: completed.id,
      channel: completed.channel,
      target: completed.target,
      timestamp: completed.updatedAt,
      ...completed.executionAudit,
    };
    assert.equal(await recordActionEvent(event), true);
    assert.equal(await recordActionEvent(event), false);

    const threadEvents = get(items)[0].updateHistory.filter((entry) => entry.eventId === eventId);
    const globalEvents = get(history).filter((entry) => entry.eventId === eventId);
    assert.equal(threadEvents.length, 1);
    assert.equal(globalEvents.length, 1);
    assert.equal(threadEvents[0].event, 'action-unconfirmed');
    assert.equal(globalEvents[0].payload.event, 'action-unconfirmed');
    const serialized = JSON.stringify({ thread: threadEvents[0], global: globalEvents[0] });
    assert.doesNotMatch(serialized, /Confidential|secret-backend|rawContent|backendEntityId/);
  });

  it('maps every post-dispatch or marker-less draft uncertainty to one unconfirmed audit event', async (testContext) => {
    const cases = [
      ['timeout', async () => ({ ok: false, action: 'outlook-draft-create', code: 'TIMEOUT', dispatched: true })],
      ['process exit', async () => ({ ok: false, action: 'outlook-draft-create', code: 'PROCESS_EXITED', dispatched: true })],
      ['null response', async () => null],
      ['empty response', async () => ({})],
      ['thrown transport error', async () => { throw new Error('secret transport detail'); }],
      ['malformed response', async () => 'secret malformed response'],
      ['protocol failure', async () => ({ ok: false, action: 'outlook-draft-create', code: 'PROTOCOL_ERROR', dispatched: true })],
      ['stream failure', async () => ({ ok: false, action: 'outlook-draft-create', code: 'STREAM_ERROR', dispatched: true })],
      ['write failure', async () => ({ ok: false, action: 'outlook-draft-create', code: 'WRITE_FAILED', dispatched: true })],
    ];

    for (const [name, createDraft] of cases) {
      await testContext.test(name, async () => {
        let calls = 0;
        const proposal = {
          ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Confidential message body.', {
            id: 'proposal-runtime-uncertainty',
            channel: 'outlook-draft',
            target: 'sofia@example.com',
          }),
          state: 'Executing',
        };
        items.set([{ id: 'thread-1', title: 'Escalation', updateHistory: [] }]);
        history.set([]);

        const completed = await executeOutlookDraftAction(proposal, async (payload) => {
          calls += 1;
          assert.deepEqual(payload, {
            to: ['sofia@example.com'],
            subject: 'Escalation',
            body: 'Confidential message body.',
          });
          return createDraft();
        }, '2026-08-31T12:12:00Z');

        assert.equal(calls, 1);
        assert.equal(completed.state, 'Failed');
        assert.equal(completed.outcome, 'Outlook draft result could not be confirmed. Check Outlook Drafts before trying again.');
        assert.equal(completed.executionVerification, 'unverified');
        assert.equal(completed.executionCode, 'ACTION_UNCONFIRMED');
        assert.equal(actionForState(completed), null);
        assert.equal(classifyActionProposalView(completed), 'open');
        assert.equal(canArchiveActionProposal(completed), true);
        assert.deepEqual(completed.executionAudit, {
          event: 'action-unconfirmed',
          outcome: 'unverified',
          verification: 'unverified',
          code: 'ACTION_UNCONFIRMED',
        });

        const eventId = createActionEventId({
          proposalId: completed.id,
          event: completed.executionAudit.event,
          timestamp: completed.updatedAt,
        });
        const event = {
          eventId,
          itemId: completed.sourceItemId,
          proposalId: completed.id,
          channel: completed.channel,
          target: completed.target,
          timestamp: completed.updatedAt,
          ...completed.executionAudit,
        };
        assert.equal(await recordActionEvent(event), true);
        assert.equal(await recordActionEvent(event), false);

        const threadEvents = get(items)[0].updateHistory.filter((entry) => entry.eventId === eventId);
        const globalEvents = get(history).filter((entry) => entry.eventId === eventId);
        assert.equal(threadEvents.length, 1);
        assert.equal(globalEvents.length, 1);
        assert.doesNotMatch(JSON.stringify({ completed, threadEvents, globalEvents }), /secret|transport detail|malformed response/i);

        const archived = archiveActionProposal(completed, 'Checked Outlook Drafts', '2026-08-31T12:13:00Z');
        assert.equal(archived.archivedAt, '2026-08-31T12:13:00Z');
        assert.equal(canRestoreActionProposal(archived), true);
      });
    }
  });

  it('keeps proven pre-dispatch failures definite and cancellation retryable', async () => {
    const proposal = {
      ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft body.', {
        id: 'proposal-pre-dispatch',
        channel: 'outlook-draft',
        target: 'sofia@example.com',
      }),
      state: 'Executing',
    };

    for (const code of ['AUTH_REQUIRED', 'START_FAILED']) {
      const failed = await executeOutlookDraftAction(proposal, async () => ({
        ok: false,
        action: 'outlook-draft-create',
        code,
        dispatched: false,
      }));
      assert.equal(failed.state, 'Failed');
      assert.equal(failed.executionCode, code);
      assert.match(actionForState(failed).label, /Retry Outlook draft/);
    }

    const unavailable = await executeOutlookDraftAction(proposal, null);
    assert.equal(unavailable.executionCode, 'API_UNAVAILABLE');
    assert.match(actionForState(unavailable).label, /Retry Outlook draft/);

    const cancelled = await executeOutlookDraftAction(proposal, async () => ({
      ok: false,
      action: 'outlook-draft-create',
      code: 'CANCELLED',
      dispatched: false,
    }));
    assert.equal(cancelled.state, 'Queued');
    assert.equal(cancelled.executionCode, 'CANCELLED');
    assert.equal(actionForState(cancelled).label, 'Create Outlook draft');
  });

  it('uses an explicit local command for thread chat proposals', () => {
    const proposal = createActionProposal({ id: '1', title: 'Escalation' }, 'Discuss locally', {
      channel: 'local-chat',
      target: 'You',
    });
    const reviewed = transitionActionProposal(proposal, 'Awaiting review');
    const approved = transitionActionProposal(reviewed, 'Approved');
    assert.equal(actionForState(approved).label, 'Queue Local thread chat');
    const queued = transitionActionProposal(approved, 'Queued');
    assert.equal(actionForState(queued).label, 'Open local thread chat');
  });

  it('classifies open, resolved, and archived management views with counts', () => {
    const base = createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
      id: 'proposal-view',
      target: 'Sofia Martinez',
    });
    const proposals = [
      base,
      { ...base, id: 'proposal-failed', state: 'Failed' },
      { ...base, id: 'proposal-succeeded', state: 'Succeeded' },
      { ...base, id: 'proposal-rejected', state: 'Rejected' },
      { ...base, id: 'proposal-cancelled', state: 'Cancelled' },
      { ...base, id: 'proposal-archived', state: 'Succeeded', archivedAt: '2026-08-31T12:00:00Z' },
    ];

    assert.equal(classifyActionProposalView(proposals[0]), 'open');
    assert.equal(classifyActionProposalView(proposals[1]), 'open');
    assert.equal(classifyActionProposalView(proposals[2]), 'resolved');
    assert.equal(classifyActionProposalView(proposals[3]), 'resolved');
    assert.equal(classifyActionProposalView(proposals[4]), 'resolved');
    assert.equal(classifyActionProposalView(proposals[5]), 'archived');
    assert.deepEqual(countActionProposalViews(proposals), { open: 2, resolved: 3, archived: 1 });
    assert.deepEqual(filterActionProposalsByView(proposals, 'archived').map((proposal) => proposal.id), ['proposal-archived']);
  });

  it('archives and restores through state-aware helpers without changing lifecycle outcome', () => {
    const succeeded = {
      ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
        id: 'proposal-archive',
        target: 'Sofia Martinez',
      }),
      state: 'Succeeded',
      outcome: 'Outlook draft created',
      executionVerification: 'runtime-backend-confirmed',
    };

    assert.equal(canArchiveActionProposal(succeeded), true);
    const archived = archiveActionProposal(succeeded, 'User cleared completed work', '2026-08-31T12:00:00Z');
    assert.equal(archived.archivedAt, '2026-08-31T12:00:00Z');
    assert.equal(archived.archivedReason, 'User cleared completed work');
    assert.equal(archived.state, 'Succeeded');
    assert.equal(archived.outcome, 'Outlook draft created');
    assert.equal(canArchiveActionProposal(archived), false);
    assert.equal(canRestoreActionProposal(archived), true);

    const restored = restoreActionProposal(archived, '2026-08-31T12:05:00Z');
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.archivedReason, null);
    assert.equal(restored.state, 'Succeeded');
    assert.equal(restored.outcome, 'Outlook draft created');
    assert.equal(canRestoreActionProposal(restored), false);
  });

  it('locks executing proposals against archive and supports narrow rejected/cancelled transitions', () => {
    const drafted = createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
      target: 'Sofia Martinez',
    });
    const awaitingReview = transitionActionProposal(drafted, 'Awaiting review');
    const rejected = transitionActionProposal(awaitingReview, 'Rejected', '2026-08-31T12:00:00Z');
    assert.equal(rejected.state, 'Rejected');
    assert.equal(classifyActionProposalView(rejected), 'resolved');

    const approved = transitionActionProposal(awaitingReview, 'Approved');
    const queued = transitionActionProposal(approved, 'Queued');
    const cancelled = transitionActionProposal(queued, 'Cancelled', '2026-08-31T12:01:00Z');
    assert.equal(cancelled.state, 'Cancelled');
    assert.equal(classifyActionProposalView(cancelled), 'resolved');

    const executing = transitionActionProposal(queued, 'Executing');
    assert.equal(actionForState(executing), null);
    assert.equal(canArchiveActionProposal(executing), false);
    assert.equal(archiveActionProposal(executing, 'Unsafe while running'), executing);
    assert.equal(transitionActionProposal(executing, 'Cancelled'), executing);
  });
});

describe('action proposal persistence', () => {
  it('survives serialize, load, and reload with non-draft lifecycle progress', async () => {
    let proposal = createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
      id: 'proposal-1',
      createdAt: '2026-08-28T12:00:00Z',
      target: 'Sofia Martinez',
    });
    proposal = transitionActionProposal(proposal, 'Awaiting review', '2026-08-28T12:01:00Z');
    proposal = transitionActionProposal(proposal, 'Approved', '2026-08-28T12:02:00Z');
    storedState = persistedFixture({ actionProposals: [proposal] });

    await loadPersistentState();
    assert.equal(get(actionProposals)[0].state, 'Approved');

    actionsQueueOpen.set(true);
    selectedProposalId.set(proposal.id);
    await savePersistentState();

    assert.deepEqual(storedState.actionProposals, [proposal]);
    assert.equal(Object.hasOwn(storedState, 'actionsQueueOpen'), false);
    assert.equal(Object.hasOwn(storedState, 'selectedProposalId'), false);

    actionProposals.set([]);
    await loadPersistentState();
    assert.equal(get(actionProposals)[0].state, 'Approved');
    assert.equal(get(actionProposals)[0].outcome, null);
  });

  it('defaults missing or invalid proposals to an inert empty collection', async () => {
    actionProposals.set([{ id: 'stale', state: 'Executing' }]);
    await loadPersistentState();
    assert.deepEqual(get(actionProposals), []);

    storedState = persistedFixture({
      actionProposals: [
        null,
        { id: 'unsafe', state: 'Executing', localOnly: false },
        { id: 'unknown', state: 'Sent', localOnly: true },
      ],
    });
    actionProposals.set([{ id: 'stale', state: 'Succeeded' }]);
    await loadPersistentState();

    assert.deepEqual(get(actionProposals), []);
  });

  it('loads an unrecognized persisted Outlook success as unconfirmed and check-first', async () => {
    storedState = persistedFixture({
      actionProposals: [{
        ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
          id: 'proposal-corrupt',
          target: 'Sofia Martinez',
        }),
        state: 'Succeeded',
        outcome: 'External email sent successfully.',
      }],
    });

    await loadPersistentState();
    const [proposal] = get(actionProposals);
    assert.equal(proposal.state, 'Failed');
    assert.equal(proposal.outcome, 'Outlook draft result could not be confirmed. Check Outlook Drafts before trying again.');
    assert.equal(proposal.executionVerification, 'unverified');
    assert.equal(proposal.executionCode, 'ACTION_UNCONFIRMED');
    assert.equal(actionForState(proposal), null);
    assert.equal(classifyActionProposalView(proposal), 'open');
    assert.doesNotMatch(JSON.stringify(proposal), /External email sent successfully/i);
  });

  it('keeps failed proposals safe and retryable after normalization', async () => {
    storedState = persistedFixture({
      actionProposals: [{
        ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
          id: 'proposal-unverified',
          target: 'Sofia Martinez',
        }),
        state: 'Failed',
        outcome: null,
      }],
    });

    await loadPersistentState();
    const [proposal] = get(actionProposals);
    assert.equal(proposal.state, 'Failed');
    assert.equal(proposal.outcome, 'Action failed; review before retrying.');
    assert.equal(proposal.executionVerification, null);
  });

  it('derives canonical trusted outcomes and strips impossible executing disposition metadata', async () => {
    const base = createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
      target: 'Sofia Martinez',
    });
    storedState = persistedFixture({
      actionProposals: [{
        ...base,
        id: 'proposal-succeeded',
        state: 'Succeeded',
        outcome: 'External email sent successfully.',
        executionVerification: 'runtime-backend-confirmed',
        executionCode: 'DRAFT_SAVED',
      }, {
        ...base,
        id: 'proposal-teams-succeeded',
        channel: 'teams',
        state: 'Succeeded',
        outcome: 'Delivered and read by every recipient.',
        executionVerification: 'runtime-backend-confirmed',
        executionCode: 'SEND_CONFIRMED',
      }, {
        ...base,
        id: 'proposal-unsupported-succeeded',
        channel: 'planner',
        state: 'Succeeded',
        outcome: 'External email sent successfully.',
        executionVerification: 'runtime-backend-confirmed',
        executionCode: 'UNKNOWN_SUCCESS',
      }, {
        ...base,
        id: 'proposal-executing',
        state: 'Executing',
        archivedAt: '2026-08-31T12:00:00Z',
        archivedReason: 'Impossible persisted state',
      }],
    });

    await loadPersistentState();
  const [succeeded, teamsSucceeded, unsupported, executing] = get(actionProposals);
    assert.equal(succeeded.state, 'Succeeded');
  assert.equal(succeeded.outcome, 'Outlook draft saved in Outlook Drafts. Nothing was sent.');
  assert.doesNotMatch(succeeded.outcome, /External email sent successfully/i);
    assert.equal(succeeded.executionVerification, 'runtime-backend-confirmed');
  assert.equal(succeeded.executionCode, 'DRAFT_SAVED');
    assert.equal(classifyActionProposalView(succeeded), 'resolved');
  assert.equal(teamsSucceeded.state, 'Succeeded');
  assert.equal(teamsSucceeded.outcome, 'Teams message sent with a matching receipt.');
  assert.doesNotMatch(teamsSucceeded.outcome, /delivered|read/i);
  assert.equal(teamsSucceeded.executionCode, 'SEND_CONFIRMED');
  assert.equal(unsupported.state, 'Executing');
  assert.equal(unsupported.outcome, 'Execution status could not be verified; no external write occurred.');
  assert.equal(unsupported.executionVerification, null);
  assert.equal(unsupported.executionCode, 'UNKNOWN_SUCCESS');
    assert.equal(executing.state, 'Failed');
    assert.equal(executing.dispatchStatus, 'unknown');
    assert.equal(executing.executionCode, 'ACTION_UNCONFIRMED');
    assert.match(executing.outcome, /Check Outlook Drafts before trying again/);
    assert.equal(executing.archivedAt, null);
    assert.equal(executing.archivedReason, null);
    assert.equal(classifyActionProposalView(executing), 'open');
  });

  it('never preserves arbitrary persisted success text, even with trusted verification', () => {
    const normalized = normalizeActionProposal({
      ...createActionProposal({ id: 'thread-1', title: 'Escalation' }, 'Draft an update', {
        id: 'proposal-adversarial-outcome',
        channel: 'outlook-draft',
        target: 'sofia@example.com',
      }),
      state: 'Succeeded',
      outcome: 'External email sent successfully.',
      executionVerification: 'runtime-backend-confirmed',
      executionCode: 'DRAFT_SAVED',
    });

    assert.equal(normalized.state, 'Succeeded');
    assert.equal(normalized.outcome, 'Outlook draft saved in Outlook Drafts. Nothing was sent.');
    assert.doesNotMatch(JSON.stringify(normalized), /External email sent successfully/i);
  });

  it('normalizes legacy disposition metadata and preserves archived proposals on reload', async () => {
    const legacy = createActionProposal({ id: 'thread-1', title: 'Legacy proposal' }, 'Draft an update', {
      id: 'proposal-legacy',
      target: 'Sofia Martinez',
    });
    const archived = archiveActionProposal({
      ...legacy,
      id: 'proposal-archived',
      state: 'Cancelled',
      outcome: 'Action cancelled.',
    }, '  Cleared by user  ', '2026-08-31T12:00:00Z');
    storedState = persistedFixture({ actionProposals: [legacy, archived] });

    await loadPersistentState();
    const [normalizedLegacy, normalizedArchived] = get(actionProposals);
    assert.equal(normalizedLegacy.archivedAt, null);
    assert.equal(normalizedLegacy.archivedReason, null);
    assert.equal(normalizedArchived.archivedAt, '2026-08-31T12:00:00Z');
    assert.equal(normalizedArchived.archivedReason, 'Cleared by user');
    assert.equal(normalizedArchived.state, 'Cancelled');

    await savePersistentState();
    actionProposals.set([]);
    await loadPersistentState();
    assert.equal(get(actionProposals)[1].archivedAt, '2026-08-31T12:00:00Z');
  });

  it('persists action events to the source thread and global History together', async () => {
    storedState = persistedFixture({
      items: [{
        id: 'thread-1',
        title: 'Escalation',
        updateHistory: [{
          kind: 'discovery',
          timestamp: '2026-08-31T11:00:00Z',
          summary: 'Existing thread entry',
          seen: true,
        }],
      }],
      history: [],
    });
    await loadPersistentState();

    assert.equal(await recordActionEvent({
      eventId: 'event-persisted-1',
      itemId: 'thread-1',
      proposalId: 'proposal-1',
      event: 'approved',
      channel: 'outlook-draft',
      target: 'Sofia Martinez',
      outcome: 'pending',
      verification: 'not-applicable',
      code: 'approved',
      timestamp: '2026-08-31T12:00:00Z',
    }), true);

    assert.equal(storedState.items[0].updateHistory[0].eventId, 'event-persisted-1');
    assert.equal(storedState.items[0].updateHistory[1].summary, 'Existing thread entry');
    assert.equal(storedState.history[0].eventId, 'event-persisted-1');
    assert.equal(storedState.history[0].payload.itemId, 'thread-1');
    assert.equal(storedState.history[0].payload.proposalId, 'proposal-1');
  });
});

describe('permanent action proposal deletion', () => {
  function proposalFixture(id, overrides = {}) {
    return {
      ...createActionProposal({ id: 'thread-1', title: 'Secret subject', sourceType: 'Email' }, 'Secret body', {
        id,
        channel: 'outlook-draft',
        target: 'secret@example.com',
        createdAt: '2026-08-31T12:00:00Z',
      }),
      ...overrides,
    };
  }

  function threadEvent(proposalId, event, eventId = `${proposalId}-${event}`) {
    return {
      kind: 'action',
      eventId,
      timestamp: '2026-08-31T12:05:00Z',
      event,
      summary: `Action proposal ${event}`,
      itemId: 'thread-1',
      proposalId,
      seen: true,
    };
  }

  function globalEvent(proposalId, event, eventId = `${proposalId}-${event}`) {
    return {
      id: `action_${eventId}`,
      eventId,
      at: '2026-08-31T12:05:00Z',
      kind: 'action',
      summary: `Action proposal ${event}`,
      payload: { itemId: 'thread-1', proposalId, event },
    };
  }

  it('normalizes durable dispatch status and classifies effect without trusting localOnly', () => {
    const drafted = proposalFixture('proposal-drafted');
    const legacyExecuting = normalizeActionProposal(proposalFixture('proposal-legacy', {
      state: 'Executing',
      dispatchStatus: undefined,
    }));
    const definiteFailure = normalizeActionProposal(proposalFixture('proposal-definite', {
      state: 'Failed',
      dispatchStatus: 'not-dispatched',
      executionCode: 'AUTH_REQUIRED',
    }));
    const confirmed = normalizeActionProposal(proposalFixture('proposal-confirmed', {
      state: 'Succeeded',
      dispatchStatus: 'dispatched',
      executionVerification: 'runtime-backend-confirmed',
      executionCode: 'DRAFT_SAVED',
    }));

    assert.equal(drafted.dispatchStatus, 'not-started');
    assert.equal(legacyExecuting.dispatchStatus, 'unknown');
    assert.equal(classifyActionProposalEffect(drafted), 'no-effect');
    assert.equal(classifyActionProposalEffect(definiteFailure), 'no-effect');
    assert.equal(classifyActionProposalEffect(legacyExecuting), 'uncertain');
    assert.equal(classifyActionProposalEffect(confirmed), 'confirmed');
    assert.equal(classifyActionProposalEffect({ ...drafted, localOnly: true, dispatchStatus: 'unknown' }), 'uncertain');
    assert.equal(classifyActionProposalEffect(drafted, {
      threadEvents: [threadEvent(drafted.id, 'execution-started')],
    }), 'uncertain');
    assert.equal(classifyActionProposalEffect(drafted, {
      globalEvents: [{
        ...globalEvent(drafted.id, 'succeeded'),
        payload: {
          itemId: 'thread-1',
          proposalId: drafted.id,
          event: 'succeeded',
          channel: 'outlook-draft',
          verification: 'runtime-backend-confirmed',
          code: 'DRAFT_SAVED',
        },
      }],
    }), 'confirmed');

    for (const state of ['Drafted', 'Awaiting review', 'Approved', 'Queued', 'Executing', 'Succeeded', 'Failed', 'Rejected', 'Cancelled']) {
      assert.equal(canPermanentlyDeleteActionProposal({ ...drafted, state }), true, state);
      assert.equal(canPermanentlyDeleteActionProposal({ ...drafted, state, archivedAt: '2026-08-31T12:10:00Z' }), true, `${state} archived`);
    }
  });

  it('recovers stale Executing proposals only during hydration and persists the correction', async () => {
    const definite = proposalFixture('proposal-definite-stale', {
      state: 'Executing',
      dispatchStatus: 'not-dispatched',
    });
    const legacy = proposalFixture('proposal-legacy-stale', {
      state: 'Executing',
    });

    const recoveredDefinite = recoverStaleExecutingActionProposal(definite, '2026-08-31T15:40:18.7935438-06:00');
    const recoveredLegacy = recoverStaleExecutingActionProposal(legacy, '2026-08-31T15:40:18.7935438-06:00');
    assert.equal(recoveredDefinite.state, 'Failed');
    assert.equal(recoveredDefinite.executionCode, 'EXECUTION_INTERRUPTED_BEFORE_DISPATCH');
    assert.match(actionForState(recoveredDefinite).label, /Retry Outlook draft/);
    assert.equal(recoveredLegacy.state, 'Failed');
    assert.equal(recoveredLegacy.executionCode, 'ACTION_UNCONFIRMED');
    assert.match(recoveredLegacy.outcome, /Check Outlook Drafts before trying again/);
    assert.equal(actionForState(recoveredLegacy), null);
    for (const dispatchStatus of ['unknown', 'dispatched']) {
      const recovered = recoverStaleExecutingActionProposal({ ...legacy, dispatchStatus });
      assert.equal(recovered.state, 'Failed');
      assert.equal(recovered.executionCode, 'ACTION_UNCONFIRMED');
      assert.equal(recovered.dispatchStatus, dispatchStatus);
      assert.equal(actionForState(recovered), null);
    }

    storedState = persistedFixture({ actionProposals: [definite, legacy] });
    await loadPersistentState();
    assert.equal(get(actionProposals)[0].executionCode, 'EXECUTION_INTERRUPTED_BEFORE_DISPATCH');
    assert.equal(get(actionProposals)[1].executionCode, 'ACTION_UNCONFIRMED');
    assert.equal(storeSetCalls, 1);
    assert.equal(storedState.actionProposals[0].state, 'Failed');

    const executing = proposalFixture('proposal-normal-save', {
      state: 'Executing',
      dispatchStatus: 'not-dispatched',
    });
    actionProposals.set([executing]);
    await savePersistentState();
    assert.equal(storedState.actionProposals[0].state, 'Executing');
  });

  it('provides canonical duplicate groups and an open insertion guard without removing existing entries', () => {
    const first = proposalFixture('proposal-duplicate-1');
    const second = proposalFixture('proposal-duplicate-2', {
      target: '  SECRET@example.com ',
      sourceTitle: ' Secret   subject ',
      content: ' Secret   body ',
      archivedAt: '2026-08-31T12:10:00Z',
    });
    const candidate = proposalFixture('proposal-duplicate-3', {
      target: 'secret@EXAMPLE.com',
      sourceTitle: 'secret subject',
      content: 'secret body',
    });

    assert.equal(actionProposalDuplicateKey(first), actionProposalDuplicateKey(second));
    assert.equal(canInsertActionProposal([first, second], candidate), false);
    assert.equal(canInsertActionProposal([{ ...first, archivedAt: '2026-08-31T12:10:00Z' }], candidate), true);
    assert.deepEqual(findActionProposalDuplicateGroups([first, second, candidate]), [{
      key: actionProposalDuplicateKey(first),
      proposalIds: [first.id, second.id, candidate.id],
    }]);
  });

  it('deletes a proven no-effect proposal, cleans administrative events, and survives reload', async () => {
    const proposal = proposalFixture('proposal-no-effect');
    const source = {
      id: 'thread-1',
      title: 'Source thread must remain',
      updateHistory: [
        threadEvent(proposal.id, 'proposal-created'),
        threadEvent(proposal.id, 'approved'),
        { kind: 'reply', timestamp: '2026-08-31T11:00:00Z', summary: 'Keep this reply', seen: true },
      ],
    };
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([source]);
    history.set([
      globalEvent(proposal.id, 'proposal-created'),
      globalEvent(proposal.id, 'approved'),
      { id: 'unrelated', at: '2026-08-31T11:00:00Z', kind: 'scan', summary: 'Keep this history' },
    ]);
    actionProposals.set([proposal]);
    storeSetCalls = 0;

    assert.equal(canPermanentlyDeleteActionProposal(proposal), true);
    const result = await permanentlyDeleteActionProposal(proposal.id, {
      at: '2026-08-31T15:40:18.7935438-06:00',
    });

    assert.deepEqual(result, { ok: true, deletedCount: 1, effect: 'no-effect' });
    assert.equal(storeSetCalls, 1);
    assert.deepEqual(get(actionProposals), []);
    assert.equal(get(items).length, 1);
    assert.equal(get(items)[0].title, 'Source thread must remain');
    assert.equal(get(items)[0].updateHistory.some((entry) => entry.proposalId === proposal.id), false);
    assert.equal(get(history).some((entry) => entry.payload?.event === 'proposal-created'), false);
    const tombstone = get(history).find((entry) => entry.payload?.event === 'proposal-deleted');
    assert.equal(tombstone.payload.effect, 'no-effect');
    assert.equal(get(items)[0].updateHistory.some((entry) => entry.event === 'proposal-deleted'), false);
    assert.doesNotMatch(JSON.stringify(tombstone), /Secret subject|Secret body|secret@example|backend/i);

    actionProposals.set([proposal]);
    items.set([]);
    history.set([]);
    await loadPersistentState();
    assert.deepEqual(get(actionProposals), []);
    assert.equal(get(items)[0].title, 'Source thread must remain');
    assert.ok(get(history).some((entry) => entry.payload?.event === 'proposal-deleted'));
  });

  it('retains uncertain and confirmed execution evidence with thread and global tombstones', async () => {
    const uncertain = proposalFixture('proposal-uncertain', {
      state: 'Failed',
      dispatchStatus: 'unknown',
      executionVerification: 'unverified',
      executionCode: 'ACTION_UNCONFIRMED',
    });
    const confirmed = proposalFixture('proposal-confirmed-delete', {
      state: 'Succeeded',
      dispatchStatus: 'dispatched',
      executionVerification: 'runtime-backend-confirmed',
      executionCode: 'DRAFT_SAVED',
    });
    const evidence = [
      threadEvent(uncertain.id, 'execution-started'),
      threadEvent(uncertain.id, 'action-unconfirmed'),
      threadEvent(confirmed.id, 'succeeded'),
    ];
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([{ id: 'thread-1', title: 'Source', updateHistory: evidence }]);
    history.set([
      globalEvent(uncertain.id, 'execution-started'),
      globalEvent(uncertain.id, 'action-unconfirmed'),
      globalEvent(confirmed.id, 'succeeded'),
    ]);
    actionProposals.set([uncertain, confirmed]);

    assert.equal((await permanentlyDeleteActionProposal(uncertain.id)).effect, 'uncertain');
    assert.equal((await permanentlyDeleteActionProposal(confirmed.id)).effect, 'confirmed');
    const updatedThread = get(items)[0].updateHistory;
    assert.ok(updatedThread.some((entry) => entry.event === 'action-unconfirmed'));
    assert.ok(updatedThread.some((entry) => entry.event === 'succeeded'));
    assert.equal(updatedThread.filter((entry) => entry.event === 'proposal-deleted').length, 2);
    assert.equal(get(history).filter((entry) => entry.payload?.event === 'proposal-deleted').length, 2);
  });

  it('atomically deletes a requested duplicate group with one save and never deletes its source', async () => {
    const first = proposalFixture('proposal-group-1');
    const second = proposalFixture('proposal-group-2', { archivedAt: '2026-08-31T12:10:00Z' });
    const unrelated = proposalFixture('proposal-unrelated', { content: 'Different body' });
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([{ id: 'thread-1', title: 'Source', updateHistory: [] }]);
    actionProposals.set([first, second, unrelated]);
    storeSetCalls = 0;

    const result = await permanentlyDeleteActionProposal(first.id, {
      includeDuplicates: true,
      at: '2026-08-31T15:40:18.7935438-06:00',
    });

    assert.deepEqual(result, { ok: true, deletedCount: 2, effect: 'no-effect' });
    assert.equal(storeSetCalls, 1);
    assert.deepEqual(get(actionProposals).map((proposal) => proposal.id), [unrelated.id]);
    assert.deepEqual(get(items).map((item) => item.id), ['thread-1']);
  });

  it('rolls every store back and returns a sanitized failure when persistence fails', async () => {
    const proposal = proposalFixture('proposal-rollback');
    const source = {
      id: 'thread-1',
      title: 'Secret subject',
      evidenceLinks: Array.from({ length: 30 }, (_, index) => ({ label: `Evidence ${index}` })),
      updateHistory: [],
    };
    const originalSource = structuredClone(source);
    const global = [globalEvent(proposal.id, 'approved')];
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([source]);
    history.set(global);
    actionProposals.set([proposal]);
    storeSetCalls = 0;
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      if (storeSetCalls === 1) throw new Error('secret persistence path C:\\private\\state.json');
      storedState = structuredClone(payload);
      return { success: true };
    };

    const result = await permanentlyDeleteActionProposal(proposal.id);

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.equal(storeSetCalls, 2);
    assert.deepEqual(get(actionProposals), [proposal]);
    assert.deepEqual(get(items), [originalSource]);
    assert.deepEqual(get(history), global);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|state\.json/i);
  });

  it('does not recreate a deleted proposal when execution completes late but keeps effect audit by event id', async () => {
    const executing = proposalFixture('proposal-late', {
      state: 'Executing',
      dispatchStatus: 'unknown',
    });
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([{ id: 'thread-1', title: 'Source', updateHistory: [] }]);
    actionProposals.set([executing]);
    await permanentlyDeleteActionProposal(executing.id);

    const completed = applyOutlookDraftResult(executing, {
      ok: true,
      action: 'outlook-draft-created',
      dispatched: true,
    }, '2026-08-31T15:41:00.000Z');
    actionProposals.update((proposals) => proposals.map((proposal) => proposal.id === executing.id ? completed : proposal));
    assert.deepEqual(get(actionProposals), []);

    const eventId = createActionEventId({
      proposalId: executing.id,
      event: completed.executionAudit.event,
      timestamp: completed.updatedAt,
    });
    assert.equal(await recordActionEvent({
      eventId,
      itemId: executing.sourceItemId,
      proposalId: executing.id,
      event: completed.executionAudit.event,
      channel: executing.channel,
      outcome: completed.executionAudit.outcome,
      verification: completed.executionAudit.verification,
      code: completed.executionAudit.code,
      timestamp: completed.updatedAt,
    }), true);
    assert.ok(get(items)[0].updateHistory.some((entry) => entry.eventId === eventId));
    assert.ok(get(history).some((entry) => entry.eventId === eventId));
  });
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function seedDeletableProposal(id) {
  const proposal = createActionProposal(
    { id: 'thread-1', title: 'Secret subject', sourceType: 'Email' },
    'Secret body',
    {
      id,
      channel: 'outlook-draft',
      target: 'secret@example.com',
      createdAt: '2026-08-31T12:00:00Z',
    }
  );
  storedState = persistedFixture();
  await loadPersistentState();
  items.set([{ id: 'thread-1', title: 'Source', updateHistory: [] }]);
  actionProposals.set([proposal]);
  await savePersistentState();
  storeSetCalls = 0;
  return proposal;
}

function subscribeAutosave() {
  return actionProposals.subscribe(() => schedulePersistentStateSave(false, 500));
}

describe('persistence transaction boundary', () => {
  it('coalesces subscription autosave so a successful deletion writes exactly once', async () => {
    const proposal = await seedDeletableProposal('proposal-transaction-success');
    const unsubscribe = subscribeAutosave();

    try {
      const result = await permanentlyDeleteActionProposal(proposal.id);
      await wait(650);

      assert.deepEqual(result, { ok: true, deletedCount: 1, effect: 'no-effect' });
      assert.equal(storeSetCalls, 1);
      assert.deepEqual(storedState.actionProposals, []);
    } finally {
      unsubscribe();
    }
  });

  it('waits for durable rollback after a slow primary failure and leaves no delayed deletion write', async () => {
    const proposal = await seedDeletableProposal('proposal-transaction-rollback');
    const durableBeforeDelete = structuredClone(storedState);
    const writes = [];
    const unsubscribe = subscribeAutosave();
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      writes.push(structuredClone(payload));
      if (storeSetCalls === 1) {
        await wait(650);
        throw new Error('secret slow primary failure');
      }
      storedState = structuredClone(payload);
      return { success: true };
    };

    try {
      const result = await permanentlyDeleteActionProposal(proposal.id);

      assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
      assert.equal(storeSetCalls, 2);
      assert.deepEqual(get(actionProposals), [proposal]);
      assert.deepEqual(storedState.actionProposals, durableBeforeDelete.actionProposals);
      assert.deepEqual(writes[0].actionProposals, []);
      assert.deepEqual(writes[1].actionProposals, durableBeforeDelete.actionProposals);

      await wait(650);
      assert.equal(storeSetCalls, 2);
      assert.deepEqual(storedState.actionProposals, durableBeforeDelete.actionProposals);
    } finally {
      unsubscribe();
    }
  });

  it('reconciles a slow failed deletion without losing concurrent domain changes', async () => {
    const transactionThreadEvent = (proposalId, event, eventId) => ({
      kind: 'action',
      eventId,
      timestamp: '2026-08-31T12:05:00Z',
      event,
      summary: `Action proposal ${event}`,
      itemId: 'thread-1',
      proposalId,
      seen: true,
    });
    const transactionGlobalEvent = (proposalId, event, eventId) => ({
      id: `action_${eventId}`,
      eventId,
      at: '2026-08-31T12:05:00Z',
      kind: 'action',
      summary: `Action proposal ${event}`,
      payload: { itemId: 'thread-1', proposalId, event },
    });
    const target = createActionProposal(
      { id: 'thread-1', title: 'Secret subject', sourceType: 'Email' },
      'Secret body',
      {
        id: 'proposal-concurrent-target',
        channel: 'outlook-draft',
        target: 'secret@example.com',
        createdAt: '2026-08-31T12:00:00Z',
        state: 'Failed',
        dispatchStatus: 'unknown',
        executionVerification: 'unverified',
        executionCode: 'ACTION_UNCONFIRMED',
      }
    );
    const existingProposal = createActionProposal(
      { id: 'thread-2', title: 'Concurrent proposal', sourceType: 'Email' },
      'Before update',
      { id: 'proposal-concurrent-existing', createdAt: '2026-08-31T11:00:00Z' }
    );
    const removedProposal = createActionProposal(
      { id: 'thread-3', title: 'Removed proposal', sourceType: 'Email' },
      'Remove concurrently',
      { id: 'proposal-concurrent-removed', createdAt: '2026-08-31T10:00:00Z' }
    );
    const sourceAdministrativeEvent = transactionThreadEvent(target.id, 'approved', 'target-approved');
    const globalAdministrativeEvent = transactionGlobalEvent(target.id, 'approved', 'target-approved');
    const source = {
      id: 'thread-1',
      title: 'Source before concurrent edit',
      owner: 'Before owner',
      lastChangedAt: '2026-08-31T12:05:00Z',
      updateHistory: [
        transactionThreadEvent(target.id, 'execution-started', 'target-execution-started'),
        sourceAdministrativeEvent,
      ],
    };
    const unrelated = { id: 'thread-2', title: 'Before unrelated update', updateHistory: [] };
    const concurrentlyRemovedItem = { id: 'thread-3', title: 'Remove concurrently', updateHistory: [] };
    storedState = persistedFixture();
    await loadPersistentState();
    items.set([source, unrelated, concurrentlyRemovedItem]);
    history.set([
      transactionGlobalEvent(target.id, 'execution-started', 'target-execution-started'),
      globalAdministrativeEvent,
      { id: 'history-remove-concurrently', at: '2026-08-31T11:00:00Z', kind: 'scan', summary: 'Remove concurrently' },
    ]);
    actionProposals.set([existingProposal, target, removedProposal]);
    await savePersistentState();
    storeSetCalls = 0;

    let primaryStarted;
    const primaryStartedPromise = new Promise((resolve) => { primaryStarted = resolve; });
    const writes = [];
    const unsubscribe = subscribeAutosave();
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      writes.push(structuredClone(payload));
      if (storeSetCalls === 1) {
        primaryStarted();
        await wait(650);
        throw new Error('secret slow primary failure');
      }
      storedState = structuredClone(payload);
      return { success: true };
    };

    try {
      const deletion = permanentlyDeleteActionProposal(target.id, {
        at: '2026-08-31T15:40:18.7935438-06:00',
      });
      await primaryStartedPromise;

      const addedProposal = createActionProposal(
        { id: 'thread-4', title: 'Added proposal', sourceType: 'Email' },
        'Added concurrently',
        { id: 'proposal-concurrent-added', createdAt: '2026-08-31T15:41:00Z' }
      );
      actionProposals.update((proposals) => [
        ...proposals
          .filter((proposal) => proposal.id !== removedProposal.id)
          .map((proposal) => proposal.id === existingProposal.id
            ? { ...proposal, content: 'Updated concurrently' }
            : proposal),
        addedProposal,
      ]);
      items.update(($items) => [
        ...$items
          .filter((item) => item.id !== concurrentlyRemovedItem.id)
          .map((item) => {
            if (item.id === source.id) {
              return {
                ...item,
                title: 'Source updated concurrently',
                owner: 'Concurrent owner',
                lastChangedAt: '2026-08-31T15:41:00Z',
                updateHistory: [
                  transactionThreadEvent(target.id, 'approved', 'target-approved'),
                  transactionThreadEvent('proposal-concurrent-added', 'proposal-created', 'source-concurrent-history'),
                  ...item.updateHistory,
                ].map((entry) => entry.eventId === 'target-approved'
                  ? { ...entry, summary: 'Concurrent administrative edit' }
                  : entry),
              };
            }
            return item.id === unrelated.id
              ? { ...item, title: 'Unrelated item updated concurrently' }
              : item;
          }),
        { id: 'thread-4', title: 'Item added concurrently', updateHistory: [] },
      ]);
      history.update(($history) => [
        { ...globalAdministrativeEvent, summary: 'Concurrent global administrative edit' },
        { id: 'history-added-concurrently', at: '2026-08-31T15:41:00Z', kind: 'scan', summary: 'Added concurrently' },
        ...$history.filter((entry) => entry.id !== 'history-remove-concurrently'),
      ]);
      const concurrentSave = savePersistentState();

      const [result, concurrentSaveResult] = await Promise.all([deletion, concurrentSave]);

      assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
      assert.equal(concurrentSaveResult, true);
      assert.equal(storeSetCalls, 2);
      assert.deepEqual(get(actionProposals).map((proposal) => proposal.id), [
        existingProposal.id,
        target.id,
        addedProposal.id,
      ]);
      assert.equal(get(actionProposals)[0].content, 'Updated concurrently');
      assert.equal(get(items).find((item) => item.id === source.id).title, 'Source updated concurrently');
      assert.equal(get(items).find((item) => item.id === source.id).owner, 'Concurrent owner');
      assert.equal(get(items).find((item) => item.id === unrelated.id).title, 'Unrelated item updated concurrently');
      assert.ok(get(items).some((item) => item.id === 'thread-4'));
      assert.equal(get(items).some((item) => item.id === concurrentlyRemovedItem.id), false);
      const restoredSourceHistory = get(items).find((item) => item.id === source.id).updateHistory;
      assert.equal(restoredSourceHistory.filter((entry) => entry.eventId === 'target-approved').length, 1);
      assert.equal(restoredSourceHistory.find((entry) => entry.eventId === 'target-approved').summary, 'Concurrent administrative edit');
      assert.ok(restoredSourceHistory.some((entry) => entry.eventId === 'source-concurrent-history'));
      assert.equal(restoredSourceHistory.some((entry) => entry.event === 'proposal-deleted'), false);
      assert.equal(get(history).filter((entry) => entry.eventId === 'target-approved').length, 1);
      assert.equal(get(history).find((entry) => entry.eventId === 'target-approved').summary, 'Concurrent global administrative edit');
      assert.ok(get(history).some((entry) => entry.id === 'history-added-concurrently'));
      assert.equal(get(history).some((entry) => entry.id === 'history-remove-concurrently'), false);
      assert.equal(get(history).some((entry) => entry.payload?.event === 'proposal-deleted'), false);
      assert.deepEqual(storedState.actionProposals, get(actionProposals));
      assert.deepEqual(storedState.items, get(items));
      assert.deepEqual(storedState.history, get(history));
      assert.deepEqual(writes[1].actionProposals, storedState.actionProposals);

      await wait(700);
      assert.equal(storeSetCalls, 2);
      assert.deepEqual(storedState.actionProposals, get(actionProposals));
    } finally {
      unsubscribe();
    }
  });

  it('preserves a concurrently recreated proposal when a slow deletion write fails', async () => {
    const proposal = await seedDeletableProposal('proposal-concurrent-recreated');
    let primaryStarted;
    const primaryStartedPromise = new Promise((resolve) => { primaryStarted = resolve; });
    const unsubscribe = subscribeAutosave();
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      if (storeSetCalls === 1) {
        primaryStarted();
        await wait(650);
        throw new Error('slow primary failure');
      }
      storedState = structuredClone(payload);
      return { success: true };
    };

    try {
      const deletion = permanentlyDeleteActionProposal(proposal.id);
      await primaryStartedPromise;
      actionProposals.update((proposals) => [
        ...proposals,
        { ...proposal, content: 'Recreated concurrently', updatedAt: '2026-08-31T15:42:00Z' },
      ]);

      assert.deepEqual(await deletion, { ok: false, code: 'PERSISTENCE_FAILED' });
      assert.equal(storeSetCalls, 2);
      assert.equal(get(actionProposals).length, 1);
      assert.equal(get(actionProposals)[0].content, 'Recreated concurrently');
      assert.equal(storedState.actionProposals[0].content, 'Recreated concurrently');

      await wait(700);
      assert.equal(storeSetCalls, 2);
    } finally {
      unsubscribe();
    }
  });

  it('requires persistence recovery when removed administrative evidence has no stable id', async () => {
    const proposal = await seedDeletableProposal('proposal-unsafe-recovery');
    items.set([{
      id: 'thread-1',
      title: 'Source',
      updateHistory: [{
        kind: 'action',
        timestamp: '2026-08-31T12:05:00Z',
        event: 'approved',
        proposalId: proposal.id,
        summary: 'Administrative evidence without stable identity',
      }],
    }]);
    await savePersistentState();
    storeSetCalls = 0;
    window.workiq.storeSet = async () => {
      storeSetCalls += 1;
      throw new Error('primary persistence failure');
    };

    const result = await permanentlyDeleteActionProposal(proposal.id);

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' });
    assert.equal(storeSetCalls, 1);
    assert.deepEqual(storedState.actionProposals, [proposal]);
    assert.deepEqual(get(actionProposals), []);
  });

  it('returns a sanitized recovery-required code when durable rollback also fails', async () => {
    const proposal = await seedDeletableProposal('proposal-transaction-recovery');
    window.workiq.storeSet = async () => {
      storeSetCalls += 1;
      throw new Error('secret path C:\\private\\state.json');
    };

    const result = await permanentlyDeleteActionProposal(proposal.id);

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' });
    assert.equal(storeSetCalls, 2);
    assert.deepEqual(get(actionProposals), [proposal]);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|state\.json/i);
  });

  it('serializes a concurrent save and persists unrelated store changes after deletion', async () => {
    const proposal = await seedDeletableProposal('proposal-transaction-concurrent');
    let releasePrimary;
    const primaryBlocked = new Promise((resolve) => { releasePrimary = resolve; });
    const writes = [];
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      writes.push(structuredClone(payload));
      if (storeSetCalls === 1) await primaryBlocked;
      storedState = structuredClone(payload);
      return { success: true };
    };

    const deletion = permanentlyDeleteActionProposal(proposal.id);
    await wait(20);
    density.set('minimal');
    const concurrentSave = savePersistentState();
    releasePrimary();

    const [deletionResult, saveResult] = await Promise.all([deletion, concurrentSave]);

    assert.equal(deletionResult.ok, true);
    assert.equal(saveResult, true);
    assert.equal(storeSetCalls, 2);
    assert.equal(writes[0].density, 'full');
    assert.equal(writes[1].density, 'minimal');
    assert.equal(storedState.density, 'minimal');
    assert.deepEqual(storedState.actionProposals, []);
  });

  it('rejects nested and contending transactions with BUSY without corrupting the owner', async () => {
    let nestedTransaction;
    let releasePrimary;
    const primaryBlocked = new Promise((resolve) => { releasePrimary = resolve; });
    window.workiq.storeSet = async (_key, payload) => {
      storeSetCalls += 1;
      await primaryBlocked;
      storedState = structuredClone(payload);
      return { success: true };
    };

    const owner = runPersistentStateTransaction({
      mutate() {
        nestedTransaction = runPersistentStateTransaction({ mutate() {}, rollback() {} });
      },
      rollback() {},
    });
    const contender = await runPersistentStateTransaction({ mutate() {}, rollback() {} });
    const nested = await nestedTransaction;

    assert.deepEqual(contender, { ok: false, code: 'BUSY' });
    assert.deepEqual(nested, { ok: false, code: 'BUSY' });
    releasePrimary();
    assert.deepEqual(await owner, { ok: true });
    assert.equal(storeSetCalls, 1);
  });
});
