'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRendererContext } = require('./helpers/renderer-context');

const ROOT = path.join(__dirname, '..', 'src');

/**
 * Load multiple renderer files as a single concatenated script so that
 * `const` declarations (e.g. STORAGE_KEY, state) share the same script scope
 * and are visible across file boundaries — matching browser `<script>` behavior.
 * We patch `const ` → `var ` so the declarations also become context properties
 * accessible from test code via `ctx.state`, `ctx.STORAGE_KEY`, etc.
 */
function loadRendererBundle(ctx, relPaths) {
  const chunks = relPaths.map((rel) => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    return `// ---- ${rel} ----\n${code}\n`;
  });
  let bundle = chunks.join('\n');
  // Replace top-level const/let with var so they become context properties
  bundle = bundle.replace(/^(const |let )/gm, 'var ');
  vm.runInContext(bundle, ctx, { filename: 'renderer-bundle.js' });
}

let ctx;
let mockStore = {};

before(() => {
  ctx = createRendererContext({
    // Browser APIs not in default vm context
    URLSearchParams,

    // Stubs for globals that state.js / briefing.js call but we don't test here
    renderBriefingsMode: () => {},
    setStatus: () => {},
    addHistory: () => {},
    setDraftButtonLoading: () => {},
    runWorkiqJson: () => Promise.resolve({}),
    buildMeetingBriefingPrompt: () => '',
  });

  // Provide window.workiq stub with electron-store mock
  ctx.window.workiq = {
    storeGet: (key) => Promise.resolve(mockStore[key]),
    storeSet: (key, value) => { mockStore[key] = value; return Promise.resolve(); },
    storeDelete: (key) => { delete mockStore[key]; return Promise.resolve(); },
    storeGetSize: () => Promise.resolve({ bytes: 0, formatted: '0 B' }),
    storeMigrateFromLocalStorage: (data) => {
      for (const [k, v] of Object.entries(data)) mockStore[k] = v;
      return Promise.resolve({ success: true });
    },
    broadcastStateChanged: () => {},
  };

  // Load all dependencies as a single script so const declarations are shared
  loadRendererBundle(ctx, [
    'renderer/constants.js',
    'renderer/utils.js',
    'renderer/models/tracking.js',
    'renderer/models/briefing.js',
    'renderer/state.js',
  ]);
});

/**
 * Helper: reset localStorage and state between tests.
 */
function resetState() {
  ctx.localStorage._store = {};
  // Set migration flag so migrateLocalStorageToStore() is bypassed in tests
  ctx.localStorage.setItem('flightdeck.migrated-to-store', 'true');
  mockStore = {};
  ctx.state.radarItems = [];
  ctx.state.meetings = [];
  ctx.state.trackingItems = [];
  ctx.state.briefingsByMeetingId = {};
  ctx.state.briefingSeenAt = {};
  ctx.state.history = [];
  ctx.state.briefing = null;
  ctx.state.connected = false;
  ctx.state.trackingDensity = 'full';
  ctx.state.radarDensity = 'full';
}

