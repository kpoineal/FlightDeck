'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

const ROOT = path.join(__dirname, '..', 'src');

/**
 * Load multiple renderer files as a single concatenated script so that
 * `const` declarations share the same script scope — matching browser
 * `<script>` tag behavior.  `const`/`let` are patched to `var` so they
 * become context properties accessible from test code.
 */
function loadRendererBundle(ctx, relPaths) {
  const chunks = relPaths.map((rel) => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    return `// ---- ${rel} ----\n${code}\n`;
  });
  let bundle = chunks.join('\n');
  bundle = bundle.replace(/^(const |let )/gm, 'var ');
  vm.runInContext(bundle, ctx, { filename: 'renderer-bundle.js' });
}

let ctx;
let saveCalls;

before(() => {
  saveCalls = 0;
  ctx = createRendererContext({
    URLSearchParams,
    // Stubs for globals that the loaded files call but we don't test here
    renderBriefingsMode: () => {},
    setStatus: () => {},
    addHistory: () => {},
    setDraftButtonLoading: () => {},
    runWorkiqJson: () => Promise.resolve({}),
    buildMeetingBriefingPrompt: () => '',
  });

  // Provide window.workiq stub
  ctx.window.workiq = { broadcastStateChanged: () => {} };

  // Load all dependencies as a single script
  loadRendererBundle(ctx, [
    'renderer/constants.js',
    'renderer/utils.js',
    'renderer/json-parser.js',
    'renderer/state.js',
    'renderer/prompts.js',
    'renderer/models/briefing.js',
  ]);

  // Override savePersistentState to count calls
  ctx.savePersistentState = () => { saveCalls++; };
});

function resetState() {
  saveCalls = 0;
  ctx.localStorage._store = {};
  ctx.state.radarItems = [];
  ctx.state.meetings = [];
  ctx.state.trackingItems = [];
  ctx.state.briefingsByMeetingId = {};
  ctx.state.briefingSeenAt = {};
  ctx.state.history = [];
  ctx.state.briefing = null;
  ctx.state.kpis = null;
  ctx.state.connected = false;
  ctx.state.trackingDensity = 'full';
  ctx.state.radarDensity = 'full';
  // Seed the prompt cache so buildDayBriefingPrompt works
  ctx.promptCache.dayBriefing = 'You are a day-briefing assistant.';
}

/* ================================================================== */
/*  Day Briefing Constants                                            */
/* ================================================================== */
describe('Day Briefing Constants', () => {
  it('DAY_BRIEFING_KEY equals "__day_briefing__"', () => {
    assert.equal(ctx.DAY_BRIEFING_KEY, '__day_briefing__');
  });

  it('DAY_BRIEFING_JSON_SCHEMA is a non-empty string', () => {
    assert.equal(typeof ctx.DAY_BRIEFING_JSON_SCHEMA, 'string');
    assert.ok(ctx.DAY_BRIEFING_JSON_SCHEMA.trim().length > 0);
  });
});

/* ================================================================== */
/*  buildDayBriefingPrompt()                                          */
/* ================================================================== */
describe('buildDayBriefingPrompt()', () => {
  beforeEach(resetState);

  it('returns a prompt string containing the day briefing template content', () => {
    const prompt = ctx.buildDayBriefingPrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.includes('You are a day-briefing assistant.'));
  });

  it('includes meeting info when state.meetings has entries', () => {
    ctx.state.meetings = [
      { title: 'Sprint Planning', startAt: '2026-02-27T10:00:00Z', organizer: 'Alice' },
    ];
    const prompt = ctx.buildDayBriefingPrompt();
    assert.ok(prompt.includes('Sprint Planning'));
    assert.ok(prompt.includes('Alice'));
  });

  it('includes tracking item info when state.trackingItems has entries', () => {
    ctx.state.trackingItems = [
      { title: 'Fix login bug', severity: 'Critical', status: 'In Progress', dueAt: '2026-03-01' },
    ];
    const prompt = ctx.buildDayBriefingPrompt();
    assert.ok(prompt.includes('Fix login bug'));
    assert.ok(prompt.includes('Critical'));
  });

  it('includes KPI data when state.kpis has values', () => {
    ctx.state.kpis = { critical: 2, elevated: 5, observe: 10 };
    const prompt = ctx.buildDayBriefingPrompt();
    assert.ok(prompt.includes('Critical=2'));
    assert.ok(prompt.includes('Elevated=5'));
    assert.ok(prompt.includes('Observe=10'));
  });

  it('handles empty meetings gracefully', () => {
    ctx.state.meetings = [];
    const prompt = ctx.buildDayBriefingPrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.includes('No meetings scheduled today'));
  });

  it('handles empty tracking items gracefully', () => {
    ctx.state.trackingItems = [];
    const prompt = ctx.buildDayBriefingPrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.includes('No active tracked items'));
  });

  it('handles null/missing KPIs gracefully', () => {
    ctx.state.kpis = null;
    const prompt = ctx.buildDayBriefingPrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.includes('No radar KPIs available'));
  });
});

