'use strict';

require('./helpers/electron-mock');

const { EventEmitter } = require('events');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkiqMcpClient } = require('../src/main/workiq-mcp-client');
const workiq101 = require('./helpers/workiq-1.0.1-contract');

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
    queueOptions: { pacingMs: 0 },
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
    queueMicrotask(() => child.respond(message.id, { tools: workiq101.tools }));
  }
}

const TARGET_USER_ID = '00000000-0000-0000-0000-000000000001';
const SELF_USER_ID = '00000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000003';
function canonicalMembers(email = 'alex@example.com', targetId = TARGET_USER_ID) {
  return [
    { displayName: 'Alex', email, userId: targetId },
    { displayName: 'Self', email: 'self@example.com', userId: SELF_USER_ID },
  ];
}

function respondIdentityRead(message, child) {
  if (message.params?.name !== 'fetch') return false;
  const [url] = message.params.arguments.entityUrls;
  let data;
  if (url.startsWith('/users?')) {
    const filter = new URL(url, 'https://graph.microsoft.com').searchParams.get('$filter');
    const email = /mail eq '([^']+)'/.exec(filter)[1];
    data = { value: [{
      id: email === 'missing@example.com' ? OTHER_USER_ID : TARGET_USER_ID, mail: email, userPrincipalName: email,
    }] };
  } else if (url === '/me?$select=id,userType') data = { id: SELF_USER_ID };
  else return false;
  queueMicrotask(() => child.respond(message.id, workiq101.fetchResult(data)));
  return true;
}

function respondCanonicalChat(message, child, chat = { id: 'target', chatType: 'oneOnOne', members: canonicalMembers() }) {
  const { name, arguments: args } = message.params || {};
  if (name === 'create_entity' && args.parentUrl === '/chats') {
    queueMicrotask(() => child.respond(message.id, workiq101.createResult({ id: chat.id, chatType: 'oneOnOne' })));
    return true;
  }
  if (name === 'fetch' && args.entityUrls?.[0]?.startsWith('/chats/')) {
    assert.equal(args.entityUrls[0], `/chats/${encodeURIComponent(chat.id)}?$select=id,chatType&$expand=members`);
    queueMicrotask(() => child.respond(message.id, workiq101.fetchResult(chat)));
    return true;
  }
  return false;
}