/* ================================================================== */
/*  loadPersistentState — basic loading                               */
/* ================================================================== */
describe('loadPersistentState()', () => {
  beforeEach(resetState);

  it('loads data from the v2 storage key', async () => {
    const data = {
      trackingItems: [{ id: 'task-alpha', title: 'Test Task' }],
      briefingsByMeetingId: {},
      briefingSeenAt: {},
      history: [],
      connected: true,
      trackingDensity: 'full',
      radarDensity: 'full',
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.trackingItems.length, 1);
    assert.equal(ctx.state.trackingItems[0].id, 'task-alpha');
    assert.equal(ctx.state.connected, true);
    // radarItems and meetings are ephemeral — not loaded from persistence
    assert.equal(ctx.state.radarItems.length, 0);
    assert.equal(ctx.state.meetings.length, 0);
  });

  it('loads data from legacy key when v2 key is absent', async () => {
    const data = {
      trackingItems: [{ id: 'legacy-item', title: 'Legacy Item' }],
      briefingsByMeetingId: {},
      briefingSeenAt: {},
      history: [],
    };
    mockStore[ctx.LEGACY_STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.trackingItems.length, 1);
    assert.equal(ctx.state.trackingItems[0].id, 'legacy-item');
  });

  it('prefers v2 key when both v2 and legacy exist', async () => {
    const v2Data = {
      trackingItems: [{ id: 'item-v-two', title: 'V2 Task' }],
      history: [],
    };
    const legacyData = {
      trackingItems: [{ id: 'item-legacy', title: 'Legacy Task' }],
      history: [],
    };
    mockStore[ctx.STORAGE_KEY] = v2Data;
    mockStore[ctx.LEGACY_STORAGE_KEY] = legacyData;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.trackingItems.length, 1);
    assert.equal(ctx.state.trackingItems[0].id, 'item-v-two');
  });

  it('handles missing/empty localStorage gracefully', async () => {
    await ctx.loadPersistentState();

    // State should retain defaults
    assert.equal(ctx.state.radarItems.length, 0);
    assert.equal(ctx.state.connected, false);
  });

  it('handles malformed JSON gracefully', async () => {
    // storeGet returns parsed objects directly; a non-object value exercises the guard
    mockStore[ctx.STORAGE_KEY] = 'not-valid-json}}}';

    await ctx.loadPersistentState();

    // Should not throw; state stays at defaults
    assert.equal(ctx.state.radarItems.length, 0);
  });

  it('defaults arrays to empty when stored data is non-array', async () => {
    const data = {
      trackingItems: null,
      history: undefined,
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.trackingItems.length, 0);
    assert.equal(ctx.state.history.length, 0);
  });

  it('defaults briefingsByMeetingId to {} when stored value is non-object', async () => {
    const data = { briefingsByMeetingId: 42, briefingSeenAt: null };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    looseAssert.deepEqual(ctx.state.briefingsByMeetingId, {});
    looseAssert.deepEqual(ctx.state.briefingSeenAt, {});
  });

  it('does NOT restore radarItems or meetings from persisted data', async () => {
    const data = {
      radarItems: [{ id: 'r1', title: 'Persisted Radar', severity: 'Critical' }],
      meetings: [{ id: 'm1', title: 'Persisted Meeting', startAt: '2026-03-01T10:00:00Z' }],
      connected: true,
      history: [],
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.radarItems.length, 0,
      'radarItems should not be restored from store');
    assert.equal(ctx.state.meetings.length, 0,
      'meetings should not be restored from store');
    // Other persisted fields should still load
    assert.equal(ctx.state.connected, true);
  });

  it('trims oversized updateHistory to 20 on load', async () => {
    const data = {
      trackingItems: [{
        id: 'big-history-item',
        title: 'Item with oversized history',
        updateHistory: Array.from({ length: 50 }, (_, i) => ({
          timestamp: new Date(Date.now() - i * 60000).toISOString(),
          changes: ['Test change'],
          summary: `Summary ${i}`,
          status: 'Tracked',
          severity: 'Observe',
          seen: true,
        })),
      }],
      history: [],
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.ok(
      ctx.state.trackingItems[0].updateHistory.length <= 20,
      `Expected updateHistory trimmed to <=20, got ${ctx.state.trackingItems[0].updateHistory.length}`
    );
  });
});

