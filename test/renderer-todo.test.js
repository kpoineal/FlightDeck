'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext({
    savePersistentState: () => {},
    renderTrackingMode: () => {},
    state: { trackingItems: [], trackingFilter: 'active' },
  });
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/tracking.js');
  loadFile(ctx, 'renderer/renderers/tracking.js');
  // Re-stub renderTrackingMode — the renderer file defines its own that needs
  // globals (sortBySeverity, elements) we don't load in this test suite.
  ctx.renderTrackingMode = () => {};
});

/* ================================================================== */
/*  normalizeTrackingItem — ToDo fields                               */
/* ================================================================== */
describe('normalizeTrackingItem() — ToDo fields', () => {
  it('archived defaults to false when not set', () => {
    const result = ctx.normalizeTrackingItem({ title: 'Test' });
    assert.equal(result.archived, false);
  });

  it('archived is true when item.archived === true', () => {
    const result = ctx.normalizeTrackingItem({ title: 'Test', archived: true });
    assert.equal(result.archived, true);
  });

  it('archived is true when item.completed === true (migration)', () => {
    const result = ctx.normalizeTrackingItem({ title: 'Test', completed: true });
    assert.equal(result.archived, true);
  });

  it('archivedAt defaults to null', () => {
    const result = ctx.normalizeTrackingItem({ title: 'Test' });
    assert.equal(result.archivedAt, null);
  });

  it('archivedAt is preserved when present', () => {
    const ts = '2026-03-15T10:00:00.000Z';
    const result = ctx.normalizeTrackingItem({ title: 'Test', archivedAt: ts });
    assert.equal(result.archivedAt, ts);
  });

  it('archivedAt falls back to completedAt for migration', () => {
    const ts = '2026-03-15T10:00:00.000Z';
    const result = ctx.normalizeTrackingItem({ title: 'Test', completedAt: ts });
    assert.equal(result.archivedAt, ts);
  });
});

/* ================================================================== */
/*  archiveTrackingItem                                               */
/* ================================================================== */
describe('archiveTrackingItem()', () => {
  beforeEach(() => {
    ctx.state.trackingItems = [
      { id: 'item-1', title: 'Task A', archived: false, archivedAt: null, severity: 'Observe', summary: 'Summary A', updateHistory: [] },
    ];
  });

  it('sets archived to true', () => {
    ctx.archiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.equal(item.archived, true);
  });

  it('sets archivedAt to a valid ISO timestamp', () => {
    ctx.archiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.ok(item.archivedAt);
    assert.ok(!isNaN(new Date(item.archivedAt).getTime()));
  });

  it('adds "Archived" entry to updateHistory', () => {
    ctx.archiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.ok(item.updateHistory.length >= 1);
    const entry = item.updateHistory[0];
    assert.equal(entry.changes.length, 1);
    assert.equal(entry.changes[0], 'Archived');
    assert.equal(entry.status, 'Archived');
  });

  it('does nothing if item id not found', () => {
    ctx.archiveTrackingItem('nonexistent');
    const item = ctx.state.trackingItems[0];
    assert.equal(item.archived, false);
  });
});

/* ================================================================== */
/*  unarchiveTrackingItem                                             */
/* ================================================================== */
describe('unarchiveTrackingItem()', () => {
  beforeEach(() => {
    ctx.state.trackingItems = [
      { id: 'item-1', title: 'Task A', archived: true, archivedAt: '2026-03-15T10:00:00.000Z', severity: 'Observe', summary: 'Summary A', status: 'Tracked', updateHistory: [] },
    ];
  });

  it('sets archived to false', () => {
    ctx.unarchiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.equal(item.archived, false);
  });

  it('clears archivedAt', () => {
    ctx.unarchiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.equal(item.archivedAt, null);
  });

  it('adds "Unarchived" entry to updateHistory', () => {
    ctx.unarchiveTrackingItem('item-1');
    const item = ctx.state.trackingItems[0];
    assert.ok(item.updateHistory.length >= 1);
    const entry = item.updateHistory[0];
    assert.equal(entry.changes.length, 1);
    assert.equal(entry.changes[0], 'Unarchived');
  });
});

