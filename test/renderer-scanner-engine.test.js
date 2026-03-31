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
    renderRadarMode: () => {},
    showToast: () => {},
    state: { items: [], scanners: [], connected: false },
    window: { workiq: { log: () => {} }, location: { search: '' } },
  });
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/scanner.js');
  loadFile(ctx, 'renderer/models/item.js');
  loadFile(ctx, 'renderer/scanner-engine.js');
});

/* ================================================================== */
/*  rescheduleOverdueScanners()                                       */
/* ================================================================== */
describe('rescheduleOverdueScanners()', () => {

  beforeEach(() => {
    saveCalls = [];
    // Stop any running engine from prior tests
    ctx.stopScannerEngine();
  });

  it('reschedules a scanner whose nextRunAt is in the past', () => {
    const pastDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    ctx.state.scanners = [
      { id: 's1', name: 'Test', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '30m',
        missedRunPolicy: 'skip',
        nextRunAt: pastDate, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
    ];

    ctx.rescheduleOverdueScanners();

    const scanner = ctx.state.scanners[0];
    const newNext = new Date(scanner.nextRunAt).getTime();
    assert.ok(newNext > Date.now(), 'nextRunAt should now be in the future');
    assert.equal(saveCalls.length, 1, 'should persist the rescheduled state');
  });

  it('does not touch a scanner whose nextRunAt is in the future', () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h from now
    ctx.state.scanners = [
      { id: 's1', name: 'Test', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '30m',
        nextRunAt: futureDate, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
    ];

    ctx.rescheduleOverdueScanners();

    assert.equal(ctx.state.scanners[0].nextRunAt, futureDate, 'nextRunAt should be unchanged');
    assert.equal(saveCalls.length, 0, 'should not save when nothing changed');
  });

  it('does not touch a scanner with null nextRunAt', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'Test', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '30m',
        nextRunAt: null, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
    ];

    ctx.rescheduleOverdueScanners();

    assert.equal(ctx.state.scanners[0].nextRunAt, null, 'nextRunAt should remain null');
    assert.equal(saveCalls.length, 0, 'should not save when nothing changed');
  });

  it('skips disabled scanners', () => {
    const pastDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      { id: 's1', name: 'Disabled', enabled: false, isDefault: false,
        scheduleType: 'interval', scheduleValue: '30m',
        nextRunAt: pastDate, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
    ];

    ctx.rescheduleOverdueScanners();

    // Disabled scanners aren't in getActiveScanners(), so untouched
    assert.equal(ctx.state.scanners[0].nextRunAt, pastDate);
    assert.equal(saveCalls.length, 0);
  });

  it('reschedules multiple overdue scanners in one pass', () => {
    const pastDate1 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const pastDate2 = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      { id: 's1', name: 'Overdue 1', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '1h',
        missedRunPolicy: 'skip',
        nextRunAt: pastDate1, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
      { id: 's2', name: 'Overdue 2', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '4h',
        missedRunPolicy: 'skip',
        nextRunAt: pastDate2, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
      { id: 's3', name: 'Not overdue', enabled: true, isDefault: false,
        scheduleType: 'interval', scheduleValue: '30m',
        nextRunAt: futureDate, lastRunAt: null,
        weeklyDays: [], weeklyTimes: [], workHoursOnly: false },
    ];

    ctx.rescheduleOverdueScanners();

    assert.ok(new Date(ctx.state.scanners[0].nextRunAt).getTime() > Date.now(), 's1 rescheduled to future');
    assert.ok(new Date(ctx.state.scanners[1].nextRunAt).getTime() > Date.now(), 's2 rescheduled to future');
    assert.equal(ctx.state.scanners[2].nextRunAt, futureDate, 's3 unchanged');
    assert.equal(saveCalls.length, 1, 'only one save call for the batch');
  });
});

