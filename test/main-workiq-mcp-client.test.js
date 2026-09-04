'use strict';

require('./helpers/electron-mock');

const { EventEmitter } = require('events');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkiqMcpClient } = require('../src/main/workiq-mcp-client');

class FakeChild extends EventEmitter {
  constructor(onMessage) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.messages = [];
    this.killCalls = 0;
    this.stdin = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: (line) => {
        const message = JSON.parse(line);
        this.messages.push(message);
        onMessage?.(message, this);
      },
      end: () => {
        this.stdin.destroyed = true;
      },
    });
  }

  respond(id, result) {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`));
  }

  kill() {
    this.killCalls += 1;
    this.emit('exit', null, 'SIGTERM');
  }
}

function createHarness(onMessage, options = {}) {
  const spawnCalls = [];
  const children = [];
  const client = createWorkiqMcpClient({
    launcher: 'C:\\WorkIQ\\workiq.exe',
    verifyLauncher: false,
    initializeTimeout: 30,
    probeTimeout: 30,
    shutdownGrace: 5,
    spawnProcess: (executable, args, spawnOptions) => {
      const child = new FakeChild(onMessage);
      children.push(child);
      spawnCalls.push({ executable, args, spawnOptions });
      return child;
    },
    ...options,
  });

  return { client, children, spawnCalls };
}

function successfulServer(message, child) {
  if (message.method === 'initialize') {
    queueMicrotask(() => child.respond(message.id, { protocolVersion: '2025-03-26' }));
  } else if (message.method === 'tools/list') {
    queueMicrotask(() => child.respond(message.id, { tools: [{ name: 'ask' }, { name: 'fetch' }, { name: 'create_entity' }] }));
  }
}

function createTeamsHarness(onCreate, options = {}) {
  let createAttempts = 0;
  const harness = createHarness((message, child) => {
    successfulServer(message, child);
    if (message.method !== 'tools/call') return;
    if (message.params.name === 'fetch') {
      queueMicrotask(() => child.respond(message.id, {
        content: [{ type: 'text', text: JSON.stringify({ value: [
          { id: 'chat-james', chatType: 'oneOnOne', members: [{ displayName: 'James Farquharson' }] },
        ] }) }],
        isError: false,
      }));
      return;
    }
    createAttempts += 1;
    onCreate?.(message, child);
  }, options);

  return { ...harness, getCreateAttempts: () => createAttempts };
}

describe('createWorkiqMcpClient()', () => {
  it('starts lazily and exposes only a sanitized read-only probe result', async () => {
    const { client, children, spawnCalls } = createHarness(successfulServer);

    assert.equal(spawnCalls.length, 0);
    assert.deepEqual(await client.probe(), {
      ok: true,
      readOnly: true,
      mcp: 'available',
      auth: 'unknown',
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].executable, 'C:\\WorkIQ\\workiq.exe');
    assert.deepEqual(spawnCalls[0].args, ['mcp', '--log-level', 'Error']);
    assert.deepEqual(children[0].messages.map((message) => message.method), [
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    assert.deepEqual(Object.keys(client).sort(), ['createOutlookDraft', 'probe', 'proposeThreadActions', 'sendTeamsMessage', 'shutdown']);
  });

  it('coalesces concurrent probes onto one process and one tools request', async () => {
    const { client, children, spawnCalls } = createHarness(successfulServer);

    const first = client.probe();
    const second = client.probe();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.deepEqual(firstResult, secondResult);
    assert.equal(spawnCalls.length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/list').length, 1);
  });

  it('returns a sanitized timeout and terminates the stalled process', async () => {
    const { client, children } = createHarness(() => {});

    assert.deepEqual(await client.probe(), {
      ok: false,
      readOnly: true,
      mcp: 'unavailable',
      auth: 'unknown',
      code: 'TIMEOUT',
    });
    assert.equal(children[0].killCalls, 1);
  });

  it('rejects malformed protocol output without exposing it', async () => {
    const { client, children } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from('tenant secret: nope\n')));
      }
    });

    const result = await client.probe();
    assert.deepEqual(result, {
      ok: false,
      readOnly: true,
      mcp: 'unavailable',
      auth: 'unknown',
      code: 'PROTOCOL_ERROR',
    });
    assert.equal(JSON.stringify(result).includes('tenant secret'), false);
    assert.equal(children[0].killCalls, 1);
  });

  it('accepts a response frame fragmented across stdout chunks', async () => {
    const { client } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        const frame = `${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2025-03-26' },
        })}\n`;
        const midpoint = Math.floor(frame.length / 2);
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(frame.slice(0, midpoint)));
          child.stdout.emit('data', Buffer.from(frame.slice(midpoint)));
        });
      } else if (message.method === 'tools/list') {
        queueMicrotask(() => child.respond(message.id, { tools: [] }));
      }
    });

    assert.equal((await client.probe()).ok, true);
  });

  it('matches multiple frames in one chunk to concurrent requests out of order', async () => {
    const createCalls = [];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;

      createCalls.push(message);
      if (createCalls.length === 2) {
        const frames = [...createCalls].reverse().map((call, index) => JSON.stringify({
          jsonrpc: '2.0',
          id: call.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ id: `draft-${index}`, isDraft: true }) }],
            isError: false,
          },
        })).join('\n');
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${frames}\n`)));
      }
    });

    const results = await Promise.all([
      client.createOutlookDraft({
        subject: 'First',
        body: 'First body',
        to: ['first@example.com'],
      }),
      client.createOutlookDraft({
        subject: 'Second',
        body: 'Second body',
        to: ['second@example.com'],
      }),
    ]);

    assert.deepEqual(results.map((result) => result.ok), [true, true]);
    assert.equal(children.length, 1);
    assert.equal(createCalls.length, 2);
  });

  it('rejects unknown response IDs and terminates the process', async () => {
    const { client, children } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.respond(message.id + 1000, { protocolVersion: '2025-03-26' }));
      }
    });

    assert.equal((await client.probe()).code, 'PROTOCOL_ERROR');
    assert.equal(children[0].killCalls, 1);
  });

  it('rejects oversized stdout and terminates the process', async () => {
    const { client, children } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from('x'.repeat(65))));
      }
    }, { maxMessageBytes: 64 });

    assert.equal((await client.probe()).code, 'PROTOCOL_ERROR');
    assert.equal(children[0].killCalls, 1);
  });

  it('can start a fresh process after an unexpected exit', async () => {
    let spawnNumber = 0;
    const { client, children } = createHarness((message, child) => {
      if (spawnNumber === 0 && message.method === 'initialize') {
        spawnNumber += 1;
        queueMicrotask(() => child.emit('exit', 1, null));
        return;
      }
      successfulServer(message, child);
    });

    const first = await client.probe();
    const second = await client.probe();

    assert.equal(first.code, 'PROCESS_EXITED');
    assert.equal(second.ok, true);
    assert.equal(children.length, 2);
  });

  it('ends stdin and force-kills a child that does not exit during shutdown', async () => {
    const { client, children } = createHarness(successfulServer);
    await client.probe();

    await client.shutdown();

    assert.equal(children[0].stdin.destroyed, true);
    assert.equal(children[0].killCalls, 1);
    assert.equal((await client.probe()).code, 'SHUTTING_DOWN');
  });

  it('creates a plain-text Outlook draft through the fixed messages collection', async () => {
    let createCall;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        createCall = message;
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: '{"id":"sensitive-id","isDraft":true}' }],
          isError: false,
        }));
      }
    });

    const result = await client.createOutlookDraft({
      subject: 'Follow-up',
      body: 'Thanks for your time.',
      to: ['person@example.com'],
      cc: ['copy@example.com'],
      importance: 'high',
    });

    assert.deepEqual(result, { ok: true, action: 'outlook-draft-created' });
    assert.equal(JSON.stringify(result).includes('sensitive-id'), false);
    assert.equal(createCall.params.name, 'create_entity');
    assert.equal(createCall.params.arguments.parentUrl, '/me/messages');
    assert.deepEqual(createCall.params.arguments.jsonBody, {
      '@odata.type': '#microsoft.graph.message',
      subject: 'Follow-up',
      body: {
        '@odata.type': '#microsoft.graph.itemBody',
        contentType: 'text',
        content: 'Thanks for your time.',
      },
      toRecipients: [{
        '@odata.type': '#microsoft.graph.recipient',
        emailAddress: {
          '@odata.type': '#microsoft.graph.emailAddress',
          address: 'person@example.com',
        },
      }],
      ccRecipients: [{
        '@odata.type': '#microsoft.graph.recipient',
        emailAddress: {
          '@odata.type': '#microsoft.graph.emailAddress',
          address: 'copy@example.com',
        },
      }],
      bccRecipients: [],
      importance: 'high',
    });
  });

  it('resolves one existing one-to-one chat and sends a plain-text Teams message once', async () => {
    const calls = [];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      calls.push(message);
      if (message.params.name === 'fetch') {
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: JSON.stringify({ value: [
            { id: 'chat-james', chatType: 'oneOnOne', members: [{ displayName: 'Kyle Poineal' }, { displayName: 'James Farquharson' }] },
            { id: 'group-chat', chatType: 'group', members: [{ displayName: 'James Farquharson' }] },
          ] }) }],
          isError: false,
        }));
      } else {
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: JSON.stringify({
            id: '1749218427231',
            chatId: 'chat-james',
            messageType: 'message',
            createdDateTime: '2026-08-28T20:07:38.817Z',
            body: { contentType: 'text', content: 'Can you confirm the CAF assessment scope?' },
          }) }],
          isError: false,
        }));
      }
    });

    assert.deepEqual(await client.sendTeamsMessage({
      targetDisplayName: 'James Farquharson',
      message: 'Can you confirm the CAF assessment scope?',
    }), { ok: true, action: 'teams-message-sent' });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params.arguments, { entityUrls: ['/me/chats?$expand=members'] });
    assert.equal(calls[1].params.name, 'create_entity');
    assert.equal(calls[1].params.arguments.parentUrl, '/chats/chat-james/messages');
    assert.deepEqual(calls[1].params.arguments.jsonBody, {
      body: { contentType: 'text', content: 'Can you confirm the CAF assessment scope?' },
    });
  });

  it('accepts only direct and allowlisted wrapper chatMessage response shapes', async (testContext) => {
    const messageEntity = {
      '@odata.type': '#microsoft.graph.chatMessage',
      id: '1749218427231',
      chatId: 'chat-james',
      messageType: 'message',
      createdDateTime: '2026-08-28T20:07:38.817Z',
      body: { contentType: 'text', content: 'private outgoing message' },
    };
    const typedBodyEntity = {
      ...messageEntity,
      body: {
        '@odata.type': '#microsoft.graph.itemBody',
        contentType: 'text',
        content: 'private outgoing message',
      },
    };
    const fixtures = [
      ['content[0].text direct chatMessage', { content: [{ type: 'text', text: JSON.stringify(messageEntity) }], isError: false }],
      ['content[0].text value chatMessage', { content: [{ type: 'text', text: JSON.stringify({ value: messageEntity }) }], isError: false }],
      ['content[0].text result chatMessage', { content: [{ type: 'text', text: JSON.stringify({ result: messageEntity }) }], isError: false }],
      ['structuredContent direct chatMessage', { content: [], structuredContent: messageEntity, isError: false }],
      ['structuredContent.result chatMessage', { content: [], structuredContent: { result: messageEntity }, isError: false }],
      ['correct body odata type', { content: [{ type: 'text', text: JSON.stringify(typedBodyEntity) }], isError: false }],
    ];

    for (const [name, fixture] of fixtures) {
      await testContext.test(name, async () => {
        const { client, getCreateAttempts } = createTeamsHarness((message, child) => {
          queueMicrotask(() => child.respond(message.id, fixture));
        });

        assert.deepEqual(await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'private outgoing message',
        }), { ok: true, action: 'teams-message-sent' });
        assert.equal(getCreateAttempts(), 1);
      });
    }
  });

  it('requires exactly one receipt candidate across all allowlisted response shapes', async (testContext) => {
    const messageEntity = {
      '@odata.type': '#microsoft.graph.chatMessage',
      id: 'private-message-id',
      chatId: 'chat-james',
      messageType: 'message',
      createdDateTime: '2026-08-28T20:07:38.817Z',
      body: { contentType: 'text', content: 'private outgoing message' },
    };
    const fixtures = [
      ['identical duplicate content candidates', {
        content: [
          { type: 'text', text: JSON.stringify(messageEntity) },
          { type: 'text', text: JSON.stringify(messageEntity) },
        ],
        isError: false,
      }],
      ['different message IDs', {
        content: [
          { type: 'text', text: JSON.stringify(messageEntity) },
          { type: 'text', text: JSON.stringify({ ...messageEntity, id: 'private-other-message-id' }) },
        ],
        isError: false,
      }],
      ['conflicting structuredContent chatId', {
        content: [{ type: 'text', text: JSON.stringify(messageEntity) }],
        structuredContent: { ...messageEntity, chatId: 'private-other-chat' },
        isError: false,
      }],
    ];

    for (const [name, fixture] of fixtures) {
      await testContext.test(name, async () => {
        const { client, children, getCreateAttempts } = createTeamsHarness((message, child) => {
          queueMicrotask(() => child.respond(message.id, fixture));
        });

        const result = await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'private outgoing message',
        });
        assert.deepEqual(result, { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' });
        assert.equal(getCreateAttempts(), 1);
        assert.equal(children.length, 1);
        assert.equal(children[0].messages.filter((message) =>
          message.method === 'tools/call' && message.params.name === 'create_entity').length, 1);
        assert.equal(JSON.stringify(result).includes('private'), false);
      });
    }
  });

  it('requires an explicitly boolean false isError value when metadata is present', async (testContext) => {
    const messageEntity = {
      id: 'private-message-id',
      chatId: 'chat-james',
      messageType: 'message',
      createdDateTime: '2026-08-28T20:07:38.817Z',
      body: { contentType: 'text', content: 'private outgoing message' },
    };
    const fixtures = [true, 'true', 'false', null, 0, 1, {}];

    for (const isError of fixtures) {
      await testContext.test(`rejects ${JSON.stringify(isError)}`, async () => {
        const { client, children, getCreateAttempts } = createTeamsHarness((message, child) => {
          queueMicrotask(() => child.respond(message.id, {
            content: [{ type: 'text', text: JSON.stringify(messageEntity) }],
            isError,
          }));
        });

        const result = await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'private outgoing message',
        });
        assert.deepEqual(result, { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' });
        assert.equal(getCreateAttempts(), 1);
        assert.equal(children.length, 1);
        assert.equal(children[0].messages.filter((message) =>
          message.method === 'tools/call' && message.params.name === 'create_entity').length, 1);
        assert.equal(JSON.stringify(result).includes('private'), false);
      });
    }
  });

  it('fails closed for non-chatMessage and non-allowlisted response evidence', async (testContext) => {
    const validEntity = {
      id: 'message-id',
      chatId: 'chat-james',
      messageType: 'message',
      createdDateTime: '2026-08-28T20:07:38.817Z',
      body: { contentType: 'text', content: 'private outgoing message' },
    };
    const fixtures = [
      ['empty content', { content: [], isError: false }],
      ['malformed JSON', { content: [{ type: 'text', text: '{not-json' }], isError: false }],
      ['display-only text', { content: [{ type: 'text', text: 'private response text: Message sent' }], isError: false }],
      ['ID-only entity', { content: [{ type: 'text', text: JSON.stringify({ id: 'operation-id' }) }], isError: false }],
      ['chat ID pair only', { content: [{ type: 'text', text: JSON.stringify({ id: 'chat-james', chatId: 'chat-james' }) }], isError: false }],
      ['operation ID wrapper', { content: [{ type: 'text', text: JSON.stringify({ operationId: 'operation-id', chatId: 'chat-james', messageType: 'message' }) }], isError: false }],
      ['operation message type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, id: 'operation-id', messageType: 'operation' }) }], isError: false }],
      ['message ID equals chat ID', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, id: 'chat-james' }) }], isError: false }],
      ['arbitrary body object', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, body: { foo: 'bar' } }) }], isError: false }],
      ['empty explicit odata type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, '@odata.type': '' }) }], isError: false }],
      ['malformed created timestamp', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, createdDateTime: 'not-a-timestamp' }) }], isError: false }],
      ['date without timestamp', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, createdDateTime: '2026-08-28' }) }], isError: false }],
      ['mismatched body content', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, body: { contentType: 'text', content: 'different outgoing message' } }) }], isError: false }],
      ['wrong body content type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, body: { contentType: 'html', content: 'private outgoing message' } }) }], isError: false }],
      ['empty body odata type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, body: { '@odata.type': '', contentType: 'text', content: 'private outgoing message' } }) }], isError: false }],
      ['wrong body odata type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, body: { '@odata.type': '#microsoft.graph.messageBody', contentType: 'text', content: 'private outgoing message' } }) }], isError: false }],
      ['wrong odata type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, '@odata.type': '#microsoft.graph.user' }) }], isError: false }],
      ['wrong normal-user message type', { content: [{ type: 'text', text: JSON.stringify({ ...validEntity, messageType: 'systemEventMessage' }) }], isError: false }],
      ['unrelated entity', { content: [{ type: 'text', text: JSON.stringify({ id: 'user-id', chatId: 'chat-james', displayName: 'James Farquharson' }) }], isError: false }],
      ['explicit non-chatMessage entity', { content: [{ type: 'text', text: JSON.stringify({ '@odata.type': '#microsoft.graph.user', id: 'user-id', chatId: 'chat-james', messageType: 'message' }) }], isError: false }],
      ['missing chatId', { content: [{ type: 'text', text: JSON.stringify({ id: 'message-id', messageType: 'message' }) }], isError: false }],
      ['wrong chatId', { content: [{ type: 'text', text: JSON.stringify({ id: 'message-id', chatId: 'different-chat', messageType: 'message' }) }], isError: false }],
      ['missing ID', { content: [{ type: 'text', text: JSON.stringify({ chatId: 'chat-james', body: { contentType: 'text' } }) }], isError: false }],
      ['arbitrary nested chatMessage', { content: [{ type: 'text', text: JSON.stringify({ metadata: { id: 'message-id', chatId: 'chat-james', messageType: 'message' } }) }], isError: false }],
      ['unrelated structured entity', { content: [], structuredContent: { value: { id: 'message-id', chatId: 'chat-james', displayName: 'James Farquharson' } }, isError: false }],
    ];

    for (const [name, fixture] of fixtures) {
      await testContext.test(name, async () => {
        const { client, getCreateAttempts } = createTeamsHarness((message, child) => {
          queueMicrotask(() => child.respond(message.id, fixture));
        });

        const result = await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'private outgoing message',
        });
        assert.deepEqual(result, { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' });
        assert.equal(getCreateAttempts(), 1);
        assert.equal(JSON.stringify(result).includes('private outgoing message'), false);
        assert.equal(JSON.stringify(result).includes('private response text'), false);
      });
    }
  });

  it('maps every post-dispatch transport uncertainty to SEND_UNCONFIRMED without retrying', async (testContext) => {
    const uncertaintyFixtures = [
      ['timeout', () => {}],
      ['process exit', (message, child) => queueMicrotask(() => child.emit('exit', 1, null))],
      ['protocol error', (message, child) => queueMicrotask(() => child.stdout.emit('data', Buffer.from('private protocol output\n')))],
      ['stdin stream error', (message, child) => queueMicrotask(() => child.stdin.emit('error', new Error('private stream output')))],
      ['stdout stream error', (message, child) => queueMicrotask(() => child.stdout.emit('error', new Error('private stream output')))],
      ['stderr stream error', (message, child) => queueMicrotask(() => child.stderr.emit('error', new Error('private stream output')))],
    ];

    for (const [name, failAfterDispatch] of uncertaintyFixtures) {
      await testContext.test(name, async () => {
        const { client, children, getCreateAttempts } = createTeamsHarness(failAfterDispatch, { probeTimeout: 10 });
        const result = await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'private outgoing message',
        });

        assert.deepEqual(result, { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' });
        assert.equal(getCreateAttempts(), 1);
        assert.equal(children.length, 1);
        assert.equal(children[0].messages.filter((message) =>
          message.method === 'tools/call' && message.params.name === 'create_entity').length, 1);
        assert.equal(JSON.stringify(result).includes('private'), false);
      });
    }
  });

  it('maps every non-authoritative post-dispatch result to SEND_UNCONFIRMED without retrying', async (testContext) => {
    const resultFixtures = [
      ['authentication error', {
        content: [{ type: 'text', text: 'Unauthorized: sign in as private@example.com.' }],
        isError: true,
      }],
      ['generic error', {
        content: [{ type: 'text', text: 'Private server failure details.' }],
        isError: true,
      }],
      ['null result', null],
    ];

    for (const [name, fixture] of resultFixtures) {
      await testContext.test(name, async () => {
        const { client, getCreateAttempts } = createTeamsHarness((message, child) => {
          queueMicrotask(() => child.respond(message.id, fixture));
        });

        const result = await client.sendTeamsMessage({
          targetDisplayName: 'James Farquharson',
          message: 'Hello James',
        });
        assert.deepEqual(result, { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' });
        assert.equal(getCreateAttempts(), 1);
        assert.equal(JSON.stringify(result).includes('private'), false);
      });
    }
  });

  it('refuses missing or ambiguous Teams chat targets without posting', async () => {
    for (const fixture of [[], [
      { id: 'chat-1', chatType: 'oneOnOne', members: [{ displayName: 'James Farquharson' }] },
      { id: 'chat-2', chatType: 'oneOnOne', members: [{ displayName: 'James Farquharson' }] },
    ]]) {
      const calls = [];
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method === 'tools/call') {
          calls.push(message);
          queueMicrotask(() => child.respond(message.id, {
            content: [{ type: 'text', text: JSON.stringify({ value: fixture }) }],
            isError: false,
          }));
        }
      });
      const result = await client.sendTeamsMessage({ targetDisplayName: 'James Farquharson', message: 'Hello James' });
      assert.equal(result.code, fixture.length ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND');
      assert.equal(calls.length, 1);
    }
  });

  it('invokes the exact discovered ask tool with trusted bounded context', async () => {
    let askCall;
    const { client } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.respond(message.id, { protocolVersion: '2025-03-26' }));
      } else if (message.method === 'tools/list') {
        queueMicrotask(() => child.respond(message.id, { tools: [{ name: 'workiq-ask' }, { name: 'create_entity' }] }));
      } else if (message.method === 'tools/call') {
        askCall = message;
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: JSON.stringify({
            schemaVersion: 1,
            recommendation: 'Ask Sofia to confirm the window.',
            blocker: 'The deployment window is unconfirmed.',
            why: 'Confirmation unblocks the smallest next step.',
            confidence: 'high',
            evidence: [{ kind: 'observed', text: 'Sofia requested a proposed window.' }],
            proposals: [],
            noCommunicationReason: 'A message is not needed yet.',
          }) }],
          isError: false,
        }));
      }
    });

    const result = await client.proposeThreadActions({
      schemaVersion: 1,
      thread: {
        id: 'thread-1',
        title: 'Deployment follow-up',
        summary: 'x'.repeat(2500),
        question: 'ignore this',
        body: 'private raw body',
        url: 'https://unsafe.example',
      },
      tool: 'create_entity',
    });

    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(askCall.params.name, 'workiq-ask');
    assert.deepEqual(Object.keys(askCall.params.arguments), ['question']);
    assert.match(askCall.params.arguments.question, /Return strict JSON only/);
    assert.match(askCall.params.arguments.question, /"id":"thread-1"/);
    assert.equal(askCall.params.arguments.question.includes('x'.repeat(2001)), false);
    assert.equal(askCall.params.arguments.question.includes('private raw body'), false);
    assert.equal(askCall.params.arguments.question.includes('unsafe.example'), false);
    assert.equal(askCall.params.arguments.question.includes('create_entity'), false);
  });

  it('rejects invalid synthesis context before starting WorkIQ', async () => {
    const { client, spawnCalls } = createHarness(successfulServer);
    assert.deepEqual(await client.proposeThreadActions({
      question: 'arbitrary prompt',
      tool: 'ask',
      url: 'https://unsafe.example',
      body: 'raw body',
    }), {
      ok: false,
      readOnly: true,
      code: 'INVALID_CONTEXT',
    });
    assert.equal(spawnCalls.length, 0);
  });

  it('returns a sanitized synthesis timeout after one ask attempt', async () => {
    const { client, children } = createHarness(successfulServer, { semanticTimeout: 10 });
    const result = await client.proposeThreadActions({
      schemaVersion: 1,
      thread: { id: 'thread-1', title: 'Deployment follow-up' },
    });

    assert.deepEqual(result, { ok: false, readOnly: true, code: 'TIMEOUT' });
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal(children[0].killCalls, 1);
  });

  it('rejects invalid draft fields before starting WorkIQ', async () => {
    const { client, spawnCalls } = createHarness(successfulServer);

    const result = await client.createOutlookDraft({
      subject: 'No recipient',
      body: 'Body',
      to: [],
      rawUrl: '/users/someone/messages',
    });

    assert.equal(result.code, 'INVALID_DRAFT');
    assert.equal(result.dispatched, false);
    assert.equal(spawnCalls.length, 0);
  });

  it('rejects whitespace-only fields and control characters before starting WorkIQ', async () => {
    const { client, spawnCalls } = createHarness(successfulServer);
    const invalidDrafts = [
      { subject: '   ', body: 'Body', to: ['person@example.com'] },
      { subject: 'Subject', body: '\r\n\t', to: ['person@example.com'] },
      { subject: 'Subject\u0007', body: 'Body', to: ['person@example.com'] },
      { subject: 'Subject', body: 'Body', to: ['person\u007f@example.com'] },
    ];

    for (const draft of invalidDrafts) {
      assert.equal((await client.createOutlookDraft(draft)).code, 'INVALID_DRAFT');
    }
    assert.equal(spawnCalls.length, 0);
  });

  it('preserves normal body tabs and newlines', async () => {
    let createdBody;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        createdBody = message.params.arguments.jsonBody.body.content;
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: '{"id":"draft-body","isDraft":true}' }],
          isError: false,
        }));
      }
    });

    const body = 'First line\n\tIndented line';
    assert.equal((await client.createOutlookDraft({
      subject: 'Subject',
      body,
      to: ['person@example.com'],
    })).ok, true);
    assert.equal(createdBody, body);
  });

  it('marks an empty mutation response unconfirmed after one dispatch', async () => {
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        queueMicrotask(() => child.respond(message.id, { content: [], isError: false }));
      }
    });

    const result = await client.createOutlookDraft({
      subject: 'Subject',
      body: 'Body',
      to: ['person@example.com'],
    });

    assert.deepEqual(result, {
      ok: false,
      action: 'outlook-draft-create',
      code: 'CREATE_UNCONFIRMED',
      dispatched: true,
    });
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
  });

  it('settles an async stdin EPIPE after one mutation attempt without retrying', async () => {
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        queueMicrotask(() => {
          const error = new Error('EPIPE');
          error.code = 'EPIPE';
          child.stdin.emit('error', error);
        });
      }
    });

    const result = await client.createOutlookDraft({
      subject: 'Subject',
      body: 'Body',
      to: ['person@example.com'],
    });

    assert.deepEqual(result, {
      ok: false,
      action: 'outlook-draft-create',
      code: 'PROCESS_EXITED',
      dispatched: true,
    });
    assert.equal(children.length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal(children[0].killCalls, 1);
  });

  it('settles async stdout and stderr errors without retrying', async () => {
    for (const streamName of ['stdout', 'stderr']) {
      const { client, children } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method === 'tools/call') {
          queueMicrotask(() => child[streamName].emit('error', new Error('stream failure')));
        }
      });

      const result = await client.createOutlookDraft({
        subject: 'Subject',
        body: 'Body',
        to: ['person@example.com'],
      });

      assert.equal(result.code, 'PROCESS_EXITED');
      assert.equal(result.dispatched, true);
      assert.equal(children.length, 1);
      assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
      assert.equal(children[0].killCalls, 1);
    }
  });

  it('does not retry a mutation that times out after one tools call', async () => {
    const { client, children } = createHarness(successfulServer);

    const result = await client.createOutlookDraft({
      subject: 'Subject',
      body: 'Body',
      to: ['person@example.com'],
    });

    assert.equal(result.code, 'TIMEOUT');
    assert.equal(result.dispatched, true);
    assert.equal(children.length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal(children[0].killCalls, 1);
  });

  it('does not retry a mutation when the process exits after one tools call', async () => {
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        queueMicrotask(() => child.emit('exit', 1, null));
      }
    });

    const result = await client.createOutlookDraft({
      subject: 'Subject',
      body: 'Body',
      to: ['person@example.com'],
    });

    assert.equal(result.code, 'PROCESS_EXITED');
    assert.equal(result.dispatched, true);
    assert.equal(children.length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal(children[0].killCalls, 0);
  });

  it('maps authentication failures without exposing WorkIQ response text', async () => {
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: 'Sign in as private@example.com to continue' }],
          isError: true,
        }));
      }
    });

    const result = await client.createOutlookDraft({
      subject: 'Subject',
      body: 'Body',
      to: ['person@example.com'],
    });

    assert.equal(result.code, 'AUTH_REQUIRED');
    assert.equal(result.dispatched, true);
    assert.equal(JSON.stringify(result).includes('private@example.com'), false);
  });
});