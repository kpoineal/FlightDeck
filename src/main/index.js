const { app, BrowserWindow, Tray, Menu, nativeImage, powerMonitor } = require('electron');
require('./state-profile-isolation').isolateGeneratedProfile(app);
const path = require('path');
const { diagnostics } = require('./state-diagnostics');
const endAppStart = diagnostics.begin('app-start');
diagnostics.record('app-start');
const {
  log,
  initLogFile,
  attachExternalNavigationGuards,
  getRuntimeWindowIcon,
  getWindowsAppUserModelId,
  applyRuntimeWindowIcon,
} = require('./utils');
const { loadWindowState, saveWindowState, debouncedSaveWindowState, isStateOnScreen } = require('./window-state');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createWorkiqCliClient } = require('./workiq-cli-client');
const { createStateFlush } = require('./state-flush');
const { createStateService } = require('./state-service');
const { ipcMain, dialog } = require('electron');
const stateFlush = createStateFlush(ipcMain);

const APP_ROOT = path.join(__dirname, '..');
const IS_DEMO = process.argv.includes('--demo');
const IS_DEMO_RESEED = process.argv.includes('--demo-reseed');
const DIST_RENDERER = path.join(APP_ROOT, '..', 'dist-renderer');

if (process.platform === 'win32') {
  app.setAppUserModelId(getWindowsAppUserModelId());
}

// Start writing logs to file in userData/logs/
initLogFile(path.join(app.getPath('userData'), 'logs'));

let mainWindow = null;
let appTray = null;
let isQuitting = false;
let shutdownComplete = false;
let shutdownStarted = false;
const popoutWindows = new Set();
const workiqMcpClient = createWorkiqCliClient();
const stateService = createStateService(app.getPath('userData'), { demo: IS_DEMO || IS_DEMO_RESEED });

// Register IPC handlers — pass getter for mainWindow since it's set after createWindow()
const cleanupIpc = registerIpcHandlers(() => mainWindow, popoutWindows, { workiqMcpClient, stateService });

const { IPC_CHANNELS } = require('../shared/ipc-contract');

const reloadingWindows = new Set();
async function reloadWindow(win) {
  if (!win || reloadingWindows.has(win)) return;
  reloadingWindows.add(win);
  try {
    if (await stateFlush.flush([win])) {
      await new Promise(resolve => {
        const done = () => {
          win.webContents.removeListener('did-stop-loading', done);
          win.webContents.removeListener('destroyed', done);
          resolve();
        };
        win.webContents.once('did-stop-loading', done);
        win.webContents.once('destroyed', done);
        win.webContents.reload();
      });
    }
    else await dialog.showMessageBox(win, {
      type: 'error', message: 'Reload cancelled: local state was not saved.',
      detail: 'Keep this window open. Retry saving, or resolve the profile conflict before reloading.',
    });
  } finally { reloadingWindows.delete(win); }
}

app.on('browser-window-created', (_event, win) => {
  let closing = false;
  win.on('close', event => {
    if (!popoutWindows.has(win) || shutdownComplete) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void stateFlush.flush([win]).then(async accepted => {
      if (accepted) win.destroy();
      else {
        await dialog.showMessageBox(win, { type: 'error', message: 'Close cancelled: local state was not saved.' });
        closing = false;
      }
    }).catch(() => { closing = false; log('[state] Popout close flush failed; window retained.'); });
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) {
      event.preventDefault();
      void reloadWindow(win);
    }
  });
});

function createWindow() {
  const savedState = loadWindowState(app);
  const opts = {
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (savedState && savedState.bounds && isStateOnScreen(savedState)) {
    opts.x = savedState.bounds.x;
    opts.y = savedState.bounds.y;
    opts.width = savedState.bounds.width;
    opts.height = savedState.bounds.height;
  }

  opts.icon = getRuntimeWindowIcon(APP_ROOT);

  const win = new BrowserWindow(opts);
  if (diagnostics.enabled) {
    let navigation = 0;
    let endNavigation = () => {};
    win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      navigation += 1;
      endNavigation = diagnostics.begin('window-navigation');
    });
    win.webContents.on('did-finish-load', () => endNavigation({ navigation, outcome: 'ok' }));
  }
  applyRuntimeWindowIcon(win, APP_ROOT);

  if (savedState && savedState.isMaximized) {
    win.maximize();
  }

  attachExternalNavigationGuards(win);

  const demoQuery = IS_DEMO || IS_DEMO_RESEED ? { demo: '1', ...(IS_DEMO_RESEED ? { reseed: '1' } : {}) } : {};
  const loadOpts = Object.keys(demoQuery).length ? { query: demoQuery } : {};
  win.loadFile(path.join(DIST_RENDERER, 'app.html'), loadOpts);

  win.on('resize', () => debouncedSaveWindowState(win, app));
  win.on('move', () => debouncedSaveWindowState(win, app));

  win.on('close', (event) => {
    saveWindowState(win, app);
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    win.hide();
  });

  mainWindow = win;
}

function createTrayIcon() {
  const iconPath = path.join(APP_ROOT, 'tray-icon.png');
  return nativeImage.createFromPath(iconPath);
}

function createTray() {
  if (appTray) {
    return;
  }

  appTray = new Tray(createTrayIcon());
  appTray.setToolTip('FlightDeck');
  appTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open FlightDeck',
      click: () => {
        if (!mainWindow) {
          createWindow();
          return;
        }

        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));

  appTray.on('click', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Enforce single instance — if a second launch is attempted, focus the existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    endAppStart({ outcome: 'ok' });
    diagnostics.record('app-ready');
    createWindow();
    createTray();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: (_item, win) => void reloadWindow(win || mainWindow) },
        { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ] },
      { role: 'windowMenu' },
    ]));

    // Notify renderer when window gains focus (e.g. returning after overnight)
    app.on('browser-window-focus', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.APP_RESUMED, 'focus');
      }
    });

    // Notify renderer when system wakes from sleep/suspend
    powerMonitor.on('resume', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.APP_RESUMED, 'resume');
      }
    });
  });
}

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownComplete) return;

  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void (async () => {
    if (!await stateFlush.flush([mainWindow, ...popoutWindows])) {
      shutdownStarted = false;
      isQuitting = false;
      await dialog.showMessageBox({
        type: 'error', message: 'Quit cancelled: local state was not saved.',
        detail: 'Keep FlightDeck open and retry saving. No pending edits have been discarded.',
      });
      return;
    }
    await stateService.close();
    cleanupIpc();
    await workiqMcpClient.shutdown();
    stateFlush.close();
    shutdownComplete = true;
    app.quit();
  })().catch(error => {
    shutdownStarted = false;
    isQuitting = false;
    log('[state] Quit coordination failed; application retained:', error.message);
    void dialog.showMessageBox({
      type: 'error', message: 'Quit cancelled: FlightDeck could not finish saving and shutting down.',
      detail: 'Keep this window open and preserve any unsaved edits before trying again.',
    }).catch(dialogError => log('[state] Could not show quit failure:', dialogError.message));
  });
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  createWindow();
});

app.on('window-all-closed', () => {
  // Keep app alive in tray for scheduled monitoring.
});