/* ================================================================== */
/*  normalizeScannerDefinition() — new settings fields                */
/* ================================================================== */
describe('normalizeScannerDefinition() — new scanner settings', () => {

  it('defaults autoMonitorNewItems to false', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', name: 'Test' });
    assert.equal(scanner.autoMonitorNewItems, false);
  });

  it('accepts autoMonitorNewItems = true', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', name: 'Test', autoMonitorNewItems: true });
    assert.equal(scanner.autoMonitorNewItems, true);
  });

  it('defaults notificationMode to "all"', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', name: 'Test' });
    assert.equal(scanner.notificationMode, 'all');
  });

  it('accepts valid notificationMode values', () => {
    for (const mode of ['all', 'critical-only', 'silent']) {
      const scanner = ctx.normalizeScannerDefinition({ id: 's1', notificationMode: mode });
      assert.equal(scanner.notificationMode, mode);
    }
  });

  it('rejects invalid notificationMode and defaults to "all"', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', notificationMode: 'bogus' });
    assert.equal(scanner.notificationMode, 'all');
  });

  it('defaults signalTypes to all signal types', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(JSON.stringify(scanner.signalTypes), JSON.stringify(['email', 'chat', 'meeting', 'doc']));
  });

  it('accepts a subset of signalTypes', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', signalTypes: ['email', 'chat'] });
    assert.equal(JSON.stringify(scanner.signalTypes), JSON.stringify(['email', 'chat']));
  });

  it('filters out invalid signalTypes entries', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', signalTypes: ['email', 'fax', 'chat'] });
    assert.equal(JSON.stringify(scanner.signalTypes), JSON.stringify(['email', 'chat']));
  });

  it('falls back to all signal types when signalTypes is empty array', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', signalTypes: [] });
    assert.equal(JSON.stringify(scanner.signalTypes), JSON.stringify(['email', 'chat', 'meeting', 'doc']));
  });

  it('defaults crossScannerDedup to true', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(scanner.crossScannerDedup, true);
  });

  it('accepts crossScannerDedup = false', () => {
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', crossScannerDedup: false });
    assert.equal(scanner.crossScannerDedup, false);
  });
});

/* ================================================================== */
/*  deduplicateAgainstInbox() — crossScannerDedup                     */
/* ================================================================== */
describe('deduplicateAgainstInbox() — crossScannerDedup', () => {

  beforeEach(() => {
    ctx.state.items = [];
    ctx.state.scanners = [];
  });

  it('with crossScannerDedup=true, deduplicates against items from other scanners', () => {
    ctx.state.items = [
      { id: 'existing1', scannerId: 'other-scanner', evidenceLinks: [{ url: 'https://example.com/a' }] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 'my-scanner', crossScannerDedup: true });
    const newItems = [
      { id: 'new1', evidenceLinks: [{ url: 'https://example.com/a' }] },
      { id: 'new2', evidenceLinks: [{ url: 'https://example.com/b' }] },
    ];
    const result = ctx.deduplicateAgainstInbox(newItems, scanner);
    assert.equal(result.length, 1, 'should filter out item with matching URL from another scanner');
    assert.equal(result[0].id, 'new2');
  });

  it('with crossScannerDedup=false, only deduplicates against same scanner items', () => {
    ctx.state.items = [
      { id: 'existing1', scannerId: 'other-scanner', evidenceLinks: [{ url: 'https://example.com/a' }] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 'my-scanner', crossScannerDedup: false });
    const newItems = [
      { id: 'new1', evidenceLinks: [{ url: 'https://example.com/a' }] },
      { id: 'new2', evidenceLinks: [{ url: 'https://example.com/b' }] },
    ];
    const result = ctx.deduplicateAgainstInbox(newItems, scanner);
    assert.equal(result.length, 2, 'should keep both items since the URL belongs to a different scanner');
  });

  it('with crossScannerDedup=true (default), still deduplicates within same scanner', () => {
    ctx.state.items = [
      { id: 'existing1', scannerId: 'my-scanner', evidenceLinks: [{ url: 'https://example.com/same' }] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 'my-scanner' });
    const newItems = [
      { id: 'new1', evidenceLinks: [{ url: 'https://example.com/same' }] },
    ];
    const result = ctx.deduplicateAgainstInbox(newItems, scanner);
    assert.equal(result.length, 0);
  });
});