/* ================================================================== */
/*  applyDayBriefingPayload()                                         */
/* ================================================================== */
describe('applyDayBriefingPayload()', () => {
  beforeEach(resetState);

  it('stores normalized briefing under DAY_BRIEFING_KEY in state.briefingsByMeetingId', () => {
    ctx.applyDayBriefingPayload({
      headline: 'Busy day ahead',
      topPriorities: ['Ship feature'],
      generatedAt: '2026-02-27T08:00:00Z',
    });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.ok(stored);
    assert.equal(stored.headline, 'Busy day ahead');
  });

  it('normalizes headline via sanitizeBriefingText', () => {
    ctx.applyDayBriefingPayload({
      headline: 'Check [link](https://evil.com) now **bold**',
    });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    // sanitizeBriefingText strips markdown links and bold markers
    assert.ok(!stored.headline.includes('https://evil.com'));
    assert.ok(!stored.headline.includes('**'));
  });

  it('handles missing topPriorities array', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    looseAssert.deepEqual(stored.topPriorities, []);
  });

  it('handles missing meetingsRequiringPrep array', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    looseAssert.deepEqual(stored.meetingsRequiringPrep, []);
  });

  it('handles missing atRiskItems array', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    looseAssert.deepEqual(stored.atRiskItems, []);
  });

  it('handles missing suggestedTimeBlocks array', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    looseAssert.deepEqual(stored.suggestedTimeBlocks, []);
  });

  it('handles missing todayFollowUps array', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    looseAssert.deepEqual(stored.todayFollowUps, []);
  });

  it('normalizes meetingsRequiringPrep entries', () => {
    ctx.applyDayBriefingPayload({
      headline: 'Test',
      meetingsRequiringPrep: [
        { title: 'Design Review', startAt: '2026-02-27T14:00:00Z', whyPrepNeeded: 'Need mockups' },
      ],
    });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.equal(stored.meetingsRequiringPrep.length, 1);
    assert.equal(stored.meetingsRequiringPrep[0].title, 'Design Review');
    assert.equal(stored.meetingsRequiringPrep[0].startAt, '2026-02-27T14:00:00Z');
  });

  it('normalizes atRiskItems entries', () => {
    ctx.applyDayBriefingPayload({
      headline: 'Test',
      atRiskItems: [
        { title: 'Deployment', severity: 'Critical', risk: 'Pipeline broken' },
      ],
    });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.equal(stored.atRiskItems.length, 1);
    assert.equal(stored.atRiskItems[0].severity, 'Critical');
  });

  it('calls savePersistentState()', () => {
    const before = saveCalls;
    ctx.applyDayBriefingPayload({ headline: 'Test' });
    assert.equal(saveCalls, before + 1);
  });

  it('uses default headline when missing', () => {
    ctx.applyDayBriefingPayload({});
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.equal(stored.headline, 'Your day at a glance');
  });

  it('sets generatedAt from payload or defaults to now', () => {
    ctx.applyDayBriefingPayload({ headline: 'Test', generatedAt: '2026-02-27T09:00:00Z' });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.equal(stored.generatedAt, '2026-02-27T09:00:00Z');
  });

  it('filters sources keeping only those with valid URLs', () => {
    ctx.applyDayBriefingPayload({
      headline: 'Test',
      sources: [
        { label: 'Doc', type: 'doc', url: 'https://contoso.sharepoint.com/doc' },
        { label: 'Empty', type: 'doc', url: '' },
      ],
    });
    const stored = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.equal(stored.sources.length, 1);
    assert.ok(stored.sources[0].url.includes('contoso'));
  });
});

