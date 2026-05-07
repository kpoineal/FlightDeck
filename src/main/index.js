const { app, BrowserWindow, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
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
const popoutWindows = new Set();

// Register IPC handlers — pass getter for mainWindow since it's set after createWindow()
registerIpcHandlers(() => mainWindow, popoutWindows);

const { IPC_CHANNELS } = require('../shared/ipc-contract');

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
    createWindow();
    createTray();

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

app.on('before-quit', () => {
  isQuitting = true;
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