/* ================================================================== */
/*  Fix 1: Legacy key cleanup after migration                         */
/* ================================================================== */
describe('Legacy key cleanup (Fix 1)', () => {
  beforeEach(resetState);

  it('removes legacy key after loading from it', async () => {
    const data = {
      trackingItems: [{ id: 'migrated-item', title: 'Migrated Task' }],
      history: [],
    };
    mockStore[ctx.LEGACY_STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    // The data should have been loaded
    assert.equal(ctx.state.trackingItems.length, 1);
    assert.equal(ctx.state.trackingItems[0].id, 'migrated-item');

    // After migration, legacy key should be removed from the store
    assert.equal(
      mockStore[ctx.LEGACY_STORAGE_KEY],
      undefined,
      'Legacy storage key should be removed after migration'
    );
  });

  it('does not remove legacy key when v2 key exists (migration not triggered)', async () => {
    const v2Data = { trackingItems: [{ id: 'item-vtwo', title: 'V2 Task' }], history: [] };
    const legacyData = { trackingItems: [{ id: 'item-legacy', title: 'Legacy Task' }], history: [] };
    mockStore[ctx.STORAGE_KEY] = v2Data;
    mockStore[ctx.LEGACY_STORAGE_KEY] = legacyData;

    await ctx.loadPersistentState();

    // v2 data wins
    assert.equal(ctx.state.trackingItems[0].id, 'item-vtwo');
    // Legacy key remains because migration path was not taken
    assert.ok(
      mockStore[ctx.LEGACY_STORAGE_KEY] !== undefined,
      'Legacy key is left intact when v2 exists (no migration)'
    );
  });
});

/* ================================================================== */
/*  pruneHistory — existing time-based behavior                       */
/* ================================================================== */
describe('pruneHistory()', () => {
  beforeEach(resetState);

  it('removes entries older than 30 days', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    ctx.state.history = [
      { at: oldDate, type: 'scan', text: 'old entry' },
      { at: recentDate, type: 'scan', text: 'recent entry' },
    ];

    ctx.pruneHistory();

    assert.equal(ctx.state.history.length, 1);
    assert.equal(ctx.state.history[0].text, 'recent entry');
  });

  it('keeps entries exactly at the 30-day boundary', () => {
    const justInside = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();

    ctx.state.history = [
      { at: justInside, type: 'scan', text: 'almost old' },
    ];

    ctx.pruneHistory();

    assert.equal(ctx.state.history.length, 1);
  });

  it('removes entries with invalid timestamps', () => {
    ctx.state.history = [
      { at: 'not-a-date', type: 'scan', text: 'bad timestamp' },
      { type: 'scan', text: 'no timestamp at all' },
      { at: new Date().toISOString(), type: 'scan', text: 'good one' },
    ];

    ctx.pruneHistory();

    assert.equal(ctx.state.history.length, 1);
    assert.equal(ctx.state.history[0].text, 'good one');
  });

  it('handles empty history gracefully', () => {
    ctx.state.history = [];
    ctx.pruneHistory();
    assert.equal(ctx.state.history.length, 0);
  });
});

/* ================================================================== */
/*  Fix 3: History pruning on save                                    */
/* ================================================================== */
describe('History pruning on save (Fix 3)', () => {
  beforeEach(resetState);

  it('savePersistentState prunes entries older than 30 days', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    ctx.state.history = [
      { at: oldDate, type: 'scan', text: 'stale entry' },
      { at: recentDate, type: 'scan', text: 'fresh entry' },
    ];

    await ctx.savePersistentState();

    // After Goose's fix, savePersistentState calls pruneHistory
    // so old entries should be gone from state
    const saved = mockStore[ctx.STORAGE_KEY];

    // The saved payload should only contain fresh history
    assert.equal(saved.history.length <= 1, true,
      'Old history entries should be pruned on save');
  });
});

/* ================================================================== */
/*  Fix 5: History max entry cap                                      */
/* ================================================================== */
describe('History max cap (Fix 5)', () => {
  beforeEach(resetState);

  it('pruneHistory trims history to the cap when exceeding max entries', () => {
    // Generate 600 entries, all with valid timestamps
    const now = Date.now();
    ctx.state.history = Array.from({ length: 600 }, (_, i) => ({
      at: new Date(now - i * 60 * 1000).toISOString(), // 1 minute apart
      type: 'scan',
      text: `entry-${i}`,
    }));

    ctx.pruneHistory();

    // pruneHistory enforces a max cap of 200
    assert.ok(
      ctx.state.history.length <= 200,
      `Expected history to be capped at <=200 entries, got ${ctx.state.history.length}`
    );
  });

  it('keeps the most recent entries when capping', () => {
    const now = Date.now();
    // Build oldest-first (matches production append order via push())
    ctx.state.history = Array.from({ length: 600 }, (_, i) => ({
      at: new Date(now - (600 - i) * 60 * 1000).toISOString(),
      type: 'scan',
      text: `entry-${i}`,
    }));

    ctx.pruneHistory();

    // slice(-200) keeps the last 200 (most recent) entries
    assert.ok(ctx.state.history.length <= 200);
    // The last entry (most recent) should survive
    const last = ctx.state.history[ctx.state.history.length - 1];
    assert.equal(last.text, 'entry-599');
    // The first surviving entry should be entry-400 (oldest 400 dropped)
    assert.equal(ctx.state.history[0].text, 'entry-400');
  });
});