/* ================================================================== */
/*  filterTrackingItems                                               */
/* ================================================================== */
describe('filterTrackingItems()', () => {
  const items = [
    { id: '1', archived: false, dueAt: null },
    { id: '2', archived: true, dueAt: null },
    { id: '3', archived: false, dueAt: new Date().toISOString() }, // due today
    { id: '4', archived: false, dueAt: '2020-01-01T00:00:00.000Z' }, // overdue
    { id: '5', archived: true, dueAt: new Date().toISOString() }, // archived + due today
  ];

  it("'active' filter excludes archived items", () => {
    const result = ctx.filterTrackingItems(items, 'active');
    assert.ok(result.every((item) => !item.archived));
    assert.equal(result.length, 3);
  });

  it("'archived' filter only shows archived items", () => {
    const result = ctx.filterTrackingItems(items, 'archived');
    assert.ok(result.every((item) => item.archived === true));
    assert.equal(result.length, 2);
  });

  it("'dueToday' filter shows items due today and overdue (not archived)", () => {
    const result = ctx.filterTrackingItems(items, 'dueToday');
    // item 3 (due today, active), item 4 (overdue, active) — not item 5 (archived)
    assert.equal(result.length, 2);
    assert.ok(result.some((item) => item.id === '3'));
    assert.ok(result.some((item) => item.id === '4'));
  });

  it("'all' filter shows everything", () => {
    const result = ctx.filterTrackingItems(items, 'all');
    assert.equal(result.length, items.length);
  });
});

/* ================================================================== */
/*  isDueToday / isDueOverdue / isDueTodayOrOverdue                   */
/* ================================================================== */
describe('isDueToday()', () => {
  it('returns true for items due today', () => {
    const today = new Date();
    today.setHours(14, 0, 0, 0);
    assert.equal(ctx.isDueToday({ dueAt: today.toISOString(), archived: false }), true);
  });

  it('returns false for archived items', () => {
    const today = new Date();
    today.setHours(14, 0, 0, 0);
    assert.equal(ctx.isDueToday({ dueAt: today.toISOString(), archived: true }), false);
  });

  it('returns false for items with no dueAt', () => {
    assert.equal(ctx.isDueToday({ dueAt: null, archived: false }), false);
  });
});

describe('isDueOverdue()', () => {
  it('returns true for items with past dueAt', () => {
    assert.equal(ctx.isDueOverdue({ dueAt: '2020-01-01T00:00:00.000Z', archived: false }), true);
  });

  it('returns false for archived items', () => {
    assert.equal(ctx.isDueOverdue({ dueAt: '2020-01-01T00:00:00.000Z', archived: true }), false);
  });

  it('returns false for items with no dueAt', () => {
    assert.equal(ctx.isDueOverdue({ dueAt: null, archived: false }), false);
  });
});

describe('isDueTodayOrOverdue()', () => {
  it('returns true for items due today', () => {
    const today = new Date();
    today.setHours(14, 0, 0, 0);
    assert.equal(ctx.isDueTodayOrOverdue({ dueAt: today.toISOString(), archived: false }), true);
  });

  it('returns true for overdue items', () => {
    assert.equal(ctx.isDueTodayOrOverdue({ dueAt: '2020-01-01T00:00:00.000Z', archived: false }), true);
  });

  it('returns false for archived items', () => {
    assert.equal(ctx.isDueTodayOrOverdue({ dueAt: '2020-01-01T00:00:00.000Z', archived: true }), false);
  });

  it('returns false for items with no dueAt', () => {
    assert.equal(ctx.isDueTodayOrOverdue({ dueAt: null, archived: false }), false);
  });
});

/* ================================================================== */
/*  buildSubtaskProgressHtml                                          */
/* ================================================================== */
describe('buildDueDateClasses()', () => {
  it("returns 'due-overdue' for overdue items", () => {
    const result = ctx.buildDueDateClasses({ dueAt: '2020-01-01T00:00:00.000Z', archived: false });
    assert.equal(result, 'due-overdue');
  });

  it("returns 'due-today' for items due today", () => {
    const today = new Date();
    today.setHours(14, 0, 0, 0);
    const result = ctx.buildDueDateClasses({ dueAt: today.toISOString(), archived: false });
    assert.equal(result, 'due-today');
  });

  it('returns empty string for archived items', () => {
    assert.equal(ctx.buildDueDateClasses({ dueAt: '2020-01-01T00:00:00.000Z', archived: true }), '');
  });

  it('returns empty string for items with no dueAt', () => {
    assert.equal(ctx.buildDueDateClasses({ dueAt: null, archived: false }), '');
  });
});
