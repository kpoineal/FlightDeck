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
/*  deleteScanner(id)                                                 */
/* ================================================================== */
describe('deleteScanner()', () => {

  beforeEach(() => {
    saveCalls = [];
    ctx.state.scanners = [
      { id: 'radar', name: 'Radar', enabled: true, itemCount: 1 },
      { id: 'scanner-A', name: 'Scanner A', enabled: true, itemCount: 4 },
      { id: 'scanner-B', name: 'Scanner B', enabled: true, itemCount: 1 },
    ];
    ctx.state.items = [
      { id: 'i1', title: 'Active item', scannerId: 'scanner-A', lifecycleStatus: 'in-progress' },
      { id: 'i2', title: 'Blocked item', scannerId: 'scanner-A', lifecycleStatus: 'blocked' },
      { id: 'i3', title: 'Completed item', scannerId: 'scanner-A', lifecycleStatus: 'complete' },
      { id: 'i4', title: 'Archived item', scannerId: 'scanner-A', lifecycleStatus: 'archived' },
      { id: 'i5', title: 'Other scanner item', scannerId: 'scanner-B', lifecycleStatus: 'in-progress' },
      { id: 'i6', title: 'Radar item', scannerId: 'radar', lifecycleStatus: 'in-progress' },
    ];
  });

  it('removes the scanner from the list', () => {
    ctx.deleteScanner('scanner-A');
    assert.ok(!ctx.state.scanners.find((s) => s.id === 'scanner-A'));
    assert.equal(ctx.state.scanners.length, 2);
  });

  it('removes active items (in-progress, blocked, waiting)', () => {
    ctx.deleteScanner('scanner-A');
    const ids = ctx.state.items.map((i) => i.id);
    assert.ok(!ids.includes('i1'), 'in-progress item should be removed');
    assert.ok(!ids.includes('i2'), 'blocked item should be removed');
  });

  it('retains completed items and nulls their scannerId', () => {
    ctx.deleteScanner('scanner-A');
    const completed = ctx.state.items.find((i) => i.id === 'i3');
    assert.ok(completed, 'completed item should be retained');
    assert.equal(completed.scannerId, null, 'scannerId should be nulled');
  });

  it('retains archived items and nulls their scannerId', () => {
    ctx.deleteScanner('scanner-A');
    const archived = ctx.state.items.find((i) => i.id === 'i4');
    assert.ok(archived, 'archived item should be retained');
    assert.equal(archived.scannerId, null, 'scannerId should be nulled');
  });

  it('does not touch items from other scanners', () => {
    ctx.deleteScanner('scanner-A');
    const other = ctx.state.items.find((i) => i.id === 'i5');
    assert.ok(other);
    assert.equal(other.scannerId, 'scanner-B');
  });

  it('removes items with no lifecycleStatus (inbox/untracked)', () => {
    ctx.state.items.push({ id: 'i7', title: 'No status', scannerId: 'scanner-A' });
    ctx.deleteScanner('scanner-A');
    assert.ok(!ctx.state.items.find((i) => i.id === 'i7'), 'item with no status should be removed');
  });

  it('removes waiting items', () => {
    ctx.state.items.push({ id: 'i8', title: 'Waiting item', scannerId: 'scanner-A', lifecycleStatus: 'waiting' });
    ctx.deleteScanner('scanner-A');
    assert.ok(!ctx.state.items.find((i) => i.id === 'i8'), 'waiting item should be removed');
  });

  it('deletes ANY scanner including one that was formerly the default (DEC-063)', () => {
    const result = ctx.deleteScanner('radar');
    assert.equal(result, true);
    assert.ok(!ctx.state.scanners.find((s) => s.id === 'radar'));
    assert.equal(ctx.state.scanners.length, 2);
    // Active radar items removed, completed/archived retained with null scannerId
    assert.ok(!ctx.state.items.find((i) => i.id === 'i6'));
  });

  it('returns false for a non-existent scanner', () => {
    const result = ctx.deleteScanner('no-such-scanner');
    assert.equal(result, false);
  });

  it('calls savePersistentState on successful delete', () => {
    const before = saveCalls.length;
    ctx.deleteScanner('scanner-A');
    assert.equal(saveCalls.length, before + 1);
  });

  it('does not call savePersistentState when delete is rejected', () => {
    const before = saveCalls.length;
    ctx.deleteScanner('no-such-scanner');
    assert.equal(saveCalls.length, before);
  });

  it('syncs radarItems and trackingItems with items', () => {
    ctx.deleteScanner('scanner-A');
    assert.deepEqual(ctx.state.radarItems, ctx.state.items);
    assert.deepEqual(ctx.state.trackingItems, ctx.state.items);
  });
});

/* ================================================================== */
/*  updateScanner(id, updates) — isDefault no longer protected        */
/* ================================================================== */
describe('updateScanner() — unified scanner model (DEC-063)', () => {

  beforeEach(() => {
    saveCalls = [];
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 'scanner-1', name: 'My Scanner', enabled: true }),
    ];
  });

  it('allows updating any field except id', () => {
    const result = ctx.updateScanner('scanner-1', { name: 'Renamed' });
    assert.ok(result);
    assert.equal(result.name, 'Renamed');
  });

  it('does not allow updating id', () => {
    ctx.updateScanner('scanner-1', { id: 'hacked' });
    assert.equal(ctx.state.scanners[0].id, 'scanner-1');
  });

  it('returns null for non-existent scanner', () => {
    const result = ctx.updateScanner('no-such', { name: 'X' });
    assert.equal(result, null);
  });

  it('persists after update', () => {
    ctx.updateScanner('scanner-1', { name: 'Updated' });
    assert.equal(saveCalls.length, 1);
  });
});
