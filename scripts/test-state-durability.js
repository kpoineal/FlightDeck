'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const { createGeneratedProfile, removeGeneratedProfile } = require('../test/fixtures/state-profile');

async function main() {
  const large = process.argv.includes('--large');
  const { directory, fixture } = createGeneratedProfile({ collisions: true, size: large ? 'large' : 'small' });
  const expectedCount = String(fixture.state.items.length);
  const originalJson = fs.readFileSync(path.join(directory, 'flightdeck-data.json'));
  let electron;
  let completed = false;
  try {
    const env = { ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory, FLIGHTDECK_STATE_DIAGNOSTICS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      executablePath: process.env.FLIGHTDECK_ELECTRON_PATH || require('electron'),
      args: [path.join(__dirname, 'state-reload-electron.cjs')], env, timeout: 30000,
    });
    const page = await electron.firstWindow();
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    const reload = () => electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus();
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['control'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: ['control'] });
    });
    const errors = [];
    page.on('pageerror', failure => errors.push(failure.message));
    await expect(page.getByTestId('today-active-count')).toHaveText(expectedCount, { timeout: 60000 });
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('button', { name: 'Review source collisions' }).click();
    await expect(page.getByText(`${large ? 100 : 25} colliding source identities`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    const row = page.locator('.radar-thread').first();
    const id = await row.getAttribute('data-thread-id');
    await row.click();
    await expect(page.getByLabel('Criticality')).toBeEnabled();
    await page.getByLabel('Criticality').selectOption('Critical');
    try {
      await Promise.all([
        page.waitForEvent('load', { timeout: 10000 }),
        reload(),
      ]);
    } catch (failure) {
      console.error(JSON.stringify({
        phase: 'controlled-reload',
        banner: await page.getByRole('status').allTextContents(),
        harness: await electron.evaluate(() => ({
          flushFailures: global.__stateHarness.flushFailures, rejectWrites: global.__stateHarness.rejectWrites,
        })),
        trace: await page.evaluate(() => window.__flightdeck_state_diagnostics()),
      }));
      throw failure;
    }
    await expect(page.getByTestId('today-active-count')).toHaveText(expectedCount);
    const afterReload = await page.evaluate(async () => window.workiq.stateQuery('projection'));
    assert.equal((await page.evaluate(id => window.workiq.stateQuery('getThread', { id }), id)).severity, 'Critical');
    assert.equal(Object.hasOwn(afterReload.value, 'trackingItems'), false);

    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await page.locator(`[data-thread-id="${id}"]`).click();
    await electron.evaluate(() => { global.__stateHarness.rejectWrites = true; });
    await page.getByLabel('Criticality').selectOption('Elevated');
    await expect(page.getByRole('status').filter({ hasText: 'Local state: failed' })).toBeVisible();
    const navigationCount = await electron.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getURL());
    await reload();
    await expect.poll(() => electron.evaluate(() => global.__stateHarness.flushFailures)).toBeGreaterThan(0);
    await expect(page.getByLabel('Criticality')).toHaveValue('Elevated');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), navigationCount);
    await electron.evaluate(() => { global.__stateHarness.rejectWrites = false; });
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Local state:' })).toHaveCount(0);

    const windowPromise = electron.waitForEvent('window');
    await page.evaluate(id => window.workiq.openTrackerPopout(id), id);
    const popout = await windowPromise;
    popout.on('pageerror', failure => errors.push(failure.message));
    await expect(popout.locator('.severity-select')).toHaveValue('Elevated');
    const revision = await popout.evaluate(async () => (await window.workiq.stateQuery('projection')).revision);
    await page.getByLabel('Criticality').selectOption('Observe');
    await expect(popout.locator('.severity-select')).toHaveValue('Observe');
    const rejected = await popout.evaluate(revision => window.workiq.stateCommand({
      commandId: crypto.randomUUID(), expectedRevision: revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'preferences', id: 'density', value: 'minimal' }] },
    }), revision);
    assert.equal(rejected.code, 'CONFLICT');
    assert.equal((await popout.evaluate(() => window.workiq.ask('gate'))).code, 'CONNECTION_NOT_READY');
    await popout.getByRole('button', { name: /Monitoring/ }).click();
    await expect(popout.getByRole('button', { name: 'Run check now' })).toBeDisabled();
    const additional = [];
    if (large) {
      await page.getByRole('button', { name: /^Archive/ }).click();
      await expect(page.locator('.radar-thread')).toHaveCount(100);
      const firstPageId = await page.locator('.radar-thread').first().getAttribute('data-thread-id');
      await page.getByRole('button', { name: 'Next threads', exact: true }).click();
      await expect.poll(() => page.locator('.radar-thread').first().getAttribute('data-thread-id')).not.toBe(firstPageId);
      await expect(page.locator('.radar-thread')).toHaveCount(100);
      const coldId = 'cold_4999';
      const coldWindow = electron.waitForEvent('window');
      await page.evaluate(id => window.workiq.openTrackerPopout(id), coldId);
      const coldPopout = await coldWindow;
      coldPopout.on('pageerror', failure => errors.push(failure.message));
      await expect(coldPopout.locator('.severity-select')).toHaveValue('Observe');
      await coldPopout.locator('.severity-select').selectOption('Critical');
      await expect.poll(() => page.evaluate(id => window.workiq.stateQuery('getThread', { id }), coldId)).toMatchObject({ severity: 'Critical' });
      const confirmation = coldPopout.waitForEvent('dialog');
      const deleting = coldPopout.getByRole('button', { name: 'Delete', exact: true }).click();
      const deleteDialog = await confirmation;
      assert.equal(deleteDialog.type(), 'confirm');
      assert.equal(deleteDialog.message(), 'Delete this item permanently?');
      // The offline main harness already answers the native dialog with response 0.
      // Observing it prevents Playwright from dismissing that already-resolved dialog.
      await deleting;
      await expect.poll(() => page.evaluate(id => window.workiq.stateQuery('getThread', { id }), coldId)).toBeNull();
      assert.deepEqual(fs.readFileSync(path.join(directory, 'flightdeck-data.json')), originalJson, 'legacy snapshots are never dual-written');
      await electron.close();
      electron = await _electron.launch({
        executablePath: process.env.FLIGHTDECK_ELECTRON_PATH || require('electron'),
        args: [path.join(__dirname, 'state-reload-electron.cjs')], env, timeout: 30000,
      });
      const restarted = await electron.firstWindow();
      await expect(restarted.getByTestId('today-active-count')).toHaveText(expectedCount);
      assert.equal(await restarted.evaluate(id => window.workiq.stateQuery('getThread', { id }), coldId), null);
      await assert.rejects(restarted.evaluate(() => window.workiq.getColdItems()), /SNAPSHOT_BACKEND_RETIRED/);
      additional.push('bounded-archive-navigation', 'cold-popout-outside-first-page', 'cold-edit-delete',
        'no-dual-write', 'restart-no-stale-json-resurrection', 'legacy-write-surface-retired');
    }
    assert.deepEqual(errors, []);
    assert.equal(await electron.evaluate(() => global.__stateHarness.remoteCalls), 0);
    const report = { ok: true, runtime: await electron.evaluate(() => process.versions),
      scenarios: ['source-collision-review', 'edit-and-controlled-Ctrl+R', 'failed-save-blocks-reload',
        'retry-save', 'popout-invalidation', 'stale-revision-rejected', 'popout-remote-gate', ...additional],
      samplesPerScenario: 1, note: 'Correctness smoke, not a latency percentile' };
    fs.writeFileSync(path.join(directory, '..', large ? 'production-electron.json' : 'durability-electron.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, scenarios: report.scenarios }));
    completed = true;
  } finally {
    if (electron && !completed) {
      await electron.evaluate(({ app }) => { global.__stateHarness.rejectWrites = false; app.exit(1); }).catch(() => {});
    }
    await electron?.close().catch(() => {});
    removeGeneratedProfile(directory);
  }
}
main().catch(failure => { console.error(failure.stack); process.exitCode = 1; });
