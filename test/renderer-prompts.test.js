'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRendererContext } = require('./helpers/renderer-context');

const ROOT = path.join(__dirname, '..', 'src');

/**
 * Load multiple renderer files as a single concatenated script so that
 * `const` declarations share the same script scope — matching browser
 * `<script>` behavior.  `const`/`let` → `var` so they become context props.
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

/** Create a mock DOM element with addEventListener and programmatic trigger. */
function createMockElement() {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    classList: {
      _classes: new Set(),
      toggle(cls) {
        if (this._classes.has(cls)) { this._classes.delete(cls); return false; }
        this._classes.add(cls); return true;
      },
      contains(cls) { return this._classes.has(cls); },
    },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    /** Trigger all registered handlers for an event; awaits async handlers. */
    async _trigger(event) {
      for (const h of (listeners[event] || [])) await h();
    },
  };
}

/* ── Shared test state ────────────────────────────────────────────── */

let ctx;
let mockElements;
let readPromptFileCalls;
let readPromptFileResults;
let mockStore = {};

function buildMockElements() {
  return {
    radarPromptEditor: createMockElement(),
    briefingPromptEditor: createMockElement(),
    promptEditorToggle: createMockElement(),
    promptEditorBody: createMockElement(),
    promptEditorApply: createMockElement(),
    promptEditorReset: createMockElement(),
    promptEditorStatus: createMockElement(),
    briefingPromptEditorToggle: createMockElement(),
    briefingPromptEditorBody: createMockElement(),
    briefingPromptEditorApply: createMockElement(),
    briefingPromptEditorReset: createMockElement(),
    briefingPromptEditorStatus: createMockElement(),
  };
}

function resetTestState() {
  ctx.localStorage._store = {};
  mockStore = {};
  ctx.promptCache.briefing = '';
  ctx.promptCache.dayBriefing = '';
  // Reset element values and textContent
  for (const el of Object.values(mockElements)) {
    el.value = '';
    el.textContent = '';
  }
  readPromptFileCalls = [];
  readPromptFileResults = {
    'briefing.md': { success: true, content: '  disk-briefing-content  ' },
    'day-briefing.md': { success: true, content: '  disk-day-briefing-content  ' },
  };
}

before(() => {
  mockElements = buildMockElements();
  readPromptFileCalls = [];
  readPromptFileResults = {
    'briefing.md': { success: true, content: '  disk-briefing-content  ' },
    'day-briefing.md': { success: true, content: '  disk-day-briefing-content  ' },
  };

  ctx = createRendererContext({
    URLSearchParams,
    Promise,
    // Stubs for globals referenced in prompts.js function bodies we don't test
    state: { trackingItems: [], meetings: [], kpis: {}, items: [], scanners: [] },
    elements: mockElements,
    cleanDisplayText: (t) => t,
    safeDate: (d) => d,
    buildPreviousSummariesContext: () => '',
  });

  // IPC mock — window.workiq.readPromptFile + store mock
  ctx.window.workiq = {
    readPromptFile: (filename) => {
      readPromptFileCalls.push(filename);
      const result = readPromptFileResults[filename]
        || { success: false, error: 'not found' };
      return Promise.resolve(result);
    },
    storeGet: (key) => Promise.resolve(mockStore[key]),
    storeSet: (key, value) => { mockStore[key] = value; return Promise.resolve(); },
    storeDelete: (key) => { delete mockStore[key]; return Promise.resolve(); },
  };

  loadRendererBundle(ctx, [
    'renderer/constants.js',
    'renderer/prompts.js',
  ]);

  // Register event handlers once (initPromptEditor adds listeners)
  ctx.initPromptEditor();
});

/* ================================================================== */
/*  saveCustomPrompt                                                  */
/* ================================================================== */
describe('saveCustomPrompt()', () => {
  beforeEach(resetTestState);

  it('stores value under PROMPT_STORAGE_PREFIX + name', () => {
    ctx.saveCustomPrompt('radarScan', 'custom radar content');

    const key = ctx.PROMPT_STORAGE_PREFIX + 'radarScan';
    assert.equal(mockStore[key], 'custom radar content');
  });

  it('saves empty string without error', () => {
    ctx.saveCustomPrompt('radarScan', '');

    const key = ctx.PROMPT_STORAGE_PREFIX + 'radarScan';
    assert.equal(mockStore[key], '');
  });
});