function createTeamsHarness(onCreate, options = {}) {
  let createAttempts = 0;
  const harness = createHarness((message, child) => {
    successfulServer(message, child);
    if (message.method !== 'tools/call') return;
    if (respondIdentityRead(message, child)) return;
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
  it('verifies the observed status/data create envelope without accepting conflicts or failed statuses', async () => {
    const entity = {
      id: 'message-id', chatId: 'chat-james', createdDateTime: '2026-10-30T12:00:00Z',
      body: { contentType: 'text', content: 'Hello' },
    };
    const valid = workiq101.createResult(entity);
    for (const [response, expected] of [
      [valid, true],
      [workiq101.createResult(entity, 200), true],
      [workiq101.createResult(entity, 403), false],
      [workiq101.createResult(entity, '201'), false],
      [workiq101.createResult({ ...entity, chatId: 'wrong-chat' }), false],
      [workiq101.createResult({ ...entity, body: { contentType: 'text', content: 'Wrong body' } }), false],
      [workiq101.createResult([entity]), false],
      [{ ...valid, structuredContent: { ...valid.structuredContent, id: 'conflicting-id' } }, false],
      [{ ...valid, content: [{ type: 'text', text: JSON.stringify(entity) }] }, false],
    ]) {
      const { client, getCreateAttempts } = createTeamsHarness((message, child) =>
        queueMicrotask(() => child.respond(message.id, response)));
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'James Farquharson', message: 'Hello' });
        assert.equal(result.ok, expected);
        assert.equal(getCreateAttempts(), 1);
        if (!expected) assert.equal(result.code, 'SEND_UNCONFIRMED');
      } finally { await client.shutdown(); }
    }
  });

  it('requires authoritative draft evidence inside successful status/data create responses', async () => {
    for (const [response, expected] of [
      [workiq101.createResult({ id: 'draft', isDraft: true }), true],
      [workiq101.createResult({ id: 'draft', isDraft: false }), false],
      [workiq101.createResult({ id: 'draft', isDraft: true }, 500), false],
      [workiq101.createResult({ id: 'draft' }), false],
    ]) {
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method === 'tools/call') queueMicrotask(() => child.respond(message.id, response));
      });
      try {
        const result = await client.createOutlookDraft({ to: ['alex@example.com'], subject: 'Subject', body: 'Body' });
        assert.equal(result.ok, expected);
        if (!expected) assert.equal(result.code, 'CREATE_UNCONFIRMED');
      } finally { await client.shutdown(); }
    }
  });

  it('never sends when authoritative directory identity is ambiguous, partial, invalid or unavailable', async () => {
    const user = { id: TARGET_USER_ID, mail: 'alex@example.com', userPrincipalName: 'alex@example.com' };
    for (const response of [
      workiq101.fetchResult({ value: [user, { ...user, id: OTHER_USER_ID }] }),
      workiq101.fetchResult({ value: [user], '@odata.nextLink': '/users?$skiptoken=next' }),
      workiq101.fetchResult({ value: [] }),
      workiq101.fetchResult({ value: [{ ...user, id: 'not-a-directory-id' }] }),
      workiq101.fetchResult({ value: [{ ...user, mail: 'wrong@example.com', userPrincipalName: 'wrong@example.com' }] }),
      workiq101.fetchResult(null, 401),
      workiq101.fetchResult(null, 429),
    ]) {
      let writes = 0, chatReads = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        if (message.params.name !== 'fetch') writes++;
        if (message.params.arguments.entityUrls?.[0]?.startsWith('/me/chats')) chatReads++;
        queueMicrotask(() => child.respond(message.id, response));
      });
      try {
        assert.equal((await client.sendTeamsMessage({
          targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello',
        })).ok, false);
        assert.equal(writes, 0);
        assert.equal(chatReads, 0);
      } finally { await client.shutdown(); }
    }
  });

  it('opens the verified pair without scanning chat pages or transporting group memberships', async () => {
    let writes = 0;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      if (respondIdentityRead(message, child)) return;
      if (message.params.arguments.parentUrl === '/chats') {
        assert.deepEqual(message.params.arguments.jsonBody, {
          chatType: 'oneOnOne',
          members: [SELF_USER_ID, TARGET_USER_ID].map(id => ({
            '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'],
            'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${id}')`,
          })),
        });
      }
      if (respondCanonicalChat(message, child)) return;
      assert.equal(message.params.name, 'create_entity', 'A verified recipient triggered a chat collection scan');
      writes++;
      queueMicrotask(() => child.respond(message.id, { structuredContent: {
        id: 'message', chatId: 'target', createdDateTime: '2026-10-30T12:00:00Z',
        body: { contentType: 'text', content: 'Hello' },
      }, isError: false }));
    }, { maxMessageBytes: 4096 });
    try {
      assert.equal((await client.sendTeamsMessage({
        targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello',
      })).ok, true);
      assert.equal(writes, 1);
    } finally { await client.shutdown(); }
  });

  it('bypasses chat pagination only for a verified email, preserving name-only pagination safety', async () => {
    for (const useEmail of [true, false]) {
      let pages = 0, writes = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        if (respondIdentityRead(message, child)) return;
        if (useEmail && respondCanonicalChat(message, child)) return;
        if (message.params.name === 'fetch') {
          pages++;
          queueMicrotask(() => child.respond(message.id, workiq101.fetchResult({
            value: [
              { id: 'target', chatType: 'oneOnOne', members: canonicalMembers() },
              { id: 'other', chatType: 'oneOnOne', members: canonicalMembers('other@example.com', OTHER_USER_ID) },
            ],
            '@odata.nextLink': `/me/chats?$skiptoken=${pages}`,
          })));
        } else {
          writes++;
          queueMicrotask(() => child.respond(message.id, { structuredContent: {
            id: 'message', chatId: 'target', createdDateTime: '2026-10-30T12:00:00Z',
            body: { contentType: 'text', content: 'Hello' },
          }, isError: false }));
        }
      });
      try {
        const result = await client.sendTeamsMessage({
          targetDisplayName: 'Alex', ...(useEmail ? { targetEmail: 'alex@example.com' } : {}), message: 'Hello',
        });
        assert.equal(result.ok, useEmail);
        assert.equal(pages, useEmail ? 0 : 10);
        assert.equal(writes, useEmail ? 1 : 0);
        if (!useEmail) assert.equal(result.code, 'RESOLUTION_FAILED');
      } finally { await client.shutdown(); }
    }
  });

  it('refuses email/userID conflicts and incomplete or non-canonical membership without posting', async () => {
    for (const members of [
      canonicalMembers('alex@example.com', OTHER_USER_ID),
      canonicalMembers('wrong@example.com'),
      [canonicalMembers()[0], { email: 'self@example.com', userId: OTHER_USER_ID }],
      [canonicalMembers()[0]],
      [canonicalMembers()[0], canonicalMembers()[0]],
      [...canonicalMembers(), { userId: OTHER_USER_ID, email: 'third@example.com' }],
    ]) {
      let writes = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        if (respondIdentityRead(message, child)) return;
        if (respondCanonicalChat(message, child, { id: 'target', chatType: 'oneOnOne', members })) return;
        if (message.params.name !== 'fetch') writes++;
        queueMicrotask(() => child.respond(message.id, workiq101.fetchResult({
          value: [{ id: 'target', chatType: 'oneOnOne', members }],
        })));
      });
      try {
        assert.equal((await client.sendTeamsMessage({
          targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello',
        })).ok, false);
        assert.equal(writes, 0);
      } finally { await client.shutdown(); }
    }
  });

  it('rejects malformed optional Teams identities before starting or posting', async () => {
    const { client, spawnCalls } = createHarness(successfulServer);
    for (const payload of [
      { targetDisplayName: 'Alex', targetEmail: 'not-an-email', message: 'Hello' },
      { targetDisplayName: 'Alex', targetEmail: 'alex@example.com\n', message: 'Hello' },
      { targetDisplayName: 'Alex', targetEmail: null, message: 'Hello' },
      { targetDisplayName: '', targetEmail: '', message: 'Hello' },
      { targetDisplayName: 'x'.repeat(161), targetEmail: 'alex@example.com', message: 'Hello' },
      { targetDisplayName: 'Alex', targetEmail: 'x'.repeat(243) + '@example.com', message: 'Hello' },
      { targetDisplayName: 'Alex', targetEmail: 'alex@example.com', targetUserId: 'invented', message: 'Hello' },
    ]) {
      assert.equal((await client.sendTeamsMessage(payload)).code, 'INVALID_MESSAGE');
    }
    assert.equal(spawnCalls.length, 0);
    await client.shutdown();
  });

  it('diagnoses distinct protocol failures without raw lines, identities or body content', async t => {
    const logs = [];
    t.mock.method(console, 'log', value => logs.push(value));
    t.mock.method(console, 'error', value => logs.push(value));
    const cases = [
      ['NON_JSON', 'secret-body private@example.com\n'],
      ['INVALID_ENVELOPE', '{"jsonrpc":"1.0","private":"secret-body"}\n'],
      ['UNKNOWN_RESPONSE_ID', '{"jsonrpc":"2.0","id":999999,"result":"secret-body"}\n'],
      ['INVALID_NOTIFICATION', '{"jsonrpc":"2.0","method":"notice","result":"secret-body"}\n'],
      ['MISSING_RESULT', '{"jsonrpc":"2.0","id":1,"private":"secret-body"}\n'],
    ];
    for (const [reason, line] of cases) {
      const { client } = createHarness((_message, child) => queueMicrotask(() => child.stdout.emit('data', Buffer.from(line))));
      assert.equal((await client.probe()).code, 'PROTOCOL_ERROR');
      assert.ok(logs.some(value => value.includes(`protocol error: ${reason}`)), reason);
      await client.shutdown();
    }
    assert.equal(logs.join('\n').includes('secret-body'), false);
    assert.equal(logs.join('\n').includes('private@example.com'), false);
  });

  it('never sends when the reopened chat is a group or has incomplete membership', async () => {
    const matching = { id: 'one', chatType: 'oneOnOne', members: canonicalMembers() };
    for (const chat of [
      { ...matching, chatType: 'group' },
      { ...matching, 'members@odata.nextLink': '/chats/one/members?$skiptoken=next' },
      { ...matching, members: undefined },
    ]) {
      let writes = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        if (respondIdentityRead(message, child)) return;
        if (respondCanonicalChat(message, child, chat)) return;
        if (message.params.name !== 'fetch') writes++;
        assert.fail('Message dispatch was attempted before complete canonical membership verification');
      });
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: '', targetEmail: 'alex@example.com', message: 'Hello' });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'CHAT_OPEN_FAILED');
        assert.equal(writes, 0);
      } finally { await client.shutdown(); }
    }
  });

  it('verifies the opened chat against the authoritative email identity, never a conflicting name', async () => {
    for (const [email, expected] of [['right@example.com', true], ['missing@example.com', false]]) {
      const writes = [];
      let verified = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        if (respondIdentityRead(message, child)) return;
        const chat = { id: 'right', chatType: 'oneOnOne', members: canonicalMembers('right@example.com') };
        if (respondCanonicalChat(message, child, chat)) {
          if (message.params.name === 'fetch') verified++;
          return;
        }
        writes.push(message.params.arguments.parentUrl);
        queueMicrotask(() => child.respond(message.id, { structuredContent: {
          id: 'posted', chatId: 'right', createdDateTime: '2026-10-30T12:00:00Z',
          body: { contentType: 'text', content: 'Hello' },
        }, isError: false }));
      });
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'Alex', targetEmail: email, message: 'Hello' });
        assert.equal(result.ok, expected);
        assert.equal(verified, 1);
        assert.deepEqual(writes, expected ? ['/chats/right/messages'] : []);
        if (!expected) assert.equal(result.code, 'CHAT_OPEN_FAILED');
      } finally { await client.shutdown(); }
    }
  });

  it('enriches names-only drafts only from a complete exact unique structured directory identity', async () => {
    const cases = [
      ['unique', [{ id: TARGET_USER_ID, displayName: 'Alex', mail: 'alex@example.com', userPrincipalName: 'alex@example.com' }], 'alex@example.com'],
      ['UPN', [{ id: TARGET_USER_ID, displayName: 'Alex', mail: null, userPrincipalName: 'alex@example.com' }], 'alex@example.com'],
      ['qualified', [{ id: TARGET_USER_ID, displayName: 'Alex (International Supplier)', mail: 'alex@example.com' }], 'alex@example.com'],
      ['qualified-ambiguous', [{ id: TARGET_USER_ID, displayName: 'Alex (Supplier A)', mail: 'a@example.com' }, { id: OTHER_USER_ID, displayName: 'Alex (Supplier B)', mail: 'b@example.com' }], ''],
      ['guest-upn', [{ id: TARGET_USER_ID, displayName: 'Alex', mail: null, userPrincipalName: 'alex_example.com#EXT#@tenant.example' }], ''],
      ['guest-mail', [{ id: TARGET_USER_ID, displayName: 'Alex', mail: 'alex@external.example', userPrincipalName: 'alex_external.example#EXT#@tenant.example' }], 'alex@external.example'],
      ['proxy', [{ id: TARGET_USER_ID, displayName: 'Alex', mail: null, proxyAddresses: ['x500:not-an-email', 'SMTP:alex@example.com'] }], 'alex@example.com'],
      ['ambiguous', [{ id: 'one', displayName: 'Alex', mail: 'a@example.com' }, { id: 'two', displayName: 'Alex', mail: 'b@example.com' }], ''],
      ['missing', [], ''],
      ['inexact', [{ id: 'one', displayName: 'Alex Other', mail: 'alex@example.com' }], ''],
      ['invalid', [{ id: 'one', displayName: 'Alex', mail: 'not-an-email', userPrincipalName: 'also-invalid' }], ''],
      ['paged', [{ id: 'one', displayName: 'Alex', mail: 'alex@example.com' }], ''],
      ['auth', [], ''],
      ['throttle', [], ''],
    ];
    for (const [scenario, rows, expected] of cases) {
      for (const channel of ['email', 'teams']) {
        let reads = 0;
        const { client } = createHarness((message, child) => {
          successfulServer(message, child);
          if (message.method !== 'tools/call') return;
          let response;
          if (message.params.name === 'ask') {
            response = { structuredContent: { response: JSON.stringify({
              schemaVersion: 1, recommendation: 'Reply', confidence: 'high',
              evidence: [{ kind: 'observed', text: 'A reply was requested' }],
              proposals: [{ channel, target: { displayName: 'Alex' },
                payload: channel === 'email' ? { subject: 'Reply', body: 'Grounded draft' } : { message: 'Grounded draft' } }],
            }) }, isError: false };
          } else {
            assert.equal(message.params.name, 'fetch');
            reads++;
            assert.equal(message.params.arguments.entityUrls.length, 1);
            assert.match(decodeURIComponent(message.params.arguments.entityUrls[0]),
              reads === 1 ? /displayName eq 'Alex'/ : /startswith\(displayName,'Alex \('\)/);
            response = ['auth', 'throttle'].includes(scenario)
              ? workiq101.fetchResult(null, scenario === 'auth' ? 401 : 429)
              : workiq101.fetchResult({ value: scenario.startsWith('qualified') && reads === 1 ? [] : rows,
                  ...(scenario === 'paged' ? { '@odata.nextLink': '/users?$skiptoken=next' } : {}) });
          }
          queueMicrotask(() => child.respond(message.id, response));
        });
        try {
          const result = await client.proposeThreadActions({ schemaVersion: 1, requestedChannel: channel, thread: { id: 'one', title: 'Reply' } });
          assert.equal(result.ok, true, scenario);
          assert.equal(reads, scenario === 'missing' || scenario.startsWith('qualified') ? 2 : 1, scenario);
          const proposal = result.result.proposals[0];
          assert.equal(proposal.target.address, expected, scenario);
          assert.equal(proposal.needsTargetResolution, !expected, scenario);
          assert.equal(proposal.payload.body || proposal.payload.message, 'Grounded draft');
          if (!expected) {
            assert.match(proposal.reviewNote, /recipient/i);
            assert.ok(proposal.missingContext.some(value => /recipient/i.test(value)));
          }
        } finally { await client.shutdown(); }
      }
    }
  });

  it('rejects unsuccessful or conflicting chat-open receipts before posting any message', async () => {
    const chat = { id: 'target', chatType: 'oneOnOne' };
    for (const response of [
      workiq101.createResult(chat, 403),
      workiq101.createResult(chat, '201'),
      workiq101.createResult({ id: 'target' }),
      workiq101.createResult({ ...chat, chatType: 'group' }),
      workiq101.createResult({ ...chat, id: 'invalid\nid' }),
      workiq101.createResult([chat]),
      { ...workiq101.createResult(chat), isError: true },
      { ...workiq101.createResult(chat), content: [{ type: 'text', text: '{"id":"other"}' }] },
      { structuredContent: { statusCode: 201, data: chat, id: 'conflicting' }, isError: false },
    ]) {
      let opens = 0, posts = 0, chatReads = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call' || respondIdentityRead(message, child)) return;
        if (message.params.arguments.parentUrl === '/chats') opens++;
        else if (message.params.name === 'fetch') chatReads++;
        else posts++;
        queueMicrotask(() => child.respond(message.id, response));
      });
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello' });
        assert.equal(result.code, 'CHAT_OPEN_FAILED');
        assert.equal(opens, 1);
        assert.equal(posts, 0);
        assert.equal(chatReads, 0);
      } finally { await client.shutdown(); }
    }
  });

  it('does not retry or report message delivery as uncertain when opening the chat times out', async () => {
    let opens = 0, posts = 0;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call' || respondIdentityRead(message, child)) return;
      if (message.params.arguments.parentUrl === '/chats') opens++;
      else posts++;
    }, { probeTimeout: 10 });
    try {
      const result = await client.sendTeamsMessage({ targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello' });
      assert.equal(result.code, 'CHAT_OPEN_FAILED');
      assert.equal(opens, 1);
      assert.equal(posts, 0);
    } finally { await client.shutdown(); }
  });

  it('resolves a supplied SMTP alias only through a unique directory identity and re-verifies canonical membership', async () => {
    for (const status of [200, 201]) {
      let directoryReads = 0, posts = 0, opens = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        const args = message.params.arguments;
        if (args.entityUrls?.[0]?.startsWith('/users?')) {
          directoryReads++;
          const filter = new URL(args.entityUrls[0], 'https://graph.microsoft.com').searchParams.get('$filter');
          assert.match(filter, directoryReads === 1 ? /mail eq 'alias@external.example'/ : /proxyAddresses\/any/);
          const user = {
            id: TARGET_USER_ID, mail: 'alex@external.example',
            userPrincipalName: 'alex_external.example#EXT#@tenant.example',
            proxyAddresses: ['smtp:alias@external.example'], userType: 'Guest',
          };
          queueMicrotask(() => child.respond(message.id, workiq101.fetchResult({ value: directoryReads === 1 ? [] : [user] })));
        } else if (respondIdentityRead(message, child)) return;
        else if (args.parentUrl === '/chats') {
          opens++;
          assert.deepEqual(args.jsonBody.members.map(member => member.roles), [['owner'], ['guest']]);
          queueMicrotask(() => child.respond(message.id, workiq101.createResult({ id: 'target', chatType: 'oneOnOne' }, status)));
        } else if (respondCanonicalChat(message, child, {
          id: 'target', chatType: 'oneOnOne', members: canonicalMembers('alias@external.example'),
        })) return;
        else {
          posts++;
          queueMicrotask(() => child.respond(message.id, workiq101.createResult({
            id: 'message', chatId: 'target', createdDateTime: '2026-10-30T12:00:00Z',
            body: { contentType: 'text', content: 'Hello' },
          })));
        }
      });
      try {
        assert.equal((await client.sendTeamsMessage({
          targetDisplayName: 'A different display name', targetEmail: 'alias@external.example', message: 'Hello',
        })).ok, true);
        assert.equal(directoryReads, 2);
        assert.equal(opens, 1);
        assert.equal(posts, 1);
      } finally { await client.shutdown(); }
    }
  });

  it('uses the advertised 1.0.1 argument schemas and structured fetch envelope without ask-based writes', async () => {
    const calls = [];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      calls.push(message.params);
      let response;
      if (message.params.name === 'ask') {
        response = { content: [{ type: 'object', text: '{"response":"Read-only answer"}' }], isError: false };
      } else if (message.params.name === 'fetch') {
        response = workiq101.fetchResult({ value: [
          { id: 'chat-person', chatType: 'oneOnOne', members: [{ displayName: 'Test Person' }] },
        ] });
      } else if (message.params.arguments.parentUrl === '/me/messages') {
        response = workiq101.createResult({ id: 'draft-id', isDraft: true });
      } else {
        response = workiq101.createResult({
          id: 'message-id', chatId: 'chat-person', createdDateTime: '2026-10-30T12:00:00Z',
          body: { contentType: 'text', content: 'Please confirm.' },
        });
      }
      queueMicrotask(() => child.respond(message.id, response));
    });
    try {
      assert.equal((await client.ask('Read only')).success, true);
      assert.equal((await client.createOutlookDraft({
        to: ['person@example.com'], subject: 'Confirm', body: 'Please confirm.',
      })).ok, true);
      assert.equal((await client.sendTeamsMessage({ targetDisplayName: 'Test Person', message: 'Please confirm.' })).ok, true);
      assert.deepEqual(calls.map((call) => call.name), ['ask', 'create_entity', 'fetch', 'create_entity']);
      for (const call of calls) {
        const schema = workiq101.tools.find((tool) => tool.name === call.name).inputSchema;
        for (const required of schema.required) assert.ok(Object.hasOwn(call.arguments, required));
        for (const [key, value] of Object.entries(call.arguments)) {
          assert.ok(Object.hasOwn(schema.properties, key), `Unadvertised argument: ${key}`);
          const field = schema.properties[key];
          if (field.type === 'string') assert.equal(typeof value, 'string');
          if (field.type === 'array') {
            assert.ok(Array.isArray(value));
            assert.ok(value.every((entry) => typeof entry === field.items.type));
          }
        }
      }
    } finally { await client.shutdown(); }
  });

  it('resolves all structured fetch pages before sending and rejects ambiguous later matches', async () => {
    for (const ambiguous of [false, true]) {
      const calls = [];
      let page = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        calls.push(message.params);
        const response = message.params.name === 'fetch'
          ? workiq101.fetchResult(++page === 1 ? {
            value: [{ id: 'chat-person', chatType: 'oneOnOne', members: [{ displayName: 'Test Person' }] }],
            '@odata.nextLink': 'https://graph.microsoft.com/me/chats?$skiptoken=next',
          } : { value: ambiguous
            ? [{ id: 'other-chat', chatType: 'oneOnOne', members: [{ displayName: 'Test Person' }] }]
            : [] })
          : { content: [{ type: 'text', text: JSON.stringify({
            id: 'message-id', chatId: 'chat-person', createdDateTime: '2026-10-30T12:00:00Z',
            body: { contentType: 'text', content: 'Please confirm.' },
          }) }], isError: false };
        queueMicrotask(() => child.respond(message.id, response));
      });
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'Test Person', message: 'Please confirm.' });
        assert.equal(result.ok, !ambiguous);
        if (ambiguous) assert.equal(result.code, 'TARGET_AMBIGUOUS');
        assert.deepEqual(calls[1].arguments, { entityUrls: ['/me/chats?$skiptoken=next'] });
        assert.equal(calls.filter((call) => call.name === 'create_entity').length, ambiguous ? 0 : 1);
      } finally { await client.shutdown(); }
    }
  });

  it('fails closed on malformed, failed, conflicting or untrusted structured chat lookup results', async () => {
    const chat = { id: 'chat-person', chatType: 'oneOnOne', members: [{ displayName: 'Test Person' }] };
    const fixtures = [
      workiq101.fetchResult({ value: [chat] }, 400),
      workiq101.fetchResult({ error: { message: 'private' }, value: [chat] }),
      workiq101.fetchResult({ unrelated: [chat] }),
      workiq101.fetchResult({ value: [chat], '@odata.nextLink': 'https://example.com/me/chats' }),
      workiq101.fetchResult({ value: [chat], '@odata.nextLink': '/me/messages' }),
      workiq101.fetchResult({ value: [chat], '@odata.nextLink': '' }),
      { content: [], structuredContent: { results: [] }, isError: false },
      { content: [], structuredContent: { results: [{ data: { value: [chat] }, statusCode: 200 }, { data: { value: [] }, statusCode: 200 }] }, isError: false },
      { ...workiq101.fetchResult({ value: [chat] }), content: [{ type: 'text', text: JSON.stringify({ value: [chat] }) }] },
    ];
    for (const fixture of fixtures) {
      const calls = [];
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method === 'tools/call') {
          calls.push(message.params);
          queueMicrotask(() => child.respond(message.id, fixture));
        }
      });
      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'Test Person', message: 'Please confirm.' });
        assert.equal(result.code, 'RESOLUTION_FAILED');
        assert.ok(calls.every((call) => call.name === 'fetch'));
      } finally { await client.shutdown(); }
    }
  });

  it('bounds pagination and rejects repeated chat pages without posting', async () => {
    for (const repeated of [false, true]) {
      let page = 0;
      const { client } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method !== 'tools/call') return;
        assert.equal(message.params.name, 'fetch');
        queueMicrotask(() => child.respond(message.id, workiq101.fetchResult({
          value: [], '@odata.nextLink': `/me/chats?$skiptoken=${repeated ? 'same' : ++page}`,
        })));
      });

      try {
        const result = await client.sendTeamsMessage({ targetDisplayName: 'Test Person', message: 'Please confirm.' });
        assert.equal(result.code, 'RESOLUTION_FAILED');
        if (!repeated) assert.equal(page, 10);
      } finally { await client.shutdown(); }
    }
  });

  it('classifies actual status-bearing fetch authentication and throttling failures before any write', async () => {
    for (const [statusCode, expectedCode] of [[401, 'AUTH_REQUIRED'], [403, 'AUTH_REQUIRED'], [429, 'THROTTLED']]) {
      const { client, children } = createHarness((message, child) => {
        successfulServer(message, child);
        if (message.method === 'tools/call') {
          queueMicrotask(() => child.respond(message.id, {
            content: [], structuredContent: { results: [{
              data: null, statusCode, error: { error: { code: 'RemoteFailure', message: 'private server detail' } },
            }] }, isError: true,
          }));
        }
      });
      try {
        assert.deepEqual(await client.sendTeamsMessage({ targetDisplayName: 'Test Person', message: 'Please confirm.' }), {
          ok: false, action: 'teams-message-send', code: expectedCode,
        });
        assert.deepEqual(children[0].messages.filter((message) => message.method === 'tools/call')
          .map((message) => message.params.name), ['fetch']);
      } finally { await client.shutdown(); }
    }
  });

  it('normalizes natural-language, JSON and verified response envelopes on one persistent connection', async () => {
    const fixtures = [
      { content: [{ type: 'text', text: 'Natural answer' }] },
      { content: [{ type: 'text', text: '{"items":[{"id":"one"}]}' }] },
      { content: [{ type: 'text', text: '{"response":"Envelope answer"}' }] },
      { content: [], structuredContent: { response: 'Structured envelope' }, isError: false },
    ];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') queueMicrotask(() => child.respond(message.id, fixtures.shift()));
    });
    for (const answer of ['Natural answer', '{"items":[{"id":"one"}]}', 'Envelope answer', 'Structured envelope']) {
      assert.deepEqual(await client.ask('Question'), { success: true, answer, attempts: 1 });
    }
    assert.equal(children.length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'initialize').length, 1);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/list').length, 1);
    await client.shutdown();
  });

  it('validates ask metadata and does not start a child for invalid requests', async () => {
    const { client, children } = createHarness(successfulServer);
    for (const [question, metadata] of [
      ['', {}], [null, {}], ['Question', null], ['Question', []],
      ['Question', { priority: 'urgent' }], ['Question', { key: '' }],
      ['Question', { maxAttempts: 3 }], ['Question', { maxAttempts: 0 }],
      ['Question', { secret: true }],
    ]) {
      const result = await client.ask(question, metadata);
      assert.equal(result.success, false);
      assert.equal(result.code, 'INVALID_REQUEST');
      assert.equal(result.attempts, 0);
    }
    assert.equal(children.length, 0);
  });

  it('coalesces equal queued/running reads but not changed prompts or attempt budgets', async () => {
    const calls = [];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        calls.push(message);
        if (calls.length === 3) {
          queueMicrotask(() => calls.forEach((call) => child.respond(call.id, {
            content: [{ type: 'text', text: call.params.arguments.question }],
          })));
        }
      }
    });
    const results = await Promise.all([
      client.ask('same', { priority: 'background', key: 'id' }),
      client.ask('same', { key: 'id' }),
      client.ask('changed', { key: 'id' }),
      client.ask('same', { key: 'id', maxAttempts: 1 }),
    ]);
    assert.deepEqual(results.map((result) => result.answer), ['same', 'same', 'changed', 'same']);
    assert.equal(calls.length, 3);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/list').length, 1);
    await client.shutdown();
  });

  it('isolates a timed-out ID and its late reply from unrelated pending calls', async () => {
    let slowCall;
    let healthyCall;
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      if (message.params.arguments.question === 'slow') slowCall = message;
      else healthyCall = message;
    }, { readTimeout: 40 });
    const slow = client.ask('slow', { maxAttempts: 1 });
    while (!slowCall) await new Promise((resolve) => setImmediate(resolve));
    const healthy = client.ask('healthy', { maxAttempts: 1 });
    while (!healthyCall) await new Promise((resolve) => setImmediate(resolve));
    const result = await slow;
    children[0].respond(slowCall.id, { content: [{ type: 'text', text: 'late' }] });
    children[0].respond(healthyCall.id, { content: [{ type: 'text', text: 'healthy answer' }] });
    assert.equal(result.code, 'TIMEOUT');
    assert.equal(result.attempts, 1);
    assert.equal((await healthy).answer, 'healthy answer');
    assert.equal(children[0].killCalls, 0);
    await client.shutdown();
  });

  it('retains five timed-out transports, queues a sixth, and releases only on a late terminal reply', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') calls.push(message);
    }, { readTimeout: 40 });
    const jobs = Array.from({ length: 6 }, (_, index) => client.ask(`unanswered-${index}`, { maxAttempts: 1 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 5);
    t.mock.timers.tick(40);
    const timedOut = await Promise.all(jobs.slice(0, 5));
    assert.ok(timedOut.every((result) => result.code === 'TIMEOUT' && result.attempts === 1));
    t.mock.timers.tick(1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 5, 'Caller timeouts must not permit a sixth outstanding remote call');
    assert.deepEqual(client.getQueueStatus(), {
      active: 5, pending: 1, limit: 5, backgroundLimit: 4, cooldownUntil: 0,
    });
    assert.equal(children[0].killCalls, 0, 'Semantic timeouts must not kill unrelated calls');

    children[0].respond(calls[0].id, { content: [{ type: 'text', text: 'late terminal answer' }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 6);
    assert.equal(client.getQueueStatus().active, 5);
    assert.equal(client.getQueueStatus().pending, 0);
    children[0].respond(calls[5].id, { content: [{ type: 'text', text: 'sixth answer' }] });
    assert.equal((await jobs[5]).answer, 'sixth answer');
    assert.equal(client.getQueueStatus().active, 4);
    const shutdown = client.shutdown();
    t.mock.timers.tick(5);
    await shutdown;
    assert.equal(client.getQueueStatus().active, 0);
    assert.equal(client.getQueueStatus().pending, 0);
    assert.equal(children[0].killCalls, 1);
  });

  it('does not retry or bypass an unresolved timed-out read even with a two-attempt budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') calls.push(message);
    }, { readTimeout: 40 });
    const first = client.ask('retained', { key: 'same-resource' });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(40);
    assert.equal((await first).attempts, 1);
    assert.equal((await client.ask('retained', { key: 'same-resource' })).code, 'TIMEOUT');
    t.mock.timers.tick(10000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(client.getQueueStatus().active, 1);
    children[0].respond(calls[0].id, { content: [{ type: 'text', text: 'late' }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.getQueueStatus().active, 0);
    assert.equal(calls.length, 1, 'Late completion must not replay the already timed-out caller');
    const shutdown = client.shutdown();
    t.mock.timers.tick(5);
    await shutdown;
  });

  it('allows both proposal synthesis and generic reads 300 seconds to retrieve Microsoft 365 context', { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') calls.push(message);
    });
    let readSettled = false;
    const read = client.ask('long scanner/monitor read', { maxAttempts: 1 }).then((result) => {
      readSettled = true;
      return result;
    });
    let proposalSettled = false;
    const proposal = client.proposeThreadActions({
      schemaVersion: 1,
      thread: { id: 'timeout-defaults', title: 'Synthetic timeout policy test' },
    }).then((result) => {
      proposalSettled = true;
      return result;
    });
    while (calls.length < 2) await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(60000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(proposalSettled, false, 'Draft generation must not time out after just one minute');
    assert.equal(readSettled, false);
    t.mock.timers.tick(239999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readSettled, false);
    assert.equal(proposalSettled, false);
    t.mock.timers.tick(1);
    assert.equal((await read).code, 'TIMEOUT');
    assert.equal((await proposal).code, 'TIMEOUT');
    assert.equal(client.getQueueStatus().active, 2, 'Neither caller timeout releases unresolved remote capacity');
    const shutdown = client.shutdown();
    t.mock.timers.tick(5);
    await shutdown;
  });

  it('delivers a grounded draft returned after the former 60-second deadline', { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let call;
    let transport;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        if (message.params.name === 'fetch') {
          queueMicrotask(() => child.respond(message.id, workiq101.fetchResult({ value: [
            { id: TARGET_USER_ID, displayName: 'Alex', mail: 'alex@example.com' },
          ] })));
        } else {
          call = message;
          transport = child;
        }
      }
    });
    const pending = client.proposeThreadActions({
      schemaVersion: 1, requestedChannel: 'teams',
      thread: { id: 'slow-draft', title: 'Confirm deployment window' },
    });
    while (!call) await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(60001);
    transport.respond(call.id, { content: [{ type: 'text', text: JSON.stringify({
      schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
      evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
      proposals: [{
        channel: 'teams', target: { displayName: 'Alex' },
        payload: { message: 'Please confirm the deployment window.' },
      }],
    }) }] });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.result.proposals[0].payload.message, 'Please confirm the deployment window.');
    assert.equal(result.result.proposals[0].target.address, 'alex@example.com');
    assert.equal(client.getQueueStatus().active, 0);
    const shutdown = client.shutdown();
    t.mock.timers.tick(5);
    await shutdown;
  });

  it('isolates tool and JSON-RPC errors, preserving the healthy shared connection', async () => {
    let count = 0;
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      count += 1;
      queueMicrotask(() => {
        if (count === 1) child.stdout.emit('data', Buffer.from(`${JSON.stringify({
          jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'private remote detail' },
        })}\n`));
        else child.respond(message.id, count === 2
          ? { isError: true, content: [{ type: 'text', text: 'private tool detail' }] }
          : { content: [{ type: 'text', text: 'healthy' }] });
      });
    });
    const rpc = await client.ask('rpc');
    const tool = await client.ask('tool');
    assert.equal(rpc.code, 'RPC_ERROR');
    assert.equal(tool.code, 'TOOL_ERROR');
    assert.equal(JSON.stringify([rpc, tool]).includes('private'), false);
    assert.equal((await client.ask('healthy')).success, true);
    assert.equal(children.length, 1);
    assert.equal(children[0].killCalls, 0);
    await client.shutdown();
  });

  it('rejects empty/wrong-shaped and structured error results without repairing terminal output', async () => {
    const fixtures = [
      {}, { content: [] }, { content: [{ type: 'text', text: ' ' }] },
      { content: [{ type: 'text', text: '{"response":null}' }] },
      { structuredContent: { unrelated: 'entity' } },
      { structuredContent: { response: 'not success', error: { message: 'private' } } },
      { structuredContent: { response: 'not success', isError: true } },
    ];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') queueMicrotask(() => child.respond(message.id, fixtures.shift()));
    });
    for (let i = 0; i < 7; i += 1) {
      const result = await client.ask(`question ${i}`);
      assert.equal(result.success, false);
      assert.equal(result.attempts, 1);
    }
    await client.shutdown();
  });

  it('uses the installed ask_work_iq name and a bounded two-attempt safe-read retry budget', async () => {
    let calls = 0;
    const { client, children } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.respond(message.id, { protocolVersion: '2025-03-26' }));
      } else if (message.method === 'tools/list') {
        queueMicrotask(() => child.respond(message.id, { tools: [{ name: 'ask_work_iq' }] }));
      } else if (message.method === 'tools/call') {
        calls += 1;
        assert.equal(message.params.name, 'ask_work_iq');
        queueMicrotask(() => child.respond(message.id, calls === 1
          ? { isError: true, content: [{ type: 'text', text: 'Too many requests: private detail' }] }
          : { content: [{ type: 'text', text: 'recovered' }] }));
      }
    }, { queueOptions: { pacingMs: 0, random: () => 0 } });
    assert.deepEqual(await client.ask('question'), { success: true, answer: 'recovered', attempts: 2 });
    assert.equal(calls, 2);
    assert.equal(children.length, 1);
    await client.shutdown();
  });

  it('preserves actual HTTP Retry-After as shared cooldown and honors maxAttempts one', async () => {
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') queueMicrotask(() =>
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32000, message: 'private', data: { status: 429, headers: { 'Retry-After': '2' } } },
        })}\n`)));
    });
    const before = Date.now();
    const result = await client.ask('question', { maxAttempts: 1 });
    assert.equal(result.code, 'THROTTLED');
    assert.equal(result.attempts, 1);
    assert.ok(client.getQueueStatus().cooldownUntil >= before + 2000);
    assert.equal(JSON.stringify(result).includes('private'), false);
    await client.shutdown();
  });

  it('applies observed mutation Retry-After to shared capacity without replaying the write', async () => {
    let calls = 0;
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        calls += 1;
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32000, message: 'private', data: { status: 429, headers: { 'Retry-After': '2' } } },
        })}\n`)));
      }
    });
    const before = Date.now();
    const result = await client.createOutlookDraft({ subject: 'Subject', body: 'Body', to: ['person@example.com'] });
    assert.equal(result.code, 'THROTTLED');
    assert.equal(result.dispatched, true);
    assert.equal(calls, 1);
    assert.ok(client.getQueueStatus().cooldownUntil >= before + 2000);
    await client.shutdown();
  });

  it('ignores stale process output/exit callbacks after generation restart', async () => {
    let call;
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') call = message;
    });
    const first = client.ask('first', { maxAttempts: 1 });
    while (!call) await new Promise((resolve) => setImmediate(resolve));
    children[0].emit('exit', 1);
    assert.equal((await first).code, 'PROCESS_EXITED');
    call = null;
    const next = client.ask('next', { maxAttempts: 1 });
    while (!call) await new Promise((resolve) => setImmediate(resolve));
    children[0].stdout.emit('data', Buffer.from('old malformed private output\n'));
    children[0].emit('exit', 1);
    children[0].stdin.emit('error', new Error('old private error'));
    children[1].respond(call.id, { content: [{ type: 'text', text: 'new generation' }] });
    assert.equal((await next).answer, 'new generation');
    assert.equal(children[1].killCalls, 0);
    await client.shutdown();
  });

  it('fails all generation calls on malformed protocol and validates negotiation/tool cache before publishing', async () => {
    const calls = [];
    const { client, children } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') {
        calls.push(message);
        if (calls.length === 2) queueMicrotask(() => child.stdout.emit('data', Buffer.from('not json\n')));
      }
    });
    const results = await Promise.all([
      client.ask('first', { maxAttempts: 1 }), client.ask('second', { maxAttempts: 1 }),
    ]);
    assert.deepEqual(results.map((result) => result.code), ['PROTOCOL_ERROR', 'PROTOCOL_ERROR']);
    assert.equal(children[0].killCalls, 1);
    for (const malformed of ['version', 'tools']) {
      const h = createHarness((message, child) => {
        if (message.method === 'initialize') queueMicrotask(() => child.respond(message.id, {
          protocolVersion: malformed === 'version' ? 'unknown' : '2025-03-26',
        }));
        if (message.method === 'tools/list') queueMicrotask(() => child.respond(message.id, {
          tools: [{ name: 'ask' }, { name: null }],
        }));
      });
      assert.equal((await h.client.ask('question', { maxAttempts: 1 })).code, 'PROTOCOL_ERROR');
      assert.equal(h.children[0].killCalls, 1);
      await h.client.shutdown();
    }
    await client.shutdown();
  });

  it('rejects queued and inflight reads on shutdown without replay', async () => {
    const { client, children } = createHarness(successfulServer, { queueOptions: { limit: 1, pacingMs: 0 } });
    const results = [client.ask('active'), client.ask('queued')];
    while (!children[0]?.messages.some((message) => message.method === 'tools/call')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await client.shutdown();
    assert.deepEqual((await Promise.all(results)).map((result) => result.code), ['SHUTTING_DOWN', 'SHUTTING_DOWN']);
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal((await client.ask('after')).attempts, 0);
  });

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
    assert.deepEqual(spawnCalls[0].args, ['--log-level', 'Error', 'mcp']);
    assert.deepEqual(children[0].messages.map((message) => message.method), [
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    assert.deepEqual(Object.keys(client).sort(), ['ask', 'createOutlookDraft', 'getQueueStatus', 'onQueueStatus', 'probe', 'proposeThreadActions', 'sendTeamsMessage', 'shutdown']);
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
    assert.deepEqual(calls[0].params.arguments, {
      entityUrls: ['/me/chats?$filter=chatType%20eq%20%27oneOnOne%27&$select=id,chatType&$expand=members&$top=50'],
    });
    assert.equal(calls[1].params.name, 'create_entity');
    assert.equal(calls[1].params.arguments.parentUrl, '/chats/chat-james/messages');
    assert.deepEqual(calls[1].params.arguments.jsonBody, {
      body: { contentType: 'text', content: 'Can you confirm the CAF assessment scope?' },
    });
  });

  it('creates Outlook drafts with the exact discovered namespaced entity tool', async () => {
    let createCall;
    const { client } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.respond(message.id, { protocolVersion: '2025-03-26' }));
      } else if (message.method === 'tools/list') {
        queueMicrotask(() => child.respond(message.id, { tools: [{ name: 'workiq-create_entity' }] }));
      } else if (message.method === 'tools/call') {
        createCall = message;
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: '{"id":"draft-id","isDraft":true}' }], isError: false,
        }));
      }
    });
    const result = await client.createOutlookDraft({
      to: ['alex@example.com'], subject: 'Window', body: 'Please confirm',
    });
    assert.deepEqual(result, { ok: true, action: 'outlook-draft-created' });
    assert.equal(createCall.params.name, 'workiq-create_entity');
    assert.equal(createCall.params.arguments.parentUrl, '/me/messages');
    await client.shutdown();
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
      ['stdout EOF', (message, child) => queueMicrotask(() => child.stdout.emit('end'))],
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

  it('accepts the installed WorkIQ ask_work_iq tool name', async () => {
    let askCall;
    const { client } = createHarness((message, child) => {
      if (message.method === 'initialize') {
        queueMicrotask(() => child.respond(message.id, { protocolVersion: '2025-03-26' }));
      } else if (message.method === 'tools/list') {
        queueMicrotask(() => child.respond(message.id, { tools: [{ name: 'ask_work_iq' }] }));
      } else if (message.method === 'tools/call') {
        askCall = message;
        queueMicrotask(() => child.respond(message.id, {
          content: [{ type: 'text', text: JSON.stringify({
            schemaVersion: 1,
            recommendation: 'Review the runtime probe result.',
            blocker: '',
            why: 'The probe confirms the smallest next step.',
            confidence: 'high',
            evidence: [{ kind: 'observed', text: 'The runtime probe completed.' }],
            proposals: [],
            noCommunicationReason: 'No external communication is needed.',
          }) }],
          isError: false,
        }));
      }
    });

    const result = await client.proposeThreadActions({
      schemaVersion: 1,
      thread: { id: 'thread-ask-work-iq', title: 'Runtime probe' },
    });

    assert.equal(result.ok, true);
    assert.equal(askCall.params.name, 'ask_work_iq');
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

  it('uses the verified structured ask envelope for both draft channels without writing', async () => {
    const calls = [];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      calls.push(message);
      const channel = message.params.arguments.question.includes('"requestedChannel":"teams"') ? 'teams' : 'email';
      queueMicrotask(() => child.respond(message.id, {
        content: [],
        structuredContent: { response: JSON.stringify({
          schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
          evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
          proposals: [{
            channel, target: { displayName: 'Alex', address: 'alex@example.com' },
            payload: channel === 'email' ? { subject: 'Window', body: 'Please confirm' } : { message: 'Please confirm' },
          }],
        }) },
      }));
    });
    for (const requestedChannel of ['email', 'teams']) {
      const result = await client.proposeThreadActions({
        schemaVersion: 1, requestedChannel, thread: { id: requestedChannel, title: 'Window' },
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.proposals[0].channel, requestedChannel);
    }
    assert.deepEqual(calls.map((call) => call.params.name), ['ask', 'ask']);
    await client.shutdown();
  });

  it('preserves synthesis throttling codes rather than reporting an unrelated synthesis failure', async () => {
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') queueMicrotask(() => child.respond(message.id, {
        isError: true, content: [{ type: 'text', text: 'Rate limited; private service detail' }],
      }));
    });
    const result = await client.proposeThreadActions({
      schemaVersion: 1, thread: { id: 'a', title: 'Window' },
    });
    assert.deepEqual(result, { ok: false, readOnly: true, code: 'THROTTLED' });
    await client.shutdown();
  });

  it('accepts live WorkIQ object response envelopes with citations for both draft channels', async () => {
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method !== 'tools/call') return;
      const channel = message.params.arguments.question.includes('"requestedChannel":"teams"') ? 'teams' : 'email';
      const response = JSON.stringify({
        schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
        evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
        proposals: [{
          channel, target: { displayName: 'Alex', address: 'alex@example.com' },
          payload: channel === 'email' ? { subject: 'Window', body: 'Please confirm' } : { message: 'Please confirm' },
        }],
      }) + '\n\n[1](https://example.com/evidence)';
      queueMicrotask(() => child.respond(message.id, {
        content: [{ type: 'object', text: JSON.stringify({ response, conversationId: 'private-id' }) }],
      }));
    });
    try {
      for (const requestedChannel of ['email', 'teams']) {
        const result = await client.proposeThreadActions({
          schemaVersion: 1, requestedChannel, thread: { id: requestedChannel, title: 'Window' },
        });
        assert.equal(result.ok, true);
        assert.equal(result.result.proposals[0].channel, requestedChannel);
        assert.equal(JSON.stringify(result).includes('private-id'), false);
      }
    } finally { await client.shutdown(); }
  });

  it('keeps concurrent composer results and failures correlated through the shared MCP queue', async () => {
    const { createThreadComposer } = await import('../src/svelte/lib/thread-composer.js');
    const { adaptEmailProposalsToActionQueue } = await import('../src/svelte/lib/proposal-synthesis.js');
    const calls = [];
    const saved = [];
    const { client } = createHarness((message, child) => {
      successfulServer(message, child);
      if (message.method === 'tools/call') calls.push({ message, child });
    });
    const composer = createThreadComposer();
    const generate = (id, channel) => composer.generate({
      item: { id, title: `Thread ${id}`, sourceType: 'Email' }, channel,
      propose: (context) => client.proposeThreadActions(context),
      saveEmail: async (item, result) => {
        const proposals = adaptEmailProposalsToActionQueue(item, result, saved);
        saved.push(...proposals);
        return proposals[0].id;
      },
    });
    const a = generate('a', 'email');
    const b = generate('b', 'teams');
    for (let tick = 0; tick < 50 && calls.length < 2; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(calls.length, 2);
    assert.equal(client.getQueueStatus().active, 2);
    calls[1].child.respond(calls[1].message.id, {
      isError: true, content: [{ type: 'text', text: 'Sign in required; private detail' }],
    });
    await b;
    assert.equal(composer.read('b').status, 'error');
    assert.match(composer.read('b').error, /sign-in/);
    assert.equal(composer.read('a').status, 'generating');
    calls[0].child.respond(calls[0].message.id, {
      content: [], structuredContent: { response: JSON.stringify({
        schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
        evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
        proposals: [{
          channel: 'email', target: { displayName: 'Alex', address: 'alex@example.com' },
          payload: { subject: 'Window', body: 'Please confirm' },
        }],
      }) },
    });
    await a;
    assert.equal(composer.read('a').status, 'ready');
    assert.equal(composer.read('a').emailProposalId, saved[0].id);
    assert.equal(saved[0].sourceItemId, 'a');
    assert.equal(composer.read('b').teamsDraft, null);
    assert.equal(client.getQueueStatus().active, 0);
    assert.deepEqual(calls.map(({ message }) => message.params.name), ['ask', 'ask']);
    await client.shutdown();
  });

  it('returns a sanitized synthesis timeout after one ask attempt', async () => {
    const { client, children } = createHarness(successfulServer, { semanticTimeout: 10 });
    const result = await client.proposeThreadActions({
      schemaVersion: 1,
      thread: { id: 'thread-1', title: 'Deployment follow-up' },
    });

    assert.deepEqual(result, { ok: false, readOnly: true, code: 'TIMEOUT' });
    assert.equal(children[0].messages.filter((message) => message.method === 'tools/call').length, 1);
    assert.equal(children[0].killCalls, 0);
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
    assert.equal(children[0].killCalls, 0);
    assert.equal(client.getQueueStatus().active, 1, 'An ambiguous timed-out write still consumes transport capacity');
    await client.shutdown();
    assert.equal(client.getQueueStatus().active, 0);
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