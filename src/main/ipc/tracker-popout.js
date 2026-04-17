const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { attachExternalNavigationGuards, getRuntimeWindowIcon, applyRuntimeWindowIcon } = require('../utils');
const { IPC_CHANNELS } = require('../../shared/ipc-contract');

const APP_ROOT = path.join(__dirname, '..', '..');
const DIST_RENDERER = path.join(APP_ROOT, '..', 'dist-renderer');
const USE_SVELTE = process.env.SVELTE !== '0' && require('fs').existsSync(path.join(DIST_RENDERER, 'popout.html'));

function registerTrackerPopoutIpc(getMainWindow, popoutWindows) {
  ipcMain.handle(IPC_CHANNELS.OPEN_TRACKER_POPOUT, async (_event, itemId) => {
    const popout = new BrowserWindow({
      width: 960,
      height: 720,
      autoHideMenuBar: true,
      icon: getRuntimeWindowIcon(APP_ROOT),
      webPreferences: {
        preload: path.join(APP_ROOT, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    applyRuntimeWindowIcon(popout, APP_ROOT);

    attachExternalNavigationGuards(popout);
    popoutWindows.add(popout);

    popout.on('closed', () => {
      popoutWindows.delete(popout);
    });

    const popoutHtml = USE_SVELTE
      ? path.join(DIST_RENDERER, 'popout.html')
      : path.join(APP_ROOT, 'index.html');
    popout.loadFile(popoutHtml, { query: { popout: String(itemId) } });
    return { success: true };
  });

  ipcMain.on(IPC_CHANNELS.TRACKER_STATE_CHANGED, (event) => {
    const senderWebContentsId = event.sender.id;
    const mainWindow = getMainWindow();

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id !== senderWebContentsId) {
      mainWindow.webContents.send(IPC_CHANNELS.TRACKER_STATE_SYNC);
    }

    for (const win of popoutWindows) {
      if (!win.isDestroyed() && win.webContents.id !== senderWebContentsId) {
        win.webContents.send(IPC_CHANNELS.TRACKER_STATE_SYNC);
      }
    }
  });
}

module.exports = {
  registerTrackerPopoutIpc,
};
