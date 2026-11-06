import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

import { coldItems, collapsedSections, deletedItemIds, filter, highlightedItemId, items, mode, scanners } from '../src/svelte/lib/stores.js';
import { hydrateRadarColdItems, navigateToRadarItem, resolveRadarItem } from '../src/svelte/lib/radar-navigation.js';

function resetState() {
  items.set([]);
  coldItems.set([]);
  deletedItemIds.set([]);
  scanners.set([{ id: 'scanner-1' }, { id: 'scanner-2' }]);
  collapsedSections.set(['scanner-scanner-1', 'scanner-scanner-2']);
  filter.set('priority');
  mode.set('Today');
  highlightedItemId.set(null);
}

test.beforeEach(() => {
  resetState();
  globalThis.window = { workiq: {} };
});

test('navigates to a hot item through the shared external entry point', async () => {
  const target = { id: 'hot-1', title: 'Hot item', scannerId: 'scanner-1' };
  items.set([target]);

  assert.equal(await navigateToRadarItem(target.id), true);
  assert.equal(get(mode), 'Radar');
  assert.equal(get(filter), 'all');
  assert.equal(get(highlightedItemId), target.id);
  assert.deepEqual(get(collapsedSections), ['scanner-scanner-2']);
});

test('waits for delayed cold hydration, reconciles it, and leaves hot items unchanged', async () => {
  const hot = { id: 'hot-1', title: 'Hot item' };
  const cold = { id: 'cold-1', title: 'Cold item', lifecycleStatus: 'archived' };
  let resolveCold;
  let reads = 0;
  items.set([hot]);
  window.workiq.getColdItems = () => {
    reads += 1;
    return new Promise((resolve) => { resolveCold = resolve; });
  };

  const pending = navigateToRadarItem(cold.id);
  await Promise.resolve();
  assert.equal(get(mode), 'Today');
  assert.equal(get(highlightedItemId), null);
  resolveCold([cold]);

  assert.equal(await pending, true);
  assert.equal(reads, 1);
  assert.deepEqual(get(items), [hot]);
  assert.deepEqual(get(coldItems), [cold]);
  assert.equal(get(mode), 'Radar');
  assert.equal(get(highlightedItemId), cold.id);
});

test('deduplicates concurrent cold hydration and resolves both callers', async () => {
  const cold = { id: 'cold-1', title: 'Cold item', lifecycleStatus: 'complete' };
  let resolveCold;
  let reads = 0;
  window.workiq.getColdItems = () => {
    reads += 1;
    return new Promise((resolve) => { resolveCold = resolve; });
  };

  const first = resolveRadarItem(cold.id);
  const second = resolveRadarItem(cold.id);
  await Promise.resolve();
  resolveCold([cold]);

  assert.deepEqual(await Promise.all([first, second]), [cold, cold]);
  assert.equal(reads, 1);
});

test('ignores an out-of-order cold navigation after a newer hot navigation', async () => {
  const cold = { id: 'cold-stale', title: 'Stale cold item', lifecycleStatus: 'archived' };
  const hot = { id: 'hot-current', title: 'Current hot item', scannerId: 'scanner-2' };
  let resolveCold;
  items.set([hot]);
  window.workiq.getColdItems = () => new Promise((resolve) => { resolveCold = resolve; });

  const staleNavigation = navigateToRadarItem(cold.id);
  await Promise.resolve();
  assert.equal(await navigateToRadarItem(hot.id), true);
  assert.equal(get(highlightedItemId), hot.id);

  resolveCold([cold]);
  assert.equal(await staleNavigation, false);
  assert.equal(get(mode), 'Radar');
  assert.equal(get(highlightedItemId), hot.id);
});

test('does not publish a cold navigation when the item is deleted during hydration', async () => {
  const cold = { id: 'cold-deleted-during-hydration', title: 'Deleted cold item', lifecycleStatus: 'archived' };
  let resolveCold;
  window.workiq.getColdItems = () => new Promise((resolve) => { resolveCold = resolve; });

  const pending = navigateToRadarItem(cold.id);
  await Promise.resolve();
  deletedItemIds.set([cold.id]);
  resolveCold([cold]);

  assert.equal(await pending, false);
  assert.equal(get(mode), 'Today');
  assert.equal(get(highlightedItemId), null);
  assert.deepEqual(get(coldItems), []);
});

