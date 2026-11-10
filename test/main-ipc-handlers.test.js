'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { electronMock } = require('./helpers/electron-mock');
const { IPC_CHANNELS } = require('../src/shared/ipc-contract');

it('repository command failures return sanitized codes without exposing payload or exception text', async t => {
    const handlers = new Map();
    t.mock.method(electronMock.ipcMain, 'handle', (channel, handler) => handlers.set(channel, handler));
    const { registerIpcHandlers } = require('../src/main/ipc-handlers');
    let failure;
    const cleanup = registerIpcHandlers(() => null, new Set(), {
      stateService: { command: async () => { throw failure; } },
    });
    try {
      for (const [code, expected] of [['INVALID_PATCH', 'INVALID_PATCH'],
        ['private thread title', 'REPOSITORY_FAILED'], [undefined, 'REPOSITORY_FAILED']]) {
        failure = Object.assign(new Error('private payload detail'), { code });
        const result = await handlers.get(IPC_CHANNELS.STATE_COMMAND)({ sender: {} }, {
          type: 'applyChanges', payload: { private: 'do not log' },
        });
        assert.deepEqual(result, { ok: false, code: expected });
        assert.equal(JSON.stringify(result).includes('private'), false);
      }
    } finally { cleanup(); }
});

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
    await exposedApi.getStateDiagnostics();
    await exposedApi.ask('status?');
    await exposedApi.acceptEula();
    await exposedApi.probeMcp();
    await exposedApi.proposeThreadActions({ schemaVersion: 1 });
    await exposedApi.createOutlookDraft({ subject: 'Hi' });
    await exposedApi.sendTeamsMessage({ targetDisplayName: 'James Farquharson', message: 'Hello' });
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
      [IPC_CHANNELS.GET_STATE_DIAGNOSTICS],
      [IPC_CHANNELS.ASK_WORKIQ, 'status?'],
      [IPC_CHANNELS.ACCEPT_WORKIQ_EULA],
      [IPC_CHANNELS.PROBE_WORKIQ_MCP],
      [IPC_CHANNELS.PROPOSE_THREAD_ACTIONS, { schemaVersion: 1 }],
      [IPC_CHANNELS.CREATE_OUTLOOK_DRAFT, { subject: 'Hi' }],
      [IPC_CHANNELS.SEND_TEAMS_MESSAGE, { targetDisplayName: 'James Farquharson', message: 'Hello' }],
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

  it('forwards app-resumed payloads through the canonical channel and removes the same listener', () => {
    const payloads = [];
    const unsubscribe = exposedApi.onAppResumed((payload) => payloads.push(payload));

    assert.equal(onCalls.length, 1);
    const [channel, listener] = onCalls[0];
    assert.equal(channel, IPC_CHANNELS.APP_RESUMED);

    listener({ sender: 'main' }, 'resume');
    assert.deepEqual(payloads, ['resume']);

    unsubscribe();
    assert.deepEqual(removeCalls, [[IPC_CHANNELS.APP_RESUMED, listener]]);
  });

  it('forwards ask scheduling metadata and queue snapshots/events with listener cleanup', async () => {
    const options = { priority: 'background', key: 'scanner:one', maxAttempts: 1 };
    await exposedApi.ask('question', options);
    await exposedApi.getWorkiqQueueStatus();
    assert.deepEqual(invokeCalls, [
      [IPC_CHANNELS.ASK_WORKIQ, 'question', options],
      [IPC_CHANNELS.GET_WORKIQ_QUEUE_STATUS],
    ]);
    const statuses = [];
    const off = exposedApi.onWorkiqQueueStatus((status) => statuses.push(status));
    const [channel, listener] = onCalls[0];
    assert.equal(channel, IPC_CHANNELS.WORKIQ_QUEUE_STATUS_CHANGED);
    const status = { active: 2, pending: 3, limit: 5, backgroundLimit: 4, cooldownUntil: 0 };
    listener({}, status);
    assert.deepEqual(statuses, [status]);
    off();
    assert.deepEqual(removeCalls, [[channel, listener]]);
    exposedApi.onWorkiqQueueStatus(null)();
    assert.equal(onCalls.length, 1);
  });
});

