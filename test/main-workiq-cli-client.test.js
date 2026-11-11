'use strict';

require('./helpers/electron-mock');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkiqCliClient } = require('../src/main/workiq-cli-client');

function harness(respond, options = {}) {
  const calls = [];
  const children = [];
  const client = createWorkiqCliClient({
    launcher: 'C:\\WorkIQ\\workiq.exe', verifyLauncher: false,
    queueOptions: { pacingMs: 0 }, shutdownGrace: 5,
    entityTimeout: 1000,
    spawnProcess(executable, args, spawnOptions) {
      const child = Object.assign(new EventEmitter(), {
        pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(), kills: 0,
        kill() { this.kills++; this.emit('close', null); },
      });
      calls.push({ executable, args, spawnOptions });
      children.push(child);
      const command = args[2];
      queueMicrotask(() => {
        if (command === '--help') {
          child.stdout.emit('data', Buffer.from('Commands:\n  ask  Ask\n  fetch  Fetch\n  create  Create\n'));
          child.emit('close', 0);
          return;
        }
        respond(command, args, child, (value, code = 0) => {
          child.stdout.emit('data', Buffer.from(JSON.stringify(value)));
          child.emit('close', code);
        });
      });
      return child;
    },
    ...options,
  });
  return { client, calls, children };
}
const argument = (args, name) => args[args.indexOf(name) + 1];
const draft = { to: ['alex@example.com'], subject: 'Subject', body: 'Body' };
function respondCreated(child, entity, status = 201) {
  child.stdout.emit('data', Buffer.from(`Created (HTTP ${status}):\r\n${JSON.stringify(entity, null, 2)}\r\n`));
  child.emit('close', 0);
}

test('production CLI routes semantic reads and probe without starting an MCP server', async () => {
  const h = harness((command, args, child, respond) => {
    assert.equal(command, 'ask');
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('--no-streaming'));
    respond({ isError: false, response: '13' });
  });
  try {
    assert.deepEqual(await h.client.probe(), { ok: true, readOnly: true, cli: 'available', auth: 'unknown' });
    assert.deepEqual(await h.client.ask('count'), { success: true, answer: '13', attempts: 1 });
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(call => !call.args.includes('mcp') && call.spawnOptions.windowsHide &&
      call.spawnOptions.stdio[0] === 'ignore'));
    assert.equal(h.client.getQueueStatus().active, 0);
  } finally { await h.client.shutdown(); }
});

