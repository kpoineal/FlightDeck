'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  export function pruneHistory() {}
  export function savePersistentState() {}
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
  export async function runPersistentStateTransaction({ mutate, rollback, persistExternal, rollbackExternal }) {
    mutate();
    if (persistExternal && await persistExternal() !== true) {
      rollback();
      if (!rollbackExternal || await rollbackExternal() !== true) {
        return { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' };
      }
      return { ok: false, code: 'PERSISTENCE_FAILED' };
    }
    globalThis.__itemDeleteWrites += 1;
    if (globalThis.__itemDeletePersist) {
      globalThis.__itemDeleteCapture?.();
      return { ok: true };
    }
    rollback();
    if (persistExternal && (!rollbackExternal || await rollbackExternal() !== true)) {
      return { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' };
    }
    globalThis.__itemDeleteWrites += 1;
    return { ok: false, code: 'PERSISTENCE_FAILED' };
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './persistence.js' && context.parentURL?.includes('/src/svelte/lib/')) {
      return { url: persistenceStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let get;
let actionProposals;
let coldItems;
let deletedItemIds;
let highlightedItemId;
let history;
let items;
let scanners;
let deleteItem;

function card(overrides = {}) {
  return {
    id: 'card-1',
    scannerId: 'scanner-1',
    title: 'Review launch plan',
    updateHistory: [],
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'proposal-1',
    sourceItemId: 'card-1',
    channel: 'outlook-draft',
    state: 'Drafted',
    dispatchStatus: 'not-started',
    executionVerification: null,
    executionCode: null,
    ...overrides,
  };
}

before(async () => {
  ({ get } = await import('svelte/store'));
  ({ actionProposals, coldItems, deletedItemIds, highlightedItemId, history, items, scanners } = await import('../src/svelte/lib/stores.js'));
  ({ deleteItem } = await import('../src/svelte/lib/item-actions.js'));
});

beforeEach(() => {
  items.set([]);
  coldItems.set([]);
  deletedItemIds.set([]);
  scanners.set([]);
  actionProposals.set([]);
  history.set([]);
  highlightedItemId.set(null);
  globalThis.__itemDeletePersist = true;
  globalThis.__itemDeleteWrites = 0;
  globalThis.__itemDeleteCapture = null;
  globalThis.__externalDeleteCalls = 0;
  globalThis.__coldWrites = [];
  globalThis.__coldWriteMode = 'success';
  globalThis.__coldConcurrentMutation = null;
  globalThis.window = {
    workiq: {
      deleteEmail() { globalThis.__externalDeleteCalls += 1; },
      deleteTeamsMessage() { globalThis.__externalDeleteCalls += 1; },
      setColdItems(entries) {
        globalThis.__coldWrites.push(structuredClone(entries));
        const mutation = globalThis.__coldConcurrentMutation;
        globalThis.__coldConcurrentMutation = null;
        mutation?.();
        if (globalThis.__coldWriteMode === 'throw') throw new Error('cold persistence failed');
        if (globalThis.__coldWriteMode === 'false') return false;
        if (globalThis.__coldWriteMode === 'ambiguous') return {};
        return { success: true };
      },
    },
  };
});

describe('permanent local card deletion', () => {
  it('persists removal, globally excludes the stable item id, and never deletes a source item', async () => {
    const target = card();
    const other = card({ id: 'card-2' });
    const noEffect = proposal();
    const uncertain = proposal({ id: 'proposal-2', state: 'Executing', dispatchStatus: 'dispatched' });
    items.set([target, other]);
    scanners.set([{ id: 'scanner-1', excludedItemIds: [] }]);
    actionProposals.set([noEffect, uncertain]);
    history.set([
      { id: 'admin-1', eventId: 'admin-1', payload: { proposalId: 'proposal-1', event: 'proposal-created' } },
      { id: 'effect-1', eventId: 'effect-1', payload: { proposalId: 'proposal-2', event: 'execution-started' } },
    ]);
    highlightedItemId.set('card-1');
    let persisted;
    globalThis.__itemDeleteCapture = () => {
      persisted = {
        items: get(items),
        deletedItemIds: get(deletedItemIds),
        proposals: get(actionProposals),
      };
    };

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, {
      ok: true,
      itemId: 'card-1',
      removedProposalCount: 1,
      preservedEffectCount: 1,
    });
    assert.deepEqual(get(items).map((item) => item.id), ['card-2']);
    assert.deepEqual(get(deletedItemIds), ['card-1']);
    assert.deepEqual(get(actionProposals).map((entry) => entry.id), ['proposal-2']);
    assert.equal(get(history).some((entry) => entry.id === 'admin-1'), false);
    assert.equal(get(history).some((entry) => entry.id === 'effect-1'), true);
    assert.equal(get(highlightedItemId), null);
    assert.equal(globalThis.__itemDeleteWrites, 1);
    assert.equal(globalThis.__externalDeleteCalls, 0);

    items.set(persisted.items);
    deletedItemIds.set(persisted.deletedItemIds);
    actionProposals.set(persisted.proposals);
    assert.equal(get(items).some((item) => item.id === 'card-1'), false);
    assert.deepEqual(get(deletedItemIds), ['card-1']);
  });

  it('rolls back without claiming success when persistence fails', async () => {
    const target = card();
    const noEffect = proposal();
    const originalHistory = [{ id: 'admin-1', eventId: 'admin-1', payload: { proposalId: 'proposal-1', event: 'proposal-created' } }];
    items.set([target]);
    scanners.set([{ id: 'scanner-1', excludedItemIds: [] }]);
    actionProposals.set([noEffect]);
    history.set(originalHistory);
    highlightedItemId.set('card-1');
    globalThis.__itemDeletePersist = false;

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(get(items), [target]);
    assert.deepEqual(get(deletedItemIds), []);
    assert.deepEqual(get(actionProposals), [noEffect]);
    assert.deepEqual(get(history), originalHistory);
    assert.equal(get(highlightedItemId), 'card-1');
    assert.equal(globalThis.__itemDeleteWrites, 2);
    assert.equal(globalThis.__externalDeleteCalls, 0);
  });

  it('does not persist or mutate when the stable id is missing', async () => {
    items.set([card()]);

    assert.deepEqual(await deleteItem('missing'), { ok: false, code: 'NOT_FOUND' });
    assert.deepEqual(get(items).map((item) => item.id), ['card-1']);
    assert.equal(globalThis.__itemDeleteWrites, 0);
  });

  it('removes and durably restores a matching cold-storage card on transaction failure', async () => {
    const target = card({ lifecycleStatus: 'archived' });
    coldItems.set([target]);
    scanners.set([{ id: 'scanner-1', excludedItemIds: [] }]);
    globalThis.__itemDeletePersist = false;

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(get(coldItems), [target]);
    assert.deepEqual(globalThis.__coldWrites, [[], [target]]);
    assert.deepEqual(get(deletedItemIds), []);
    assert.equal(globalThis.__externalDeleteCalls, 0);
  });

  for (const mode of ['throw', 'false', 'ambiguous']) {
    it(`fails closed when cold persistence returns ${mode}`, async () => {
      const target = card({ lifecycleStatus: 'archived' });
      coldItems.set([target]);
      globalThis.__coldWriteMode = mode;

      const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

      assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' });
      assert.deepEqual(get(coldItems), [target]);
      assert.equal(globalThis.__itemDeleteWrites, 0);
    });
  }

  it('fails closed before mutation when required cold persistence is unavailable', async () => {
    const target = card({ lifecycleStatus: 'archived' });
    coldItems.set([target]);
    delete window.workiq.setColdItems;

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(get(coldItems), [target]);
    assert.deepEqual(get(deletedItemIds), []);
    assert.equal(globalThis.__itemDeleteWrites, 0);
  });

  it('persists live concurrent changes to every store with one canonical write', async () => {
    const target = card({ lifecycleStatus: 'archived' });
    const existing = card({ id: 'cold-existing', lifecycleStatus: 'archived', title: 'Original title' });
    const concurrent = card({ id: 'cold-concurrent', lifecycleStatus: 'archived' });
    const hot = card({ id: 'hot-existing', title: 'Original hot title' });
    const proposalToKeep = proposal({ id: 'proposal-keep', sourceItemId: 'hot-existing' });
    const historyToKeep = { id: 'history-keep', payload: { itemId: 'hot-existing', event: 'queued' } };
    items.set([hot]);
    coldItems.set([target, existing]);
    actionProposals.set([proposalToKeep]);
    history.set([historyToKeep]);
    highlightedItemId.set('card-1');
    let persisted;
    globalThis.__itemDeleteCapture = () => {
      persisted = {
        items: structuredClone(get(items)),
        coldItems: structuredClone(get(coldItems)),
        proposals: structuredClone(get(actionProposals)),
        history: structuredClone(get(history)),
        deletedItemIds: structuredClone(get(deletedItemIds)),
        highlightedItemId: get(highlightedItemId),
      };
    };
    globalThis.__coldConcurrentMutation = () => {
      items.set([{ ...hot, title: 'Concurrent hot edit' }, card({ id: 'hot-concurrent' })]);
      coldItems.set([{ ...existing, title: 'Concurrent edit' }, concurrent]);
      actionProposals.set([{ ...proposalToKeep, state: 'AwaitingReview' }, proposal({ id: 'proposal-concurrent', sourceItemId: 'hot-concurrent' })]);
      history.set([{ ...historyToKeep, summary: 'Concurrent history edit' }, { id: 'history-concurrent' }]);
      deletedItemIds.update((ids) => [...ids, 'other-deleted-id']);
      highlightedItemId.set('hot-concurrent');
    };

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.equal(result.ok, true);
    assert.deepEqual(get(items).map((item) => item.title), ['Concurrent hot edit', 'Review launch plan']);
    assert.deepEqual(get(coldItems), [{ ...existing, title: 'Concurrent edit' }, concurrent]);
    assert.deepEqual(get(actionProposals).map((entry) => entry.id), ['proposal-keep', 'proposal-concurrent']);
    assert.deepEqual(get(history).map((entry) => entry.id), ['history-keep', 'history-concurrent']);
    assert.deepEqual(get(deletedItemIds), ['card-1', 'other-deleted-id']);
    assert.equal(get(highlightedItemId), 'hot-concurrent');
    assert.deepEqual(globalThis.__coldWrites, [
      [existing],
      [{ ...existing, title: 'Concurrent edit' }, concurrent],
    ]);
    assert.equal(globalThis.__itemDeleteWrites, 1);
    assert.deepEqual(persisted, {
      items: get(items),
      coldItems: get(coldItems),
      proposals: get(actionProposals),
      history: get(history),
      deletedItemIds: get(deletedItemIds),
      highlightedItemId: 'hot-concurrent',
    });
  });

  it('allows ordinary hot-only deletion without a cold persistence capability', async () => {
    items.set([card()]);
    delete window.workiq.setColdItems;

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.equal(result.ok, true);
    assert.deepEqual(get(items), []);
    assert.deepEqual(get(deletedItemIds), ['card-1']);
    assert.equal(globalThis.__itemDeleteWrites, 1);
  });

  it('rolls back only deletion-owned records while preserving concurrent store changes', async () => {
    const target = card({ lifecycleStatus: 'archived' });
    const hotKept = card({ id: 'hot-kept', title: 'Hot original' });
    const hotRemovedConcurrently = card({ id: 'hot-removed-concurrently' });
    const coldKept = card({ id: 'cold-kept', lifecycleStatus: 'archived', title: 'Cold original' });
    const coldRemovedConcurrently = card({ id: 'cold-removed-concurrently', lifecycleStatus: 'archived' });
    const deletedProposal = proposal();
    const keptProposal = proposal({ id: 'proposal-kept', sourceItemId: 'hot-kept' });
    const removedProposal = proposal({ id: 'proposal-removed-concurrently', sourceItemId: 'hot-kept' });
    const deletedAdmin = { id: 'admin-deleted', eventId: 'admin-deleted', payload: { proposalId: 'proposal-1', event: 'proposal-created' } };
    const keptHistory = { id: 'history-kept', eventId: 'history-kept', payload: { itemId: 'hot-kept', event: 'queued' } };
    const removedHistory = { id: 'history-removed-concurrently', eventId: 'history-removed-concurrently' };
    items.set([target, hotKept, hotRemovedConcurrently]);
    coldItems.set([target, coldKept, coldRemovedConcurrently]);
    actionProposals.set([deletedProposal, keptProposal, removedProposal]);
    history.set([deletedAdmin, keptHistory, removedHistory]);
    deletedItemIds.set(['preexisting-deleted']);
    highlightedItemId.set('card-1');
    globalThis.__itemDeletePersist = false;
    globalThis.__coldConcurrentMutation = () => {
      items.set([{ ...hotKept, title: 'Hot concurrent edit' }, card({ id: 'hot-added' })]);
      coldItems.set([{ ...coldKept, title: 'Cold concurrent edit' }, card({ id: 'cold-added', lifecycleStatus: 'archived' })]);
      actionProposals.set([{ ...keptProposal, state: 'AwaitingReview' }, proposal({ id: 'proposal-added', sourceItemId: 'hot-added' })]);
      history.set([{ ...keptHistory, summary: 'History concurrent edit' }, { id: 'history-added', eventId: 'history-added' }]);
      deletedItemIds.update((ids) => [...ids, 'concurrent-deleted']);
      highlightedItemId.set('hot-added');
    };

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(get(items).map((entry) => entry.id), ['card-1', 'hot-kept', 'hot-added']);
    assert.equal(get(items).find((entry) => entry.id === 'hot-kept').title, 'Hot concurrent edit');
    assert.deepEqual(get(coldItems).map((entry) => entry.id), ['card-1', 'cold-kept', 'cold-added']);
    assert.equal(get(coldItems).find((entry) => entry.id === 'cold-kept').title, 'Cold concurrent edit');
    assert.deepEqual(get(actionProposals).map((entry) => entry.id), ['proposal-1', 'proposal-kept', 'proposal-added']);
    assert.equal(get(actionProposals).find((entry) => entry.id === 'proposal-kept').state, 'AwaitingReview');
    assert.deepEqual(get(history).map((entry) => entry.id), ['admin-deleted', 'history-kept', 'history-added']);
    assert.equal(get(history).find((entry) => entry.id === 'history-kept').summary, 'History concurrent edit');
    assert.deepEqual(get(deletedItemIds), ['preexisting-deleted', 'concurrent-deleted']);
    assert.equal(get(highlightedItemId), 'hot-added');
    assert.equal(globalThis.__itemDeleteWrites, 2);
  });

  it('deletes a model-valid stable id containing slash and equals characters', async () => {
    const stableId = 'tenant/message/=42';
    items.set([card({ id: stableId, scannerId: null })]);

    const result = await deleteItem(`  ${stableId}  `, { at: '2026-09-01T15:00:00Z' });

    assert.equal(result.ok, true);
    assert.equal(result.itemId, stableId);
    assert.deepEqual(get(items), []);
    assert.deepEqual(get(deletedItemIds), [stableId]);
    assert.equal(globalThis.__itemDeleteWrites, 1);
  });
});