/* ================================================================== */
/*  loadCustomPrompt                                                  */
/* ================================================================== */
describe('loadCustomPrompt()', () => {
  beforeEach(resetTestState);

  it('returns saved value', async () => {
    const key = ctx.PROMPT_STORAGE_PREFIX + 'briefing';
    mockStore[key] = 'my custom briefing';

    assert.equal(await ctx.loadCustomPrompt('briefing'), 'my custom briefing');
  });

  it('returns null when no saved prompt exists', async () => {
    assert.equal(await ctx.loadCustomPrompt('nonexistent'), null);
  });
});

/* ================================================================== */
/*  clearCustomPrompt                                                 */
/* ================================================================== */
describe('clearCustomPrompt()', () => {
  beforeEach(resetTestState);

  it('removes the stored value', () => {
    const key = ctx.PROMPT_STORAGE_PREFIX + 'radarScan';
    mockStore[key] = 'some prompt';

    ctx.clearCustomPrompt('radarScan');

    assert.equal(mockStore[key], undefined);
  });
});

/* ================================================================== */
/*  loadPromptFiles — localStorage priority over IPC                  */
/* ================================================================== */
describe('loadPromptFiles()', () => {
  beforeEach(resetTestState);

  it('uses localStorage value when present (IPC still called for fallback)', async () => {
    ctx.saveCustomPrompt('briefing', 'local-briefing');
    ctx.saveCustomPrompt('dayBriefing', 'local-day-briefing');

    await ctx.loadPromptFiles();

    // store values used for promptCache even though IPC was called
    assert.equal(ctx.promptCache.briefing, 'local-briefing');
    assert.equal(ctx.promptCache.dayBriefing, 'local-day-briefing');
    // IPC is still called to keep disk versions available as fallback
    assert.equal(readPromptFileCalls.length, 2,
      'IPC always called for fallback even when store has values');
  });

  it('falls back to IPC read when no localStorage value', async () => {
    await ctx.loadPromptFiles();

    // Both prompts fall through to IPC (radar prompt removed in DEC-063)
    assert.equal(readPromptFileCalls.length, 2);
    assert.ok(readPromptFileCalls.includes('briefing.md'));
    assert.ok(readPromptFileCalls.includes('day-briefing.md'));
    // Disk content should be trimmed
    assert.equal(ctx.promptCache.briefing, 'disk-briefing-content');
    assert.equal(ctx.promptCache.dayBriefing, 'disk-day-briefing-content');
  });

  it('mixed: localStorage for briefing, IPC fallback for dayBriefing', async () => {
    ctx.saveCustomPrompt('briefing', 'local-briefing');
    // dayBriefing not in store → fall back to IPC

    await ctx.loadPromptFiles();

    assert.equal(ctx.promptCache.briefing, 'local-briefing');
    assert.equal(ctx.promptCache.dayBriefing, 'disk-day-briefing-content');
    // IPC always called for both prompts as fallback
    assert.equal(readPromptFileCalls.length, 2,
      'IPC always called for all prompts as fallback');
    assert.ok(readPromptFileCalls.includes('briefing.md'));
    assert.ok(readPromptFileCalls.includes('day-briefing.md'));
  });

  it('seeds editor elements with correct values regardless of source', async () => {
    // briefing from IPC
    await ctx.loadPromptFiles();

    assert.equal(mockElements.briefingPromptEditor.value, 'disk-briefing-content',
      'Briefing editor should be seeded from disk via IPC');
  });
});

