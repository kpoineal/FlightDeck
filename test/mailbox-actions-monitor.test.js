'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  export function pruneHistory() {}
  export function savePersistentState(isDemo = false) {
    globalThis.__mailboxTestSaveCalls = (globalThis.__mailboxTestSaveCalls || 0) + 1;
    globalThis.__mailboxTestSaveModes.push(isDemo);
    globalThis.__mailboxTestOnMonitorCycleSaved?.();
  }
  export function isAcceptedPersistenceReceipt(receipt) {
    if (receipt === true) return true;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    if (Object.getPrototypeOf(receipt) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(receipt);
    if (keys.length !== 1 || keys[0] !== 'success') return false;
    const descriptor = Object.getOwnPropertyDescriptor(receipt, 'success');
    return descriptor !== undefined
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && descriptor.value === true
      && descriptor.writable === true
      && descriptor.enumerable === true
      && descriptor.configurable === true;
  }
  export async function runPersistentStateTransaction({ mutate }) {
    mutate();
    savePersistentState();
    return { ok: true };
  }
`)}`;
const jsonParserStub = `data:text/javascript,${encodeURIComponent(`
  export async function runWorkiqJson(...args) {
    if (typeof globalThis.__mailboxTestRunWorkiqJson === 'function') {
      return globalThis.__mailboxTestRunWorkiqJson(...args);
    }
    return globalThis.__mailboxTestMonitorPayload;
  }
`)}`;
const toastStub = `data:text/javascript,${encodeURIComponent(`
  export function showToast(message, options) {
    globalThis.__mailboxTestToasts.push({ message, options });
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './persistence.js' && context.parentURL?.includes('/src/svelte/lib/')) {
      return { url: persistenceStub, shortCircuit: true };
    }
    if (specifier === './json-parser.js' && context.parentURL?.endsWith('/src/svelte/lib/monitor-engine.js')) {
      return { url: jsonParserStub, shortCircuit: true };
    }
    if (specifier === '../components/Toast.svelte' && context.parentURL?.endsWith('/src/svelte/lib/monitor-engine.js')) {
      return { url: toastStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let get;
let items;
let history;
let activeOperations;
let createActionEventId;
let markItemRead;
let recordActionEvent;
let setItemLifecycle;
let runItemCheck;
let startMonitoringLoop;
let stopMonitoringLoop;
let connected;
let isDemo;
let setItemField;

function monitoredItem(overrides = {}) {
  return {
    id: 'thread-1',
    title: 'Review launch plan',
    summary: 'Current summary',
    reason: 'Current reason',
    status: 'In Progress',
    severity: 'Observe',
    dueAt: null,
    owner: 'You',
    counterparties: [],
    suggestedNextSteps: [],
    evidenceLinks: [],
    doneCriteria: null,
    completionConfidence: null,
    sourceType: 'Email',
    lifecycleStatus: 'in-progress',
    monitorEnabled: true,
    notifyEnabled: true,
    scheduleType: 'interval',
    scheduleValue: '4h',
    workHoursOnly: false,
    updateHistory: [{
      kind: 'discovery',
      timestamp: '2026-08-27T08:00:00Z',
      summary: 'Current summary',
      seen: true,
    }],
    isNew: false,
    hasNewUpdate: false,
    ...overrides,
  };
}

function matchingPayload(overrides = {}) {
  return {
    hasNewInfo: true,
    summary: 'Current summary',
    reason: 'Current reason',
    status: 'In Progress',
    severity: 'Observe',
    dueAt: null,
    owner: 'You',
    counterparties: [],
    suggestedNextSteps: [],
    evidenceLinks: [],
    doneCriteria: null,
    completionConfidence: null,
    ...overrides,
  };
}

before(async () => {
  ({ get } = await import('svelte/store'));
  ({ items, history, activeOperations, connected, isDemo } = await import('../src/svelte/lib/stores.js'));
  ({ createActionEventId, markItemRead, recordActionEvent, setItemLifecycle, setItemField } = await import('../src/svelte/lib/item-actions.js'));
  ({ runItemCheck, startMonitoringLoop, stopMonitoringLoop } = await import('../src/svelte/lib/monitor-engine.js'));
});

beforeEach(() => {
  items.set([]);
  history.set([]);
  activeOperations.set(new Map());
  connected.set(false);
  isDemo.set(false);
  globalThis.__mailboxTestSaveCalls = 0;
  globalThis.__mailboxTestSaveModes = [];
  globalThis.__mailboxTestMonitorPayload = null;
  globalThis.__mailboxTestRunWorkiqJson = null;
  globalThis.__mailboxTestOnMonitorCycleSaved = null;
  globalThis.__mailboxTestToasts = [];
  globalThis.window = {
    workiq: {
      showDesktopNotification(payload) {
        globalThis.__mailboxTestNotifications.push(payload);
        return Promise.resolve();
      },
    },
  };
  globalThis.__mailboxTestNotifications = [];
});

describe('shared item actions', () => {
  it('saves edited completion criteria to the current storage mode without trimming typed text', () => {
    const doneCriteria = 'Legal approves the renewal.\nBoth parties sign. ';
    for (const demoMode of [false, true]) {
      isDemo.set(demoMode);
      items.set([monitoredItem()]);
      setItemField('thread-1', 'doneCriteria', doneCriteria);
      assert.equal(get(items)[0].doneCriteria, doneCriteria);
      assert.equal(globalThis.__mailboxTestSaveModes.at(-1), demoMode);
    }
  });

  it('creates stable event ids that vary by canonical event and attempt', () => {
    const input = {
      proposalId: 'proposal-1',
      event: 'Succeeded',
      timestamp: '2026-08-31T12:00:00Z',
    };
    const eventId = createActionEventId(input);

    assert.equal(eventId, createActionEventId({ ...input, event: 'succeeded' }));
    assert.notEqual(eventId, createActionEventId({ ...input, event: 'failed' }));
    assert.notEqual(eventId, createActionEventId({ ...input, attempt: 1 }));
    assert.match(eventId, /^action:succeeded:[a-f0-9]{8}$/);
    assert.equal(createActionEventId({ ...input, timestamp: 'invalid' }), null);
  });

  it('marks only the requested item read and persists the update', () => {
    const target = monitoredItem({ isNew: true, hasNewUpdate: true, updateHistory: [{ kind: 'reply', seen: false }] });
    const other = monitoredItem({ id: 'thread-2', isNew: true, updateHistory: [{ kind: 'reply', seen: false }] });
    items.set([target, other]);

    assert.equal(markItemRead(target.id), true);
    assert.equal(markItemRead(target.id), false);

    const [updatedTarget, untouchedOther] = get(items);
    assert.equal(updatedTarget.isNew, false);
    assert.equal(updatedTarget.hasNewUpdate, false);
    assert.equal(updatedTarget.updateHistory[0].seen, true);
    assert.equal(untouchedOther, other);
    assert.equal(untouchedOther.isNew, true);
    assert.equal(globalThis.__mailboxTestSaveCalls, 1);
  });

  it('records one seen lifecycle entry and does not duplicate a repeated transition', () => {
    items.set([monitoredItem()]);

    assert.equal(setItemLifecycle('thread-1', 'complete'), true);
    assert.equal(setItemLifecycle('thread-1', 'complete'), false);

    const updated = get(items)[0];
    const lifecycleEntries = updated.updateHistory.filter((entry) => entry.kind === 'lifecycle');
    assert.equal(lifecycleEntries.length, 1);
    assert.equal(lifecycleEntries[0].seen, true);
    assert.equal(updated.monitorEnabled, false);
    assert.equal(updated.nextRunAt, null);
    assert.ok(updated.completedAt);
    assert.equal(globalThis.__mailboxTestSaveCalls, 1);
  });

  it('keeps manually edited work states consistent through reload normalization', async () => {
    const { normalizeItem } = await import('../src/svelte/lib/models/item.js');
    for (const [lifecycleStatus, status] of [
      ['blocked', 'Blocked'],
      ['waiting', 'Waiting'],
      ['in-progress', 'In Progress'],
    ]) {
      items.set([monitoredItem({ status: 'Complete', lifecycleStatus: 'complete' })]);
      setItemLifecycle('thread-1', lifecycleStatus);
      const updated = get(items)[0];
      assert.equal(updated.status, status);
      assert.equal(normalizeItem(JSON.parse(JSON.stringify(updated))).lifecycleStatus, lifecycleStatus);
      assert.equal(updated.updateHistory[0].status, 'Complete', 'History lost the previous observed status');
    }
  });

  it('records one sanitized action event in both ledgers with one persistence call', async () => {
    const source = monitoredItem();
    items.set([source]);

    assert.equal(await recordActionEvent({
      eventId: 'event-1',
      itemId: 'thread-1',
      proposalId: 'proposal-1',
      event: 'Succeeded',
      channel: 'outlook-draft',
      target: 'Sofia Martinez',
      outcome: 'succeeded',
      verification: 'runtime-backend-confirmed',
      code: 'draft_created',
      timestamp: '2026-08-31T12:00:00Z',
      summary: 'SECRET MESSAGE BODY',
      messageBody: 'SECRET MESSAGE BODY',
      backendEntityId: '2cf28567-7bd7-4a1a-9352-8985d24e9e83',
      rawError: 'token=secret',
      executionPayload: { body: 'SECRET MESSAGE BODY' },
    }), true);

    const updated = get(items)[0];
    const threadEvent = updated.updateHistory[0];
    const globalEvent = get(history)[0];
    assert.equal(threadEvent.kind, 'action');
    assert.equal(threadEvent.eventId, 'event-1');
    assert.equal(threadEvent.event, 'succeeded');
    assert.equal(threadEvent.summary, 'Action proposal succeeded');
    assert.equal(threadEvent.code, 'DRAFT_CREATED');
    assert.equal(threadEvent.seen, true);
    assert.equal(globalEvent.id, 'action_event-1');
    assert.equal(globalEvent.eventId, 'event-1');
    assert.equal(globalEvent.kind, 'action');
    assert.equal(globalEvent.payload.itemId, 'thread-1');
    assert.equal(globalEvent.payload.proposalId, 'proposal-1');
    assert.equal(globalEvent.payload.event, 'succeeded');
    assert.equal(globalThis.__mailboxTestSaveCalls, 1);

    const serialized = JSON.stringify({ threadEvent, globalEvent });
    assert.doesNotMatch(serialized, /SECRET|token=|backendEntityId|rawError|executionPayload|messageBody/);
  });

  it('is idempotent by eventId in both ledgers and rejects missing source items', async () => {
    items.set([monitoredItem()]);
    const event = {
      eventId: 'event-dedupe',
      itemId: 'thread-1',
      proposalId: 'proposal-1',
      event: 'approved',
      timestamp: '2026-08-31T12:00:00Z',
    };

    assert.equal(await recordActionEvent(event), true);
    assert.equal(await recordActionEvent(event), false);
    assert.equal(await recordActionEvent({ ...event, eventId: 'event-missing', itemId: 'missing' }), false);
    assert.equal(get(items)[0].updateHistory.filter((entry) => entry.eventId === 'event-dedupe').length, 1);
    assert.equal(get(history).filter((entry) => entry.eventId === 'event-dedupe').length, 1);
    assert.equal(get(history).some((entry) => entry.eventId === 'event-missing'), false);
    assert.equal(globalThis.__mailboxTestSaveCalls, 1);
  });

  it('preserves unrelated monitor history and untouched threads when adding action events', async () => {
    const monitorHistory = Array.from({ length: 20 }, (_, index) => ({
      kind: 'reply',
      timestamp: `2026-08-30T${String(index).padStart(2, '0')}:00:00Z`,
      summary: `Monitor update ${index}`,
      seen: true,
    }));
    const source = monitoredItem({ updateHistory: monitorHistory });
    const other = monitoredItem({ id: 'thread-2' });
    items.set([source, other]);

    await recordActionEvent({
      eventId: 'event-integrity',
      itemId: 'thread-1',
      proposalId: 'proposal-1',
      event: 'queued',
      timestamp: '2026-08-31T12:00:00Z',
    });

    const [updated, untouched] = get(items);
    assert.equal(updated.updateHistory.length, 21);
    assert.equal(updated.updateHistory.filter((entry) => entry.kind === 'reply').length, 20);
    assert.equal(updated.updateHistory[0].eventId, 'event-integrity');
    assert.equal(untouched, other);
  });

  it('preserves action audit entries when lifecycle history reaches its monitor cap', () => {
    const replies = Array.from({ length: 19 }, (_, index) => ({
      kind: 'reply',
      timestamp: `2026-08-30T${String(index).padStart(2, '0')}:00:00Z`,
      summary: `Monitor update ${index}`,
      seen: true,
    }));
    items.set([monitoredItem({
      updateHistory: [...replies, {
        kind: 'action',
        eventId: 'older-action',
        timestamp: '2026-08-29T12:00:00Z',
        event: 'approved',
        summary: 'Action proposal approved',
        seen: true,
      }],
    })]);

    setItemLifecycle('thread-1', 'complete');

    const updated = get(items)[0];
    assert.equal(updated.updateHistory.filter((entry) => entry.kind !== 'action').length, 20);
    assert.equal(updated.updateHistory.some((entry) => entry.eventId === 'older-action'), true);
  });
});

describe('monitor mailbox behavior', () => {
  it('adds one unseen reply and notifications for a meaningful accepted result', async () => {
    const item = monitoredItem();
    items.set([item]);
    globalThis.__mailboxTestMonitorPayload = matchingPayload({
      summary: 'A launch blocker was reported',
      reason: 'Needs immediate attention',
      status: 'Blocked',
      severity: 'Critical',
    });

    await runItemCheck(item);

    const updated = get(items)[0];
    assert.equal(updated.hasNewUpdate, true);
    assert.equal(updated.updateHistory.length, 2);
    assert.equal(updated.updateHistory[0].kind, 'reply');
    assert.equal(updated.updateHistory[0].seen, false);
    assert.equal(globalThis.__mailboxTestToasts.length, 1);
    assert.equal(globalThis.__mailboxTestNotifications.length, 1);
    assert.equal(get(activeOperations).size, 0);
  });

  it('reschedules a no-change result without timeline, unread, toast, or notification changes', async () => {
    const item = monitoredItem({
      doneCriteria: 'The launch owner approves the plan.',
      completionConfidence: 'medium',
      evidenceLinks: [{ label: 'Existing plan', type: 'doc', url: 'https://contoso.sharepoint.com/sites/launch/Documents/plan.docx' }],
    });
    items.set([item]);
    globalThis.__mailboxTestMonitorPayload = matchingPayload({
      hasNewInfo: false,
      doneCriteria: 'Do not overwrite this.',
      completionConfidence: 'high',
      evidenceLinks: [{ label: 'Do not add this', type: 'email', url: 'https://outlook.office.com/mail/deeplink/read/ignored' }],
    });

    await runItemCheck(item);

    const updated = get(items)[0];
    assert.equal(updated.updateHistory.length, 1);
    assert.equal(updated.hasNewUpdate, false);
    assert.equal(globalThis.__mailboxTestToasts.length, 0);
    assert.equal(globalThis.__mailboxTestNotifications.length, 0);
    assert.equal(updated.doneCriteria, 'The launch owner approves the plan.');
    assert.equal(updated.completionConfidence, 'medium');
    assert.deepEqual(updated.evidenceLinks, item.evidenceLinks);
    assert.ok(updated.lastRunAt);
    assert.ok(updated.nextRunAt);
  });

  it('deduplicates an accepted payload that matches the current observation', async () => {
    const item = monitoredItem();
    items.set([item]);
    globalThis.__mailboxTestMonitorPayload = matchingPayload();

    await runItemCheck(item);

    const updated = get(items)[0];
    assert.equal(updated.updateHistory.length, 1);
    assert.equal(updated.hasNewUpdate, false);
    assert.equal(globalThis.__mailboxTestToasts.length, 0);
    assert.equal(globalThis.__mailboxTestNotifications.length, 0);
  });

  it('persists curated evidence and completion metadata from a meaningful result', async () => {
    const item = monitoredItem({
      evidenceLinks: [{ label: 'Existing plan', type: 'doc', url: 'https://contoso.sharepoint.com/sites/launch/Documents/plan.docx' }],
      doneCriteria: 'The launch owner approves the plan.',
    });
    items.set([item]);
    globalThis.__mailboxTestMonitorPayload = matchingPayload({
      summary: 'The owner [approved the plan](https://outlook.office.com/mail/deeplink/read/approval).',
      reason: 'The explicit approval closes the task.',
      status: 'Complete',
      evidenceLinks: [{ label: 'Approval email', type: 'email', url: 'https://outlook.office.com/mail/deeplink/read/approval' }],
      doneCriteria: 'The launch owner explicitly approves the final plan.',
      completionConfidence: 'HIGH',
    });

    await runItemCheck(item);

    const updated = get(items)[0];
    assert.equal(updated.doneCriteria, 'The launch owner explicitly approves the final plan.');
    assert.equal(updated.completionConfidence, 'high');
    assert.equal(updated.lifecycleStatus, 'complete');
    assert.equal(updated.monitorEnabled, false);
    assert.deepEqual(updated.evidenceLinks.map(({ label, type, url }) => ({ label, type, url })), [{
      label: 'Approval email',
      type: 'email',
      url: 'https://outlook.office.com/mail/deeplink/read/approval',
    }]);
    assert.equal(updated.updateHistory[0].newLinks.length, 1);
  });

  it('re-marks a read thread unread when a later meaningful reply arrives', async () => {
    const item = monitoredItem({
      isNew: true,
      hasNewUpdate: true,
      updateHistory: [{ kind: 'reply', summary: 'Earlier reply', seen: false }],
    });
    items.set([item]);
    markItemRead(item.id);
    const readItem = get(items)[0];
    globalThis.__mailboxTestMonitorPayload = matchingPayload({
      summary: 'A later reply changed the plan',
    });

    await runItemCheck(readItem);

    const updated = get(items)[0];
    assert.equal(updated.hasNewUpdate, true);
    assert.equal(updated.updateHistory[0].kind, 'reply');
    assert.equal(updated.updateHistory[0].seen, false);
    assert.equal(updated.updateHistory[1].seen, true);
  });

  it('preserves action audit entries when a later monitor reply reaches its cap', async () => {
    const replies = Array.from({ length: 19 }, (_, index) => ({
      kind: 'reply',
      timestamp: `2026-08-30T${String(index).padStart(2, '0')}:00:00Z`,
      summary: `Monitor update ${index}`,
      seen: true,
    }));
    const item = monitoredItem({
      updateHistory: [...replies, {
        kind: 'action',
        eventId: 'older-action',
        timestamp: '2026-08-29T12:00:00Z',
        event: 'approved',
        summary: 'Action proposal approved',
        seen: true,
      }],
    });
    items.set([item]);
    globalThis.__mailboxTestMonitorPayload = matchingPayload({ summary: 'A later reply changed the plan' });

    await runItemCheck(item);

    const updated = get(items)[0];
    assert.equal(updated.updateHistory.filter((entry) => entry.kind !== 'action').length, 20);
    assert.equal(updated.updateHistory.some((entry) => entry.eventId === 'older-action'), true);
  });

  it('bounds concurrent due checks and continues the queue after one check rejects', { timeout: 5000 }, async () => {
    const dueItems = Array.from({ length: 7 }, (_, index) => monitoredItem({
      id: `thread-${index + 1}`,
      title: `Review launch plan ${index + 1}`,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    }));
    items.set(dueItems);
    connected.set(true);

    let startedCount = 0;
    let activeCount = 0;
    let maxActiveCount = 0;
    const initialChecks = [];
    const startedWaiters = new Map();
    let resolveInitialStarted;
    const initialStarted = new Promise((resolve) => {
      resolveInitialStarted = resolve;
    });
    let resolveCycleDone;
    const cycleDone = new Promise((resolve) => {
      resolveCycleDone = resolve;
    });

    const waitForStartedCount = (count) => {
      if (startedCount >= count) return Promise.resolve();
      return new Promise((resolve) => startedWaiters.set(count, resolve));
    };

    globalThis.__mailboxTestOnMonitorCycleSaved = resolveCycleDone;
    globalThis.__mailboxTestRunWorkiqJson = () => {
      const attempt = startedCount++;
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      for (const [count, resolve] of startedWaiters) {
        if (startedCount >= count) {
          startedWaiters.delete(count);
          resolve();
        }
      }
      if (startedCount === 5) resolveInitialStarted();

      if (attempt < 5) {
        let settled = false;
        const settle = (finish) => {
          if (settled) return;
          settled = true;
          activeCount -= 1;
          finish();
        };
        return new Promise((resolve, reject) => {
          initialChecks[attempt] = {
            resolve: () => settle(() => resolve(matchingPayload())),
            reject: () => settle(() => reject(new Error('simulated monitor failure'))),
          };
        });
      }

      return Promise.resolve(matchingPayload()).finally(() => {
        activeCount -= 1;
      });
    };

    try {
      startMonitoringLoop();
      await initialStarted;
      assert.equal(startedCount, 5);
      assert.equal(maxActiveCount, 5);

      initialChecks[0].reject();
      await waitForStartedCount(6);
      initialChecks.slice(1).forEach((check) => check.resolve());
      await cycleDone;

      assert.equal(startedCount, dueItems.length);
      assert.equal(maxActiveCount, 5);
      assert.ok(get(items).every((item) => item.lastRunAt));
      assert.equal(globalThis.__mailboxTestSaveCalls, 1);
    } finally {
      for (const check of initialChecks) check?.resolve();
      stopMonitoringLoop();
    }
  });

  it('manual item checks default to interactive metadata', async () => {
    const item = monitoredItem();
    items.set([item]);
    let options;
    globalThis.__mailboxTestRunWorkiqJson = (_prompt, _validator, _label, metadata) => {
      options = metadata;
      return matchingPayload();
    };
    await runItemCheck(item);
    assert.deepEqual(options, { priority: 'interactive', key: `item:${item.id}` });
  });

  it('same-item lease prevents duplicate manual checks while a request is pending', async () => {
    const item = monitoredItem();
    items.set([item]);
    let release;
    let calls = 0;
    globalThis.__mailboxTestRunWorkiqJson = () => {
      calls++;
      return new Promise((resolve) => { release = resolve; });
    };
    const first = runItemCheck(item);
    assert.deepEqual(await runItemCheck(item), { ok: false, code: 'BUSY' });
    assert.equal(calls, 1);
    release(matchingPayload());
    await first;
    assert.equal(get(activeOperations).size, 0);
  });

  it('deferred monitor workers revalidate deletion, enabled state, snooze, lifecycle and due time', { timeout: 5000 }, async () => {
    const due = Array.from({ length: 12 }, (_, index) => monitoredItem({
      id: `deferred-${index}`, nextRunAt: '2000-01-01T00:00:00.000Z',
    }));
    items.set(due);
    connected.set(true);
    const calls = [];
    const releases = [];
    let resolveStarted;
    const started = new Promise((resolve) => { resolveStarted = resolve; });
    const cycleDone = new Promise((resolve) => { globalThis.__mailboxTestOnMonitorCycleSaved = resolve; });
    globalThis.__mailboxTestRunWorkiqJson = (prompt, _validator, _label, options) => {
      calls.push({ prompt, options });
      if (calls.length === 5) resolveStarted();
      return new Promise((resolve) => releases.push(() => resolve(matchingPayload())));
    };
    try {
      startMonitoringLoop();
      await started;
      items.update((current) => current.filter((i) => i.id !== 'deferred-5').map((i) =>
        i.id === 'deferred-6' ? { ...i, monitorEnabled: false } :
        i.id === 'deferred-7' ? { ...i, snoozeUntil: '2099-01-01T00:00:00.000Z' } :
        i.id === 'deferred-8' ? { ...i, lifecycleStatus: 'complete' } :
        i.id === 'deferred-9' ? { ...i, lifecycleStatus: 'archived' } :
        i.id === 'deferred-10' ? { ...i, nextRunAt: '2099-01-01T00:00:00.000Z' } :
        i.id === 'deferred-11' ? { ...i, title: 'Latest deferred title' } : i));
      releases[0]();
      for (let attempt = 0; calls.length < 6 && attempt < 20; attempt++) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls.length, 6);
      assert.match(calls[5].prompt, /Latest deferred title/);
      assert.deepEqual(calls[5].options, { priority: 'background', key: 'item:deferred-11' });
      releases.slice(1).forEach((release) => release());
      await cycleDone;
      assert.equal(get(activeOperations).size, 0);
    } finally {
      releases.forEach((release) => release());
      stopMonitoringLoop();
    }
  });

  it('QUEUE_FULL leaves automatic monitor due without lastRunAt or failure history', { timeout: 5000 }, async () => {
    const item = monitoredItem({ nextRunAt: '2000-01-01T00:00:00.000Z', lastRunAt: '2000-01-01T00:00:00.000Z' });
    items.set([item]);
    connected.set(true);
    const cycleDone = new Promise((resolve) => { globalThis.__mailboxTestOnMonitorCycleSaved = resolve; });
    globalThis.__mailboxTestRunWorkiqJson = () => { throw Object.assign(new Error('Full'), { code: 'QUEUE_FULL' }); };
    try {
      startMonitoringLoop();
      await cycleDone;
      assert.equal(get(items)[0].lastRunAt, item.lastRunAt);
      assert.equal(get(items)[0].nextRunAt, item.nextRunAt);
      assert.equal(get(history).length, 0);
      assert.equal(get(activeOperations).size, 0);
    } finally { stopMonitoringLoop(); }
  });
});