/* ================================================================== */
/*  normalizeScannerDefinition() — medium-priority fields             */
/* ================================================================== */
describe('normalizeScannerDefinition() — medium-priority fields', () => {

  it('defaults autoMonitorSeverityThreshold to "all"', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(s.autoMonitorSeverityThreshold, 'all');
  });

  it('accepts valid autoMonitorSeverityThreshold values', () => {
    for (const v of ['all', 'Critical', 'Elevated']) {
      const s = ctx.normalizeScannerDefinition({ id: 's1', autoMonitorSeverityThreshold: v });
      assert.equal(s.autoMonitorSeverityThreshold, v);
    }
  });

  it('rejects invalid autoMonitorSeverityThreshold', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1', autoMonitorSeverityThreshold: 'bogus' });
    assert.equal(s.autoMonitorSeverityThreshold, 'all');
  });

  it('defaults maxItemsPerScan to 10', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(s.maxItemsPerScan, 10);
  });

  it('accepts valid maxItemsPerScan in range 1-25', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: 5 }).maxItemsPerScan, 5);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: 25 }).maxItemsPerScan, 25);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: 1 }).maxItemsPerScan, 1);
  });

  it('rejects out-of-range maxItemsPerScan', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: 0 }).maxItemsPerScan, 10);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: 30 }).maxItemsPerScan, 10);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', maxItemsPerScan: -1 }).maxItemsPerScan, 10);
  });

  it('defaults runOnStartup to false', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).runOnStartup, false);
  });

  it('accepts runOnStartup = true', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', runOnStartup: true }).runOnStartup, true);
  });

  it('defaults missedRunPolicy to "run-once"', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).missedRunPolicy, 'run-once');
  });

  it('accepts valid missedRunPolicy values', () => {
    for (const v of ['skip', 'run-once', 'catch-up']) {
      assert.equal(ctx.normalizeScannerDefinition({ id: 's1', missedRunPolicy: v }).missedRunPolicy, v);
    }
  });

  it('rejects invalid missedRunPolicy', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', missedRunPolicy: 'nope' }).missedRunPolicy, 'run-once');
  });

  it('defaults dedupStrategy to "evidence-url"', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).dedupStrategy, 'evidence-url');
  });

  it('accepts valid dedupStrategy values', () => {
    for (const v of ['evidence-url', 'title-similarity', 'both']) {
      assert.equal(ctx.normalizeScannerDefinition({ id: 's1', dedupStrategy: v }).dedupStrategy, v);
    }
  });

  it('defaults excludeKeywords to empty array', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(JSON.stringify(s.excludeKeywords), '[]');
  });

  it('accepts excludeKeywords array of strings', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1', excludeKeywords: ['newsletter', 'digest'] });
    assert.equal(JSON.stringify(s.excludeKeywords), JSON.stringify(['newsletter', 'digest']));
  });

  it('filters out empty strings in excludeKeywords', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1', excludeKeywords: ['newsletter', '', '  '] });
    assert.equal(JSON.stringify(s.excludeKeywords), JSON.stringify(['newsletter']));
  });

  it('defaults defaultMonitorSchedule to "4h"', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).defaultMonitorSchedule, '4h');
  });

  it('accepts valid defaultMonitorSchedule values', () => {
    for (const v of ['15m', '30m', '1h', '2h', '4h']) {
      assert.equal(ctx.normalizeScannerDefinition({ id: 's1', defaultMonitorSchedule: v }).defaultMonitorSchedule, v);
    }
  });

  it('defaults autoArchiveAfterDays to 0', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).autoArchiveAfterDays, 0);
  });

  it('accepts autoArchiveAfterDays = 7', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', autoArchiveAfterDays: 7 }).autoArchiveAfterDays, 7);
  });

  it('defaults retentionDays to 365', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).retentionDays, 365);
  });

  it('accepts retentionDays in range 1-365', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 7 }).retentionDays, 7);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 365 }).retentionDays, 365);
  });

  it('rejects out-of-range retentionDays', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 0 }).retentionDays, 365);
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 400 }).retentionDays, 365);
  });

  it('defaults webhookUrl to empty string', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).webhookUrl, '');
  });

  it('accepts valid webhookUrl', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', webhookUrl: 'https://hooks.slack.com/test' }).webhookUrl, 'https://hooks.slack.com/test');
  });

  it('defaults scannerGroupId to empty string', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).scannerGroupId, '');
  });

  it('accepts scannerGroupId', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', scannerGroupId: 'Work' }).scannerGroupId, 'Work');
  });

  it('defaults defaultMonitorScheduleType to "interval"', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).defaultMonitorScheduleType, 'interval');
  });

  it('accepts valid defaultMonitorScheduleType values', () => {
    for (const v of ['interval', 'weekly', 'one-time']) {
      assert.equal(ctx.normalizeScannerDefinition({ id: 's1', defaultMonitorScheduleType: v }).defaultMonitorScheduleType, v);
    }
  });

  it('defaults defaultMonitorWorkHoursOnly to false', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).defaultMonitorWorkHoursOnly, false);
  });

  it('accepts defaultMonitorWorkHoursOnly = true', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', defaultMonitorWorkHoursOnly: true }).defaultMonitorWorkHoursOnly, true);
  });

  it('defaults defaultMonitorSignals to all signal types', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(JSON.stringify(s.defaultMonitorSignals), JSON.stringify(['email', 'chat', 'meeting', 'doc']));
  });

  it('accepts a subset of defaultMonitorSignals', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1', defaultMonitorSignals: ['email', 'chat'] });
    assert.equal(JSON.stringify(s.defaultMonitorSignals), JSON.stringify(['email', 'chat']));
  });

  it('defaults defaultMonitorNotifyEnabled to true', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1' }).defaultMonitorNotifyEnabled, true);
  });

  it('accepts defaultMonitorNotifyEnabled = false', () => {
    assert.equal(ctx.normalizeScannerDefinition({ id: 's1', defaultMonitorNotifyEnabled: false }).defaultMonitorNotifyEnabled, false);
  });

  it('defaults defaultMonitorWeeklyDays to Mon-Fri', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(JSON.stringify(s.defaultMonitorWeeklyDays), JSON.stringify(['mon', 'tue', 'wed', 'thu', 'fri']));
  });

  it('defaults defaultMonitorWeeklyTimes to 08:00, 12:00', () => {
    const s = ctx.normalizeScannerDefinition({ id: 's1' });
    assert.equal(JSON.stringify(s.defaultMonitorWeeklyTimes), JSON.stringify(['08:00', '12:00']));
  });
});

