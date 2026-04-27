'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let sortByRecent, sortBySeverity, severityRankValue;

before(async () => {
  const utils = await import('../src/svelte/lib/utils.js');
  sortByRecent = utils.sortByRecent;
  sortBySeverity = utils.sortBySeverity;
  severityRankValue = utils.severityRankValue;
});

/* ------------------------------------------------------------------ */
/*  sortByRecent()                                                     */
/* ------------------------------------------------------------------ */
describe('sortByRecent()', () => {
  it('sorts items by lastChangedAt descending (most recent first)', () => {
    const items = [
      { id: 'old', lastChangedAt: '2026-01-01T00:00:00Z' },
      { id: 'new', lastChangedAt: '2026-04-15T00:00:00Z' },
      { id: 'mid', lastChangedAt: '2026-03-01T00:00:00Z' },
    ];
    const result = sortByRecent(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['new', 'mid', 'old']);
  });

  it('falls back to lastRunAt when lastChangedAt is null', () => {
    const items = [
      { id: 'a', lastChangedAt: null, lastRunAt: '2026-02-01T00:00:00Z' },
      { id: 'b', lastChangedAt: '2026-04-01T00:00:00Z' },
    ];
    const result = sortByRecent(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['b', 'a']);
  });

  it('falls back to discoveredAt when lastChangedAt and lastRunAt are null', () => {
    const items = [
      { id: 'a', lastChangedAt: null, lastRunAt: null, discoveredAt: '2026-01-10T00:00:00Z' },
      { id: 'b', lastChangedAt: null, lastRunAt: null, discoveredAt: '2026-03-20T00:00:00Z' },
    ];
    const result = sortByRecent(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['b', 'a']);
  });

  it('sorts items with all null timestamps to the bottom', () => {
    const items = [
      { id: 'none', lastChangedAt: null, lastRunAt: null, discoveredAt: null },
      { id: 'has', lastChangedAt: '2026-02-01T00:00:00Z' },
    ];
    const result = sortByRecent(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['has', 'none']);
  });

  it('returns empty array for empty input', () => {
    const result = sortByRecent([]);
    assert.deepStrictEqual(result, []);
  });

  it('returns single item unchanged', () => {
    const items = [{ id: 'only', lastChangedAt: '2026-01-01T00:00:00Z' }];
    const result = sortByRecent(items);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'only');
  });

  it('does not mutate the original array', () => {
    const items = [
      { id: 'b', lastChangedAt: '2026-01-01T00:00:00Z' },
      { id: 'a', lastChangedAt: '2026-04-01T00:00:00Z' },
    ];
    const result = sortByRecent(items);
    assert.equal(items[0].id, 'b');
    assert.notStrictEqual(result, items);
  });

  it('handles mixed fallback chain across items', () => {
    const items = [
      { id: 'discovered', lastChangedAt: null, lastRunAt: null, discoveredAt: '2026-04-01T00:00:00Z' },
      { id: 'changed', lastChangedAt: '2026-04-20T00:00:00Z' },
      { id: 'ran', lastChangedAt: null, lastRunAt: '2026-04-10T00:00:00Z' },
      { id: 'nothing' },
    ];
    const result = sortByRecent(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['changed', 'ran', 'discovered', 'nothing']);
  });
});

/* ------------------------------------------------------------------ */
/*  sortBySeverity() — verify existing behavior                        */
/* ------------------------------------------------------------------ */
describe('sortBySeverity()', () => {
  it('sorts new/updated items before others when useHasNewUpdate is true', () => {
    const items = [
      { id: 'old', severity: 'Critical', hasNewUpdate: false, isNew: false },
      { id: 'new', severity: 'Observe', isNew: true },
    ];
    const result = sortBySeverity(items, true);
    assert.equal(result[0].id, 'new');
    assert.equal(result[1].id, 'old');
  });

  it('sorts by severity rank: Critical < Elevated < Observe', () => {
    const items = [
      { id: 'obs', severity: 'Observe' },
      { id: 'crit', severity: 'Critical' },
      { id: 'elev', severity: 'Elevated' },
    ];
    const result = sortBySeverity(items);
    assert.deepStrictEqual(result.map((i) => i.id), ['crit', 'elev', 'obs']);
  });

  it('promotes hasNewUpdate items alongside isNew items', () => {
    const items = [
      { id: 'normal', severity: 'Critical' },
      { id: 'updated', severity: 'Observe', hasNewUpdate: true },
    ];
    const result = sortBySeverity(items, true);
    assert.equal(result[0].id, 'updated');
  });

  it('does not mutate the original array', () => {
    const items = [
      { id: 'b', severity: 'Observe' },
      { id: 'a', severity: 'Critical' },
    ];
    const result = sortBySeverity(items);
    assert.equal(items[0].id, 'b');
    assert.notStrictEqual(result, items);
  });
});

/* ------------------------------------------------------------------ */
/*  severityRankValue()                                                */
/* ------------------------------------------------------------------ */
describe('severityRankValue()', () => {
  it('returns 0 for Critical', () => assert.equal(severityRankValue('Critical'), 0));
  it('returns 1 for Elevated', () => assert.equal(severityRankValue('Elevated'), 1));
  it('returns 2 for Observe', () => assert.equal(severityRankValue('Observe'), 2));
  it('returns 2 for unknown severity', () => assert.equal(severityRankValue('unknown'), 2));
});
