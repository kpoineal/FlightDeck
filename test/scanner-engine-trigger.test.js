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
  export function addHistory(...args) { globalThis.__scannerTriggerHistory.push(args); }
`)}`;
const toastStub = `data:text/javascript,${encodeURIComponent(`
  export function showToast() {}
`)}`;
const jsonParserStub = `data:text/javascript,${encodeURIComponent(`
  export async function runWorkiqJson(prompt, validator, label, options) {
    globalThis.__scannerTriggerPrompts.push(prompt);
    globalThis.__scannerTriggerOptions.push(options);
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
  globalThis.__scannerTriggerOptions = [];
  globalThis.__scannerTriggerHistory = [];
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
  delete globalThis.__scannerTriggerOptions;
  delete globalThis.__scannerTriggerHistory;
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
  assert.deepEqual(globalThis.__scannerTriggerOptions[0], { priority: 'background', key: `scanner:${scanner.id}` });
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
  assert.deepEqual(globalThis.__scannerTriggerOptions[0], { priority: 'interactive', key: `scanner:${scanner.id}` });

  const updatedScanner = get(scanners)[0];
  assert.equal(get(items).length, 0);
  assert.equal(updatedScanner.itemCount, 0);
  assert.equal(updatedScanner.lastRunStatus, 'success');
  assert.ok(updatedScanner.lastRunAt);
  assert.notEqual(updatedScanner.lastRunAt, scanner.lastRunAt);
  assert.ok(updatedScanner.nextRunAt);
});

test('five scanner workers start in parallel, revalidate deferred jobs, and do not stack ticks', async () => {
  const due = Array.from({ length: 9 }, (_, index) => makeScanner({ id: `parallel-${index}`, name: `Scanner ${index}` }));
  scanners.set(due);
  connected.set(true);
  const releases = [];
  let active = 0;
  let peak = 0;
  globalThis.__scannerTriggerTransport = () => {
    active++;
    peak = Math.max(peak, active);
    return new Promise((resolve) => releases.push(() => { active--; resolve({ radarItems: [] }); }));
  };
  engine.startScannerEngine();
  await waitForPromptCount(5);
  assert.equal(globalThis.__scannerTriggerPrompts.length, 5);
  assert.equal(peak, 5);
  fireIntervals();
  engine.resumeScannerEngine();
  assert.equal(globalThis.__scannerTriggerPrompts.length, 5);
  scanners.update((current) => current.filter((s) => s.id !== 'parallel-5').map((s) =>
    s.id === 'parallel-6' ? { ...s, enabled: false } :
    s.id === 'parallel-7' ? { ...s, nextRunAt: new Date(Date.now() + 3600000).toISOString() } :
    s.id === 'parallel-8' ? { ...s, prompt: 'Latest deferred prompt' } : s));
  releases[0]();
  await waitForPromptCount(6);
  assert.equal(globalThis.__scannerTriggerPrompts.length, 6);
  assert.match(globalThis.__scannerTriggerPrompts[5], /Latest deferred prompt/);
  assert.deepEqual(globalThis.__scannerTriggerOptions[5], { priority: 'background', key: 'scanner:parallel-8' });
  releases.slice(1).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(activeOperations).size, 0);
  assert.equal(peak, 5);
});

test('QUEUE_FULL leaves automatic scanner due without recording failure and retries next tick', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  connected.set(true);
  globalThis.__scannerTriggerTransport = () => { throw Object.assign(new Error('Full'), { code: 'QUEUE_FULL' }); };
  engine.startScannerEngine();
  await waitForPromptCount(1);
  await new Promise((resolve) => setImmediate(resolve));
  const deferred = get(scanners)[0];
  assert.equal(deferred.lastRunAt, scanner.lastRunAt);
  assert.notEqual(deferred.lastRunStatus, 'failed');
  assert.equal(globalThis.__scannerTriggerHistory.length, 0);
  assert.ok(new Date(deferred.nextRunAt).getTime() <= Date.now());
  assert.equal(get(activeOperations).size, 0);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });
  fireIntervals();
  await waitForPromptCount(2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(scanners)[0].lastRunStatus, 'success');
});

test('parallel scanner results still deduplicate before synchronous store merge', async () => {
  const due = [makeScanner({ id: 'dedup-a' }), makeScanner({ id: 'dedup-b' })];
  scanners.set(due);
  connected.set(true);
  const releases = [];
  globalThis.__scannerTriggerTransport = () => new Promise((resolve) => releases.push(resolve));
  engine.startScannerEngine();
  await waitForPromptCount(2);
  const payload = { radarItems: [{ id: 'shared-result', title: 'One shared result', summary: 'Shared evidence' }] };
  releases.forEach((resolve) => resolve(payload));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(items).length, 1);
  assert.equal(get(items)[0].id, 'shared-result');
  assert.equal(get(scanners).filter((s) => s.lastRunStatus === 'success').length, 2);
});

test('same-scanner lease prevents a manual duplicate while the first call is pending', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  let release;
  globalThis.__scannerTriggerTransport = () => new Promise((resolve) => { release = resolve; });
  const first = engine.runScanner(scanner);
  await waitForPromptCount(1);
  assert.deepEqual(await engine.runScanner(scanner), { ok: false, code: 'BUSY' });
  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);
  release({ radarItems: [] });
  await first;
  assert.equal(get(activeOperations).size, 0);
});

test('EULA failure disconnects scanner cycle and stops dispatching deferred work', async () => {
  scanners.set(Array.from({ length: 7 }, (_, index) => makeScanner({ id: `eula-${index}` })));
  connected.set(true);
  const releases = [];
  let rejectFirst;
  globalThis.__scannerTriggerTransport = () => new Promise((resolve, reject) => {
    if (!rejectFirst) rejectFirst = reject;
    releases.push(() => resolve({ radarItems: [] }));
  });
  engine.startScannerEngine();
  await waitForPromptCount(5);
  rejectFirst(new Error('WorkIQ EULA not accepted'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(connected), false);
  assert.equal(timers.size, 0);
  releases.forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(globalThis.__scannerTriggerPrompts.length, 5);
});

test('scanner execution passes the unchanged generated prompt to mocked WorkIQ transport', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerTriggerTransport = async () => ({ radarItems: [] });

  await engine.runScanner(scanner);

  assert.equal(globalThis.__scannerTriggerPrompts.length, 1);
  assert.equal(globalThis.__scannerTriggerPrompts[0], buildScannerPrompt(scanner, [], [scanner]));
});