test('proposal synthesis and recipient verification both run through CLI', async () => {
  const h = harness((command, args, child, respond) => {
    if (command === 'ask') {
      respond({ isError: false, response: JSON.stringify({
        schemaVersion: 1, recommendation: 'Reply with a status update', confidence: 'high',
        evidence: [{ kind: 'observed', text: 'Alex asked for an update.' }], proposals: [{
          channel: 'email', payload: { subject: 'Update', body: 'Here is the update.' },
          target: { displayName: 'Alex' },
        }],
      }) });
    } else {
      assert.equal(command, 'fetch');
      assert.ok(argument(args, '--urls').startsWith('/users?'));
      respond({ value: [{
        id: '00000000-0000-0000-0000-000000000001',
        displayName: 'Alex', mail: 'alex@example.com',
      }] });
    }
  });
  try {
    const result = await h.client.proposeThreadActions({
      schemaVersion: 1, thread: { id: 'synthetic', title: 'Synthetic thread' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.proposals[0].target.address, 'alex@example.com');
    assert.ok(h.calls.some(call => call.args[2] === 'fetch'));
    assert.ok(h.calls.every(call => !call.args.includes('mcp')));
  } finally { await h.client.shutdown(); }
});

test('Outlook create uses literal argv JSON and requires a returned draft entity', async () => {
  for (const [receipt, ok] of [
    [{ id: 'draft-id', isDraft: true }, true],
    [{ id: 'draft-id', isDraft: false }, false],
    [{ message: 'Draft created successfully' }, false],
    [{ error: { message: 'Access denied' } }, false],
  ]) {
    let writes = 0;
    const h = harness((command, args, child, respond) => {
      assert.equal(command, 'create');
      assert.equal(argument(args, '--url'), '/me/messages');
      const body = JSON.parse(argument(args, '--body'));
      assert.equal(body.body.content, draft.body);
      assert.equal(body.toRecipients[0].emailAddress.address, draft.to[0]);
      writes++;
      respond(receipt);
    });
    try {
      assert.equal((await h.client.createOutlookDraft(draft)).ok, ok);
      assert.equal(writes, 1);
    } finally { await h.client.shutdown(); }
  }
});

test('Outlook accepts observed CLI create framing only with authoritative successful draft evidence', async () => {
  const entity = { id: 'private-draft-id', isDraft: true };
  for (const [output, expected] of [
    [`Created (HTTP 201):\r\n${JSON.stringify(entity, null, 2)}`, true],
    [`Created (HTTP 200):\n${JSON.stringify(entity)}`, true],
    [`Created (HTTP 500):\n${JSON.stringify(entity)}`, false],
    ['Created (HTTP 201):\n{"id":"private-draft-id","isDraft":false}', false],
    ['Created (HTTP 201):\n{"id":"private-draft-id"}', false],
    ['Created (HTTP 201):\n{"message":"Draft created successfully"}', false],
    ['Created (HTTP 201):\n{"error":{"message":"private failure"}}', false],
    [`Unrecognized diagnostic\n${JSON.stringify(entity)}`, false],
    [`Created (HTTP 201):\n${JSON.stringify(entity)}\n{"id":"second","isDraft":true}`, false],
    [`Created (HTTP 201):\n${JSON.stringify(entity)}\ntrailing diagnostic`, false],
    ['Created (HTTP 201):\nnot JSON', false],
    ['Created (HTTP 201):\n[]', false],
  ]) {
    let writes = 0;
    const h = harness((command, _args, child) => {
      assert.equal(command, 'create');
      writes++;
      child.stdout.emit('data', Buffer.from(output));
      child.emit('close', 0);
    });
    try {
      const result = await h.client.createOutlookDraft(draft);
      assert.equal(result.ok, expected, output);
      assert.equal(writes, 1, 'An uncertain create must never be replayed');
      if (!expected) assert.equal(result.dispatched, true);
      assert.equal(JSON.stringify(result).includes('private'), false);
    } finally { await h.client.shutdown(); }
  }
});

test('Teams CLI verifies directory identity and canonical chat before sending and checking the receipt', async () => {
  const targetId = '00000000-0000-0000-0000-000000000001';
  const selfId = '00000000-0000-0000-0000-000000000002';
  const members = [{ userId: targetId, email: 'alex@example.com' }, { userId: selfId }];
  for (const [validReceipt, framed] of [[true, false], [false, false], [true, true], [false, true]]) {
    let sends = 0;
    const h = harness((command, args, child, respond) => {
      const url = argument(args, command === 'fetch' ? '--urls' : '--url');
      const fetch = entity => respond(framed ? { results: [{ data: entity, statusCode: 200 }], requestId: 'synthetic-request' } : entity);
      if (command === 'fetch' && url.startsWith('/users?')) {
        fetch({ value: [{ id: targetId, mail: 'alex@example.com' }] });
      } else if (command === 'fetch' && url.startsWith('/me?')) {
        fetch({ id: selfId });
      } else if (command === 'create' && url === '/chats') {
        const body = JSON.parse(argument(args, '--body'));
        assert.equal(body.members.length, 2);
        const chat = { id: 'chat-id', chatType: 'oneOnOne' };
        if (framed) respondCreated(child, chat, 200);
        else respond(chat);
      } else if (command === 'fetch' && url.startsWith('/chats/')) {
        fetch({ id: 'chat-id', chatType: 'oneOnOne', members });
      } else {
        assert.equal(command, 'create');
        assert.equal(url, '/chats/chat-id/messages');
        sends++;
        const body = JSON.parse(argument(args, '--body')).body;
        assert.equal(body.content, 'Hello');
        const receipt = { id: 'message-id', chatId: validReceipt ? 'chat-id' : 'wrong-chat',
          createdDateTime: '2026-11-10T12:00:00Z', body };
        if (framed) respondCreated(child, receipt);
        else respond(receipt);
      }
    });
    try {
      const result = await h.client.sendTeamsMessage({
        targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello',
      });
      assert.equal(result.ok, validReceipt);
      if (!validReceipt) assert.equal(result.code, 'SEND_UNCONFIRMED');
      assert.equal(sends, 1);
    } finally { await h.client.shutdown(); }
  }
});

test('CLI fetch error envelopes preserve safe failure classification without posting', async () => {
  for (const [statusCode, expected] of [[401, 'AUTH_REQUIRED'], [403, 'AUTH_REQUIRED'], [429, 'THROTTLED'], [404, 'RESOLUTION_FAILED']]) {
    const h = harness((command, _args, _child, respond) => {
      assert.equal(command, 'fetch', 'No write is allowed after a failed identity lookup');
      respond({ results: [{ data: null, statusCode, error: { error: { code: 'SyntheticFailure', message: 'private detail' } } }],
        requestId: 'private-request-id' });
    });
    try {
      const result = await h.client.sendTeamsMessage({ targetDisplayName: 'Alex', targetEmail: 'alex@example.com', message: 'Hello' });
      assert.equal(result.code, expected);
      assert.equal(JSON.stringify(result).includes('private'), false);
      assert.equal(h.calls.filter(call => call.args[2] === 'fetch').length, 1);
    } finally { await h.client.shutdown(); }
  }
});

test('CLI entity work can finish after the availability-probe budget without duplicate writes', async () => {
  let writes = 0;
  const h = harness((command, _args, child) => {
    assert.equal(command, 'create');
    writes++;
    setTimeout(() => respondCreated(child, { id: 'draft-id', isDraft: true }), 40);
  }, { probeTimeout: 20, entityTimeout: 1000 });
  try {
    assert.equal((await h.client.createOutlookDraft(draft)).ok, true);
    assert.equal(writes, 1);
  } finally { await h.client.shutdown(); }
});

test('failed or ambiguous CLI writes are never replayed', async () => {
  for (const mode of ['exit', 'timeout', 'malformed']) {
    let writes = 0;
    const h = harness((command, args, child, respond) => {
      assert.equal(command, 'create');
      writes++;
      if (mode === 'timeout') return;
      if (mode === 'malformed') {
        child.stdout.emit('data', Buffer.from('not JSON'));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from('Error: too many requests'));
        child.emit('close', 1);
      }
    }, { probeTimeout: 20, entityTimeout: 20 });
    try {
      const result = await h.client.createOutlookDraft(draft);
      assert.equal(result.ok, false);
      assert.equal(result.dispatched, true);
      assert.equal(writes, 1);
    } finally { await h.client.shutdown(); }
  }
});

test('empty CLI answers resume only their own read conversation within the shared budget', async () => {
  const calls = [];
  const h = harness((command, args, child, respond) => {
    assert.equal(command, 'ask');
    calls.push(args);
    respond({ isError: false, response: calls.length === 1 ? '' : '0', conversationId: 'read-conversation' });
  }, { queueOptions: { pacingMs: 0, random: () => 0 } });
  try {
    const result = await h.client.ask('count');
    assert.equal(result.answer, '0');
    assert.equal(result.attempts, 2);
    assert.equal(calls[0].includes('--conversation-id'), false);
    assert.equal(argument(calls[1], '--conversation-id'), 'read-conversation');
    await h.client.ask('unrelated');
    assert.equal(calls[2].includes('--conversation-id'), false);
  } finally { await h.client.shutdown(); }
});

test('shutdown cancels owned structured CLI processes and does not dispatch a write afterwards', async () => {
  const h = harness(() => {});
  const pending = h.client.sendTeamsMessage({ targetDisplayName: 'Alex', message: 'Hello' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.getQueueStatus().active, 1);
  await h.client.shutdown();
  assert.equal((await pending).code, 'SHUTTING_DOWN');
  assert.equal(h.children.at(-1).kills, 1);
  assert.equal(h.calls.some(call => call.args[2] === 'create'), false);
});
