// Offline-only entrypoint: isolate before any production module opens stores/logs.
const { app, session, net, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { assertGeneratedProfile } = require('../test/fixtures/state-profile');
const profile = assertGeneratedProfile(process.env.FLIGHTDECK_GENERATED_PROFILE);
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setPath('logs', path.join(profile, 'logs'));

global.__stateHarness = { held: false, validators: 0, remoteCalls: 0, release: null, validationSuccess: true, rejectWrites: false, flushFailures: 0, pageQueries: [] };
app.on('browser-window-created', (_event, win) => {
  const reload = win.webContents.reload.bind(win.webContents);
  win.webContents.reload = () => {
    global.__stateHarness.reloads = (global.__stateHarness.reloads || 0) + 1;
    return reload();
  };
});
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options.type === 'error') global.__stateHarness.flushFailures++;
  return { response: 0 };
};
dialog.showMessageBoxSync = () => 0;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'state-query') return handle(channel, async (...args) => {
    if (args[1] === 'getThread') {
      if (args[2].id === global.__stateHarness.failThreadReadId) throw new Error('Synthetic thread read failure');
      if (args[2].id === global.__stateHarness.holdThreadReadId) {
        await new Promise(resolve => { global.__stateHarness.releaseThreadRead = resolve; });
      }
    }
    const result = await handler(...args);
    if (args[1] === 'radarPage') {
      global.__stateHarness.pageQueries.push({ offset: args[2].offset, revision: result.revision });
      if (global.__stateHarness.pageQueries.length > 256) global.__stateHarness.pageQueries.shift();
    }
    return result;
  });
  return handle(channel, channel === 'store-set' || channel === 'state-command'
    ? async (...args) => {
      if (channel === 'state-command' && args[1]?.payload?.changes?.some(change =>
        change.domain === 'deletedItemIds' && change.id === global.__stateHarness.failDeletionOnceId)) {
        global.__stateHarness.failDeletionOnceId = null;
        return { ok: false, code: 'SYNTHETIC_WRITE_FAILURE' };
      }
      if (global.__stateHarness.rejectWrites) return { success: false };
      const result = await handler(...args);
      if (channel === 'state-command' && args[1]?.payload?.changes?.some(change =>
        change.domain === 'deletedItemIds' && change.id === global.__stateHarness.loseDeletionAckId)) {
        global.__stateHarness.loseDeletionAckId = null;
        throw new Error('Synthetic deletion acknowledgement loss');
      }
      return result;
    }
    : handler);
};
function blocked() {
  global.__stateHarness.remoteCalls++;
  throw new Error('Remote operation blocked by offline harness');
}
net.request = blocked;
shell.openExternal = blocked;
require.cache[require.resolve('../src/main/pty-bridge')] = {
  exports: {
    runWorkiqAcceptEula: async () => {
      global.__stateHarness.validators++;
      if (global.__stateHarness.held) {
        await new Promise(resolve => { global.__stateHarness.release = resolve; });
      }
      return { success: global.__stateHarness.validationSuccess };
    },
  },
};
require.cache[require.resolve('../src/main/workiq-mcp-client')] = {
  exports: { createWorkiqMcpClient: () => ({
    ask: async () => ({ success: true, answer: '{"meetings":[],"items":[]}' }),
    probe: async () => ({ ok: false, code: 'OFFLINE' }),
    onQueueStatus: () => () => {},
    shutdown: async () => {},
  }) },
};
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith('file:') || details.url.startsWith('devtools:');
    if (!allowed) global.__stateHarness.remoteCalls++;
    callback({ cancel: !allowed });
  });
});
require('../src/main/index');
const { IPC_CHANNELS } = require('../src/shared/ipc-contract');
ipcMain.removeHandler(IPC_CHANNELS.CHECK_FOR_UPDATES);
ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, () => ({ available: false }));