/* ================================================================== */
/*  Apply handler — saves to promptCache AND localStorage             */
/* ================================================================== */
describe('Apply handler', () => {
  beforeEach(resetTestState);

  it('briefing Apply saves to promptCache AND store', async () => {
    mockElements.briefingPromptEditor.value = 'my edited briefing prompt';

    await mockElements.briefingPromptEditorApply._trigger('click');

    assert.equal(ctx.promptCache.briefing, 'my edited briefing prompt');
    const stored = mockStore[ctx.PROMPT_STORAGE_PREFIX + 'briefing'];
    assert.equal(stored, 'my edited briefing prompt',
      'Edited prompt should persist in store');
  });

  it('Apply with empty value does not save to store', async () => {
    mockElements.briefingPromptEditor.value = '   ';

    await mockElements.briefingPromptEditorApply._trigger('click');

    assert.equal(ctx.promptCache.briefing, '',
      'promptCache should remain empty');
    assert.equal(
      mockStore[ctx.PROMPT_STORAGE_PREFIX + 'briefing'],
      undefined,
      'Empty/whitespace-only value should not be persisted');
  });
});

/* ================================================================== */
/*  Reset handler — clears localStorage, reloads from disk            */
/* ================================================================== */
describe('Reset handler', () => {
  beforeEach(resetTestState);

  it('briefing Reset clears store AND reloads from disk', async () => {
    ctx.saveCustomPrompt('briefing', 'custom briefing');
    ctx.promptCache.briefing = 'custom briefing';

    await mockElements.briefingPromptEditorReset._trigger('click');

    assert.equal(
      mockStore[ctx.PROMPT_STORAGE_PREFIX + 'briefing'],
      undefined,
      'Store entry should be cleared on reset'
    );
    assert.equal(ctx.promptCache.briefing, 'disk-briefing-content');
    assert.ok(readPromptFileCalls.includes('briefing.md'));
  });

  it('briefing Reset updates the editor element with the disk version', async () => {
    ctx.saveCustomPrompt('briefing', 'custom briefing');
    mockElements.briefingPromptEditor.value = 'custom briefing';

    await mockElements.briefingPromptEditorReset._trigger('click');

    assert.equal(mockElements.briefingPromptEditor.value, 'disk-briefing-content');
  });

  it('Reset shows "Reset to default" status message', async () => {
    ctx.saveCustomPrompt('briefing', 'custom');
    ctx.promptCache.briefing = 'custom';

    await mockElements.briefingPromptEditorReset._trigger('click');

    // showPromptEditorStatus sets textContent; setTimeout clears it later
    assert.match(
      mockElements.briefingPromptEditorStatus.textContent,
      /reset to default/i,
      'Status should indicate reset to default'
    );
  });
});

/* ================================================================== */
/*  extractScannerTopic()                                             */
/* ================================================================== */
describe('extractScannerTopic()', () => {
  it('extracts "Focus specifically on:" line', () => {
    const prompt = 'Analyze signals.\nFocus specifically on: budget approvals and vendor contracts\n\n# Rules\n- Be precise.';
    assert.equal(ctx.extractScannerTopic(prompt, 'Fallback'), 'budget approvals and vendor contracts');
  });

  it('extracts "Focus on:" (without specifically)', () => {
    const prompt = 'Analyze signals.\nFocus on: hiring pipeline\n# Rules';
    assert.equal(ctx.extractScannerTopic(prompt, 'Fallback'), 'hiring pipeline');
  });

  it('truncates long focus lines to 80 chars', () => {
    const longFocus = 'a'.repeat(100);
    const prompt = `Focus specifically on: ${longFocus}`;
    const result = ctx.extractScannerTopic(prompt, 'Fallback');
    assert.ok(result.length <= 80, 'Should truncate to ≤80 chars');
    assert.ok(result.endsWith('...'), 'Should end with ellipsis');
  });

  it('falls back to first meaningful line when no focus match', () => {
    const prompt = '# Rules\n- short\nAnalyze recent emails about the launch plan\n- another rule';
    assert.equal(ctx.extractScannerTopic(prompt, 'Fallback'), 'Analyze recent emails about the launch plan');
  });

  it('falls back to name when no usable lines', () => {
    const prompt = '# Rules\n- short line\n- another';
    assert.equal(ctx.extractScannerTopic(prompt, 'My Scanner'), 'My Scanner');
  });

  it('strips {lastRunAt} placeholders before extraction', () => {
    const prompt = 'Focus specifically on: items since {lastRunAt} about budgets';
    assert.equal(ctx.extractScannerTopic(prompt, 'Fallback'), 'items since  about budgets');
  });

  it('handles empty/null prompt', () => {
    assert.equal(ctx.extractScannerTopic('', 'Name'), 'Name');
    assert.equal(ctx.extractScannerTopic(null, 'Name'), 'Name');
  });
});