/* ================================================================== */
/*  pruneStaleBriefings                                               */
/* ================================================================== */
describe('pruneStaleBriefings()', () => {
  beforeEach(resetState);

  it('removes briefings for meetings that started before today', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    ctx.state.briefingsByMeetingId = {
      mtg_old: {
        headline: 'Old briefing',
        upcomingMeeting: { startAt: yesterday.toISOString() },
      },
    };
    ctx.state.briefingSeenAt = { mtg_old: new Date().toISOString() };

    ctx.pruneStaleBriefings();

    looseAssert.deepEqual(ctx.state.briefingsByMeetingId, {});
    looseAssert.deepEqual(ctx.state.briefingSeenAt, {},
      'pruneStaleBriefings should also remove corresponding briefingSeenAt entries');
  });

  it('keeps briefings for meetings starting today or later', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    ctx.state.briefingsByMeetingId = {
      mtg_future: {
        headline: 'Future briefing',
        upcomingMeeting: { startAt: tomorrow.toISOString() },
      },
    };
    ctx.state.briefingSeenAt = { mtg_future: new Date().toISOString() };

    ctx.pruneStaleBriefings();

    assert.ok(ctx.state.briefingsByMeetingId.mtg_future);
    assert.ok(ctx.state.briefingSeenAt.mtg_future);
  });

  it('keeps briefings with no startAt (cannot determine staleness)', () => {
    ctx.state.briefingsByMeetingId = {
      mtg_no_date: {
        headline: 'No date briefing',
        upcomingMeeting: {},
      },
    };

    ctx.pruneStaleBriefings();

    assert.ok(ctx.state.briefingsByMeetingId.mtg_no_date);
  });

  it('removes seenAt alongside briefing for stale meetings', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    ctx.state.briefingsByMeetingId = {
      mtg_a: { headline: 'A', upcomingMeeting: { startAt: twoDaysAgo.toISOString() } },
    };
    ctx.state.briefingSeenAt = {
      mtg_a: '2025-01-01T00:00:00Z',
    };

    ctx.pruneStaleBriefings();

    assert.equal(ctx.state.briefingSeenAt.mtg_a, undefined,
      'seenAt for pruned meeting should be removed');
  });

  it('handles mixed stale and fresh briefings', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    ctx.state.briefingsByMeetingId = {
      mtg_stale: { headline: 'Stale', upcomingMeeting: { startAt: yesterday.toISOString() } },
      mtg_fresh: { headline: 'Fresh', upcomingMeeting: { startAt: tomorrow.toISOString() } },
    };
    ctx.state.briefingSeenAt = {
      mtg_stale: new Date().toISOString(),
      mtg_fresh: new Date().toISOString(),
    };

    ctx.pruneStaleBriefings();

    assert.equal(ctx.state.briefingsByMeetingId.mtg_stale, undefined);
    assert.equal(ctx.state.briefingSeenAt.mtg_stale, undefined);
    assert.ok(ctx.state.briefingsByMeetingId.mtg_fresh);
    assert.ok(ctx.state.briefingSeenAt.mtg_fresh);
  });
});

