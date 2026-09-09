'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  export function savePersistentState() {}
`)}`;
const actionsStub = `data:text/javascript,${encodeURIComponent(`
  export function addHistory() {}
`)}`;
const toastStub = `data:text/javascript,${encodeURIComponent(`
  export function showToast() {}
`)}`;
const jsonParserStub = `data:text/javascript,${encodeURIComponent(`
  export async function runWorkiqJson(prompt) {
    globalThis.__scannerTriggerPrompts.push(prompt);
    const transport = globalThis.__scannerTriggerTransport;
    return typeof transport === 'function' ? transport(prompt) : { radarItems: [] };
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentIsScannerEngine = context.parentURL?.endsWith('/src/svelte/lib/scanner-engine.js');
    if (parentIsScannerEngine && specifier === './persistence.js') {
      return { url: persistenceStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === './actions.js') {
      return { url: actionsStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === './json-parser.js') {
      return { url: jsonParserStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === '../components/Toast.svelte') {
      return { url: toastStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let engine;
let buildScannerPrompt;
let activeOperations;
let connected;
let get;
let items;
let scanners;
let deletedItemIds;
let originalSetInterval;
let originalClearInterval;
let originalWindow;
let timerSequence;
const timers = new Map();

function makeScanner(overrides = {}) {
  return {
    id: 'scanner-trigger',
    name: 'Trigger test scanner',
    enabled: true,
    prompt: 'Find current commitments.',
    lastRunAt: '2026-09-08T12:00:00.000Z',
    nextRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    scheduleType: 'interval',
    scheduleValue: '2h',
    workHoursOnly: false,
    maxItemsPerScan: 10,
    missedRunPolicy: 'run-once',
    signalTypes: ['email'],
    recentTitles: [],
    excludedItemIds: [],
    ...overrides,
  };
}

function installFakeIntervals() {
  timerSequence = 0;
  timers.clear();
  originalSetInterval = globalThis.setInterval;
  originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay, ...args) => {
    const handle = { id: ++timerSequence, callback, delay, args };
    timers.set(handle.id, handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    if (handle) timers.delete(handle.id);
  };
}

function restoreFakeIntervals() {
  timers.clear();
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

function fireIntervals() {
  for (const timer of [...timers.values()]) timer.callback(...timer.args);
}

async function waitForPromptCount(expectedCount) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (globalThis.__scannerTriggerPrompts.length >= expectedCount) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `RadarView is missing ${name}()`);
  const end = source.indexOf(`\n  async function ${nextName}()`, start);
  assert.notEqual(end, -1, `RadarView is missing the function boundary after ${name}()`);
  return source.slice(start, end);
}

test.before(async () => {
  ({ get } = await import('svelte/store'));
  ({ activeOperations, connected, deletedItemIds, items, scanners } = await import('../src/svelte/lib/stores.js'));
  ({ buildScannerPrompt } = await import('../src/svelte/lib/prompts.js'));
  engine = await import('../src/svelte/lib/scanner-engine.js');
});

test.beforeEach(() => {
  installFakeIntervals();
  originalWindow = globalThis.window;
  globalThis.window = { workiq: { showDesktopNotification: async () => {} } };
  globalThis.__scannerTriggerPrompts = [];
  globalThis.__scannerTriggerTransport = null;
  activeOperations.set(new Map());
  connected.set(false);
  deletedItemIds.set([]);
  items.set([]);
  scanners.set([]);
});

test.afterEach(() => {
  engine.stopScannerEngine();
  restoreFakeIntervals();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  delete globalThis.__scannerTriggerPrompts;
  delete globalThis.__scannerTriggerTransport;
  activeOperations.set(new Map());
  connected.set(false);
  deletedItemIds.set([]);
  items.set([]);
  scanners.set([]);
});

test('scanner start performs an immediate guarded due check before the 60-second timer', async () => {
  const scanner = makeScanner();
  connected.set(true);
  scanners.set([scanner]);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });

  engine.startScannerEngine();
  await waitForPromptCount(1);

  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 60_000);
  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);
  assert.equal(globalThis.__scannerTriggerPrompts[0], buildScannerPrompt(scanner, [], [scanner]));
  assert.equal(get(items).length, 0);
  assert.ok(get(scanners)[0].lastRunAt);
});

test('restart is idempotent, connected state gates scans, and pending cycles cannot overlap', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  connected.set(false);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });

  engine.startScannerEngine();
  engine.startScannerEngine();
  engine.resumeScannerEngine();
  fireIntervals();
  await waitForPromptCount(1);
  assert.equal(globalThis.__scannerTriggerPrompts.length, 0);
  assert.equal(timers.size, 1);

  connected.set(true);
  let release;
  globalThis.__scannerTriggerTransport = () => new Promise((resolve) => { release = resolve; });
  engine.resumeScannerEngine();
  await waitForPromptCount(1);
  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);

  fireIntervals();
  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);

  engine.stopScannerEngine();
  assert.equal(timers.size, 0);
  engine.resumeScannerEngine();
  assert.equal(timers.size, 1);
  fireIntervals();
  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);

  release({ radarItems: [] });
  await waitForPromptCount(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(activeOperations).size, 0);
});

test('manual Run Now handlers catch scanner rejection and expose a UI error/status path', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/svelte/components/RadarView.svelte'),
    'utf8'
  );
  const runScannerNow = functionSource(source, 'runScannerNow', 'runEditingScanner');
  const runEditingScanner = functionSource(source, 'runEditingScanner', 'runSelectedScanner');

  assert.match(runScannerNow, /try\s*\{/);
  assert.match(runScannerNow, /await\s+runScanner\(/);
  assert.match(runScannerNow, /catch\b/);
  assert.match(runScannerNow, /(status|message|showToast|error)/i);
  assert.match(runEditingScanner, /await\s+runScannerNow\(editingScanner\)/);
});

test('a valid zero-item scan updates scanner run bookkeeping without creating a radar item', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });

  await engine.runScanner(scanner);

  const updatedScanner = get(scanners)[0];
  assert.equal(get(items).length, 0);
  assert.equal(updatedScanner.itemCount, 0);
  assert.equal(updatedScanner.lastRunStatus, 'success');
  assert.ok(updatedScanner.lastRunAt);
  assert.notEqual(updatedScanner.lastRunAt, scanner.lastRunAt);
  assert.ok(updatedScanner.nextRunAt);
});

test('scanner execution passes the unchanged generated prompt to mocked WorkIQ transport', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });

  await engine.runScanner(scanner);

  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);
  assert.equal(globalThis.__scannerTriggerPrompts[0], buildScannerPrompt(scanner, [], [scanner]));
});