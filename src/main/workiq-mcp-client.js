'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { workiqLauncher, getNodeExecutable } = require('./pty-bridge');
const { log, logError } = require('./utils');

const DEFAULT_INITIALIZE_TIMEOUT = 30000;
const DEFAULT_PROBE_TIMEOUT = 10000;
const DEFAULT_SEMANTIC_TIMEOUT = 60000;
const DEFAULT_SHUTDOWN_GRACE = 1000;
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const MCP_PROTOCOL_VERSION = '2025-03-26';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const C0_OR_DEL_PATTERN = /[\x00-\x1f\x7f]/;
const DRAFT_FIELDS = new Set(['subject', 'body', 'to', 'cc', 'bcc', 'importance']);
const DRAFT_IMPORTANCE = new Set(['low', 'normal', 'high']);
const TEAMS_MESSAGE_FIELDS = new Set(['targetDisplayName', 'message']);
const MESSAGE_CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const GRAPH_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
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

function normalizeTeamsMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !TEAMS_MESSAGE_FIELDS.has(key))) {
    throw createClientError('INVALID_MESSAGE');
  }
  const targetDisplayName = typeof value.targetDisplayName === 'string' ? value.targetDisplayName.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!targetDisplayName || targetDisplayName.length > 160 || C0_OR_DEL_PATTERN.test(targetDisplayName)
    || !message || message.length > 4000 || MESSAGE_CONTROL_PATTERN.test(message)) {
    throw createClientError('INVALID_MESSAGE');
  }
  return { targetDisplayName, message };
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
  const shutdownGrace = options.shutdownGrace || DEFAULT_SHUTDOWN_GRACE;
  const maxMessageBytes = options.maxMessageBytes || DEFAULT_MAX_MESSAGE_BYTES;

  let child = null;
  let stdoutBuffer = '';
  let nextRequestId = 1;
  let initializePromise = null;
  let probePromise = null;
  let availableTools = null;
  let shuttingDown = false;
  let synthesisModulePromise = null;
  const pendingRequests = new Map();

  function publicFailure(code) {
    return {
      ok: false,
      readOnly: true,
      mcp: 'unavailable',
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

  function protocolFailure() {
    logError('[main] WorkIQ MCP protocol error');
    terminateProcess('PROTOCOL_ERROR');
  }

  function handleMessage(line) {
    if (Buffer.byteLength(line, 'utf8') > maxMessageBytes) {
      protocolFailure();
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      protocolFailure();
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      protocolFailure();
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const request = pendingRequests.get(message.id);
    if (!request) {
      protocolFailure();
      return;
    }

    pendingRequests.delete(message.id);
    clearTimeout(request.timeout);

    if (message.error) {
      request.reject(createClientError('PROTOCOL_ERROR'));
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
      request.reject(createClientError('PROTOCOL_ERROR'));
      return;
    }

    request.resolve(message.result);
  }

  function handleStdout(chunk) {
    stdoutBuffer += chunk.toString('utf8');

    if (Buffer.byteLength(stdoutBuffer, 'utf8') > maxMessageBytes && !stdoutBuffer.includes('\n')) {
      protocolFailure();
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

    startedChild.stdout.on('data', handleStdout);
    startedChild.stderr.on('data', () => {});
    startedChild.stdin.on('error', () => {
      logError('[main] WorkIQ MCP stream error');
      failProcess(startedChild, 'PROCESS_EXITED');
    });
    startedChild.stdout.on('error', () => {
      logError('[main] WorkIQ MCP stream error');
      failProcess(startedChild, 'PROCESS_EXITED');
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
    const activeChild = startProcess();
    const id = nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(createClientError('TIMEOUT'));
        terminateProcess('TIMEOUT');
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timeout });

      try {
        activeChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (_) {
        clearTimeout(timeout);
        pendingRequests.delete(id);
        reject(createClientError('PROCESS_EXITED'));
        terminateProcess('PROCESS_EXITED');
      }
    });
  }

  function ensureInitialized() {
    if (initializePromise) return initializePromise;

    initializePromise = sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'FlightDeck', version: '2.0.0' },
    }, initializeTimeout).then((result) => {
      if (!result || typeof result !== 'object' || typeof result.protocolVersion !== 'string') {
        throw createClientError('PROTOCOL_ERROR');
      }
      sendNotification('notifications/initialized');
    }).catch((error) => {
      initializePromise = null;
      throw error;
    });

    return initializePromise;
  }

  async function runProbe() {
    await ensureTools();
    return {
      ok: true,
      readOnly: true,
      mcp: 'available',
      auth: 'unknown',
    };
  }

  async function ensureTools() {
    await ensureInitialized();
    if (availableTools) return availableTools;

    const result = await sendRequest('tools/list', {}, probeTimeout);
    if (!result || typeof result !== 'object' || !Array.isArray(result.tools)) {
      throw createClientError('PROTOCOL_ERROR');
    }

    availableTools = new Set();
    for (const tool of result.tools) {
      if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
        throw createClientError('PROTOCOL_ERROR');
      }
      availableTools.add(tool.name);
    }
    return availableTools;
  }

  function probe() {
    if (shuttingDown) return Promise.resolve(publicFailure('SHUTTING_DOWN'));
    if (probePromise) return probePromise;

    probePromise = runProbe()
      .catch((error) => {
        const code = error && typeof error.code === 'string' ? error.code : 'PROTOCOL_ERROR';
        if (child) terminateProcess(code);
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
      if (!tools.has('create_entity')) {
        return actionFailure('UNSUPPORTED');
      }

      const createPromise = sendRequest('tools/call', {
        name: 'create_entity',
        arguments: {
          parentUrl: '/me/messages',
          jsonBody,
        },
      }, probeTimeout);
      createDispatched = true;
      const result = await createPromise;

      if (!result || typeof result !== 'object' || result.isError === true) {
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
      if (code !== 'INVALID_DRAFT' && child) terminateProcess(code);
      return actionFailure(code, createDispatched);
    }
  }

  async function sendTeamsMessage(input) {
    if (shuttingDown) return teamsFailure('SHUTTING_DOWN');

    let payload;
    let createDispatched = false;
    try {
      payload = normalizeTeamsMessage(input);
      const tools = await ensureTools();
      const fetchTool = resolveEntityTool(tools, 'fetch');
      const createTool = resolveEntityTool(tools, 'create_entity');
      if (!fetchTool || !createTool) return teamsFailure('UNSUPPORTED');

      const chatsResult = await sendRequest('tools/call', {
        name: fetchTool,
        arguments: { entityUrls: ['/me/chats?$expand=members'] },
      }, probeTimeout);
      if (!chatsResult || chatsResult.isError === true) return teamsFailure('RESOLUTION_FAILED');

      const chats = extractEntityValues(chatsResult);
      const targetName = payload.targetDisplayName.toLocaleLowerCase();
      const matches = chats.filter((chat) =>
        chat?.chatType === 'oneOnOne'
        && typeof chat.id === 'string'
        && chat.id
        && Array.isArray(chat.members)
        && chat.members.some((member) => String(member?.displayName || '').trim().toLocaleLowerCase() === targetName)
      );
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
      const sendResult = await sendPromise;
      if (!sendResult || typeof sendResult !== 'object' || Array.isArray(sendResult)
        || (Object.prototype.hasOwnProperty.call(sendResult, 'isError') && sendResult.isError !== false)) {
        return teamsFailure('SEND_UNCONFIRMED');
      }
      if (!hasCreatedTeamsMessageEvidence(sendResult, matches[0].id, payload.message)) {
        return teamsFailure('SEND_UNCONFIRMED');
      }
      return { ok: true, action: 'teams-message-sent' };
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'SEND_FAILED';
      if (code !== 'INVALID_MESSAGE' && child) terminateProcess(code);
      return teamsFailure(createDispatched ? 'SEND_UNCONFIRMED' : code);
    }
  }

  async function proposeThreadActions(context) {
    if (shuttingDown) return synthesisFailure('SHUTTING_DOWN');

    try {
      const synthesis = await loadSynthesisModule();
      const normalizedContext = synthesis.normalizeProposalSynthesisContext(context);
      if (!normalizedContext) return synthesisFailure('INVALID_CONTEXT');

      const tools = await ensureTools();
      const askTool = resolveAskTool(tools);
      if (!askTool) return synthesisFailure('UNSUPPORTED');

      const template = fs.readFileSync(SYNTHESIS_PROMPT_PATH, 'utf8');
      const question = `${template.trim()}\n\nSelected thread context:\n${JSON.stringify(normalizedContext)}`;
      const result = await sendRequest('tools/call', {
        name: askTool,
        arguments: { question },
      }, semanticTimeout);

      if (!result || typeof result !== 'object' || result.isError === true) {
        const content = extractToolText(result);
        return synthesisFailure(/auth|sign[ -]?in|login|unauthorized|consent/i.test(content)
          ? 'AUTH_REQUIRED'
          : 'SYNTHESIS_FAILED');
      }

      const normalizedResult = synthesis.parseProposalSynthesisResponse(extractToolText(result));
      if (!normalizedResult) return synthesisFailure('INVALID_RESPONSE');
      return {
        ok: true,
        readOnly: true,
        result: normalizedResult,
      };
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'SYNTHESIS_FAILED';
      if (!['INVALID_CONTEXT', 'INVALID_RESPONSE'].includes(code) && child) terminateProcess(code);
      return synthesisFailure(code);
    }
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
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

  return { probe, proposeThreadActions, createOutlookDraft, sendTeamsMessage, shutdown };
}

function resolveEntityTool(tools, logicalName) {
  if (!(tools instanceof Set)) return null;
  if (tools.has(logicalName)) return logicalName;
  const escaped = logicalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...tools].find((name) => new RegExp(`(?:^|[-_.:])${escaped}$`, 'i').test(name) && /workiq/i.test(name)) || null;
}

function extractEntityValues(result) {
  const text = extractToolText(result);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.value) ? parsed.value : [];
  } catch (_) {
    return [];
  }
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
    const hasResult = structuredContent && typeof structuredContent === 'object'
      && Object.prototype.hasOwnProperty.call(structuredContent, 'result');
    candidates.push(hasResult ? structuredContent.result : structuredContent);
  }

  if (candidates.length !== 1) return false;
  const [entity] = candidates;
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return false;
  if (Object.prototype.hasOwnProperty.call(entity, '@odata.type')
    && entity['@odata.type'] !== '#microsoft.graph.message') return false;
  return typeof entity.id === 'string' && Boolean(entity.id.trim()) && entity.isDraft === true;
}

