'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { AsyncLocalStorage } = require('async_hooks');
const { workiqLauncher, getNodeExecutable } = require('./pty-bridge');
const { log, logError } = require('./utils');
const { createWorkiqRequestQueue } = require('./workiq-request-queue');
const { isValidEmail, normalizeTeamsMessage } = require('../shared/recipient-validation.mjs');

const DEFAULT_INITIALIZE_TIMEOUT = 30000;
const DEFAULT_PROBE_TIMEOUT = 10000;
const DEFAULT_SEMANTIC_TIMEOUT = 300000;
const DEFAULT_READ_TIMEOUT = 300000;
const DEFAULT_SHUTDOWN_GRACE = 1000;
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const MCP_PROTOCOL_VERSION = '2025-03-26';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const C0_OR_DEL_PATTERN = /[\x00-\x1f\x7f]/;
const DRAFT_FIELDS = new Set(['subject', 'body', 'to', 'cc', 'bcc', 'importance']);
const DRAFT_IMPORTANCE = new Set(['low', 'normal', 'high']);
const GRAPH_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const DIRECTORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHESIS_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'proposal-synthesis.md');
const SYNTHESIS_MODULE_URL = pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'proposal-synthesis.js')).href;

function createClientError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeRecipients(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw createClientError('INVALID_DRAFT');

  return value.map((recipient) => {
    if (typeof recipient !== 'string') throw createClientError('INVALID_DRAFT');
    const address = recipient.trim();
    if (address.length > 254 || C0_OR_DEL_PATTERN.test(address) || !EMAIL_PATTERN.test(address)) {
      throw createClientError('INVALID_DRAFT');
    }
    return {
      '@odata.type': '#microsoft.graph.recipient',
      emailAddress: {
        '@odata.type': '#microsoft.graph.emailAddress',
        address,
      },
    };
  });
}

function normalizeDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createClientError('INVALID_DRAFT');
  }

  if (Object.keys(value).some((key) => !DRAFT_FIELDS.has(key))) {
    throw createClientError('INVALID_DRAFT');
  }

  if (
    typeof value.subject !== 'string'
    || value.subject.trim().length === 0
    || value.subject.length > 500
    || C0_OR_DEL_PATTERN.test(value.subject)
  ) {
    throw createClientError('INVALID_DRAFT');
  }

  if (typeof value.body !== 'string' || value.body.trim().length === 0 || value.body.length > 100000) {
    throw createClientError('INVALID_DRAFT');
  }

  const toRecipients = normalizeRecipients(value.to);
  if (toRecipients.length === 0) throw createClientError('INVALID_DRAFT');

  const importance = value.importance || 'normal';
  if (!DRAFT_IMPORTANCE.has(importance)) throw createClientError('INVALID_DRAFT');

  return {
    '@odata.type': '#microsoft.graph.message',
    subject: value.subject,
    body: {
      '@odata.type': '#microsoft.graph.itemBody',
      contentType: 'text',
      content: value.body,
    },
    toRecipients,
    ccRecipients: normalizeRecipients(value.cc),
    bccRecipients: normalizeRecipients(value.bcc),
    importance,
  };
}

