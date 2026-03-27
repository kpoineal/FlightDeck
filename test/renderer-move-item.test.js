'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;
let saveCalls;

before(() => {
  saveCalls = [];
  ctx = createRendererContext({
    savePersistentState: () => { saveCalls.push(Date.now()); },
    addHistory: () => {},
    renderTrackingMode: () => {},
    state: { items: [], scanners: [] },
  });
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/scanner.js');
  loadFile(ctx, 'renderer/models/item.js');
});

/* ================================================================== */
/*  moveItemToScanner(itemId, targetScannerId)                        */
/* ================================================================== */
describe('moveItemToScanner()', () => {

  beforeEach(() => {
    saveCalls = [];
    ctx.state.items = [
      { id: 'item-1', title: 'Alpha', scannerId: null },
      { id: 'item-2', title: 'Beta', scannerId: 'scanner-A' },
      { id: 'item-3', title: 'Gamma', scannerId: 'scanner-A' },
    ];
    ctx.state.scanners = [
      { id: 'scanner-A', name: 'Scanner A', itemCount: 2, enabled: true },
      { id: 'scanner-B', name: 'Scanner B', itemCount: 0, enabled: true },
    ];
  });

  it('moves item from Radar to a Scanner', () => {
    const result = ctx.moveItemToScanner('item-1', 'scanner-B');
    assert.equal(result.scannerId, 'scanner-B');
  });

  it('moves item from Scanner to Radar (targetScannerId = null)', () => {
    const result = ctx.moveItemToScanner('item-2', null);
    assert.equal(result.scannerId, null);
  });

  it('moves item from Scanner A to Scanner B', () => {
    const result = ctx.moveItemToScanner('item-2', 'scanner-B');
    assert.equal(result.scannerId, 'scanner-B');
  });

  it('updates scanner itemCounts correctly', () => {
    ctx.moveItemToScanner('item-2', 'scanner-B');
    const srcScanner = ctx.state.scanners.find((s) => s.id === 'scanner-A');
    const dstScanner = ctx.state.scanners.find((s) => s.id === 'scanner-B');
    assert.equal(srcScanner.itemCount, 1);
    assert.equal(dstScanner.itemCount, 1);
  });

  it('does not crash when moving from Radar (no source scanner to decrement)', () => {
    // item-1 has scannerId === null (Radar) — no scanner to decrement
    const result = ctx.moveItemToScanner('item-1', 'scanner-A');
    assert.equal(result.scannerId, 'scanner-A');
    const scannerA = ctx.state.scanners.find((s) => s.id === 'scanner-A');
    assert.equal(scannerA.itemCount, 3); // was 2, incremented by 1
  });

  it('does not crash when moving to Radar (no target scanner to increment)', () => {
    // Moving item-2 from scanner-A to Radar (null) — no scanner to increment
    const result = ctx.moveItemToScanner('item-2', null);
    assert.equal(result.scannerId, null);
    const scannerA = ctx.state.scanners.find((s) => s.id === 'scanner-A');
    assert.equal(scannerA.itemCount, 1); // was 2, decremented by 1
  });

  it('returns null for non-existent item', () => {
    const result = ctx.moveItemToScanner('no-such-item', 'scanner-A');
    assert.equal(result, null);
  });

  it('calls savePersistentState after a successful move', () => {
    const before = saveCalls.length;
    ctx.moveItemToScanner('item-1', 'scanner-B');
    assert.equal(saveCalls.length, before + 1);
  });
});
