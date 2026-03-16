const { screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { log, logError } = require('./utils');

let windowStateTimeout = null;

function getWindowStatePath(app) {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(app) {
  try {
    const statePath = getWindowStatePath(app);
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf-8');
      log('[main] Loaded window state:', data);
      return JSON.parse(data);
    }
  } catch (e) {
    logError('[main] Failed to load window state:', e.message);
  }
  return null;
}

function saveWindowState(win, app) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    const isMaximized = win.isMaximized();
    // When maximized, preserve the previous normal bounds
    const bounds = isMaximized ? (loadWindowState(app) || {}).bounds || win.getBounds() : win.getBounds();
    const state = { bounds, isMaximized };
    fs.writeFileSync(getWindowStatePath(app), JSON.stringify(state));
  } catch (e) {
    logError('[main] Failed to save window state:', e.message);
  }
}

function debouncedSaveWindowState(win, app) {
  if (windowStateTimeout) clearTimeout(windowStateTimeout);
  windowStateTimeout = setTimeout(() => saveWindowState(win, app), 500);
}

function isStateOnScreen(state) {
  const displays = screen.getAllDisplays();
  return displays.some(display => {
    const { x, y, width, height } = display.workArea;
    return (
      state.bounds.x < x + width &&
      state.bounds.x + state.bounds.width > x &&
      state.bounds.y < y + height &&
      state.bounds.y + state.bounds.height > y
    );
  });
}

module.exports = {
  getWindowStatePath,
  loadWindowState,
  saveWindowState,
  debouncedSaveWindowState,
  isStateOnScreen,
};