/* ================================================================== */
/*  deduplicateAgainstInbox() — dedupStrategy                         */
/* ================================================================== */
describe('deduplicateAgainstInbox() — dedupStrategy', () => {

  beforeEach(() => {
    ctx.state.items = [];
  });

  it('title-similarity: filters item with nearly identical title', () => {
    ctx.state.items = [
      { id: 'e1', scannerId: 's1', title: 'Q3 Budget Review Meeting', evidenceLinks: [] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', dedupStrategy: 'title-similarity' });
    const items = [
      { id: 'n1', title: 'Q3 Budget Review Meeting Notes', evidenceLinks: [] },
    ];
    const result = ctx.deduplicateAgainstInbox(items, scanner);
    assert.equal(result.length, 0, 'should filter similar title');
  });

  it('title-similarity: keeps items with different titles', () => {
    ctx.state.items = [
      { id: 'e1', scannerId: 's1', title: 'Q3 Budget Review', evidenceLinks: [] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', dedupStrategy: 'title-similarity' });
    const items = [
      { id: 'n1', title: 'Hiring Pipeline Update', evidenceLinks: [] },
    ];
    const result = ctx.deduplicateAgainstInbox(items, scanner);
    assert.equal(result.length, 1, 'should keep different title');
  });

  it('both: filters if either URL or title matches', () => {
    ctx.state.items = [
      { id: 'e1', scannerId: 's1', title: 'Unique Title Only', evidenceLinks: [{ url: 'https://example.com/a' }] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', dedupStrategy: 'both' });
    // Same URL, different title
    const items1 = [{ id: 'n1', title: 'Completely Different', evidenceLinks: [{ url: 'https://example.com/a' }] }];
    assert.equal(ctx.deduplicateAgainstInbox(items1, scanner).length, 0, 'filtered by URL');

    // Different URL, same title
    const items2 = [{ id: 'n2', title: 'Unique Title Only', evidenceLinks: [{ url: 'https://example.com/z' }] }];
    assert.equal(ctx.deduplicateAgainstInbox(items2, scanner).length, 0, 'filtered by title');
  });

  it('evidence-url: does not filter by title', () => {
    ctx.state.items = [
      { id: 'e1', scannerId: 's1', title: 'Same Title Exactly', evidenceLinks: [{ url: 'https://example.com/a' }] },
    ];
    const scanner = ctx.normalizeScannerDefinition({ id: 's1', dedupStrategy: 'evidence-url' });
    const items = [{ id: 'n1', title: 'Same Title Exactly', evidenceLinks: [{ url: 'https://example.com/b' }] }];
    assert.equal(ctx.deduplicateAgainstInbox(items, scanner).length, 1, 'should not filter by title in url-only mode');
  });
});

/* ================================================================== */
/*  titlesSimilar()                                                   */
/* ================================================================== */
describe('titlesSimilar()', () => {

  it('returns true for identical titles', () => {
    assert.equal(ctx.titlesSimilar('budget review', 'budget review'), true);
  });

  it('returns true for titles with 70%+ word overlap', () => {
    assert.equal(ctx.titlesSimilar('q3 budget review meeting', 'q3 budget review meeting notes'), true);
  });

  it('returns false for very different titles', () => {
    assert.equal(ctx.titlesSimilar('budget review', 'hiring pipeline update'), false);
  });

  it('returns false for empty strings', () => {
    assert.equal(ctx.titlesSimilar('', ''), false);
    assert.equal(ctx.titlesSimilar('hello', ''), false);
  });
});

/* ================================================================== */
/*  rescheduleOverdueScanners() — missedRunPolicy                     */
/* ================================================================== */
describe('rescheduleOverdueScanners() — missedRunPolicy', () => {

  beforeEach(() => {
    saveCalls = [];
    ctx.stopScannerEngine();
  });

  it('skip policy: reschedules to the future', () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', name: 'Skip', enabled: true, missedRunPolicy: 'skip',
        scheduleType: 'interval', scheduleValue: '30m', nextRunAt: past }),
    ];
    ctx.rescheduleOverdueScanners();
    assert.ok(new Date(ctx.state.scanners[0].nextRunAt).getTime() > Date.now(), 'should be in future');
  });

  it('run-once policy: sets nextRunAt to approximately now', () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', name: 'RunOnce', enabled: true, missedRunPolicy: 'run-once',
        scheduleType: 'interval', scheduleValue: '30m', nextRunAt: past }),
    ];
    ctx.rescheduleOverdueScanners();
    // Should be set to approx now (within 5 seconds)
    const diff = Math.abs(new Date(ctx.state.scanners[0].nextRunAt).getTime() - Date.now());
    assert.ok(diff < 5000, 'should be set to approximately now');
  });

  it('catch-up policy: sets _catchUpRemaining', () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', name: 'CatchUp', enabled: true, missedRunPolicy: 'catch-up',
        scheduleType: 'interval', scheduleValue: '30m', nextRunAt: past }),
    ];
    ctx.rescheduleOverdueScanners();
    assert.equal(ctx.state.scanners[0]._catchUpRemaining, 3, 'should set catch-up remaining to 3');
  });
});

