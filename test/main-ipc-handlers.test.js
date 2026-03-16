'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { electronMock } = require('./helpers/electron-mock');
const { IPC_CHANNELS } = require('../src/shared/ipc-contract');

describe('preload IPC contract', () => {
  let exposedApi;
  let invokeCalls;
  let sendCalls;
  let onCalls;
  let removeCalls;

  beforeEach(() => {
    exposedApi = null;
    invokeCalls = [];
    sendCalls = [];
    onCalls = [];
    removeCalls = [];

    electronMock.contextBridge.exposeInMainWorld = (_name, api) => {
      exposedApi = api;
    };
    electronMock.ipcRenderer.invoke = (...args) => {
      invokeCalls.push(args);
      return Promise.resolve(null);
    };
    electronMock.ipcRenderer.send = (...args) => {
      sendCalls.push(args);
    };
    electronMock.ipcRenderer.on = (...args) => {
      onCalls.push(args);
    };
    electronMock.ipcRenderer.removeListener = (...args) => {
      removeCalls.push(args);
    };

    const preloadPath = path.resolve(__dirname, '../src/preload.js');
    delete require.cache[preloadPath];
    require(preloadPath);
  });

  it('uses canonical channel constants for invoke/send/listen paths', async () => {
    assert.ok(exposedApi, 'preload workiq API should be exposed');

    await exposedApi.getAppVersion();
    await exposedApi.ask('status?');
    await exposedApi.acceptEula();
    await exposedApi.readPromptFile('briefing.md');
    await exposedApi.openMarkdownWindow({ title: 'Draft' });
    await exposedApi.openExternal('https://example.com');
    await exposedApi.showDesktopNotification({ title: 'x' });
    await exposedApi.openTrackerPopout('task-1');
    exposedApi.broadcastStateChanged();

    const offState = exposedApi.onStateChanged(() => {});
    offState();

    const offNotification = exposedApi.onNotificationClicked(() => {});
    offNotification();

    assert.deepEqual(invokeCalls, [
      [IPC_CHANNELS.GET_APP_VERSION],
      [IPC_CHANNELS.ASK_WORKIQ, 'status?'],
      [IPC_CHANNELS.ACCEPT_WORKIQ_EULA],
      [IPC_CHANNELS.READ_PROMPT_FILE, 'briefing.md'],
      [IPC_CHANNELS.OPEN_MARKDOWN_WINDOW, { title: 'Draft' }],
      [IPC_CHANNELS.OPEN_EXTERNAL, 'https://example.com'],
      [IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION, { title: 'x' }],
      [IPC_CHANNELS.OPEN_TRACKER_POPOUT, 'task-1'],
    ]);

    assert.deepEqual(sendCalls, [[IPC_CHANNELS.TRACKER_STATE_CHANGED]]);
    assert.equal(onCalls[0][0], IPC_CHANNELS.TRACKER_STATE_SYNC);
    assert.equal(onCalls[1][0], IPC_CHANNELS.NOTIFICATION_CLICKED);
    assert.equal(removeCalls[0][0], IPC_CHANNELS.TRACKER_STATE_SYNC);
    assert.equal(removeCalls[1][0], IPC_CHANNELS.NOTIFICATION_CLICKED);
  });

  it('returns no-op unsubscribers without registering listeners for invalid callbacks', () => {
    assert.ok(exposedApi, 'preload workiq API should be exposed');

    const offState = exposedApi.onStateChanged(null);
    const offNotification = exposedApi.onNotificationClicked('not-a-function');

    assert.equal(typeof offState, 'function');
    assert.equal(typeof offNotification, 'function');
    offState();
    offNotification();

    assert.deepEqual(onCalls, []);
    assert.deepEqual(removeCalls, []);
  });
});

