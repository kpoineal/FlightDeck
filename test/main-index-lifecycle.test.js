'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { electronMock } = require('./helpers/electron-mock');
const { IPC_CHANNELS } = require('../src/shared/ipc-contract');

it('real entry keeps queue broadcasts across close-to-tray/reopen and unsubscribes at actual teardown', async () => {
  const windows = [];
  const trays = [];
  const listeners = new Set();
  let unsubscribes = 0;
  let shutdowns = 0;
  let quits = 0;
  let resolveShutdown;
  const shutdownGate = new Promise((resolve) => { resolveShutdown = resolve; });
  const app = Object.assign(new EventEmitter(), {
    getPath: () => path.resolve(__dirname, '..'),
    setAppUserModelId() {},
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit: () => { quits++; },
  });
  class Window extends EventEmitter {
    constructor() {
      super();
      this.visible = true;
      this.sent = [];
      this.webContents = { isDestroyed: () => false, send: (...args) => this.sent.push(args) };
      windows.push(this);
    }
    loadFile() {}
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    focus() {}
  }
  class Tray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  Object.assign(electronMock, {
    app, BrowserWindow: Window, Tray,
    Menu: { buildFromTemplate: (template) => template },
    powerMonitor: new EventEmitter(),
  });
  const { registerIpcHandlers } = require('../src/main/ipc-handlers');
  const client = {
    onQueueStatus(callback) {
      listeners.add(callback);
      return () => { unsubscribes++; listeners.delete(callback); };
    },
    shutdown() { shutdowns++; return shutdownGate; },
  };
  const entry = path.resolve(__dirname, '../src/main/index.js');
  const requireEntry = createRequire(entry);
  const stubs = {
    electron: electronMock,
    './ipc-handlers': { registerIpcHandlers },
    './workiq-mcp-client': { createWorkiqMcpClient: () => client },
    './window-state': { loadWindowState: () => null, saveWindowState() {}, debouncedSaveWindowState() {} },
    './utils': {
      log() {}, initLogFile() {}, attachExternalNavigationGuards() {},
      getRuntimeWindowIcon() {}, getWindowsAppUserModelId: () => 'test', applyRuntimeWindowIcon() {},
    },
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    require: (specifier) => stubs[specifier] || requireEntry(specifier),
    __dirname: path.dirname(entry), process,
  }, { filename: entry });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows.length, 1);
  assert.equal(listeners.size, 1);
  const win = windows[0];
  const publish = (active) => {
    const snapshot = { active, pending: 0, limit: 5, backgroundLimit: 4, cooldownUntil: 0 };
    for (const listener of listeners) listener(snapshot);
  };
  publish(1);
  let closePrevented = false;
  win.emit('close', { preventDefault() { closePrevented = true; } });
  assert.equal(closePrevented, true);
  assert.equal(win.isVisible(), false);
  assert.equal(unsubscribes, 0);
  publish(2);
  trays[0].menu.find((item) => item.label === 'Open FlightDeck').click();
  assert.equal(win.isVisible(), true);
  publish(3);
  assert.deepEqual(win.sent.filter(([channel]) => channel === IPC_CHANNELS.WORKIQ_QUEUE_STATUS_CHANGED)
    .map(([, status]) => status.active), [1, 2, 3]);
  let quitPrevented = false;
  app.emit('before-quit', { preventDefault() { quitPrevented = true; } });
  assert.equal(quitPrevented, true);
  assert.equal(unsubscribes, 1);
  assert.equal(listeners.size, 0);
  assert.equal(shutdowns, 1);
  app.emit('before-quit', { preventDefault() {} });
  assert.equal(unsubscribes, 1);
  assert.equal(shutdowns, 1);
  publish(4);
  assert.equal(win.sent.length, 3);
  resolveShutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quits, 1);
  app.emit('before-quit', { preventDefault() { assert.fail('completed teardown must not be prevented'); } });
  assert.equal(unsubscribes, 1);
});