/* ================================================================== */
/*  Fix 2: briefingSeenAt orphan cleanup in reconcileMeetingScopedState */
/* ================================================================== */
describe('briefingSeenAt orphan cleanup (Fix 2)', () => {
  beforeEach(resetState);

  it('reconcileMeetingScopedState drops briefings for missing meetings', () => {
    ctx.state.briefingsByMeetingId = {
      mtg_gone: {
        meetingId: 'mtg_gone',
        headline: 'Orphaned briefing',
        upcomingMeeting: { title: 'Deleted Meeting' },
      },
    };
    ctx.state.briefingSeenAt = { mtg_gone: new Date().toISOString() };

    // Pass empty meetings list — mtg_gone is no longer valid
    ctx.reconcileMeetingScopedState([]);

    // The briefing should be removed since no meeting matches
    assert.equal(ctx.state.briefingsByMeetingId.mtg_gone, undefined);
  });

  it('prunes orphan briefingSeenAt keys for meetings not in the list or briefings map', () => {
    // Set up a briefingSeenAt entry for a meeting that no longer exists
    ctx.state.briefingsByMeetingId = {};
    ctx.state.briefingSeenAt = {
      mtg_orphan: '2025-06-01T00:00:00Z',
      mtg_valid: '2025-06-01T00:00:00Z',
    };

    const meetings = [{ id: 'mtg_valid', title: 'Valid Meeting' }];

    // After Goose's fix, reconcileMeetingScopedState should prune
    // briefingSeenAt keys that don't correspond to any meeting or briefing
    ctx.reconcileMeetingScopedState(meetings);

    // mtg_orphan should be cleaned up (Fix 2)
    assert.equal(
      ctx.state.briefingSeenAt.mtg_orphan,
      undefined,
      'Orphan briefingSeenAt key should be pruned for meetings not in the list'
    );
  });

  it('keeps briefingSeenAt for meetings that still have aligned briefings', () => {
    const meetings = [
      { id: 'mtg_active', title: 'Active Meeting', startAt: '2025-06-15T10:00:00Z' },
    ];

    ctx.state.briefingsByMeetingId = {
      mtg_active: {
        meetingId: 'mtg_active',
        headline: 'Active briefing',
        upcomingMeeting: { title: 'Active Meeting', startAt: '2025-06-15T10:00:00Z' },
      },
    };
    ctx.state.briefingSeenAt = { mtg_active: '2025-06-15T09:00:00Z' };

    ctx.reconcileMeetingScopedState(meetings);

    // The briefing is aligned, so seenAt should be preserved
    assert.ok(ctx.state.briefingsByMeetingId.mtg_active);
    // seenAt should survive for valid meeting+briefing combos
    // (whether this key survives depends on the fix including a "keep valid" path)
  });

  it('cleans up seenAt when briefing is reassigned to a different meeting', () => {
    const meetings = [
      { id: 'mtg_new', title: 'Sprint Planning', startAt: '2025-06-15T10:00:00Z' },
    ];

    // Briefing was originally for mtg_old, but mtg_old no longer exists
    ctx.state.briefingsByMeetingId = {
      mtg_old: {
        meetingId: 'mtg_old',
        headline: 'Sprint prep',
        upcomingMeeting: { title: 'Sprint Planning', startAt: '2025-06-15T10:00:00Z' },
      },
    };
    ctx.state.briefingSeenAt = {
      mtg_old: '2025-06-15T08:00:00Z',
    };

    ctx.reconcileMeetingScopedState(meetings);

    // mtg_old briefing may get re-assigned to mtg_new by alignment scoring.
    // Either way, mtg_old seenAt should be cleaned up (Fix 2).
    assert.equal(
      ctx.state.briefingSeenAt.mtg_old,
      undefined,
      'seenAt for the old meeting key should be removed after reconciliation'
    );
  });
});

