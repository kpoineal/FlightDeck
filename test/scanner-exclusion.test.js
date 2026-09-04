'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  export function pruneHistory() {}
  export function savePersistentState() {}
`)}`;
const jsonParserStub = `data:text/javascript,${encodeURIComponent(`
  export async function runWorkiqJson() {
    return new Promise((resolve) => { globalThis.__resolveScannerPayload = resolve; });
  }
`)}`;
const toastStub = `data:text/javascript,${encodeURIComponent(`
  export function showToast() {}
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './persistence.js' && context.parentURL?.includes('/src/svelte/lib/')) {
      return { url: persistenceStub, shortCircuit: true };
    }
    if (specifier === './json-parser.js' && context.parentURL?.endsWith('/src/svelte/lib/scanner-engine.js')) {
      return { url: jsonParserStub, shortCircuit: true };
    }
    if (specifier === '../components/Toast.svelte' && context.parentURL?.endsWith('/src/svelte/lib/scanner-engine.js')) {
      return { url: toastStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test('an in-flight result from another scanner cannot restore a globally deleted stable item id', async () => {
  const { get } = await import('svelte/store');
  const { activeOperations, deletedItemIds, items, scanners } = await import('../src/svelte/lib/stores.js');
  const { runScanner } = await import('../src/svelte/lib/scanner-engine.js');
  const scanner = {
    id: 'scanner-1',
    name: 'Inbox scanner',
    enabled: true,
    scheduleType: 'interval',
    scheduleValue: '4h',
    maxItemsPerScan: 10,
    recentTitles: [],
    excludedItemIds: [],
  };
  globalThis.window = { workiq: { showDesktopNotification: async () => {} } };
  globalThis.__resolveScannerPayload = null;
  items.set([]);
  scanners.set([scanner]);
  deletedItemIds.set([]);

  const scan = runScanner(scanner);
  while (!globalThis.__resolveScannerPayload) await new Promise((resolve) => setImmediate(resolve));
  scanners.set([{ ...scanner }, { ...scanner, id: 'scanner-2', excludedItemIds: [] }]);
  deletedItemIds.set(['card-1']);
  globalThis.__resolveScannerPayload({
    radarItems: [{ id: 'card-1', title: 'Deleted source signal', summary: 'Stale scan result' }],
  });
  await scan;

  assert.equal(get(items).some((item) => item.id === 'card-1'), false);
  assert.deepEqual(get(deletedItemIds), ['card-1']);
  assert.equal(get(activeOperations).size, 0);
});

test('a scannerless global deletion excludes only the exact canonical id', async () => {
  const { get } = await import('svelte/store');
  const { deletedItemIds, items, scanners } = await import('../src/svelte/lib/stores.js');
  const { runScanner } = await import('../src/svelte/lib/scanner-engine.js');
  const scanner = {
    id: 'scanner-1',
    name: 'Inbox scanner',
    maxItemsPerScan: 10,
    recentTitles: [],
    excludedItemIds: [],
  };
  items.set([]);
  scanners.set([scanner]);
  deletedItemIds.set(['tenant/message/=42']);

  const scan = runScanner(scanner);
  while (!globalThis.__resolveScannerPayload) await new Promise((resolve) => setImmediate(resolve));
  globalThis.__resolveScannerPayload({ radarItems: [
    { id: 'tenant/message/=42', title: 'Deleted source signal' },
    { id: 'tenant/message/=43', title: 'Actually new source signal' },
  ] });
  await scan;

  assert.deepEqual(get(items).map((item) => item.id), ['tenant/message/=43']);
});

test('a deleted id does not suppress a later distinct id with the same title', async () => {
  const { get } = await import('svelte/store');
  const { deletedItemIds, items, scanners } = await import('../src/svelte/lib/stores.js');
  const { runScanner } = await import('../src/svelte/lib/scanner-engine.js');
  const scanner = {
    id: 'scanner-1',
    name: 'Inbox scanner',
    maxItemsPerScan: 10,
    recentTitles: [],
    excludedItemIds: [],
  };
  items.set([]);
  scanners.set([scanner]);
  deletedItemIds.set(['deleted-id']);

  let scan = runScanner(scanner);
  while (!globalThis.__resolveScannerPayload) await new Promise((resolve) => setImmediate(resolve));
  globalThis.__resolveScannerPayload({ radarItems: [{ id: 'deleted-id', title: 'Shared title' }] });
  await scan;

  globalThis.__resolveScannerPayload = null;
  scan = runScanner(get(scanners)[0]);
  while (!globalThis.__resolveScannerPayload) await new Promise((resolve) => setImmediate(resolve));
  globalThis.__resolveScannerPayload({ radarItems: [{ id: 'new-id', title: 'Shared title' }] });
  await scan;

  assert.deepEqual(get(items).map((item) => item.id), ['new-id']);
});

test('cold hydration preserves concurrent entries while excluding exact deleted ids', async () => {
  const { reconcileHydratedItems } = await import('../src/svelte/lib/models/item.js');
  const current = [
    { id: 'edited-id', title: 'Concurrent edit' },
    { id: 'concurrent-id', title: 'Concurrent addition' },
  ];
  const hydrated = [
    { id: 'deleted-id', title: 'Stale deleted card' },
    { id: 'edited-id', title: 'Stale title' },
    { id: 'hydrated-id', title: 'Hydrated card' },
  ];

  assert.deepEqual(reconcileHydratedItems(current, hydrated, ['deleted-id']), [
    { id: 'edited-id', title: 'Concurrent edit' },
    { id: 'hydrated-id', title: 'Hydrated card' },
    { id: 'concurrent-id', title: 'Concurrent addition' },
  ]);
});