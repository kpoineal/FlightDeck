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
  ctx.promptCache.radarScan = '';
  ctx.promptCache.briefing = '';
  ctx.promptCache.dayBriefing = '';
  // Reset element values and textContent
  for (const el of Object.values(mockElements)) {
    el.value = '';
    el.textContent = '';
  }
  readPromptFileCalls = [];
  readPromptFileResults = {
    'radar-scan.md': { success: true, content: '  disk-radar-content  ' },
    'briefing.md': { success: true, content: '  disk-briefing-content  ' },
    'day-briefing.md': { success: true, content: '  disk-day-briefing-content  ' },
  };
}

before(() => {
  mockElements = buildMockElements();
  readPromptFileCalls = [];
  readPromptFileResults = {
    'radar-scan.md': { success: true, content: '  disk-radar-content  ' },
    'briefing.md': { success: true, content: '  disk-briefing-content  ' },
    'day-briefing.md': { success: true, content: '  disk-day-briefing-content  ' },
  };

  ctx = createRendererContext({
    URLSearchParams,
    Promise,
    // Stubs for globals referenced in prompts.js function bodies we don't test
    state: { trackingItems: [], meetings: [], kpis: {} },
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
    ctx.saveCustomPrompt('radarScan', 'local-radar');
    ctx.saveCustomPrompt('briefing', 'local-briefing');
    ctx.saveCustomPrompt('dayBriefing', 'local-day-briefing');

    await ctx.loadPromptFiles();

    // store values used for promptCache even though IPC was called
    assert.equal(ctx.promptCache.radarScan, 'local-radar');
    assert.equal(ctx.promptCache.briefing, 'local-briefing');
    assert.equal(ctx.promptCache.dayBriefing, 'local-day-briefing');
    // IPC is still called to keep disk versions available as fallback
    assert.equal(readPromptFileCalls.length, 3,
      'IPC always called for fallback even when store has values');
  });

  it('falls back to IPC read when no localStorage value', async () => {
    await ctx.loadPromptFiles();

    // All three prompts fall through to IPC
    assert.equal(readPromptFileCalls.length, 3);
    assert.ok(readPromptFileCalls.includes('radar-scan.md'));
    assert.ok(readPromptFileCalls.includes('briefing.md'));
    assert.ok(readPromptFileCalls.includes('day-briefing.md'));
    // Disk content should be trimmed
    assert.equal(ctx.promptCache.radarScan, 'disk-radar-content');
    assert.equal(ctx.promptCache.briefing, 'disk-briefing-content');
    assert.equal(ctx.promptCache.dayBriefing, 'disk-day-briefing-content');
  });

  it('mixed: localStorage for radar, IPC for briefing and dayBriefing', async () => {
    ctx.saveCustomPrompt('radarScan', 'local-radar');
    // briefing + dayBriefing not in store → fall back to IPC

    await ctx.loadPromptFiles();

    assert.equal(ctx.promptCache.radarScan, 'local-radar');
    assert.equal(ctx.promptCache.briefing, 'disk-briefing-content');
    assert.equal(ctx.promptCache.dayBriefing, 'disk-day-briefing-content');
    // IPC always called for all three (disk fallback), but store wins for radar
    assert.equal(readPromptFileCalls.length, 3,
      'IPC always called for all prompts as fallback');
    assert.ok(readPromptFileCalls.includes('radar-scan.md'));
    assert.ok(readPromptFileCalls.includes('briefing.md'));
    assert.ok(readPromptFileCalls.includes('day-briefing.md'));
  });

  it('seeds editor elements with correct values regardless of source', async () => {
    ctx.saveCustomPrompt('radarScan', 'local-radar');
    // briefing from IPC

    await ctx.loadPromptFiles();

    assert.equal(mockElements.radarPromptEditor.value, 'local-radar',
      'Radar editor should be seeded from store');
    assert.equal(mockElements.briefingPromptEditor.value, 'disk-briefing-content',
      'Briefing editor should be seeded from disk via IPC');
  });
});

/* ================================================================== */
/*  Apply handler — saves to promptCache AND localStorage             */
/* ================================================================== */
describe('Apply handler', () => {
  beforeEach(resetTestState);

  it('radar Apply saves to promptCache AND store', async () => {
    mockElements.radarPromptEditor.value = 'my edited radar prompt';

    await mockElements.promptEditorApply._trigger('click');

    assert.equal(ctx.promptCache.radarScan, 'my edited radar prompt');
    const stored = mockStore[ctx.PROMPT_STORAGE_PREFIX + 'radarScan'];
    assert.equal(stored, 'my edited radar prompt',
      'Edited prompt should persist in store');
  });

  it('briefing Apply saves to promptCache AND store', async () => {
    mockElements.briefingPromptEditor.value = 'my edited briefing prompt';

    await mockElements.briefingPromptEditorApply._trigger('click');

    assert.equal(ctx.promptCache.briefing, 'my edited briefing prompt');
    const stored = mockStore[ctx.PROMPT_STORAGE_PREFIX + 'briefing'];
    assert.equal(stored, 'my edited briefing prompt',
      'Edited prompt should persist in store');
  });

  it('Apply with empty value does not save to store', async () => {
    mockElements.radarPromptEditor.value = '   ';

    await mockElements.promptEditorApply._trigger('click');

    assert.equal(ctx.promptCache.radarScan, '',
      'promptCache should remain empty');
    assert.equal(
      mockStore[ctx.PROMPT_STORAGE_PREFIX + 'radarScan'],
      undefined,
      'Empty/whitespace-only value should not be persisted');
  });
});

/* ================================================================== */
/*  Reset handler — clears localStorage, reloads from disk            */
/* ================================================================== */
describe('Reset handler', () => {
  beforeEach(resetTestState);

  it('radar Reset clears store AND reloads from disk', async () => {
    // Pre-condition: custom prompt is saved
    ctx.saveCustomPrompt('radarScan', 'custom radar');
    ctx.promptCache.radarScan = 'custom radar';

    await mockElements.promptEditorReset._trigger('click');

    // store entry should be removed
    assert.equal(
      mockStore[ctx.PROMPT_STORAGE_PREFIX + 'radarScan'],
      undefined,
      'Store entry should be cleared on reset'
    );
    // promptCache should have the disk version (trimmed)
    assert.equal(ctx.promptCache.radarScan, 'disk-radar-content');
    // IPC should have been called to read disk
    assert.ok(readPromptFileCalls.includes('radar-scan.md'));
  });

  it('radar Reset updates the editor element with the disk version', async () => {
    ctx.saveCustomPrompt('radarScan', 'custom radar');
    mockElements.radarPromptEditor.value = 'custom radar';

    await mockElements.promptEditorReset._trigger('click');

    assert.equal(mockElements.radarPromptEditor.value, 'disk-radar-content');
  });

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
    ctx.saveCustomPrompt('radarScan', 'custom');

    await mockElements.promptEditorReset._trigger('click');

    // showPromptEditorStatus sets textContent; setTimeout clears it later
    assert.match(
      mockElements.promptEditorStatus.textContent,
      /reset to default/i,
      'Status should indicate reset to default'
    );
  });
});