/* ================================================================== */
/*  runScannerAutoArchiveAndRetention()                               */
/* ================================================================== */
describe('runScannerAutoArchiveAndRetention()', () => {

  beforeEach(() => {
    saveCalls = [];
    ctx.state.scanners = [];
    ctx.state.items = [];
  });

  it('auto-archives stale items when autoArchiveAfterDays > 0', () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', autoArchiveAfterDays: 7 }),
    ];
    ctx.state.items = [
      { id: 'i1', scannerId: 's1', discoveredAt: staleDate, lastChangedAt: staleDate, lifecycleStatus: 'in-progress' },
    ];
    ctx.runScannerAutoArchiveAndRetention();
    assert.equal(ctx.state.items[0].lifecycleStatus, 'archived');
    assert.equal(ctx.state.items[0].monitorEnabled, false);
  });

  it('does not archive items newer than threshold', () => {
    const freshDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', autoArchiveAfterDays: 7 }),
    ];
    ctx.state.items = [
      { id: 'i1', scannerId: 's1', discoveredAt: freshDate, lastChangedAt: freshDate, lifecycleStatus: 'in-progress' },
    ];
    ctx.runScannerAutoArchiveAndRetention();
    assert.equal(ctx.state.items[0].lifecycleStatus, 'in-progress');
  });

  it('removes archived items older than retentionDays', () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 30 }),
    ];
    ctx.state.items = [
      { id: 'i1', scannerId: 's1', discoveredAt: oldDate, lastChangedAt: oldDate, lifecycleStatus: 'archived' },
      { id: 'i2', scannerId: 's1', discoveredAt: new Date().toISOString(), lastChangedAt: new Date().toISOString(), lifecycleStatus: 'in-progress' },
    ];
    ctx.runScannerAutoArchiveAndRetention();
    assert.equal(ctx.state.items.length, 1, 'should remove the old archived item');
    assert.equal(ctx.state.items[0].id, 'i2');
  });

  it('does not remove active items even if older than retentionDays', () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', retentionDays: 30 }),
    ];
    ctx.state.items = [
      { id: 'i1', scannerId: 's1', discoveredAt: oldDate, lastChangedAt: oldDate, lifecycleStatus: 'in-progress' },
    ];
    ctx.runScannerAutoArchiveAndRetention();
    assert.equal(ctx.state.items.length, 1, 'should NOT remove active items');
  });

  it('does nothing when autoArchiveAfterDays is 0', () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.scanners = [
      ctx.normalizeScannerDefinition({ id: 's1', autoArchiveAfterDays: 0 }),
    ];
    ctx.state.items = [
      { id: 'i1', scannerId: 's1', discoveredAt: staleDate, lastChangedAt: staleDate, lifecycleStatus: 'in-progress' },
    ];
    ctx.runScannerAutoArchiveAndRetention();
    assert.equal(ctx.state.items[0].lifecycleStatus, 'in-progress');
  });
});
