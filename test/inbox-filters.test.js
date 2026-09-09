import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  QUICK_FILTER_IDS,
  REFINE_FACET_IDS,
  filterInboxItems,
  matchesInboxFilters,
} from '../src/svelte/lib/inbox-filters.js';

const NOW = Date.parse('2026-09-08T12:00:00Z');

function runCalendarProbe(timeZone, fixture) {
  const moduleUrl = new URL('../src/svelte/lib/inbox-filters.js', import.meta.url).href;
  const source = `
    import { matchesInboxFilters } from ${JSON.stringify(moduleUrl)};
    const fixture = ${JSON.stringify(fixture)};
    const now = Date.parse(fixture.now);
    const matchesDueSoon = (dueAt) => matchesInboxFilters(
      { id: dueAt, dueAt },
      { quickFilter: 'due-soon' },
      { now }
    );
    const matchesToday = (lastChangedAt) => matchesInboxFilters(
      { id: lastChangedAt, lastChangedAt },
      { facets: { 'activity-age': ['today'] } },
      { now }
    );
    process.stdout.write(JSON.stringify({
      resolvedTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nowOffsetMinutes: new Date(now).getTimezoneOffset(),
      localMidnightOffsetMinutes: new Date(fixture.localMidnight).getTimezoneOffset(),
      results: {
        dueLocalMidnight: matchesDueSoon(fixture.localMidnight),
        dueSeventhDayEnd: matchesDueSoon(fixture.seventhDayEnd),
        dueEighthDayStart: matchesDueSoon(fixture.eighthDayStart),
        todayLocalMidnight: matchesToday(fixture.localMidnight),
        todayPreviousInstant: matchesToday(fixture.previousInstant),
      },
    }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, TZ: timeZone },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function item(overrides = {}) {
  return {
    id: 'item-1',
    severity: 'Observe',
    lifecycleStatus: 'in-progress',
    scannerId: 'scanner-a',
    sourceType: 'Email',
    isNew: false,
    hasNewUpdate: false,
    monitorEnabled: false,
    monitorPaused: false,
    dueAt: null,
    lastChangedAt: '2026-09-08T10:00:00Z',
    updateHistory: [],
    evidenceLinks: [],
    ...overrides,
  };
}

describe('Inbox filter configuration', () => {
  test('publishes the approved quick filters and Refine facets', () => {
    assert.deepEqual(QUICK_FILTER_IDS, [
      'unread',
      'new',
      'updated',
      'critical',
      'blocked',
      'due-soon',
    ]);
    assert.deepEqual(REFINE_FACET_IDS, [
      'severity',
      'lifecycle',
      'scanner',
      'read',
      'monitoring',
      'due',
      'signal',
      'activity-age',
    ]);
  });
});

describe('matchesInboxFilters quick filters', () => {
  const cases = [
    ['unread', item({ updateHistory: [{ seen: false }] })],
    ['new', item({ isNew: true })],
    ['updated', item({ hasNewUpdate: true })],
    ['critical', item({ severity: 'Critical' })],
    ['blocked', item({ lifecycleStatus: 'blocked' })],
    ['due-soon', item({ dueAt: '2026-09-15T23:59:59Z' })],
  ];

  for (const [quickFilter, matchingItem] of cases) {
    test(`matches ${quickFilter} without conflating adjacent states`, () => {
      assert.equal(matchesInboxFilters(matchingItem, { quickFilter }, { now: NOW }), true);
      assert.equal(matchesInboxFilters(item(), { quickFilter }, { now: NOW }), false);
    });
  }

  test('due-soon includes overdue dates and excludes dates after seven calendar days', () => {
    assert.equal(matchesInboxFilters(item({ dueAt: '2026-09-07T08:00:00Z' }), { quickFilter: 'due-soon' }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(item({ dueAt: '2026-09-16T00:00:00Z' }), { quickFilter: 'due-soon' }, { now: NOW }), false);
    assert.equal(matchesInboxFilters(item({ dueAt: null }), { quickFilter: 'due-soon' }, { now: NOW }), false);
  });
});

describe('local calendar boundaries', () => {
  test('uses America/Denver midnight and includes the seventh local day but not the eighth', () => {
    const probe = runCalendarProbe('America/Denver', {
      now: '2026-09-08T12:00:00-06:00',
      localMidnight: '2026-09-08T00:00:00-06:00',
      previousInstant: '2026-09-07T23:59:59.999-06:00',
      seventhDayEnd: '2026-09-15T23:59:59.999-06:00',
      eighthDayStart: '2026-09-16T00:00:00-06:00',
    });

    assert.equal(probe.resolvedTimeZone, 'America/Denver');
    assert.equal(probe.nowOffsetMinutes, 360);
    assert.deepEqual(probe.results, {
      dueLocalMidnight: true,
      dueSeventhDayEnd: true,
      dueEighthDayStart: false,
      todayLocalMidnight: true,
      todayPreviousInstant: false,
    });
  });

  test('uses the DST-adjacent America/New_York local day when midnight has a different offset', () => {
    const probe = runCalendarProbe('America/New_York', {
      now: '2026-03-08T12:00:00-04:00',
      localMidnight: '2026-03-08T00:00:00-05:00',
      previousInstant: '2026-03-07T23:59:59.999-05:00',
      seventhDayEnd: '2026-03-15T23:59:59.999-04:00',
      eighthDayStart: '2026-03-16T00:00:00-04:00',
    });

    assert.equal(probe.resolvedTimeZone, 'America/New_York');
    assert.equal(probe.nowOffsetMinutes, 240);
    assert.equal(probe.localMidnightOffsetMinutes, 300);
    assert.deepEqual(probe.results, {
      dueLocalMidnight: true,
      dueSeventhDayEnd: true,
      dueEighthDayStart: false,
      todayLocalMidnight: true,
      todayPreviousInstant: false,
    });
  });
});

describe('matchesInboxFilters Refine facets', () => {
  test('matches normalized source type and evidence signal types', () => {
    const thread = item({
      sourceType: 'Email',
      evidenceLinks: [{ type: 'Meeting' }, { sourceType: 'Doc' }],
    });

    assert.equal(matchesInboxFilters(thread, { facets: { signal: ['email'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { signal: ['meeting'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { signal: ['doc'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { signal: ['chat'] } }, { now: NOW }), false);
  });

  test('supports scanner, read, monitoring, due, and activity-age facets', () => {
    const thread = item({
      scannerId: 'scanner-b',
      hasNewUpdate: true,
      monitorEnabled: true,
      monitorPaused: true,
      dueAt: '2026-09-07T08:00:00Z',
      lastChangedAt: '2026-09-06T12:00:00Z',
    });

    assert.equal(matchesInboxFilters(thread, { facets: { scanner: ['scanner-b'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { read: ['unread'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { monitoring: ['paused'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { due: ['overdue'] } }, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { 'activity-age': ['last-7-days'] } }, { now: NOW }), true);
  });

  test('ORs values within a facet and ANDs facets with the quick filter', () => {
    const filters = {
      quickFilter: 'updated',
      facets: {
        severity: ['Critical', 'Elevated'],
        lifecycle: ['blocked'],
        scanner: ['scanner-a', 'scanner-b'],
      },
    };

    assert.equal(matchesInboxFilters(item({
      severity: 'Elevated',
      lifecycleStatus: 'blocked',
      scannerId: 'scanner-b',
      hasNewUpdate: true,
    }), filters, { now: NOW }), true);
    assert.equal(matchesInboxFilters(item({
      severity: 'Observe',
      lifecycleStatus: 'blocked',
      scannerId: 'scanner-b',
      hasNewUpdate: true,
    }), filters, { now: NOW }), false);
    assert.equal(matchesInboxFilters(item({
      severity: 'Critical',
      lifecycleStatus: 'waiting',
      scannerId: 'scanner-a',
      hasNewUpdate: true,
    }), filters, { now: NOW }), false);
    assert.equal(matchesInboxFilters(item({
      severity: 'Critical',
      lifecycleStatus: 'blocked',
      scannerId: 'scanner-a',
      hasNewUpdate: false,
    }), filters, { now: NOW }), false);
  });

  test('treats missing and empty facets as any value', () => {
    const thread = item();
    assert.equal(matchesInboxFilters(thread, {}, { now: NOW }), true);
    assert.equal(matchesInboxFilters(thread, { facets: { severity: [], lifecycle: [] } }, { now: NOW }), true);
  });
});

test('filterInboxItems preserves source ordering and does not mutate the input', () => {
  const threads = [
    item({ id: 'older', severity: 'Critical', lastChangedAt: '2026-09-01T00:00:00Z' }),
    item({ id: 'newer', severity: 'Critical', lastChangedAt: '2026-09-08T11:00:00Z' }),
    item({ id: 'middle', severity: 'Observe', lastChangedAt: '2026-09-05T00:00:00Z' }),
  ];

  const filtered = filterInboxItems(threads, { facets: { severity: ['Critical'] } }, { now: NOW });

  assert.deepEqual(filtered.map(({ id }) => id), ['older', 'newer']);
  assert.deepEqual(threads.map(({ id }) => id), ['older', 'newer', 'middle']);
  assert.notEqual(filtered, threads);
});