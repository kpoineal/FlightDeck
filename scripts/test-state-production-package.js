'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const { createGeneratedProfile, removeGeneratedProfile } = require('../test/fixtures/state-profile');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function validateProfile(executablePath, legacy103) {
  const { directory, fixture } = createGeneratedProfile({ legacy103 });
  const expectedCount = (fixture.state.items || fixture.state.trackingItems).length;
  const legacyFile = path.join(directory, 'flightdeck-data.json');
  const legacyBytes = fs.readFileSync(legacyFile);
  const coldFile = path.join(directory, 'flightdeck-cold.json');
  const coldBytes = fs.existsSync(coldFile) ? fs.readFileSync(coldFile) : null;
  const errors = [];
  const scenarios = [];
  const record = (...names) => {
    scenarios.push(...names);
    console.log(JSON.stringify({ fixture: legacy103 ? '1.0.3' : 'current', passed: names }));
  };
  let electron;
  try {
    const env = { ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    async function launch() {
      const instance = await _electron.launch({ executablePath, env, cwd: path.resolve('.'), timeout: 30000 });
      await instance.evaluate(({ app, net, session, shell, dialog, ipcMain }) => {
        if (app.commandLine.getSwitchValue('host-resolver-rules') !== 'MAP * ~NOTFOUND') {
          throw new Error('Generated profile DNS isolation is required');
        }
        global.__packageSmoke = { blockedRequests: 0, dialogs: [], flushAcks: [] };
        ipcMain.on('state-flush-ack', (event, token, accepted) => {
          global.__packageSmoke.flushAcks.push({ sender: event.sender.id, token, accepted });
        });
        const showMessageBox = dialog.showMessageBox.bind(dialog);
        dialog.showMessageBox = (...args) => {
          global.__packageSmoke.dialogs.push(args.at(-1));
          return showMessageBox(...args);
        };
        const blocked = () => {
          global.__packageSmoke.blockedRequests++;
          throw new Error('Network disabled for packaged smoke');
        };
        net.request = blocked;
        shell.openExternal = blocked;
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
          const local = /^(file|devtools):/.test(details.url);
          if (!local) global.__packageSmoke.blockedRequests++;
          callback({ cancel: !local });
        });
      });
      return instance;
    }
    fs.writeFileSync(legacyFile, '{invalid-generated-import');
    electron = await launch();
    let page = await electron.firstWindow();
    page.on('pageerror', failure => errors.push(failure.message));
    await expect(page.locator('.persistence-banner')).toContainText('IMPORT_READ_FAILED');
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), '{invalid-generated-import');
    assert.equal(fs.existsSync(path.join(directory, 'state-normal', 'backend.json')), false);
    record('visible-import-refusal');
    fs.writeFileSync(legacyFile, legacyBytes);
    await page.getByRole('button', { name: 'Retry reading profile' }).click();
    await expect(page.getByTestId('today-active-count')).toHaveText(String(expectedCount));
    record('repair-and-explicit-retry');

    const metadata = await electron.evaluate(async ({ app }) => {
      const path = process.getBuiltinModule('node:path');
      const fs = process.getBuiltinModule('node:fs');
      const packagedRequire = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'));
      const require = packagedRequire;
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const sqlite = db.prepare('select sqlite_version() as version').get().version;
      db.close();
      const nativeRoot = path.join(app.getAppPath(), 'node_modules', 'node-pty');
      const nativeModules = [];
      for (const relative of ['build/Release', `prebuilds/${process.platform}-${process.arch}`]) {
        const folder = path.join(nativeRoot, relative);
        for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.node'))) {
          const exports = packagedRequire(path.join(folder, file));
          nativeModules.push({ path: `${relative}/${file}`, exports: Object.keys(exports) });
        }
      }
      const pty = packagedRequire('node-pty');
      const terminal = pty.spawn(process.env.ComSpec, ['/d', '/c', 'echo FLIGHTDECK_PACKAGED_PTY_OK'], {
        cwd: app.getPath('userData'), env: { ...process.env }, cols: 80, rows: 24,
      });
      const terminalResult = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => { terminal.kill(); reject(new Error('PTY child timed out')); }, 15000);
        const data = terminal.onData(chunk => { output += chunk; });
        const exit = terminal.onExit(result => {
          clearTimeout(timeout);
          data.dispose();
          exit.dispose();
          resolve({ output, exitCode: result.exitCode });
        });
      });
      const loadedNative = Object.keys(require.cache).filter(file => file.endsWith('.node'));
      return {
        packaged: app.isPackaged, userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
        logs: app.getPath('logs'), runtime: process.versions, sqlite, nativeModules, loadedNative,
        terminalResult, appPath: app.getAppPath(), execPath: process.execPath,
        workerPresent: fs.existsSync(path.join(app.getAppPath(), 'src', 'main', 'state-worker.js')),
        workiqPresent: fs.existsSync(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules',
          '@microsoft', 'workiq', 'bin', 'win-x64', 'workiq.exe')),
      };
    });
    assert.equal(metadata.userData, directory);
    assert.equal(metadata.sessionData, path.join(directory, 'session'));
    assert.equal(metadata.logs, path.join(directory, 'logs'));
    assert.equal(metadata.packaged, true);
    assert.equal(metadata.runtime.electron, '41.0.3');
    assert.equal(metadata.runtime.node, '24.14.0');
    assert.equal(metadata.sqlite, '3.51.2');
    assert.equal(metadata.execPath, executablePath);
    assert.match(metadata.appPath, /app\.asar$/);
    assert.equal(metadata.workerPresent, true);
    assert.equal(metadata.workiqPresent, true);
    assert.equal(metadata.terminalResult.exitCode, 0);
    assert.match(metadata.terminalResult.output, /FLIGHTDECK_PACKAGED_PTY_OK/);
    assert.equal(metadata.nativeModules.length, 6);
    assert.equal(page.url().startsWith('file:'), true);
    assert.match(page.url(), /app\.asar\/dist-renderer\/app\.html$/);
    record('packaged-runtime-asar-worker-renderer', 'all-windows-x64-native-modules-load',
      'native-pty-harmless-spawn-exit-dispose');

    const stateDirectory = path.join(directory, 'state-normal');
    const backup = fs.readdirSync(stateDirectory).find(name => name.startsWith('backup-'));
    assert.ok(backup);
    const backupDirectory = path.join(stateDirectory, backup);
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8'));
    assert.deepEqual(fs.readFileSync(path.join(backupDirectory, 'hot.json')), legacyBytes);
    assert.equal(manifest.hotHash, hash(legacyBytes));
    assert.equal(manifest.coldHash, coldBytes ? hash(coldBytes) : null);
    assert.equal(manifest.threads, expectedCount);
    assert.equal(fs.existsSync(path.join(backupDirectory, 'cold.json')), !!coldBytes);
    if (coldBytes) assert.deepEqual(fs.readFileSync(path.join(backupDirectory, 'cold.json')), coldBytes);
    record(legacy103 ? 'faithful-1.0.3-trackingItems-import-no-cold-store' : 'current-shape-import',
      'byte-identical-backup-and-sha256-manifest');

    const initial = await page.evaluate(() => window.workiq.stateQuery('projection'));
    const [target, deleted] = initial.value.items;
    const popoutPromise = electron.waitForEvent('window');
    await page.evaluate(id => window.workiq.openTrackerPopout(id), target.id);
    const popout = await popoutPromise;
    popout.on('pageerror', failure => errors.push(failure.message));
    await expect(popout.locator('.severity-select')).toHaveValue('Observe');
    const oldRevision = (await popout.evaluate(() => window.workiq.stateQuery('projection'))).revision;
    const command = await page.evaluate(({ id, revision }) => window.workiq.stateCommand({
      commandId: 'packaged-change', expectedRevision: revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id, patch: { severity: 'Critical' } }] },
    }), { id: target.id, revision: initial.revision });
    assert.equal(command.ok, true);
    await expect(popout.locator('.severity-select')).toHaveValue('Critical');
    const stale = await popout.evaluate(revision => window.workiq.stateCommand({
      commandId: 'packaged-stale', expectedRevision: revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'preferences', id: 'density', value: 'minimal' }] },
    }), oldRevision);
    assert.equal(stale.code, 'CONFLICT');
    assert.equal((await popout.evaluate(() => window.workiq.ask('offline readiness gate'))).code, 'CONNECTION_NOT_READY');
    record('incremental-edit', 'multiwindow-invalidation', 'stale-revision-refused', 'remote-readiness-gate');
    const projection = await page.evaluate(() => window.workiq.stateQuery('projection'));
    const deletion = await page.evaluate(({ id, revision }) => window.workiq.stateCommand({
      commandId: 'packaged-delete', expectedRevision: revision, type: 'deleteThread', payload: { id },
    }), { id: deleted.id, revision: projection.revision });
    assert.equal(deletion.ok, true);
    assert.equal(await page.evaluate(id => window.workiq.stateQuery('getThread', { id }), deleted.id), null);
    assert.deepEqual(fs.readFileSync(legacyFile), legacyBytes);
    record('incremental-deletion-original-json-unchanged');
    // Repository invalidation hydrates asynchronously. Wait for the real renderer
    // flush acknowledgement instead of racing quit against an in-progress load.
    await expect.poll(() => electron.evaluate(({ BrowserWindow, ipcMain }) =>
      Promise.all(BrowserWindow.getAllWindows().map(win => new Promise(resolve => {
        const token = `package-smoke-${win.id}-${Date.now()}`;
        const finish = accepted => {
          clearTimeout(timer);
          ipcMain.removeListener('state-flush-ack', ack);
          resolve(accepted);
        };
        const ack = (event, received, accepted) => {
          if (event.sender === win.webContents && received === token) finish(accepted);
        };
        const timer = setTimeout(() => finish(false), 2000);
        ipcMain.on('state-flush-ack', ack);
        win.webContents.send('state-flush-request', token);
      }))).then(results => results.every(Boolean))), { timeout: 10000 }).toBe(true);
    const offline = await electron.evaluate(() => global.__packageSmoke);
    assert.deepEqual(offline.dialogs, []);
    const closed = electron.waitForEvent('close', { timeout: 20000 });
    await electron.evaluate(({ app }) => app.quit());
    try {
      await closed;
    } catch (failure) {
      console.error(JSON.stringify({
        phase: 'coordinated-quit',
        main: await electron.evaluate(() => global.__packageSmoke),
        windows: await Promise.all(electron.windows().map(async window => ({
          url: window.url(), statuses: await window.getByRole('status').allTextContents(),
        }))),
      }));
      throw failure;
    }
    await electron.close();
    record('coordinated-quit');
    electron = null;
    fs.writeFileSync(legacyFile, '{invalid-stale-json-after-cutover');
    electron = await launch();
    page = await electron.firstWindow();
    page.on('pageerror', failure => errors.push(failure.message));
    await expect(page.getByTestId('today-active-count')).toHaveText(String(expectedCount - 1));
    assert.equal((await page.evaluate(id => window.workiq.stateQuery('getThread', { id }), target.id)).severity, 'Critical');
    assert.equal(await page.evaluate(id => window.workiq.stateQuery('getThread', { id }), deleted.id), null);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), '{invalid-stale-json-after-cutover');
    assert.deepEqual(fs.readFileSync(path.join(backupDirectory, 'hot.json')), legacyBytes);
    assert.deepEqual(errors, []);
    record('restart-stale-unreadable-json-ignored', 'persisted-edit-and-no-deletion-resurrection');
    return { ok: true, fixture: legacy103 ? '1.0.3-f61ea51' : 'current', ...metadata,
      userData: 'isolated-generated-profile', sessionData: 'isolated-generated-profile/session',
      logs: 'isolated-generated-profile/logs', manifest, offline, errors, scenarios };
  } finally {
    if (electron) {
      await electron.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await electron.close().catch(() => {});
    }
    removeGeneratedProfile(directory);
  }
}

async function main() {
  assert.ok(process.env.FLIGHTDECK_PACKAGE_PATH, 'Set FLIGHTDECK_PACKAGE_PATH to the actual packaged FlightDeck.exe');
  const executablePath = path.resolve(process.env.FLIGHTDECK_PACKAGE_PATH);
  assert.ok(fs.existsSync(executablePath));
  const profiles = [];
  for (const legacy103 of [false, true]) profiles.push(await validateProfile(executablePath, legacy103));
  const report = { ok: true, executablePath, executableSHA256: hash(fs.readFileSync(executablePath)),
    profiles, scenarioCount: profiles.reduce((count, result) => count + result.scenarios.length, 0),
    note: 'Exact packaged production entry, isolated generated profiles, offline. No installed upgrade, signing or other-platform certification.' };
  fs.writeFileSync(path.resolve('test-results', 'state-reload', 'production-package.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(failure => { console.error(failure.stack); process.exitCode = 1; });