/* ================================================================== */
/*  buildCrossScannerDedupBlock()                                     */
/* ================================================================== */
describe('buildCrossScannerDedupBlock()', () => {
  beforeEach(() => {
    ctx.state.scanners = [];
  });

  it('returns empty string when no other scanners exist', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'Current', enabled: true, prompt: 'Focus on: budgets' },
    ];
    assert.equal(ctx.buildCrossScannerDedupBlock('s1'), '');
  });

  it('returns empty string when other scanners are disabled', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'Current', enabled: true, prompt: 'Focus on: budgets' },
      { id: 's2', name: 'Other', enabled: false, prompt: 'Focus on: hiring' },
    ];
    assert.equal(ctx.buildCrossScannerDedupBlock('s1'), '');
  });

  it('includes other enabled scanners with topics', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'Budget Watch', enabled: true, prompt: 'Focus on: budgets' },
      { id: 's2', name: 'HR Monitor', enabled: true, prompt: 'Focus on: hiring pipeline' },
      { id: 's3', name: 'Vendor Tracker', enabled: true, prompt: 'Focus on: vendor contracts' },
    ];
    const result = ctx.buildCrossScannerDedupBlock('s1');
    assert.ok(result.includes('HR Monitor'), 'Should include other scanner names');
    assert.ok(result.includes('Vendor Tracker'), 'Should include other scanner names');
    assert.ok(result.includes('hiring pipeline'), 'Should include extracted topics');
    assert.ok(!result.includes('Budget Watch'), 'Should NOT include current scanner');
  });

  it('caps at 5 other scanners', () => {
    const scanners = [{ id: 'current', name: 'Me', enabled: true, prompt: 'Focus on: me' }];
    for (let i = 0; i < 7; i++) {
      scanners.push({ id: `s${i}`, name: `Scanner ${i}`, enabled: true, prompt: `Focus on: topic ${i}` });
    }
    ctx.state.scanners = scanners;
    const result = ctx.buildCrossScannerDedupBlock('current');
    const lineCount = (result.match(/^- "/gm) || []).length;
    assert.ok(lineCount <= 5, `Should cap at 5 other scanners, got ${lineCount}`);
  });

  it('skips scanners without a prompt', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'Current', enabled: true, prompt: 'Focus on: budgets' },
      { id: 's2', name: 'Empty', enabled: true, prompt: '' },
      { id: 's3', name: 'Valid', enabled: true, prompt: 'Focus on: sales' },
    ];
    const result = ctx.buildCrossScannerDedupBlock('s1');
    assert.ok(!result.includes('Empty'), 'Should skip scanners without prompt');
    assert.ok(result.includes('Valid'), 'Should include scanners with prompt');
  });

  it('contains the soft-boundary instruction phrase', () => {
    ctx.state.scanners = [
      { id: 's1', name: 'A', enabled: true, prompt: 'Focus on: budgets' },
      { id: 's2', name: 'B', enabled: true, prompt: 'Focus on: hiring' },
    ];
    const result = ctx.buildCrossScannerDedupBlock('s1');
    assert.ok(result.includes('skip items that clearly belong to another scanner'), 'Should use soft-boundary framing');
  });
});

