'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
it('reports exact retained source owners, hot precedence, tombstones and directional scanner policy without mutation', async () => {
  const { findSourceCollisions } = await import('../src/shared/source-collisions.mjs');
  const { collectItemSourceIdentities } = await import('../src/svelte/lib/models/item.js');
  const source = { sourceType: 'email', sourceProvider: 'outlook', sourceId: 'message-1' };
  const input = {
    hot: [{ id: 'one', scannerId: 'a', ...source }, { id: 'two', scannerId: 'b', ...source },
      { id: 'different-source', title: 'Same title', ...source, sourceId: 'other' }],
    cold: [{ id: 'one', scannerId: 'wrong', ...source }, { id: 'three', scannerId: 'a', ...source },
      { id: 'deleted', ...source }],
    scanners: [{ id: 'a', crossScannerDedup: true }, { id: 'b', crossScannerDedup: false }],
    deletedItemIds: ['deleted'],
  };
  const before = structuredClone(input);
  const report = findSourceCollisions(input, collectItemSourceIdentities);
  assert.equal(report.length, 1);
  assert.equal(report[0].owners.length, 3);
  assert.equal(report[0].owners.find(entry => entry.threadId === 'one').tier, 'hot');
  assert.equal(report[0].sameScannerCollision, true);
  assert.equal(report[0].allowsCrossScannerDuplicate, true);
  assert.deepEqual(input, before);
});
