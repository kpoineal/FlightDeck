'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { electronMock } = require('./helpers/electron-mock');
const { IPC_CHANNELS } = require('../src/shared/ipc-contract');

describe('registerTrackerPopoutIpc()', () => {
  let handlers;
  let eventHandlers;
  let BrowserWindowMock;

  beforeEach(() => {
    handlers = new Map();
    eventHandlers = new Map();

    electronMock.ipcMain.handle = (channel, handler) => {
      handlers.set(channel, handler);
    };
    electronMock.ipcMain.on = (channel, handler) => {
      eventHandlers.set(channel, handler);
    };

    let nextId = 200;
    BrowserWindowMock = class BrowserWindow {
      constructor() {
        this.webContents = {
          id: nextId++,
          sendCalls: [],
          send: (channel) => {
            this.webContents.sendCalls.push(channel);
          },
          setWindowOpenHandler: () => {},
          on: () => {},
          getURL: () => 'about:blank',
        };
        this.closedHandlers = [];
        this.loadFileArgs = null;
        this.destroyed = false;
      }

      on(eventName, cb) {
        if (eventName === 'closed') {
          this.closedHandlers.push(cb);
        }
      }

      emitClosed() {
        for (const cb of this.closedHandlers) {
          cb();
        }
      }

      loadFile(filePath, options) {
        this.loadFileArgs = { filePath, options };
      }

      isDestroyed() {
        return this.destroyed;
      }
    };
    electronMock.BrowserWindow = BrowserWindowMock;

    const trackerPath = path.resolve(__dirname, '../src/main/ipc/tracker-popout.js');
    delete require.cache[trackerPath];
  });

  it('registers tracker popout IPC channels', () => {
    const { registerTrackerPopoutIpc } = require('../src/main/ipc/tracker-popout');
    registerTrackerPopoutIpc(() => null, new Set());

    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_TRACKER_POPOUT), 'function');
    assert.equal(typeof eventHandlers.get(IPC_CHANNELS.TRACKER_STATE_CHANGED), 'function');
  });

  it('creates a popout window and removes it from set on close', async () => {
    const { registerTrackerPopoutIpc } = require('../src/main/ipc/tracker-popout');
    const popoutWindows = new Set();
    registerTrackerPopoutIpc(() => null, popoutWindows);

    const openPopout = handlers.get(IPC_CHANNELS.OPEN_TRACKER_POPOUT);
    const result = await openPopout(null, 'task-42');

    assert.deepEqual(result, { success: true });
    assert.equal(popoutWindows.size, 1);

    const [createdWindow] = [...popoutWindows];
    assert.ok(createdWindow instanceof BrowserWindowMock);
    assert.ok(createdWindow.loadFileArgs);
    assert.ok(createdWindow.loadFileArgs.filePath.endsWith(path.join('src', 'index.html')));
    assert.deepEqual(createdWindow.loadFileArgs.options, { query: { popout: 'task-42' } });

    createdWindow.emitClosed();
    assert.equal(popoutWindows.size, 0);
  });

  it('broadcasts tracker sync to non-sender main and popout windows only', () => {
    const { registerTrackerPopoutIpc } = require('../src/main/ipc/tracker-popout');

    const mainWindow = {
      destroyed: false,
      webContents: {
        id: 1,
        sendCalls: [],
        send(channel) {
          this.sendCalls.push(channel);
        },
      },
      isDestroyed() {
        return this.destroyed;
      },
    };

    const senderPopout = {
      destroyed: false,
      webContents: {
        id: 2,
        sendCalls: [],
        send(channel) {
          this.sendCalls.push(channel);
        },
      },
      isDestroyed() {
        return this.destroyed;
      },
    };

    const siblingPopout = {
      destroyed: false,
      webContents: {
        id: 3,
        sendCalls: [],
        send(channel) {
          this.sendCalls.push(channel);
        },
      },
      isDestroyed() {
        return this.destroyed;
      },
    };

    const destroyedPopout = {
      destroyed: true,
      webContents: {
        id: 4,
        sendCalls: [],
        send(channel) {
          this.sendCalls.push(channel);
        },
      },
      isDestroyed() {
        return this.destroyed;
      },
    };

    const popoutWindows = new Set([senderPopout, siblingPopout, destroyedPopout]);
    registerTrackerPopoutIpc(() => mainWindow, popoutWindows);

    const onStateChanged = eventHandlers.get(IPC_CHANNELS.TRACKER_STATE_CHANGED);
    onStateChanged({ sender: { id: 2 } });

    assert.deepEqual(mainWindow.webContents.sendCalls, [IPC_CHANNELS.TRACKER_STATE_SYNC]);
    assert.deepEqual(senderPopout.webContents.sendCalls, []);
    assert.deepEqual(siblingPopout.webContents.sendCalls, [IPC_CHANNELS.TRACKER_STATE_SYNC]);
    assert.deepEqual(destroyedPopout.webContents.sendCalls, []);
  });

  it('does not fanout when main window is destroyed and no popouts are active', () => {
    const { registerTrackerPopoutIpc } = require('../src/main/ipc/tracker-popout');

    const mainWindow = {
      destroyed: true,
      webContents: {
        id: 1,
        sendCalls: [],
        send(channel) {
          this.sendCalls.push(channel);
        },
      },
      isDestroyed() {
        return this.destroyed;
      },
    };

    const popoutWindows = new Set();
    registerTrackerPopoutIpc(() => mainWindow, popoutWindows);

    const onStateChanged = eventHandlers.get(IPC_CHANNELS.TRACKER_STATE_CHANGED);
    onStateChanged({ sender: { id: 77 } });

    assert.deepEqual(mainWindow.webContents.sendCalls, []);
  });
});
