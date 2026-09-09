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

let deleteItem;
let deletedItemIds;
let get;
let isAcceptedPersistenceReceipt;
let items;
let loadPersistentState;
let MAX_ACTIVE_ITEMS;
let savePersistentState;
let coldState;
let coldWrites;
let storedState;
let storeSetReceipts;
let writes;

function card() {
  return {
    id: 'card-1',
    scannerId: 'scanner-1',
    title: 'Review launch plan',
    updateHistory: [],
  };
}

function persistedFixture(overrides = {}) {
  return {
    items: [card()],
    scanners: [{
      id: 'scanner-1',
      name: 'Radar',
      prompt: 'Find important work.',
      enabled: true,
      scheduleType: 'interval',
      scheduleValue: '4h',
    }],
    deletedItemIds: [],
    ...overrides,
  };
}

before(async () => {
  ({ get } = await import('svelte/store'));
  ({ deletedItemIds, items } = await import('../src/svelte/lib/stores.js'));
  ({ deleteItem } = await import('../src/svelte/lib/item-actions.js'));
  ({ MAX_ACTIVE_ITEMS } = await import('../src/svelte/lib/constants.js'));
  ({
    isAcceptedPersistenceReceipt,
    loadPersistentState,
    savePersistentState,
  } = await import('../src/svelte/lib/persistence.js'));
});

beforeEach(() => {
  coldState = [];
  coldWrites = [];
  storedState = persistedFixture();
  storeSetReceipts = [];
  writes = [];
  globalThis.window = {
    workiq: {
      storeGet: async () => structuredClone(storedState),
      storeSet: async (_key, payload) => {
        writes.push(structuredClone(payload));
        storedState = structuredClone(payload);
        return storeSetReceipts.length ? storeSetReceipts.shift() : { success: true };
      },
      storeDelete: async () => ({ success: true }),
      readPromptFile: async () => ({ success: false }),
      getColdItems: async () => structuredClone(coldState),
      setColdItems: async (entries) => {
        coldState = structuredClone(entries);
        coldWrites.push(structuredClone(entries));
        return { success: true };
      },
      broadcastStateChanged: () => {},
    },
  };
});

describe('permanent card deletion persistence boundary', () => {
  it('accepts exactly literal true and the established IPC success receipt', () => {
    const symbolExtra = { success: true, [Symbol('extra')]: true };
    const nonEnumerableExtra = { success: true };
    Object.defineProperty(nonEnumerableExtra, 'extra', { value: true });
    let accessorReads = 0;
    const accessorReceipt = {};
    Object.defineProperty(accessorReceipt, 'success', {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return true;
      },
    });
    const matrix = [
      [true, true],
      [{ success: true }, true],
      [false, false],
      [undefined, false],
      [null, false],
      [{}, false],
      [{ success: false }, false],
      [[], false],
      [[{ success: true }], false],
      [{ success: true, extra: true }, false],
      [symbolExtra, false],
      [nonEnumerableExtra, false],
      [accessorReceipt, false],
      [Object.assign(Object.create(null), { success: true }), false],
    ];

    for (const [receipt, expected] of matrix) {
      assert.equal(isAcceptedPersistenceReceipt(receipt), expected);
    }
    assert.equal(accessorReads, 0);
  });

  it('restores the card and removes its tombstone after an ambiguous primary and accepted rollback', async () => {
    await loadPersistentState();
    storeSetReceipts = [{}, { success: true }];

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(get(items).map((item) => item.id), ['card-1']);
    assert.deepEqual(get(deletedItemIds), []);
    assert.deepEqual(writes[0].deletedItemIds, ['card-1']);
    assert.deepEqual(writes[1].deletedItemIds, []);
    assert.deepEqual(storedState.deletedItemIds, []);
  });

  it('requires recovery after an ambiguous primary and ambiguous rollback', async () => {
    await loadPersistentState();
    storeSetReceipts = [{}, {}];

    const result = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' });
    assert.deepEqual(get(items).map((item) => item.id), ['card-1']);
    assert.deepEqual(get(deletedItemIds), []);
    assert.equal(writes.length, 2);
  });

  it('does not let deferred pre-delete hydration restore a deleted card or clear its tombstone', async () => {
    await loadPersistentState();
    const staleSnapshot = structuredClone(storedState);
    let resolveHydration;
    window.workiq.storeGet = () => new Promise((resolve) => { resolveHydration = resolve; });

    const hydration = loadPersistentState();
    const deletion = await deleteItem('card-1', { at: '2026-09-01T15:00:00Z' });
    resolveHydration(staleSnapshot);

    assert.equal(await hydration, false);
    assert.equal(deletion.ok, true);
    assert.deepEqual(get(items), []);
    assert.deepEqual(get(deletedItemIds), ['card-1']);
    assert.deepEqual(storedState.deletedItemIds, ['card-1']);
  });
});

describe('eviction convergence', () => {
  it('removes accepted age eviction from live and canonical state without repeating the cold write', async () => {
    await loadPersistentState();
    items.set([
      card(),
      {
        ...card(),
        id: 'age-evicted',
        title: 'Old archived work',
        lifecycleStatus: 'archived',
        lastChangedAt: '2000-01-01T00:00:00Z',
      },
    ]);
    writes = [];

    const firstSave = await savePersistentState();
    const secondSave = await savePersistentState();

    assert.deepEqual({
      firstSave,
      secondSave,
      liveIds: get(items).map((item) => item.id),
      canonicalIds: storedState.items.map((item) => item.id),
      coldIds: coldState.map((item) => item.id),
      coldWriteCount: coldWrites.length,
    }, {
      firstSave: true,
      secondSave: true,
      liveIds: ['card-1'],
      canonicalIds: ['card-1'],
      coldIds: ['age-evicted'],
      coldWriteCount: 1,
    });
  });

  it('removes accepted cap eviction from live and canonical state without repeating the cold write', async () => {
    await loadPersistentState();
    const activeItems = Array.from({ length: MAX_ACTIVE_ITEMS + 1 }, (_, index) => ({
      ...card(),
      id: `cap-${String(index).padStart(3, '0')}`,
      title: `Cap item ${index}`,
      lifecycleStatus: 'in-progress',
      discoveredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    items.set(activeItems);
    writes = [];

    const firstSave = await savePersistentState();
    const secondSave = await savePersistentState();

    assert.deepEqual({
      firstSave,
      secondSave,
      liveCount: get(items).length,
      canonicalCount: storedState.items.length,
      coldIds: coldState.map((item) => item.id),
      coldWriteCount: coldWrites.length,
    }, {
      firstSave: true,
      secondSave: true,
      liveCount: MAX_ACTIVE_ITEMS,
      canonicalCount: MAX_ACTIVE_ITEMS,
      coldIds: ['cap-000'],
      coldWriteCount: 1,
    });
  });
});