describe('registerIpcHandlers()', () => {
  let handlers;
  let eventHandlers;
  let lastLoadedUrl;
  let currentMainWindow;
  let notificationInstances;
  let workiqMcpProbeCalls;
  let workiqDraftCalls;
  let workiqProposalCalls;
  let workiqTeamsCalls;
  let dialogCalls;
  let dialogResponse;
  let workiqAskCalls;
  let queueListener;
  let cleanup;
  let queueUnsubscribed;
  let popouts;

  beforeEach(async () => {
    handlers = new Map();
    eventHandlers = new Map();
    lastLoadedUrl = '';
    currentMainWindow = null;
    notificationInstances = [];
    workiqMcpProbeCalls = 0;
    workiqDraftCalls = [];
    workiqProposalCalls = [];
    workiqTeamsCalls = [];
    dialogCalls = [];
    dialogResponse = 0;
    workiqAskCalls = [];
    queueListener = null;
    queueUnsubscribed = false;
    popouts = new Set();

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
    electronMock.dialog = {
      showMessageBox: async (...args) => {
        dialogCalls.push(args);
        return { response: dialogResponse };
      },
    };

    const handlersPath = path.resolve(__dirname, '../src/main/ipc-handlers.js');
    delete require.cache[handlersPath];
    const { registerIpcHandlers } = require(handlersPath);
    cleanup = registerIpcHandlers(() => currentMainWindow, popouts, {
      validateConnection: async () => ({ success: true }),
      workiqMcpClient: {
        ask: async (...args) => {
          workiqAskCalls.push(args);
          return { success: true, answer: 'MCP answer', attempts: 1 };
        },
        getQueueStatus: () => ({ active: 2, pending: 1, limit: 5, backgroundLimit: 4, cooldownUntil: 0 }),
        onQueueStatus: (listener) => {
          queueListener = listener;
          return () => { queueUnsubscribed = true; };
        },
        probe: async () => {
          workiqMcpProbeCalls += 1;
          return { ok: true, readOnly: true, mcp: 'available', auth: 'unknown' };
        },
        createOutlookDraft: async (draft) => {
          workiqDraftCalls.push(draft);
          return { ok: true, action: 'outlook-draft-created' };
        },
        proposeThreadActions: async (context) => {
          workiqProposalCalls.push(context);
          return { ok: true, readOnly: true, result: { schemaVersion: 1 } };
        },
        sendTeamsMessage: async (payload) => {
          workiqTeamsCalls.push(payload);
          return { ok: true, action: 'teams-message-sent' };
        },
      },
    });
    await handlers.get(IPC_CHANNELS.ACCEPT_WORKIQ_EULA)();
  });

  it('blocks every remote entry point after disconnect without dispatch or confirmation', async () => {
    handlers.get('connection-disconnect')();
    for (const channel of [IPC_CHANNELS.ASK_WORKIQ, IPC_CHANNELS.PROBE_WORKIQ_MCP,
      IPC_CHANNELS.PROPOSE_THREAD_ACTIONS, IPC_CHANNELS.CREATE_OUTLOOK_DRAFT, IPC_CHANNELS.SEND_TEAMS_MESSAGE]) {
      assert.equal((await handlers.get(channel)(null, {})).code, 'CONNECTION_NOT_READY');
    }
    assert.equal(dialogCalls.length, 0);
    assert.deepEqual(workiqAskCalls, []);
    assert.deepEqual(workiqDraftCalls, []);
    assert.deepEqual(workiqTeamsCalls, []);
    assert.deepEqual(workiqProposalCalls, []);
  });

  it('enforces repository-issued revision leases on hot and cold writes before touching storage', () => {
    const { EventEmitter } = require('node:events');
    const first = { sender: new EventEmitter() }, second = { sender: new EventEmitter() };
    const key = 'flightdeck.persisted.v2';
    const read = handlers.get(IPC_CHANNELS.STATE_READ)(first, key);
    assert.equal(read.revision, 0);
    assert.throws(() => handlers.get(IPC_CHANNELS.STORE_SET)(first, key, { items: [] }), /LEASE_REQUIRED/);
    assert.equal(handlers.get(IPC_CHANNELS.STATE_ACQUIRE)(first, read.revision).ok, true);
    assert.throws(() => handlers.get(IPC_CHANNELS.STORE_SET_COLD_ITEMS)(second, []), /LEASE_REQUIRED/);
    assert.deepEqual(handlers.get(IPC_CHANNELS.STORE_SET)(first, key, { items: [] }), { success: true });
    assert.equal(handlers.get(IPC_CHANNELS.STATE_RELEASE)(first, true, true).revision, 1);
    assert.equal(handlers.get(IPC_CHANNELS.STATE_ACQUIRE)(second, 0).code, 'CONFLICT');
    assert.throws(() => handlers.get(IPC_CHANNELS.STORE_SET)(second, key, { items: [{ id: 'resurrect' }] }), /LEASE_REQUIRED/);
    assert.deepEqual(handlers.get(IPC_CHANNELS.STATE_READ)(second, key).value, { items: [] });
  });

  it('registers IPC handlers using canonical channel constants', () => {
    const diagnosticExport = handlers.get(IPC_CHANNELS.GET_STATE_DIAGNOSTICS)();
    assert.equal(diagnosticExport.schemaVersion, 1);
    assert.deepEqual(diagnosticExport.entries, []);
    assert.equal(typeof handlers.get(IPC_CHANNELS.GET_APP_VERSION), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.ASK_WORKIQ), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.GET_WORKIQ_QUEUE_STATUS), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.ACCEPT_WORKIQ_EULA), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.PROBE_WORKIQ_MCP), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.PROPOSE_THREAD_ACTIONS), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.CREATE_OUTLOOK_DRAFT), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.SEND_TEAMS_MESSAGE), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.READ_PROMPT_FILE), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_MARKDOWN_WINDOW), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_TRACKER_POPOUT), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.OPEN_EXTERNAL), 'function');
    assert.equal(typeof handlers.get(IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION), 'function');
    assert.equal(typeof eventHandlers.get(IPC_CHANNELS.TRACKER_STATE_CHANGED), 'function');
  });

  it('routes reads and scheduling metadata to MCP without PTY fallback', async () => {
    const options = { priority: 'background', key: 'item:one', maxAttempts: 1 };
    assert.deepEqual(await handlers.get(IPC_CHANNELS.ASK_WORKIQ)(null, 'question', options), {
      success: true, answer: 'MCP answer', attempts: 1,
    });
    assert.deepEqual(workiqAskCalls, [['question', options]]);
    assert.equal(dialogCalls.length, 0);
  });

  it('provides an initial queue snapshot, broadcasts safely to all windows, and unsubscribes', () => {
    const status = handlers.get(IPC_CHANNELS.GET_WORKIQ_QUEUE_STATUS)();
    const deliveries = [];
    currentMainWindow = {
      isDestroyed: () => false,
      webContents: { send: (...args) => deliveries.push(['main', ...args]) },
    };
    popouts.add({
      isDestroyed: () => false,
      webContents: { send: (...args) => deliveries.push(['popout', ...args]) },
    });
    popouts.add({ isDestroyed: () => true });
    popouts.add({ isDestroyed: () => false, webContents: { send: () => { throw new Error('private'); } } });
    queueListener(status);
    assert.deepEqual(deliveries, [
      ['main', IPC_CHANNELS.WORKIQ_QUEUE_STATUS_CHANGED, status],
      ['popout', IPC_CHANNELS.WORKIQ_QUEUE_STATUS_CHANGED, status],
    ]);
    cleanup();
    assert.equal(queueUnsubscribed, true);
  });

  it('runs the read-only WorkIQ MCP probe without accepting renderer input', async () => {
    const probeWorkiqMcp = handlers.get(IPC_CHANNELS.PROBE_WORKIQ_MCP);
    const result = await probeWorkiqMcp(null, { method: 'tools/call', secret: 'nope' });

    assert.deepEqual(result, {
      ok: true,
      readOnly: true,
      mcp: 'available',
      auth: 'unknown',
    });
    assert.equal(workiqMcpProbeCalls, 1);
  });

  it('forwards only the narrow synthesis context without showing write confirmation', async () => {
    const proposeThreadActions = handlers.get(IPC_CHANNELS.PROPOSE_THREAD_ACTIONS);
    const context = { schemaVersion: 1, thread: { id: 'thread-1', title: 'Deployment' } };

    assert.deepEqual(await proposeThreadActions(null, context), {
      ok: true,
      readOnly: true,
      result: { schemaVersion: 1 },
    });
    assert.deepEqual(workiqProposalCalls, [context]);
    assert.equal(dialogCalls.length, 0);
  });

  it('keeps final draft consent in Electron main and invokes the client once', async () => {
    const createOutlookDraft = handlers.get(IPC_CHANNELS.CREATE_OUTLOOK_DRAFT);
    const draft = {
      subject: 'Sensitive subject',
      body: 'Sensitive body',
      to: ['sensitive@example.com'],
    };

    assert.deepEqual(await createOutlookDraft(null, draft), {
      ok: false,
      action: 'outlook-draft-create',
      code: 'CANCELLED',
      dispatched: false,
    });
    assert.deepEqual(workiqDraftCalls, []);
    assert.equal(dialogCalls.length, 1);
    const cancelOptions = dialogCalls[0][0];
    assert.deepEqual(cancelOptions.buttons, ['Cancel', 'Create draft']);
    assert.equal(cancelOptions.defaultId, 0);
    assert.equal(cancelOptions.cancelId, 0);
    assert.equal(JSON.stringify(cancelOptions).includes(draft.subject), false);
    assert.equal(JSON.stringify(cancelOptions).includes(draft.body), false);
    assert.equal(JSON.stringify(cancelOptions).includes(draft.to[0]), false);

    dialogResponse = 1;
    assert.deepEqual(await createOutlookDraft(null, draft), {
      ok: true,
      action: 'outlook-draft-created',
    });
    assert.deepEqual(workiqDraftCalls, [draft]);
    assert.equal(dialogCalls.length, 2);
  });

  it('keeps final Teams send consent in Electron main and invokes the narrow client once', async () => {
    const sendTeamsMessage = handlers.get(IPC_CHANNELS.SEND_TEAMS_MESSAGE);
    const payload = {
      targetDisplayName: '  James Farquharson  ',
      message: '  Can you confirm\tthe scope?\r\nThanks.  ',
    };
    const normalizedPayload = {
      targetDisplayName: 'James Farquharson',
      message: 'Can you confirm\tthe scope?\r\nThanks.',
    };

    assert.deepEqual(await sendTeamsMessage(null, payload), {
      ok: false,
      action: 'teams-message-send',
      code: 'CANCELLED',
    });
    assert.deepEqual(workiqTeamsCalls, []);

    dialogResponse = 1;
    assert.deepEqual(await sendTeamsMessage(null, payload), { ok: true, action: 'teams-message-sent' });
    assert.deepEqual(workiqTeamsCalls, [normalizedPayload]);
    const options = dialogCalls.at(-1)[0];
    assert.match(options.message, /James Farquharson/);
    assert.equal(JSON.stringify(options).includes(payload.message), false);
    assert.equal(JSON.stringify(options).includes(normalizedPayload.message), false);
  });

  it('rejects invalid Teams message payloads before confirmation or client invocation', async () => {
    const sendTeamsMessage = handlers.get(IPC_CHANNELS.SEND_TEAMS_MESSAGE);
    const validPayload = { targetDisplayName: 'James Farquharson', message: 'Hello' };
    const invalidPayloads = [
      null,
      [],
      {},
      { message: 'Hello' },
      { targetDisplayName: 'James Farquharson' },
      { ...validPayload, targetDisplayName: '   ' },
      { ...validPayload, targetDisplayName: 'x'.repeat(161) },
      { ...validPayload, targetDisplayName: 'James\x00Farquharson' },
      { ...validPayload, targetDisplayName: 'James\x7fFarquharson' },
      { ...validPayload, targetEmail: '' },
      { ...validPayload, targetEmail: null },
      { ...validPayload, targetEmail: 'not-an-email' },
      { ...validPayload, targetEmail: 'james@example.com\r\n' },
      { ...validPayload, targetEmail: 'x'.repeat(243) + '@example.com' },
      { ...validPayload, message: ' \t\r\n ' },
      { ...validPayload, message: 'x'.repeat(4001) },
      { ...validPayload, message: 'Hello\x00world' },
      { ...validPayload, message: 'Hello\x0bworld' },
      { ...validPayload, message: 'Hello\x7fworld' },
      { ...validPayload, chatId: 'chat-1' },
      { ...validPayload, tool: 'send_chat_message' },
      { ...validPayload, parentUrl: 'https://example.com' },
      { ...validPayload, jsonBody: '{"message":"Hello"}' },
    ];

    for (const payload of invalidPayloads) {
      assert.deepEqual(await sendTeamsMessage(null, payload), {
        ok: false,
        action: 'teams-message-send',
        code: 'INVALID_MESSAGE',
      });
    }

    assert.deepEqual(dialogCalls, []);
    assert.deepEqual(workiqTeamsCalls, []);
  });

  it('confirms the exact email for named and email-only Teams recipients and preserves it', async () => {
    const sendTeamsMessage = handlers.get(IPC_CHANNELS.SEND_TEAMS_MESSAGE);
    for (const targetDisplayName of ['Surika Ravikumar', '']) {
      const payload = {
        targetDisplayName, targetEmail: '  Surika.Ravikumar@microsoft.com  ', message: 'Hello',
      };
      assert.equal((await sendTeamsMessage(null, payload)).code, 'CANCELLED');
      assert.equal(workiqTeamsCalls.length, targetDisplayName ? 0 : 1);
      assert.ok(dialogCalls.at(-1)[0].message.includes('Surika.Ravikumar@microsoft.com'));
      assert.match(dialogCalls.at(-1)[0].detail, /open or reuse a one-to-one chat, creating it if needed/);
      dialogResponse = 1;
      assert.equal((await sendTeamsMessage(null, payload)).ok, true);
      assert.deepEqual(workiqTeamsCalls.at(-1), {
        targetDisplayName, targetEmail: 'Surika.Ravikumar@microsoft.com', message: 'Hello',
      });
      dialogResponse = 0;
    }
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