/* ================================================================== */
/*  getDayBriefing()                                                  */
/* ================================================================== */
describe('getDayBriefing()', () => {
  beforeEach(resetState);

  it('returns the day briefing when it exists', () => {
    const briefing = { headline: 'Good morning', generatedAt: '2026-02-27T08:00:00Z' };
    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = briefing;
    const result = ctx.getDayBriefing();
    assert.equal(result.headline, 'Good morning');
  });

  it('returns null when no day briefing exists', () => {
    const result = ctx.getDayBriefing();
    assert.equal(result, null);
  });
});

/* ================================================================== */
/*  reconcileMeetingScopedState() with day briefing                   */
/* ================================================================== */
describe('reconcileMeetingScopedState() with day briefing', () => {
  beforeEach(resetState);

  it('preserves __day_briefing__ entry when reconciling meetings', () => {
    const dayBriefing = { headline: 'Day overview', generatedAt: '2026-02-27T08:00:00Z' };
    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = dayBriefing;

    // Reconcile with an empty meetings list
    ctx.reconcileMeetingScopedState([]);

    const result = ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY];
    assert.ok(result);
    assert.equal(result.headline, 'Day overview');
  });

  it('does not orphan the day briefing when meetings list changes', () => {
    const dayBriefing = { headline: 'Day overview', generatedAt: '2026-02-27T08:00:00Z' };
    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = dayBriefing;
    ctx.state.briefingsByMeetingId['mtg_1'] = {
      meetingId: 'mtg_1',
      headline: 'Sprint',
      upcomingMeeting: { title: 'Sprint Planning' },
    };

    // Reconcile with a different set of meetings (mtg_1 removed, mtg_2 added)
    ctx.reconcileMeetingScopedState([
      { id: 'mtg_2', title: 'Design Review' },
    ]);

    // Day briefing should still be there
    assert.ok(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY]);
    assert.equal(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY].headline, 'Day overview');
  });
});

/* ================================================================== */
/*  pruneStaleBriefings() with day briefing                           */
/* ================================================================== */
describe('pruneStaleBriefings() with day briefing', () => {
  beforeEach(resetState);

  it('keeps day briefing when generatedAt is today', () => {
    const now = new Date();
    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = {
      headline: 'Today briefing',
      generatedAt: now.toISOString(),
    };

    ctx.pruneStaleBriefings();

    assert.ok(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY]);
    assert.equal(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY].headline, 'Today briefing');
  });

  it('prunes day briefing when generatedAt is from yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = {
      headline: 'Yesterday briefing',
      generatedAt: yesterday.toISOString(),
    };
    ctx.state.briefingSeenAt[ctx.DAY_BRIEFING_KEY] = yesterday.toISOString();

    ctx.pruneStaleBriefings();

    assert.equal(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY], undefined);
    assert.equal(ctx.state.briefingSeenAt[ctx.DAY_BRIEFING_KEY], undefined);
  });

  it('prunes day briefing when generatedAt is from two days ago', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = {
      headline: 'Old briefing',
      generatedAt: twoDaysAgo.toISOString(),
    };

    ctx.pruneStaleBriefings();

    assert.equal(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY], undefined);
  });

  it('does not prune day briefing alongside meeting briefings when day briefing is fresh', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const now = new Date();

    ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY] = {
      headline: 'Fresh day briefing',
      generatedAt: now.toISOString(),
    };
    ctx.state.briefingsByMeetingId['mtg_stale'] = {
      headline: 'Stale meeting',
      upcomingMeeting: { startAt: yesterday.toISOString() },
    };

    ctx.pruneStaleBriefings();

    // Day briefing preserved, meeting briefing pruned
    assert.ok(ctx.state.briefingsByMeetingId[ctx.DAY_BRIEFING_KEY]);
    assert.equal(ctx.state.briefingsByMeetingId['mtg_stale'], undefined);
  });
});
