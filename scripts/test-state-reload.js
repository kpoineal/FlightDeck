const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { createGeneratedProfile, removeGeneratedProfile, STORAGE_KEY } = require('../test/fixtures/state-profile');

const ROOT = path.resolve(__dirname, '..');
const nodeOnly = process.argv.includes('--node');
const samplesArg = process.argv.find(arg => arg.startsWith('--samples='));
const samples = samplesArg ? Number(samplesArg.split('=')[1]) : 30;
if (!Number.isInteger(samples) || samples < 1 || samples > 200) throw new Error('samples must be 1..200');

function statistics(values) {
  if (values.length < 30) return { samples: values.length, rawMs: values, note: 'Smoke only; insufficient samples for percentiles' };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length, medianMs: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1), rawMs: values,
  };
}

async function nodeBaseline(directory) {
  const Conf = (await import('conf')).default;
  const hot = new Conf({ cwd: directory, configName: 'flightdeck-data', projectName: 'flightdeck-offline' });
  const cold = new Conf({ cwd: directory, configName: 'flightdeck-cold', projectName: 'flightdeck-offline' });
  const canonical = hot.get(STORAGE_KEY);
  delete canonical.trackingItems;
  delete canonical.radarItems;
  hot.set(STORAGE_KEY, canonical);
  const reads = [], writes = [], coldReads = [];
  for (let i = 0; i < samples; i++) {
    let start = performance.now();
    const state = hot.get(STORAGE_KEY);
    reads.push(performance.now() - start);
    start = performance.now();
    hot.set(STORAGE_KEY, state);
    writes.push(performance.now() - start);
    start = performance.now();
    cold.get('items');
    coldReads.push(performance.now() - start);
  }
  return {
    hotRead: statistics(reads), hotWrite: statistics(writes), coldRead: statistics(coldReads),
    measuredFileBytes: {
      hot: fs.statSync(path.join(directory, 'flightdeck-data.json')).size,
      cold: fs.statSync(path.join(directory, 'flightdeck-cold.json')).size,
    },
  };
}

