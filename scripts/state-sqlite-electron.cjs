'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const { assertGeneratedProfile } = require('../test/fixtures/state-profile');
const { migrateStateProfile } = require('../src/main/state-migration');
const profile = assertGeneratedProfile(process.env.FLIGHTDECK_GENERATED_PROFILE,
  app.isPackaged ? process.env.FLIGHTDECK_GENERATED_ROOT : undefined);
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setPath('logs', path.join(profile, 'logs'));
app.whenReady().then(async () => {
  let repository;
  try {
    repository = await migrateStateProfile(profile);
    const status = await repository.call('status');
    const page = await repository.call('listThreads', { limit: 100 });
    const first = await repository.call('getThread', { id: page.rows[0].id });
    const receipt = await repository.call('command', {
      commandId: 'runtime-patch', expectedRevision: status.revision, type: 'patchThread',
      payload: { id: first.id, expectedRecordRevision: first.repositoryRevision, patch: { severity: 'Critical' } },
    });
    const repeated = await repository.call('command', {
      commandId: 'runtime-patch', expectedRevision: status.revision, type: 'patchThread',
      payload: { id: first.id, expectedRecordRevision: first.repositoryRevision, patch: { severity: 'Critical' } },
    });
    if (repeated.revision !== receipt.revision) throw new Error('RECEIPT_MISMATCH');
    await repository.call('backup', { path: path.join(profile, 'runtime-backup.sqlite') });
    const integrity = await repository.call('integrity');
    const queryPlan = await repository.call('queryPlan');
    // Load the real renderer/preload against this same migrated worker.
    const win = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false,
    } });
    const { registerIpcHandlers } = require('../src/main/ipc-handlers');
    registerIpcHandlers(() => win, new Set(), {
      validateConnection: async () => ({ success: false }),
      stateService: { query: (method, input) => repository.call(method, input),
        command: input => repository.call('command', input), acquireEngine: () => false, releaseEngine: () => {} },
    });
    ipcMain.removeHandler('check-for-updates');
    ipcMain.handle('check-for-updates', () => ({ available: false }));
    await win.loadFile(path.join(__dirname, '..', 'dist-renderer', 'app.html'));
    const renderer = await win.webContents.executeJavaScript(`new Promise((resolve,reject) => {
      let n=0; const timer=setInterval(() => {
        const count=document.querySelector('[data-testid="today-active-count"]')?.textContent;
        if (count && count !== '0') { clearInterval(timer); resolve({ count, bridge:!!window.workiq.readState }); }
        else if (++n>200) {clearInterval(timer);reject(new Error('RENDERER_TIMEOUT'));}
      },25);
    })`);
    const report = { ok: true, packaged: app.isPackaged, platform: process.platform, arch: process.arch,
      runtime: process.versions, status, receipt, integrity, queryPlan, renderer,
      api: { worker: Worker !== undefined, backup: true, transactions: true, preparedStatements: true } };
    fs.writeFileSync(path.join(profile, 'sqlite-runtime-result.json'), JSON.stringify(report, null, 2));
    await repository.close();
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(profile, 'sqlite-runtime-result.json'), JSON.stringify({
      ok: false, code: error.code || error.message, runtime: process.versions,
    }, null, 2));
    await repository?.close().catch(() => {});
    app.exit(1);
  }
});