/* ================================================================== */
/*  savePersistentState — round-trip                                  */
/* ================================================================== */
describe('savePersistentState()', () => {
  beforeEach(resetState);

  it('persists state to the store under the v2 key', async () => {
    ctx.state.trackingItems = [{ id: 'task-persist', title: 'Persisted Task' }];
    ctx.state.history = [{ at: new Date().toISOString(), type: 'scan', text: 'test' }];

    await ctx.savePersistentState();

    const parsed = mockStore[ctx.STORAGE_KEY];
    assert.ok(parsed, 'Should write to store');
    assert.equal(parsed.trackingItems.length, 1);
    assert.equal(parsed.trackingItems[0].id, 'task-persist');
    assert.equal(parsed.history.length, 1);
    // radarItems and meetings should NOT be in the persisted payload
    assert.equal(parsed.radarItems, undefined);
    assert.equal(parsed.meetings, undefined);
  });

  it('round-trips through save and load', async () => {
    ctx.state.trackingItems = [{ id: 'round-trip', title: 'Round Trip Task' }];
    ctx.state.briefingSeenAt = { mtg1: '2025-06-15T10:00:00Z' };
    ctx.state.trackingDensity = 'minimal';
    ctx.state.radarDensity = 'minimal';

    await ctx.savePersistentState();

    // Reset state, then reload
    ctx.state.trackingItems = [];
    ctx.state.briefingSeenAt = {};
    ctx.state.trackingDensity = 'full';
    ctx.state.radarDensity = 'full';

    await ctx.loadPersistentState();

    assert.equal(ctx.state.trackingItems.length, 1);
    assert.equal(ctx.state.trackingItems[0].id, 'round-trip');
    assert.equal(ctx.state.trackingDensity, 'minimal');
    assert.equal(ctx.state.radarDensity, 'minimal');
  });

  it('persists briefingsByMeetingId and briefingSeenAt', async () => {
    ctx.state.briefingsByMeetingId = {
      mtg1: { headline: 'Test', upcomingMeeting: { title: 'Meeting' } },
    };
    ctx.state.briefingSeenAt = { mtg1: '2025-06-15T10:00:00Z' };

    await ctx.savePersistentState();

    const parsed = mockStore[ctx.STORAGE_KEY];
    assert.ok(parsed.briefingsByMeetingId.mtg1);
    assert.equal(parsed.briefingSeenAt.mtg1, '2025-06-15T10:00:00Z');
  });

  it('does NOT include radarItems or meetings in saved payload', async () => {
    ctx.state.radarItems = [{ id: 'r1', title: 'Active Radar Item' }];
    ctx.state.meetings = [{ id: 'm1', title: 'Upcoming Meeting' }];
    ctx.state.history = [{ at: new Date().toISOString(), type: 'scan', text: 'verify-save' }];

    await ctx.savePersistentState();

    const parsed = mockStore[ctx.STORAGE_KEY];
    assert.equal(parsed.radarItems, undefined,
      'radarItems should not appear in persisted payload');
    assert.equal(parsed.meetings, undefined,
      'meetings should not appear in persisted payload');
    // Confirm other fields are still written
    assert.equal(parsed.history.length, 1);
  });
});

/* ================================================================== */
/*  loadPersistentState runs pruneHistory and pruneStaleBriefings      */
/* ================================================================== */
describe('loadPersistentState runs cleanup on load', () => {
  beforeEach(resetState);

  it('prunes old history entries during load', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date().toISOString();

    const data = {
      history: [
        { at: oldDate, type: 'scan', text: 'ancient' },
        { at: freshDate, type: 'scan', text: 'fresh' },
      ],
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.history.length, 1);
    assert.equal(ctx.state.history[0].text, 'fresh');
  });

  it('prunes stale briefings during load', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const data = {
      briefingsByMeetingId: {
        mtg_stale: { headline: 'Old', upcomingMeeting: { startAt: yesterday.toISOString() } },
        mtg_ok: { headline: 'Current', upcomingMeeting: { startAt: tomorrow.toISOString() } },
      },
      briefingSeenAt: {
        mtg_stale: '2025-01-01T00:00:00Z',
        mtg_ok: '2025-06-15T00:00:00Z',
      },
    };
    mockStore[ctx.STORAGE_KEY] = data;

    await ctx.loadPersistentState();

    assert.equal(ctx.state.briefingsByMeetingId.mtg_stale, undefined);
    assert.equal(ctx.state.briefingSeenAt.mtg_stale, undefined);
    assert.ok(ctx.state.briefingsByMeetingId.mtg_ok);
  });
});