function createWorkiqMcpClient(options = {}) {
  const launcher = options.launcher === undefined ? workiqLauncher : options.launcher;
  const spawnProcess = options.spawnProcess || spawn;
  const verifyLauncher = options.verifyLauncher === undefined
    ? !options.spawnProcess
    : options.verifyLauncher;
  const initializeTimeout = options.initializeTimeout || DEFAULT_INITIALIZE_TIMEOUT;
  const probeTimeout = options.probeTimeout || DEFAULT_PROBE_TIMEOUT;
  const semanticTimeout = options.semanticTimeout || DEFAULT_SEMANTIC_TIMEOUT;
  const readTimeout = options.readTimeout || DEFAULT_READ_TIMEOUT;
  const shutdownGrace = options.shutdownGrace || DEFAULT_SHUTDOWN_GRACE;
  const maxMessageBytes = options.maxMessageBytes || DEFAULT_MAX_MESSAGE_BYTES;
  const queue = createWorkiqRequestQueue(options.queueOptions);
  const transportLease = new AsyncLocalStorage();
  const outstandingTransports = new Map();
  const semanticQueries = new Map();

  async function semanticAnswer(question, timeoutMs, conversation) {
    if (typeof options.semanticQuery !== 'function') {
      const tools = await ensureTools();
      const name = resolveAskTool(tools);
      if (!name) throw createClientError('UNSUPPORTED');
      const args = { question };
      if (conversation.id) args.conversationId = conversation.id;
      const result = await sendRequest('tools/call', { name, arguments: args }, timeoutMs);
      assertReadResult(result);
      const answer = normalizeAskAnswer(result);
      if (!answer) {
        const empty = !extractToolText(result).trim()
          && ['answer', 'response'].some(field => typeof result.structuredContent?.[field] === 'string'
            && !result.structuredContent[field].trim());
        const code = empty ? 'EMPTY_RESPONSE' : 'INVALID_RESPONSE';
        const conversationId = result.structuredContent?.conversationId;
        if (empty && typeof conversationId === 'string' && conversationId.trim()
          && conversationId.length <= 512 && !C0_OR_DEL_PATTERN.test(conversationId)) {
          // Grounding can finish without an answer; resume this read, not a new conversation.
          conversation.id = conversationId;
        }
        logError('[main] WorkIQ MCP semantic query failed:', code);
        throw createClientError(code);
      }
      return answer;
    }

    const result = await runOwnedQuery(queryOptions => options.semanticQuery(question, {
      ...queryOptions, ...(conversation.id ? { conversationId: conversation.id } : {}),
    }), timeoutMs);
    if (!result?.success) {
      const id = result?.conversationId;
      if (result?.code === 'EMPTY_RESPONSE' && typeof id === 'string' && id.trim()
        && id.length <= 512 && !C0_OR_DEL_PATTERN.test(id)) conversation.id = id;
      throw createClientError(result?.code || 'REQUEST_FAILED');
    }
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw createClientError('INVALID_RESPONSE');
    return result.answer.trim();
  }

  async function runOwnedQuery(query, timeoutMs) {
    const controller = new AbortController();
    const release = transportLease.getStore()?.retain() || (() => {});
    let exited = false;
    let resolveExit;
    const exit = new Promise(resolve => { resolveExit = resolve; });
    const onExit = () => {
      if (exited) return;
      exited = true;
      semanticQueries.delete(controller);
      release();
      resolveExit();
    };
    semanticQueries.set(controller, exit);
    try {
      return await query({ timeoutMs, signal: controller.signal, onExit });
    } catch (error) {
      logError('[main] WorkIQ CLI semantic query failed:', error.code || 'REQUEST_FAILED');
      throw error;
    }
  }

  let child = null;
  let stdoutBuffer = '';
  let stdoutDecoder = new StringDecoder('utf8');
  let nextRequestId = 1;
  let initializePromise = null;
  let probePromise = null;
  let availableTools = null;
  let toolsPromise = null;
  let shuttingDown = false;
  let synthesisModulePromise = null;
  const pendingRequests = new Map();
  const tombstones = new Set();

  function publicFailure(code) {
    return {
      ok: false,
      readOnly: true,
      [options.transportName || 'mcp']: 'unavailable',
      auth: 'unknown',
      code,
    };
  }

  function actionFailure(code, dispatched = false) {
    return {
      ok: false,
      action: 'outlook-draft-create',
      code,
      dispatched,
    };
  }

  function synthesisFailure(code) {
    logError('[main] WorkIQ proposal synthesis failed:', /^[A-Z_]{1,40}$/.test(code) ? code : 'SYNTHESIS_FAILED');
    return {
      ok: false,
      readOnly: true,
      code,
    };
  }

  function teamsFailure(code) {
    return { ok: false, action: 'teams-message-send', code };
  }

  function loadSynthesisModule() {
    if (!synthesisModulePromise) {
      synthesisModulePromise = import(SYNTHESIS_MODULE_URL);
    }
    return synthesisModulePromise;
  }

  function rejectPending(code) {
    for (const request of pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(createClientError(code));
    }
    pendingRequests.clear();
  }

  function clearProcess(expectedChild, code) {
    if (child !== expectedChild) return;
    child = null;
    stdoutBuffer = '';
    initializePromise = null;
    availableTools = null;
    toolsPromise = null;
    tombstones.clear();
    rejectPending(code);
  }

  function failProcess(expectedChild, code) {
    if (child !== expectedChild) return;
    clearProcess(expectedChild, code);
    try {
      expectedChild.kill();
    } catch (_) {
      logError('[main] WorkIQ MCP process termination failed');
    }
  }

  function terminateProcess(code) {
    if (child) failProcess(child, code);
  }

  function protocolFailure(reason) {
    logError('[main] WorkIQ MCP protocol error:', reason, 'pending:', pendingRequests.size);
    terminateProcess('PROTOCOL_ERROR');
  }

  function handleMessage(line) {
    if (Buffer.byteLength(line, 'utf8') > maxMessageBytes) {
      protocolFailure('LINE_TOO_LARGE');
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      protocolFailure('NON_JSON');
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      protocolFailure('INVALID_ENVELOPE');
      return;
    }

    if (message.id === undefined) {
      if (typeof message.method !== 'string' || !message.method
        || 'result' in message || 'error' in message) protocolFailure('INVALID_NOTIFICATION');
      return;
    }

    const request = pendingRequests.get(message.id);
    if (!request) {
      if (tombstones.has(message.id)) return;
      protocolFailure('UNKNOWN_RESPONSE_ID');
      return;
    }

    pendingRequests.delete(message.id);
    clearTimeout(request.timeout);
    request.releaseTransport();
    if (request.timedOut) {
      tombstones.add(message.id);
      if (tombstones.size > 256) tombstones.delete(tombstones.values().next().value);
    }

    if (Object.prototype.hasOwnProperty.call(message, 'error')) {
      if (!message.error || typeof message.error !== 'object'
        || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string'
        || Object.prototype.hasOwnProperty.call(message, 'result')) {
        request.reject(createClientError('PROTOCOL_ERROR'));
        protocolFailure('INVALID_RPC_ERROR');
        return;
      }
      const failure = classifyRemoteFailure(message.error, 'RPC_ERROR');
      queue.observeFailure(failure);
      request.reject(failure);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
      request.reject(createClientError('PROTOCOL_ERROR'));
      protocolFailure('MISSING_RESULT');
      return;
    }

    try { assertReadResult(message.result); } catch (error) { queue.observeFailure(error); }
    request.resolve(message.result);
  }

  function handleStdout(chunk) {
    stdoutBuffer += stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

    if (Buffer.byteLength(stdoutBuffer, 'utf8') > maxMessageBytes && !stdoutBuffer.includes('\n')) {
      protocolFailure('BUFFER_TOO_LARGE');
      return;
    }

    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleMessage(line);
      if (!child) return;
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  }

  function resolveLaunchSpec() {
    if (!launcher) {
      throw createClientError('NOT_INSTALLED');
    }

    if (verifyLauncher && !fs.existsSync(launcher)) {
      throw createClientError('NOT_INSTALLED');
    }

    if (launcher.toLowerCase().endsWith('.js')) {
      return {
        executable: options.nodeExecutable || getNodeExecutable(),
        args: [launcher, '--log-level', 'Error', 'mcp'],
      };
    }

    return {
      executable: launcher,
      args: ['--log-level', 'Error', 'mcp'],
    };
  }

  function startProcess() {
    if (shuttingDown) throw createClientError('SHUTTING_DOWN');
    if (child) return child;

    const launchSpec = resolveLaunchSpec();
    let startedChild;
    try {
      startedChild = spawnProcess(launchSpec.executable, launchSpec.args, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (_) {
      throw createClientError('START_FAILED');
    }

    child = startedChild;
    stdoutBuffer = '';
    stdoutDecoder = new StringDecoder('utf8');

    startedChild.stdout.on('data', (chunk) => {
      if (child === startedChild) handleStdout(chunk);
    });
    startedChild.stderr.on('data', () => {});
    startedChild.stdin.on('error', () => {
      logError('[main] WorkIQ MCP stream error');
      failProcess(startedChild, 'PROCESS_EXITED');
    });
    startedChild.stdout.on('error', () => {
      logError('[main] WorkIQ MCP stream error');
      failProcess(startedChild, 'PROCESS_EXITED');
    });
    startedChild.stdout.on('end', () => {
      if (!shuttingDown) failProcess(startedChild, 'PROCESS_EXITED');
    });
    startedChild.stderr.on('error', () => {
      logError('[main] WorkIQ MCP stream error');
      failProcess(startedChild, 'PROCESS_EXITED');
    });
    startedChild.on('error', () => {
      logError('[main] WorkIQ MCP process error');
      failProcess(startedChild, 'START_FAILED');
    });
    startedChild.on('exit', () => {
      log('[main] WorkIQ MCP process exited');
      clearProcess(startedChild, 'PROCESS_EXITED');
      for (const release of outstandingTransports.get(startedChild) || []) release();
    });
    log('[main] WorkIQ MCP process started');

    return startedChild;
  }

  function sendNotification(method, params = {}) {
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw createClientError('PROCESS_EXITED');
    }

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  function sendRequest(method, params, timeoutMs) {
    if (typeof options.toolQuery === 'function' && method === 'tools/call') {
      return runOwnedQuery(queryOptions => options.toolQuery(params.name, params.arguments, queryOptions), timeoutMs);
    }
    const activeChild = startProcess();
    const id = nextRequestId++;
    const releaseSlot = transportLease.getStore()?.retain() || (() => {});
    if (!outstandingTransports.has(activeChild)) outstandingTransports.set(activeChild, new Set());
    const transports = outstandingTransports.get(activeChild);
    const releaseTransport = () => {
      if (!transports.delete(releaseTransport)) return;
      if (!transports.size) outstandingTransports.delete(activeChild);
      releaseSlot();
    };
    transports.add(releaseTransport);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const request = pendingRequests.get(id);
        if (request) request.timedOut = true;
        reject(createClientError('TIMEOUT'));
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timeout, releaseTransport, timedOut: false });

      try {
        activeChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (_) {
        clearTimeout(timeout);
        pendingRequests.delete(id);
        reject(createClientError('PROCESS_EXITED'));
        failProcess(activeChild, 'PROCESS_EXITED');
      }
    });
  }

  function ensureInitialized() {
    if (initializePromise) return initializePromise;

    const activeChild = startProcess();
    const promise = sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'FlightDeck', version: '2.0.0' },
    }, initializeTimeout).then((result) => {
      if (child !== activeChild) throw createClientError('PROCESS_EXITED');
      if (!result || typeof result !== 'object' || result.protocolVersion !== MCP_PROTOCOL_VERSION) {
        protocolFailure('INITIALIZE_RESPONSE');
        throw createClientError('PROTOCOL_ERROR');
      }
      sendNotification('notifications/initialized');
    }).catch((error) => {
      if (child === activeChild) {
        failProcess(activeChild, error.code || 'PROTOCOL_ERROR');
      }
      throw error;
    });

    initializePromise = promise;
    return initializePromise;
  }

  async function runProbe() {
    await ensureTools();
    return {
      ok: true,
      readOnly: true,
      [options.transportName || 'mcp']: 'available',
      auth: 'unknown',
    };
  }

  async function ensureTools() {
    if (typeof options.discoverTools === 'function') {
      if (availableTools) return availableTools;
      if (!toolsPromise) {
        toolsPromise = runOwnedQuery(options.discoverTools, probeTimeout).then(tools => {
          if (!(tools instanceof Set)) throw createClientError('INVALID_RESPONSE');
          availableTools = tools;
          return tools;
        }).finally(() => { toolsPromise = null; });
      }
      return toolsPromise;
    }
    await ensureInitialized();
    if (availableTools) return availableTools;
    if (toolsPromise) return toolsPromise;
    const activeChild = child;
    const promise = sendRequest('tools/list', {}, probeTimeout).then((result) => {
      if (child !== activeChild) throw createClientError('PROCESS_EXITED');
      if (!result || typeof result !== 'object' || !Array.isArray(result.tools)) {
        protocolFailure('INVALID_TOOL_LIST');
        throw createClientError('PROTOCOL_ERROR');
      }
      const tools = new Set();
      for (const tool of result.tools) {
        if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string'
          || !tool.name.trim() || tools.has(tool.name)) {
          protocolFailure('INVALID_TOOL_DESCRIPTOR');
          throw createClientError('PROTOCOL_ERROR');
        }
        tools.add(tool.name);
      }
      availableTools = tools;
      return tools;
    }).finally(() => {
      if (toolsPromise === promise) toolsPromise = null;
    });
    toolsPromise = promise;
    return promise;
  }

  function probe() {
    if (shuttingDown) return Promise.resolve(publicFailure('SHUTTING_DOWN'));
    if (probePromise) return probePromise;

    probePromise = runProbe()
      .catch((error) => {
        const code = error && typeof error.code === 'string' ? error.code : 'PROTOCOL_ERROR';
        return publicFailure(code);
      })
      .finally(() => {
        probePromise = null;
      });

    return probePromise;
  }

  async function createOutlookDraft(draft) {
    if (shuttingDown) return actionFailure('SHUTTING_DOWN');

    let jsonBody;
    let createDispatched = false;
    try {
      jsonBody = normalizeDraft(draft);
      const tools = await ensureTools();
      const createTool = resolveEntityTool(tools, 'create_entity');
      if (!createTool) {
        return actionFailure('UNSUPPORTED');
      }

      const createPromise = sendRequest('tools/call', {
        name: createTool,
        arguments: {
          parentUrl: '/me/messages',
          jsonBody,
        },
      }, probeTimeout);
      createDispatched = true;
      const result = await createPromise;

      if (!result || typeof result !== 'object' || result.isError === true
        || result.structuredContent?.isError === true || result.structuredContent?.error) {
        const content = Array.isArray(result?.content)
          ? result.content.map((item) => typeof item?.text === 'string' ? item.text : '').join(' ')
          : '';
        const code = /auth|sign[ -]?in|login|unauthorized|consent/i.test(content)
          ? 'AUTH_REQUIRED'
          : 'CREATE_FAILED';
        return actionFailure(code, createDispatched);
      }

      if (!hasCreatedOutlookDraftEvidence(result)) {
        return actionFailure('CREATE_UNCONFIRMED', createDispatched);
      }

      return {
        ok: true,
        action: 'outlook-draft-created',
      };
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'CREATE_FAILED';
      return actionFailure(code, createDispatched);
    }
  }

  async function sendTeamsMessage(input) {
    if (shuttingDown) return teamsFailure('SHUTTING_DOWN');

    let payload;
    let createDispatched = false;
    let openingChat = false;
    try {
      payload = normalizeTeamsMessage(input);
      log('[main] WorkIQ Teams send:', 'RESOLUTION_STARTED', payload.targetEmail ? 'EMAIL' : 'NAME');
      const tools = await ensureTools();
      const fetchTool = resolveEntityTool(tools, 'fetch');
      const createTool = resolveEntityTool(tools, 'create_entity');
      if (!fetchTool || !createTool) return teamsFailure('UNSUPPORTED');

      let identity;
      if (payload.targetEmail) {
        const recipient = await resolveDirectoryRecipient(fetchTool, { address: payload.targetEmail });
        if (!recipient.user) return teamsFailure(['TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS'].includes(recipient.code)
          ? recipient.code : 'RESOLUTION_FAILED');
        const { user, addresses } = recipient;
        const selfResult = await sendRequest('tools/call', {
          name: fetchTool, arguments: { entityUrls: ['/me?$select=id,userType'] },
        }, probeTimeout);
        assertReadResult(selfResult);
        const self = extractEntityData(selfResult);
        if (!DIRECTORY_ID_PATTERN.test(self?.id) || self.id.toLowerCase() === user.id.toLowerCase()) {
          return teamsFailure('RESOLUTION_FAILED');
        }
        identity = {
          targetId: user.id.toLowerCase(), selfId: self.id.toLowerCase(), addresses,
          targetRole: user.userType === 'Guest' ? 'guest' : 'owner',
          selfRole: self.userType === 'Guest' ? 'guest' : 'owner',
        };
        log('[main] WorkIQ Teams send:', 'DIRECTORY_IDENTITY_VERIFIED');
      }

      const chats = [];
      const visited = new Set();
      let canonicalChat = null;
      if (identity) {
        // Graph reuses the existing one-to-one chat for this pair, or creates it.
        // This is a confirmed write, not a read-only recipient lookup.
        openingChat = true;
        const opened = await sendRequest('tools/call', {
          name: createTool,
          arguments: {
            parentUrl: '/chats',
            jsonBody: {
              chatType: 'oneOnOne',
              members: [[identity.selfId, identity.selfRole], [identity.targetId, identity.targetRole]].map(([id, role]) => ({
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                roles: [role],
                'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${id}')`,
              })),
            },
          },
        }, probeTimeout);
        const openedChat = extractCreatedChat(opened);
        if (!openedChat) {
          logError('[main] WorkIQ Teams send:', 'CHAT_OPEN_NOT_VERIFIED');
          return teamsFailure('CHAT_OPEN_FAILED');
        }
        const verified = await sendRequest('tools/call', {
          name: fetchTool,
          arguments: { entityUrls: [`/chats/${encodeURIComponent(openedChat.id)}?$select=id,chatType&$expand=members`] },
        }, probeTimeout);
        assertReadResult(verified);
        const chat = extractEntityData(verified);
        const pair = findCanonicalPair(chat ? [chat] : [], identity);
        if (chat?.id !== openedChat.id || pair.conflict || pair.matches.length !== 1) {
          logError('[main] WorkIQ Teams send:', 'CHAT_PAIR_NOT_VERIFIED');
          return teamsFailure('CHAT_OPEN_FAILED');
        }
        canonicalChat = chat;
        openingChat = false;
        log('[main] WorkIQ Teams send:', 'CANONICAL_PAIR_VERIFIED');
      }
      // Group-chat membership can exceed the strict transport limit. The installed
      // service supports this filter; only one-to-one chats can be send targets.
      const chatFilter = "chatType eq 'oneOnOne'";
      let nextPage = identity ? null
        : `/me/chats?$filter=${encodeURIComponent(chatFilter).replace(/'/g, '%27')}&$select=id,chatType&$expand=members&$top=50`;
      while (nextPage) {
        // Resolve the complete bounded collection before deciding a display name is unique.
        if (visited.has(nextPage) || visited.size >= 10) {
          logError('[main] WorkIQ Teams send:', 'INCOMPLETE_PAGINATION', 'pages:', visited.size);
          return teamsFailure('RESOLUTION_FAILED');
        }
        visited.add(nextPage);
        const chatsResult = await sendRequest('tools/call', {
          name: fetchTool,
          arguments: { entityUrls: [nextPage] },
        }, probeTimeout);
        assertReadResult(chatsResult);
        const collection = extractChatCollection(chatsResult);
        if (!collection) {
          logError('[main] WorkIQ Teams send:', 'INVALID_CHAT_COLLECTION');
          return teamsFailure('RESOLUTION_FAILED');
        }
        chats.push(...collection.values);
        nextPage = collection.nextPage;
      }

      const targetName = payload.targetDisplayName.toLocaleLowerCase();
      const targetEmail = payload.targetEmail?.toLowerCase();
      const matches = identity ? (canonicalChat ? [canonicalChat] : []) : chats.filter((chat) =>
        chat?.chatType === 'oneOnOne'
        && typeof chat.id === 'string'
        && chat.id
        && Array.isArray(chat.members)
        && !chat['members@odata.nextLink']
        && chat.members.some((member) => targetEmail
          ? [member?.email, member?.userPrincipalName].some(identity =>
            isValidEmail(identity) && identity.toLowerCase() === targetEmail)
          : String(member?.displayName || '').trim().toLocaleLowerCase() === targetName)
      );
      if (chats.some(chat => chat?.chatType === 'oneOnOne'
        && (!Array.isArray(chat.members) || chat['members@odata.nextLink']))) {
        logError('[main] WorkIQ Teams send:', 'INCOMPLETE_MEMBERS');
        return teamsFailure('RESOLUTION_FAILED');
      }
      log('[main] WorkIQ Teams send:', 'RESOLUTION_COMPLETED', 'pages:', visited.size, 'matches:', matches.length);
      if (!matches.length) return teamsFailure('TARGET_NOT_FOUND');
      if (matches.length > 1) return teamsFailure('TARGET_AMBIGUOUS');

      const chatId = encodeURIComponent(matches[0].id);
      const sendPromise = sendRequest('tools/call', {
        name: createTool,
        arguments: {
          parentUrl: `/chats/${chatId}/messages`,
          jsonBody: { body: { contentType: 'text', content: payload.message } },
        },
      }, probeTimeout);
      createDispatched = true;
      log('[main] WorkIQ Teams send:', 'CREATE_DISPATCHED');
      const sendResult = await sendPromise;
      if (!sendResult || typeof sendResult !== 'object' || Array.isArray(sendResult)
        || sendResult.structuredContent?.isError === true || sendResult.structuredContent?.error
        || (Object.prototype.hasOwnProperty.call(sendResult, 'isError') && sendResult.isError !== false)) {
        logError('[main] WorkIQ Teams send:', 'CREATE_ERROR_RESULT');
        return teamsFailure('SEND_UNCONFIRMED');
      }
      const receiptFailure = teamsMessageReceiptFailure(sendResult, matches[0].id, payload.message);
      if (receiptFailure) {
        logError('[main] WorkIQ Teams send:', 'RECEIPT_NOT_VERIFIED', receiptFailure);
        return teamsFailure('SEND_UNCONFIRMED');
      }
      log('[main] WorkIQ Teams send:', 'RECEIPT_VERIFIED');
      return { ok: true, action: 'teams-message-sent' };
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'SEND_FAILED';
      logError('[main] WorkIQ Teams send:', createDispatched ? 'CREATE_UNCONFIRMED' : 'PRE_DISPATCH_FAILED',
        /^[A-Z_]{1,40}$/.test(code) ? code : 'SEND_FAILED');
      return teamsFailure(createDispatched ? 'SEND_UNCONFIRMED'
        : openingChat && !['AUTH_REQUIRED', 'THROTTLED'].includes(code) ? 'CHAT_OPEN_FAILED'
          : code === 'TOOL_ERROR' ? 'RESOLUTION_FAILED' : code);
    }
  }

  async function resolveDirectoryRecipient(fetchTool, { address, name }) {
    const literal = (address || name).replace(/'/g, "''");
    const exact = address
      ? `mail eq '${literal}' or userPrincipalName eq '${literal}'`
      : `displayName eq '${literal}'`;
    const fallback = address
      ? `proxyAddresses/any(a:a eq 'smtp:${literal}') or proxyAddresses/any(a:a eq 'SMTP:${literal}') or otherMails/any(a:a eq '${literal}')`
      : `startswith(displayName,'${literal} (')`;
    for (const [index, filter] of [exact, fallback].entries()) {
      const response = await sendRequest('tools/call', {
        name: fetchTool,
        arguments: { entityUrls: [`/users?$filter=${encodeURIComponent(filter)}&$select=id,displayName,mail,userPrincipalName,otherMails,proxyAddresses,userType&$top=3`] },
      }, probeTimeout);
      assertReadResult(response);
      const collection = extractEntityCollection(response);
      if (!collection || collection['@odata.nextLink']) return { code: 'RESOLUTION_INCOMPLETE' };
      if (collection.value.length > 1) return { code: 'TARGET_AMBIGUOUS' };
      if (!collection.value.length) continue;
      const [user] = collection.value;
      const addresses = directoryAddresses(user);
      const displayName = typeof user?.displayName === 'string' ? user.displayName.trim().toLowerCase() : '';
      const baseName = name?.toLowerCase();
      const matchesName = !name || displayName === baseName || (index === 1
        && displayName.startsWith(`${baseName} (`) && /^\([^()]+\)$/.test(displayName.slice(baseName.length + 1)));
      if (!DIRECTORY_ID_PATTERN.test(user?.id) || !addresses.length
        || (address ? !addresses.includes(address.toLowerCase()) : !matchesName)) {
        return { code: 'INVALID_IDENTITY' };
      }
      return { user, addresses, address: addresses[0], code: 'TARGET_VERIFIED' };
    }
    return { code: 'TARGET_NOT_FOUND' };
  }

  async function enrichProposalRecipients(result, tools) {
    const fetchTool = resolveEntityTool(tools, 'fetch');
    const resolutions = new Map();
    for (const proposal of result.proposals) {
      if (!['email', 'teams'].includes(proposal.channel) || proposal.target.address) continue;
      const name = proposal.target.displayName;
      let resolution = resolutions.get(name);
      if (!resolution) {
        resolution = { code: 'TARGET_NOT_FOUND' };
        if (!fetchTool) resolution.code = 'UNSUPPORTED';
        else if (!name || name.length > 160 || C0_OR_DEL_PATTERN.test(name)) resolution.code = 'INVALID_TARGET';
        else {
          try {
            resolution = await resolveDirectoryRecipient(fetchTool, { name });
          } catch (error) {
            resolution.code = ['AUTH_REQUIRED', 'THROTTLED', 'TIMEOUT', 'PROTOCOL_ERROR'].includes(error?.code)
              ? error.code : 'RESOLUTION_FAILED';
          }
        }
        resolutions.set(name, resolution);
        log('[main] WorkIQ proposal recipient resolution:', resolution.code);
      }
      if (resolution.address) {
        proposal.target.address = resolution.address;
        proposal.needsTargetResolution = false;
      } else {
        proposal.needsTargetResolution = true;
        proposal.missingContext = [...proposal.missingContext.slice(0, 7), `Verified recipient address required (${resolution.code}).`];
        proposal.reviewNote = `${proposal.reviewNote ? `${proposal.reviewNote} ` : ''}Recipient could not be uniquely verified; resolve manually (${resolution.code}).`.slice(-500);
      }
    }
  }

  async function proposeThreadActions(context, conversation) {
    if (shuttingDown) return synthesisFailure('SHUTTING_DOWN');

    try {
      const synthesis = await loadSynthesisModule();
      const normalizedContext = synthesis.normalizeProposalSynthesisContext(context);
      if (!normalizedContext) return synthesisFailure('INVALID_CONTEXT');

      const template = fs.readFileSync(SYNTHESIS_PROMPT_PATH, 'utf8');
      const question = `${template.trim()}\n\nSelected thread context:\n${JSON.stringify(normalizedContext)}`;
      log('[main] WorkIQ proposal synthesis started:', normalizedContext.requestedChannel || 'automatic');
      const answer = await semanticAnswer(question, semanticTimeout, conversation);
      const normalizedResult = synthesis.parseProposalSynthesisResponse(answer);
      if (!normalizedResult) return synthesisFailure('INVALID_RESPONSE');
      const tools = await ensureTools();
      await enrichProposalRecipients(normalizedResult, tools);
      log('[main] WorkIQ proposal synthesis completed:', normalizedResult.proposals.length, 'proposals');
      return {
        ok: true,
        readOnly: true,
        result: normalizedResult,
      };
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'SYNTHESIS_FAILED';
      return synthesisFailure(code);
    }
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    queue.shutdown();
    const semanticExits = [...semanticQueries.values()];
    for (const controller of semanticQueries.keys()) controller.abort();
    if (semanticExits.length) {
      let timeout;
      await Promise.race([
        Promise.all(semanticExits),
        new Promise(resolve => { timeout = setTimeout(resolve, shutdownGrace); }),
      ]);
      clearTimeout(timeout);
    }
    probePromise = null;
    initializePromise = null;
    const activeChild = child;
    if (!activeChild) return;

    rejectPending('SHUTTING_DOWN');

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };

      activeChild.once('exit', finish);
      const forceTimer = setTimeout(() => {
        try {
          activeChild.kill();
        } catch (_) {
          logError('[main] WorkIQ MCP forced shutdown failed');
        }
        clearProcess(activeChild, 'SHUTTING_DOWN');
        finish();
      }, shutdownGrace);

      try {
        activeChild.stdin.end();
      } catch (_) {
        clearProcess(activeChild, 'SHUTTING_DOWN');
        finish();
      }
    });
  }

  async function ask(question, metadata = {}) {
    if (typeof question !== 'string' || !question.trim() || question.length > 200000
      || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || Object.keys(metadata).some((key) => !['priority', 'key', 'maxAttempts'].includes(key))
      || (metadata.priority !== undefined && !['interactive', 'background'].includes(metadata.priority))
      || (metadata.key !== undefined && (typeof metadata.key !== 'string' || !metadata.key.trim() || metadata.key.length > 256))
      || (metadata.maxAttempts !== undefined && ![1, 2].includes(metadata.maxAttempts))) {
      return readFailure('INVALID_REQUEST', 0);
    }
    const conversation = { id: null };
    try {
      const { value, attempts } = await scheduleRequest(async () => {
        const answer = await semanticAnswer(question, readTimeout, conversation);
        return { success: true, answer };
      }, {
        ...metadata,
        // Never coalesce different prompts or attempt budgets, even when a caller reuses its key.
        key: JSON.stringify(['ask', metadata.key || '', question, metadata.maxAttempts ?? 2]),
      });
      return { ...value, attempts };
    } catch (error) {
      return readFailure(error.code || 'REQUEST_FAILED', error.attempts || 0);
    }
  }

  function scheduled(run, failure, readOnly = false, maxAttempts = 1) {
    return scheduleRequest(run, { readOnly, maxAttempts })
      .then(({ value }) => value)
      .catch((error) => failure(error.code || 'REQUEST_FAILED'));
  }

  function scheduleRequest(run, metadata) {
    return queue.schedule((lease) => transportLease.run(lease, run), metadata);
  }

  return {
    ask,
    probe: () => scheduled(probe, publicFailure, true),
    proposeThreadActions: (context) => {
      const conversation = { id: null };
      return scheduled(() => proposeThreadActions(context, conversation), synthesisFailure, true, 2);
    },
    createOutlookDraft: (draft) => scheduled(() => createOutlookDraft(draft), actionFailure),
    sendTeamsMessage: (input) => scheduled(() => sendTeamsMessage(input), teamsFailure),
    getQueueStatus: queue.getStatus,
    onQueueStatus: queue.subscribe,
    shutdown,
  };
}

const READ_ERRORS = {
  INVALID_REQUEST: 'Invalid WorkIQ request.',
  QUEUE_FULL: 'WorkIQ is busy. Please try again shortly.',
  THROTTLED: 'WorkIQ is temporarily rate limited.',
  TIMEOUT: 'WorkIQ request timed out.',
  SHUTTING_DOWN: 'WorkIQ is shutting down.',
  AUTH_REQUIRED: 'WorkIQ sign-in is required.',
  EMPTY_RESPONSE: 'WorkIQ returned no answer after the allowed attempts. Please try again.',
  INVALID_RESPONSE: 'WorkIQ returned an empty or unsupported response.',
};

function readFailure(code, attempts) {
  return { success: false, error: READ_ERRORS[code] || 'WorkIQ request failed.', code, attempts };
}

function classifyRemoteFailure(remote, fallback) {
  const text = typeof remote?.message === 'string' ? remote.message : '';
  const data = remote?.data;
  const status = data?.status ?? data?.statusCode;
  const code = status === 429 || /throttl|rate.?limit|too many requests/i.test(text)
    ? 'THROTTLED'
    : status === 401 || status === 403 || /auth|sign[ -]?in|login|unauthorized|consent/i.test(text) ? 'AUTH_REQUIRED' : fallback;
  const error = createClientError(code);
  // Only an actual HTTP Retry-After header establishes a shared server cooldown.
  const headers = data?.headers;
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    const name = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after');
    const value = name && headers[name];
    if ((typeof value === 'string' && value.trim()) || typeof value === 'number') {
      const seconds = Number(value);
      const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
      if (Number.isFinite(milliseconds) && milliseconds >= 0) error.retryAfterMs = milliseconds;
    }
  }
  return error;
}

function assertReadResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw createClientError('INVALID_RESPONSE');
  const structured = result.structuredContent;
  const failedEntityResult = Array.isArray(structured?.results)
    ? structured.results.find((entry) => entry?.error || (Number.isInteger(entry?.statusCode)
      && (entry.statusCode < 200 || entry.statusCode >= 300))) : null;
  if ((result.isError !== undefined && result.isError !== false)
    || structured?.isError === true || structured?.error || failedEntityResult) {
    const remoteError = failedEntityResult?.error?.error || failedEntityResult?.error || structured?.error;
    throw classifyRemoteFailure({
      message: `${extractToolText(result)} ${typeof remoteError?.message === 'string' ? remoteError.message : ''}`,
      data: failedEntityResult ? { ...remoteError?.data, statusCode: failedEntityResult.statusCode } : remoteError?.data,
    }, 'TOOL_ERROR');
  }
}

function normalizeAskAnswer(result) {
  const text = extractToolText(result).trim();
  if (text) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'response')) {
        return typeof value.response === 'string' ? value.response.trim() : '';
      }
      if (typeof value === 'string') return value.trim();
      return text;
    } catch (_) {
      return text;
    }
  }
  // Some installed WorkIQ versions label the verified ask envelope as an object.
  for (const item of Array.isArray(result.content) ? result.content : []) {
    if (item?.type !== 'object' || typeof item.text !== 'string') continue;
    let envelope;
    try {
      envelope = JSON.parse(item.text);
    } catch {
      continue;
    }
    if (typeof envelope?.response === 'string') return envelope.response.trim();
  }
  // WorkIQ's verified ask envelope, not arbitrary structured entity payloads.
  for (const field of ['answer', 'response']) {
    const value = result.structuredContent?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveEntityTool(tools, logicalName) {
  if (!(tools instanceof Set)) return null;
  if (tools.has(logicalName)) return logicalName;
  const escaped = logicalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...tools].find((name) => new RegExp(`(?:^|[-_.:])${escaped}$`, 'i').test(name) && /workiq/i.test(name)) || null;
}

function extractEntityData(result) {
  const candidates = [];
  const text = extractToolText(result);
  if (text) {
    try { candidates.push(JSON.parse(text)); } catch (_) { return null; }
  }
  if (result?.structuredContent !== undefined) {
    const entries = result.structuredContent?.results;
    if (!Array.isArray(entries) || entries.length !== 1) return null;
    const [entry] = entries;
    if (entry?.statusCode !== 200 || entry.error || entry.data?.error) return null;
    candidates.push(entry.data);
  }
  if (candidates.length !== 1 || !candidates[0] || typeof candidates[0] !== 'object'
    || Array.isArray(candidates[0])) return null;
  return candidates[0];
}

function extractEntityCollection(result) {
  const collection = extractEntityData(result);
  return Array.isArray(collection?.value) && collection.value.length <= 1000 ? collection : null;
}

function directoryAddresses(user) {
  const proxies = Array.isArray(user?.proxyAddresses)
    ? user.proxyAddresses.filter(value => typeof value === 'string' && /^smtp:/i.test(value)).map(value => value.slice(5)) : [];
  return [...new Set([
    user?.mail,
    typeof user?.userPrincipalName === 'string' && !/#EXT#@/i.test(user.userPrincipalName) ? user.userPrincipalName : null,
    ...proxies,
    ...(Array.isArray(user?.otherMails) ? user.otherMails : []),
  ].filter(isValidEmail).map(value => value.toLowerCase()))];
}

function extractCreatedChat(result) {
  const structured = result?.structuredContent;
  let chat = structured?.data;
  if (structured === undefined && result?.content?.length === 1 && result.content[0]?.type === 'text') {
    try { chat = JSON.parse(result.content[0].text); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return null;
    }
  }
  if (!result || typeof result !== 'object' || result.error
    || (result.isError !== undefined && result.isError !== false)
    || (structured !== undefined && ((Array.isArray(result.content) && result.content.length)
      || !structured || Object.keys(structured).some(key => !['statusCode', 'data'].includes(key))
      || ![200, 201].includes(structured.statusCode)))
    || chat?.error || chat?.chatType !== 'oneOnOne'
    || typeof chat.id !== 'string' || !chat.id || chat.id.length > 512 || C0_OR_DEL_PATTERN.test(chat.id)) return null;
  return chat;
}

function findCanonicalPair(chats, identity) {
  const matches = [];
  for (const chat of chats) {
    if (chat?.chatType !== 'oneOnOne' || !Array.isArray(chat.members)) continue;
    for (const member of chat.members) {
      const id = typeof member?.userId === 'string' ? member.userId.toLowerCase() : '';
      const addressMatch = isValidEmail(member?.email) && identity.addresses.includes(member.email.toLowerCase());
      if ((addressMatch && id !== identity.targetId)
        || (id === identity.targetId && !addressMatch)) return { matches: [], conflict: true };
    }
    if (typeof chat.id !== 'string' || !chat.id || chat.members.length !== 2 || chat['members@odata.nextLink']) continue;
    const ids = chat.members.map(member => typeof member?.userId === 'string' ? member.userId.toLowerCase() : '');
    if (ids.includes(identity.selfId) && ids.includes(identity.targetId)) matches.push(chat);
  }
  return { matches, conflict: false };
}

function extractChatCollection(result) {
  const candidates = [];
  const text = extractToolText(result);
  if (text) {
    try { candidates.push(JSON.parse(text)); } catch (_) { return null; }
  }
  const structured = result?.structuredContent;
  if (structured !== undefined) {
    // WorkIQ 1.0.1 fetch returns one status-bearing result per requested path.
    if (!Array.isArray(structured?.results) || structured.results.length !== 1) return null;
    const [entry] = structured.results;
    if (entry?.statusCode !== 200 || entry.error || entry.data?.error) return null;
    candidates.push(entry.data);
  }
  if (candidates.length !== 1) return null;
  const [collection] = candidates;
  const values = Array.isArray(collection) ? collection : collection?.value;
  if (!Array.isArray(values) || values.length > 1000) return null;
  const nextLink = collection?.['@odata.nextLink'];
  if (nextLink === undefined) return { values, nextPage: null };
  if (typeof nextLink !== 'string' || !nextLink || nextLink.length > 16000) return null;
  let url;
  try { url = new URL(nextLink, 'https://graph.microsoft.com'); } catch (_) { return null; }
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || url.hash
    || !/^\/(?:v1\.0\/)?me\/chats$/.test(url.pathname)) return null;
  return { values, nextPage: `/me/chats${url.search}` };
}

function isValidGraphTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = GRAPH_TIMESTAMP_PATTERN.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const calendarDate = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === date;
}

function hasCreatedOutlookDraftEvidence(result) {
  const candidates = [];
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        const parsed = JSON.parse(item.text);
        const hasValue = parsed && typeof parsed === 'object'
          && Object.prototype.hasOwnProperty.call(parsed, 'value');
        const hasResult = parsed && typeof parsed === 'object'
          && Object.prototype.hasOwnProperty.call(parsed, 'result');
        if (hasValue) candidates.push(parsed.value);
        if (hasResult) candidates.push(parsed.result);
        if (!hasValue && !hasResult) candidates.push(parsed);
      } catch (_) {}
    }
  }

  const structuredContent = result?.structuredContent;
  if (structuredContent !== undefined) {
    candidates.push(createdStructuredEntity(structuredContent));
  }

  if (candidates.length !== 1) return false;
  const [entity] = candidates;
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return false;
  if (Object.prototype.hasOwnProperty.call(entity, '@odata.type')
    && entity['@odata.type'] !== '#microsoft.graph.message') return false;
  return typeof entity.id === 'string' && Boolean(entity.id.trim()) && entity.isDraft === true;
}

function teamsMessageReceiptFailure(result, expectedChatId, expectedContent) {
  const candidates = [];
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        const parsed = JSON.parse(item.text);
        const hasValue = parsed && typeof parsed === 'object'
          && Object.prototype.hasOwnProperty.call(parsed, 'value');
        const hasResult = parsed && typeof parsed === 'object'
          && Object.prototype.hasOwnProperty.call(parsed, 'result');
        if (hasValue) candidates.push(parsed.value);
        if (hasResult) candidates.push(parsed.result);
        if (!hasValue && !hasResult) candidates.push(parsed);
      } catch (_) {}
    }
  }

  const structuredContent = result?.structuredContent;
  if (structuredContent !== undefined) {
    candidates.push(createdStructuredEntity(structuredContent));
  }

  if (candidates.length !== 1) return 'ENTITY_COUNT';

  const [entity] = candidates;
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return 'ENTITY_SHAPE';
  if (Object.prototype.hasOwnProperty.call(entity, '@odata.type')
    && entity['@odata.type'] !== '#microsoft.graph.chatMessage') return 'ENTITY_TYPE';
  if (typeof entity.id !== 'string' || !entity.id.trim()) return 'MESSAGE_ID';
  if (typeof entity.chatId !== 'string' || entity.chatId !== expectedChatId) return 'CHAT_MISMATCH';
  if (entity.id === expectedChatId) return 'MESSAGE_ID';
  if (!isValidGraphTimestamp(entity.createdDateTime)) return 'CREATED_TIMESTAMP';
  if (!entity.body || typeof entity.body !== 'object' || Array.isArray(entity.body)) return 'BODY_SHAPE';
  if (Object.prototype.hasOwnProperty.call(entity.body, '@odata.type')
    && entity.body['@odata.type'] !== '#microsoft.graph.itemBody') return 'BODY_TYPE';
  if (entity.body.contentType !== 'text'
    || typeof entity.body.content !== 'string'
    || entity.body.content !== expectedContent) return 'BODY_MISMATCH';
  if (Object.prototype.hasOwnProperty.call(entity, 'messageType')
    && entity.messageType !== 'message') return 'MESSAGE_TYPE';
  return null;
}

function createdStructuredEntity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'statusCode') || Object.prototype.hasOwnProperty.call(value, 'data')) {
    // Observed on installed WorkIQ 1.0.1 create_entity. Fetch uses results[],
    // while creates return one status-bearing data object.
    if (Object.keys(value).length !== 2
      || !Number.isInteger(value.statusCode) || value.statusCode < 200 || value.statusCode >= 300
      || !Object.prototype.hasOwnProperty.call(value, 'data')) return null;
    return value.data;
  }
  return Object.prototype.hasOwnProperty.call(value, 'result') ? value.result : value;
}

function resolveAskTool(tools) {
  if (!(tools instanceof Set)) return null;
  if (tools.has('ask')) return 'ask';
  if (tools.has('ask_work_iq')) return 'ask_work_iq';
  return [...tools].find((name) => /(?:^|[-_.:])ask$/i.test(name) && /workiq/i.test(name)) || null;
}

function extractToolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .map((item) => item?.type === 'text' && typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  createWorkiqMcpClient,
};