/* ================================================================== */
/*  buildScannerPrompt() — signal type filtering                      */
/* ================================================================== */
describe('buildScannerPrompt() — signalTypes filtering', () => {

  beforeEach(() => {
    ctx.state.items = [];
    ctx.state.scanners = [];
  });

  it('does not inject signal filter when all signal types are selected', () => {
    ctx.state.scanners = [{ id: 's1', name: 'Test', enabled: true, prompt: 'Look for stuff', signalTypes: ['email', 'chat', 'meeting', 'doc'] }];
    const result = ctx.buildScannerPrompt(ctx.state.scanners[0]);
    assert.ok(!result.includes('Signal source filter'), 'Should not restrict when all types selected');
  });

  it('injects signal filter when a subset of signal types is selected', () => {
    ctx.state.scanners = [{ id: 's1', name: 'Chat Only', enabled: true, prompt: 'Look for chats', signalTypes: ['chat'] }];
    const result = ctx.buildScannerPrompt(ctx.state.scanners[0]);
    assert.ok(result.includes('Signal source filter'), 'Should include signal filter');
    assert.ok(result.includes('Chat'), 'Should mention Chat');
  });

  it('includes multiple selected signal types in the filter instruction', () => {
    ctx.state.scanners = [{ id: 's1', name: 'Mix', enabled: true, prompt: 'Look for things', signalTypes: ['email', 'meeting'] }];
    const result = ctx.buildScannerPrompt(ctx.state.scanners[0]);
    assert.ok(result.includes('Email'), 'Should mention Email');
    assert.ok(result.includes('Meeting'), 'Should mention Meeting');
    assert.ok(result.includes('ONLY search for and consider'), 'Should use ONLY directive');
  });

  it('treats undefined signalTypes as all types (no restriction)', () => {
    ctx.state.scanners = [{ id: 's1', name: 'No Types', enabled: true, prompt: 'Look for stuff' }];
    const result = ctx.buildScannerPrompt(ctx.state.scanners[0]);
    assert.ok(!result.includes('Signal source filter'), 'Should not restrict when signalTypes is undefined');
  });
});

/* ================================================================== */
/*  buildScannerPrompt() — radar-like prompts (DEC-063)               */
/* ================================================================== */
describe('buildScannerPrompt() — radar-like prompts (DEC-063)', () => {

  beforeEach(() => {
    ctx.state.items = [];
    ctx.state.scanners = [];
  });

  it('builds prompt for a scanner previously handled by buildRadarScanPrompt', () => {
    const radarScanner = {
      id: 'scanner_radar',
      name: 'Radar',
      enabled: true,
      prompt: 'Analyze recent Microsoft 365 signals. Focus specifically on: all actionable work items.\n\nLook for items with signals since {lastRunAt}.',
      lastRunAt: '2026-04-01T10:00:00Z',
      signalTypes: ['email', 'chat', 'meeting', 'doc'],
      maxItemsPerScan: 10,
    };
    ctx.state.scanners = [radarScanner];

    const result = ctx.buildScannerPrompt(radarScanner);

    assert.ok(result.includes('work-signal scanner agent'), 'Should include scanner agent preamble');
    assert.ok(result.includes('all actionable work items'), 'Should include the focus topic');
    assert.ok(result.includes('2026-04-01T10:00:00Z'), 'Should substitute lastRunAt in the prompt');
    assert.ok(result.includes('radarItems'), 'Should include the JSON schema for radarItems');
  });

  it('handles scanner with no lastRunAt (falls back to 14-day window)', () => {
    const scanner = {
      id: 's1',
      name: 'Fresh Scanner',
      enabled: true,
      prompt: 'Look for items with signals since {lastRunAt}.',
      lastRunAt: null,
    };
    ctx.state.scanners = [scanner];

    const result = ctx.buildScannerPrompt(scanner);

    // When lastRunAt is null, buildScannerPrompt uses a 14-day fallback
    assert.ok(!result.includes('{lastRunAt}'), 'Should not leave placeholder unreplaced');
    assert.ok(result.includes('Last scan was at'), 'Should include time window reference');
  });

  it('includes dedup block when scanner has existing items', () => {
    const scanner = {
      id: 's1',
      name: 'Radar',
      enabled: true,
      prompt: 'Focus specifically on: all signals',
    };
    ctx.state.scanners = [scanner];
    ctx.state.items = [
      { id: 'existing-1', scannerId: 's1', title: 'Budget Review', lifecycleStatus: 'in-progress', evidenceLinks: [] },
    ];

    const result = ctx.buildScannerPrompt(scanner);

    assert.ok(result.includes('Budget Review'), 'Should include existing items in dedup block');
    assert.ok(result.includes('do NOT re-report'), 'Should include dedup instruction');
  });
});