async function electronBaseline(directory, connected, expectedCount) {
  const { _electron } = require('playwright');
  const { expect } = require('@playwright/test');
  const environment = { ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory, FLIGHTDECK_STATE_DIAGNOSTICS: '1' };
  delete environment.ELECTRON_RUN_AS_NODE;
  const start = performance.now();
  const electron = await _electron.launch({
    ...(process.env.FLIGHTDECK_ELECTRON_PATH ? { executablePath: process.env.FLIGHTDECK_ELECTRON_PATH } : {}),
    args: [path.join(__dirname, 'state-reload-electron.cjs')], cwd: ROOT, env: environment, timeout: 30_000,
  });
  let completed = false;
  try {
    const runtime = await electron.evaluate(() => ({
      electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    }));
    const page = await electron.firstWindow();
    const reload = async () => {
      const previousRun = await page.evaluate(async () => (await window.__flightdeck_state_diagnostics()).renderer.run);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), electron.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.focus();
        win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['control'] });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: ['control'] });
      })]);
      await page.waitForFunction(async previous => {
        if (typeof window.__flightdeck_state_diagnostics !== 'function') return false;
        const trace = (await window.__flightdeck_state_diagnostics()).renderer;
        return trace.run !== previous && trace.entries.some(entry => entry.operation === 'startup-complete');
      }, previousRun, { timeout: 30000 });
    };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const localInteraction = async () => {
      await expect(page.getByTestId('today-active-count')).toHaveText(String(expectedCount), { timeout: 30_000 });
      const button = page.getByTestId('today-status-in-progress');
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.getByTestId('today-chart-selection')).toBeVisible();
    };
    const ready = () => page.waitForFunction(() =>
      typeof window.__flightdeck_state_diagnostics === 'function'
      && window.workiq.getStateDiagnostics
      && document.querySelector('[data-testid="today-active-count"]')?.textContent !== '0');
    await ready();
    await localInteraction();
    const coldAppObservedMs = performance.now() - start;
    await page.waitForFunction(async () => (await window.__flightdeck_state_diagnostics()).renderer.entries.some(entry => entry.operation === 'startup-complete'));
    const startup = await page.evaluate(async () => (await window.__flightdeck_state_diagnostics()).renderer.entries.map(entry => entry.operation));
    const order = ['cached-published', 'subscriptions-installed', 'startup-complete'];
    for (let i = 1; i < order.length; i++) {
      assert.ok(startup.indexOf(order[i - 1]) >= 0 && startup.indexOf(order[i - 1]) < startup.indexOf(order[i]), `Startup order: ${order[i - 1]} before ${order[i]}`);
    }
    // Separate actual remote cache/meeting maintenance from initial subscription effects.
    await page.waitForTimeout(1000);
    if (!connected) {
      const idle = await page.evaluate(() => window.__flightdeck_state_diagnostics());
      assert.equal(idle.renderer.entries.filter(entry => entry.operation === 'save-write').length, 0, 'No idle snapshot save');
    }
    if (connected) {
      await page.evaluate(() => window.workiq.disconnect());
      const before = await electron.evaluate(() => {
        global.__stateHarness.held = true;
        return global.__stateHarness.validators;
      });
      await reload();
      await expect.poll(() => electron.evaluate(() => global.__stateHarness.validators)).toBeGreaterThan(before);
      await page.waitForTimeout(150);
      await localInteraction();
      const blocked = await page.evaluate(() => window.workiq.ask('offline gate check'));
      assert.equal(blocked.code, 'CONNECTION_NOT_READY');
      await electron.evaluate(() => {
        global.__stateHarness.held = false;
        global.__stateHarness.release();
      });
      await ready();
      await page.waitForTimeout(1000);
      await electron.evaluate(() => { global.__stateHarness.validationSuccess = false; });
      await page.evaluate(() => window.workiq.disconnect());
      await reload();
      await localInteraction();
      await expect(page.getByRole('button', { name: 'Retry WorkIQ' })).toBeVisible();
      assert.equal((await page.evaluate(() => window.workiq.ask('failed gate check'))).code, 'CONNECTION_NOT_READY');
      await electron.evaluate(() => { global.__stateHarness.validationSuccess = true; });
      await page.getByRole('button', { name: 'Retry WorkIQ' }).click();
      await expect(page.getByRole('button', { name: 'Retry WorkIQ' })).toHaveCount(0);
    }
    const reloads = [], publications = [], validations = [];
    let trace;
    for (let i = 0; i < samples; i++) {
      const reloadStart = performance.now();
      await reload();
      await ready();
      await localInteraction();
      reloads.push(performance.now() - reloadStart);
      const deadline = performance.now() + 30000;
      do {
        trace = await page.evaluate(() => window.__flightdeck_state_diagnostics());
        if (trace.renderer.entries.some(entry => entry.operation === 'startup-complete')
          && trace.renderer.entries.some(entry => entry.operation === 'hydrate')) break;
        await page.waitForTimeout(50);
      } while (performance.now() < deadline);
      const entries = trace.renderer.entries;
      assert.ok(entries.some(entry => entry.operation === 'renderer-reload'));
      assert.equal((await page.evaluate(() => window.workiq.stateQuery('status'))).schemaVersion, 1);
      const publication = entries.find(entry => entry.operation === 'hydrate');
      assert.ok(publication, `Missing hydration span: ${JSON.stringify(trace.renderer)}, reloads=${await electron.evaluate(() => global.__stateHarness.reloads)}, sample=${i}`);
      publications.push(publication.durationMs);
      const validation = entries.find(entry => entry.operation === 'connection-validate');
      if (validation) validations.push(validation.durationMs);
      // Include existing idle-save effects between navigations, not inside the UI metric.
      await page.waitForTimeout(750);
    }
    assert.deepEqual(errors, [], 'Production renderer errors');
    assert.equal(await electron.evaluate(() => global.__stateHarness.remoteCalls), 0);
    const exported = JSON.stringify(trace);
    for (const forbidden of ['Generated thread', 'Synthetic summary', 'Offline generated prompt', 'source:v1:', directory]) {
      assert.ok(!exported.includes(forbidden), 'Diagnostic trace contains non-allowlisted fixture content');
    }
    completed = true;
    return {
      runtime,
      coldAppObservedMs, coldAppSamples: 1,
      warmReloadVerifiedLocalInteraction: statistics(reloads),
      cachedHydrationIncludingRepairs: statistics(publications),
      ...(connected ? { stubValidation: statistics(validations), heldValidatorCacheUsable: true, failedValidationCacheUsable: true } : {}),
      trace,
    };
  } finally {
    if (!completed) await electron.evaluate(({ app }) => app.exit(1)).catch(() => {});
    await electron.close().catch(error => { if (completed) throw error; });
  }
}

async function main() {
  const report = {
    mode: nodeOnly ? 'Conf storage microbenchmark; NOT Electron E2E' : 'Electron production renderer, offline stubs; observer includes Playwright interaction overhead',
    runtime: {
      node: process.version, platform: process.platform, arch: process.arch,
      osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
    },
    diagnostics: nodeOnly ? 'off; direct Conf calls' : 'on',
    definitions: {
      hotRead: 'Conf.get of canonical key, entire hot file parse',
      hotWrite: 'Conf.set of unchanged canonical key without array aliases; separate pre-existing demo snapshot retained',
      coldRead: 'Conf.get of entire cold array',
      warmReload: 'same Electron main/profile; native controlled Ctrl+R (including acknowledged flush) through verified Today count plus enabled status-button click and visible selection; no claim of first paint',
      coldApp: 'single process launch through same interaction; uncontrolled OS filesystem caches; not a percentile',
    },
    scenarios: [],
  };
  for (const size of ['small', 'large']) {
    for (const connected of nodeOnly ? [false] : [false, true]) {
      const { directory, fixture } = createGeneratedProfile({ size, connected, collisions: true });
      try {
        const fixtureBytes = {
          hot: fs.statSync(path.join(directory, 'flightdeck-data.json')).size,
          cold: fs.statSync(path.join(directory, 'flightdeck-cold.json')).size,
        };
        const result = await (nodeOnly ? nodeBaseline(directory) : electronBaseline(directory, connected, fixture.state.items.length));
        report.scenarios.push({ size, connected, hotCount: fixture.state.items.length, coldCount: fixture.cold.length, fixtureBytes, ...result });
        console.log(`${size}/${connected ? 'connected' : 'disconnected'}: ${samples} samples passed`);
      } finally {
        removeGeneratedProfile(directory);
      }
    }
  }
  const output = path.join(ROOT, 'test-results', 'state-reload', nodeOnly ? 'node-baseline.json' : 'electron-baseline.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Report: ${path.relative(ROOT, output)}`);
}

main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