test('deduplicates cold hydration shared by navigation and Radar view hydration', async () => {
  const cold = { id: 'cold-shared', title: 'Shared cold item', lifecycleStatus: 'archived' };
  let resolveCold;
  let reads = 0;
  window.workiq.getColdItems = () => {
    reads += 1;
    return new Promise((resolve) => { resolveCold = resolve; });
  };

  const hydration = hydrateRadarColdItems();
  const navigation = navigateToRadarItem(cold.id);
  await Promise.resolve();
  resolveCold([cold]);

  assert.deepEqual(await hydration, [cold]);
  assert.equal(await navigation, true);
  assert.equal(reads, 1);
});

test('keeps the current selection when an unavailable cold ID is requested', async () => {
  const current = { id: 'current-hot', title: 'Current item', scannerId: 'scanner-1' };
  items.set([current]);
  mode.set('Radar');
  highlightedItemId.set(current.id);
  window.workiq.getColdItems = async () => [];

  assert.equal(await navigateToRadarItem('unavailable-cold'), false);
  assert.equal(get(mode), 'Radar');
  assert.equal(get(highlightedItemId), current.id);
});

test('does not navigate to a deleted or unavailable cold item', async () => {
  const deleted = { id: 'deleted-cold', title: 'Deleted', lifecycleStatus: 'archived' };
  deletedItemIds.set([deleted.id]);
  window.workiq.getColdItems = async () => [deleted];

  assert.equal(await navigateToRadarItem(deleted.id), false);
  assert.equal(get(mode), 'Today');
  assert.equal(get(highlightedItemId), null);
  assert.deepEqual(get(coldItems), []);
  assert.equal(await navigateToRadarItem('missing'), false);
});

test('shares concurrent repository detail reads before a caller marks the thread read', async () => {
  const partial = { id: 'unread', isNew: true, historyPartial: true, updateHistory: [] };
  const detail = { id: partial.id, isNew: true, updateHistory: [{ seen: false }] };
  items.set([partial]);
  let release;
  let reads = 0;
  window.workiq.stateQuery = () => {
    reads++;
    return new Promise(resolve => { release = resolve; });
  };
  const selection = resolveRadarItem(partial.id);
  const effect = resolveRadarItem(partial.id);
  assert.equal(reads, 1);
  release(detail);
  assert.deepEqual(await Promise.all([selection, effect]), [detail, detail]);
  items.update(rows => rows.map(row => ({ ...row, isNew: false, updateHistory: [{ seen: true }] })));
  assert.equal((await resolveRadarItem(partial.id)).isNew, false);
  assert.equal(reads, 1, 'No late duplicate fetch may restore the unread snapshot');
});

test('repository detail hydration preserves edits made while the read is pending', async () => {
  const partial = { id: 'edited', title: 'Before', historyPartial: true };
  items.set([partial]);
  let release;
  window.workiq.stateQuery = () => new Promise(resolve => { release = resolve; });
  const pending = resolveRadarItem(partial.id);
  const edited = { ...partial, title: 'Local edit' };
  items.set([edited]);
  release({ id: partial.id, title: 'Server detail', updateHistory: [] });
  assert.equal(await pending, edited);
  assert.equal(get(items)[0], edited);
});

test('repository detail hydration cannot restore a thread deleted while the read is pending', async () => {
  items.set([{ id: 'deleted', historyPartial: true }]);
  let release;
  window.workiq.stateQuery = () => new Promise(resolve => { release = resolve; });
  const pending = resolveRadarItem('deleted');
  deletedItemIds.set(['deleted']);
  items.set([]);
  release({ id: 'deleted', updateHistory: [] });
  assert.equal(await pending, null);
  assert.deepEqual(get(items), []);
  assert.deepEqual(get(coldItems), []);
});

test('a failed shared repository detail read is cleared so selecting again retries', async () => {
  items.set([{ id: 'retry', historyPartial: true }]);
  let reject;
  window.workiq.stateQuery = () => new Promise((_resolve, fail) => { reject = fail; });
  const first = resolveRadarItem('retry');
  const second = resolveRadarItem('retry');
  const rejected = assert.rejects(first, /offline/);
  const alsoRejected = assert.rejects(second, /offline/);
  reject(new Error('offline'));
  await Promise.all([rejected, alsoRejected]);
  const detail = { id: 'retry', updateHistory: [] };
  window.workiq.stateQuery = async () => detail;
  assert.equal(await resolveRadarItem('retry'), detail);
});