describe('registerIpcHandlers()', () => {
  let handlers;
  let eventHandlers;
  let lastLoadedUrl;
  let currentMainWindow;
  let notificationInstances;

  beforeEach(() => {
    handlers = new Map();
    eventHandlers = new Map();
    lastLoadedUrl = '';
    currentMainWindow = null;
    notificationInstances = [];

    electronMock.ipcMain.handle = (channel, handler) => {
      handlers.set(channel, handler);
    };
    electronMock.ipcMain.on = (channel, handler) => {
      eventHandlers.set(channel, handler);
    };

    electronMock.BrowserWindow = class BrowserWindow {
      constructor() {
        this.webContents = {
          id: 999,
          send: () => {},
          setWindowOpenHandler: () => {},
          on: () => {},
          getURL: () => 'about:blank',
        };
      }

      setTitle() {}

      async loadURL(url) {
        lastLoadedUrl = url;
      }

      loadFile() {}

      on() {}

      isDestroyed() {
        return false;
      }
    };

    electronMock.app.getVersion = () => '1.2.3-test';
    electronMock.Notification = class Notification {
      static isSupported() {
        return true;
      }

      constructor(options) {
        this.options = options;
        this.handlers = {};
        this.showCalls = 0;
        notificationInstances.push(this);
      }

      on(eventName, handler) {
        this.handlers[eventName] = handler;
      }

      show() {
        this.showCalls += 1;
      }

      emitClick() {
        if (typeof this.handlers.click === 'function') {
          this.handlers.click();
        }
      }
    };

    const handlersPath = path.resolve(__dirname, '../src/main/ipc-handlers.js');
    delete require.cache[handlersPath];
    const { registerIpcHandlers } = require(handlersPath);
    registerIpcHandlers(() => currentMainWindow, new Set());
  });

  it('registers IPC handlers using canonical channel constants', () => {
    assert.equal(typeof handlers.get(IPC_CHANNELS.GET_APP_VERSION), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.ASK_WORKIQ), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.ACCEPT_WORKIQ_EULA), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.READ_PROMPT_FILE), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_MARKDOWN_WINDOW), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_TRACKER_POPOUT), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_EXTERNAL), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION), 'function');
    assert.equal(typeof eventHandlers.get(IPC_CHANNELS.TRACKER_STATE_CHANGED), 'function');
  });

  it('ignores rawHtml and renders markdown preview from markdown fields', async () => {
    const openMarkdownWindow = handlers.get(IPC_CHANNELS.OPEN_MARKDOWN_WINDOW);
    const result = await openMarkdownWindow(null, {
      title: 'Secure Preview',
      markdown: '# Hello',
      instructions: '- one',
      rawHtml: '<script>window.__pwned__=true</script><h1>Injected</h1>',
    });

    assert.deepEqual(result, { success: true });
    assert.ok(lastLoadedUrl.startsWith('data:text/html;charset=utf-8,'));

    const encoded = lastLoadedUrl.slice('data:text/html;charset=utf-8,'.length);
    const html = decodeURIComponent(encoded);

    assert.ok(html.includes('<h1>Hello</h1>'));
    assert.ok(html.includes('<li>one</li>'));
    assert.equal(html.includes('window.__pwned__=true'), false);
    assert.equal(html.includes('<h1>Injected</h1>'), false);
  });

  it('shows desktop notification and relays click payload to main window', async () => {
    currentMainWindow = {
      showCalls: 0,
      focusCalls: 0,
      restoreCalls: 0,
      alwaysOnTopCalls: [],
      _minimized: false,
      show() {
        this.showCalls += 1;
      },
      focus() {
        this.focusCalls += 1;
      },
      isMinimized() {
        return this._minimized;
      },
      restore() {
        this.restoreCalls += 1;
      },
      setAlwaysOnTop(flag) {
        this.alwaysOnTopCalls.push(flag);
      },
      webContents: {
        sendCalls: [],
        send(channel, payload) {
          this.sendCalls.push({ channel, payload });
        },
      },
    };

    const showDesktopNotification = handlers.get(IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION);
    const result = await showDesktopNotification(null, {
      title: 'Heads up',
      body: 'Tracker updated',
      taskId: 'tracker-9',
    });

    assert.deepEqual(result, { success: true });
    assert.equal(notificationInstances.length, 1);

    const notification = notificationInstances[0];
    assert.equal(notification.showCalls, 1);
    assert.equal(notification.options.title, 'Heads up');
    assert.equal(notification.options.body, 'Tracker updated');

    notification.emitClick();

    assert.equal(currentMainWindow.showCalls, 1);
    assert.equal(currentMainWindow.focusCalls, 1);
    assert.deepEqual(currentMainWindow.alwaysOnTopCalls, [true, false]);
    assert.deepEqual(currentMainWindow.webContents.sendCalls, [
      { channel: IPC_CHANNELS.NOTIFICATION_CLICKED, payload: { taskId: 'tracker-9' } },
    ]);
  });
});
