const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { log, initLogFile, attachExternalNavigationGuards } = require('./utils');
const { loadWindowState, saveWindowState, debouncedSaveWindowState, isStateOnScreen } = require('./window-state');
const { registerIpcHandlers } = require('./ipc-handlers');

const APP_ROOT = path.join(__dirname, '..');
const IS_DEMO = process.argv.includes('--demo');

app.setAppUserModelId('com.flightdeck.app');

// Start writing logs to file in userData/logs/
initLogFile(path.join(app.getPath('userData'), 'logs'));

let mainWindow = null;
let appTray = null;
let isQuitting = false;
const popoutWindows = new Set();

// Register IPC handlers — pass getter for mainWindow since it's set after createWindow()
registerIpcHandlers(() => mainWindow, popoutWindows);

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

  opts.icon = path.join(APP_ROOT, 'icon.png');

  const win = new BrowserWindow(opts);

  if (savedState && savedState.isMaximized) {
    win.maximize();
  }

  attachExternalNavigationGuards(win);

  const loadOpts = IS_DEMO ? { query: { demo: '1' } } : {};
  win.loadFile(path.join(APP_ROOT, 'index.html'), loadOpts);

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

app.setAppUserModelId('FlightDeck');

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