function hasCreatedTeamsMessageEvidence(result, expectedChatId, expectedContent) {
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
    const hasResult = structuredContent && typeof structuredContent === 'object'
      && Object.prototype.hasOwnProperty.call(structuredContent, 'result');
    candidates.push(hasResult ? structuredContent.result : structuredContent);
  }

  if (candidates.length !== 1) return false;

  const [entity] = candidates;
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return false;
  if (Object.prototype.hasOwnProperty.call(entity, '@odata.type')
    && entity['@odata.type'] !== '#microsoft.graph.chatMessage') return false;
  if (typeof entity.id !== 'string' || !entity.id.trim()) return false;
  if (typeof entity.chatId !== 'string' || entity.chatId !== expectedChatId) return false;
  if (entity.id === expectedChatId) return false;
  if (!isValidGraphTimestamp(entity.createdDateTime)) return false;
  if (!entity.body || typeof entity.body !== 'object' || Array.isArray(entity.body)) return false;
  if (Object.prototype.hasOwnProperty.call(entity.body, '@odata.type')
    && entity.body['@odata.type'] !== '#microsoft.graph.itemBody') return false;
  if (entity.body.contentType !== 'text'
    || typeof entity.body.content !== 'string'
    || entity.body.content !== expectedContent) return false;
  if (Object.prototype.hasOwnProperty.call(entity, 'messageType')
    && entity.messageType !== 'message') return false;
  return true;
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