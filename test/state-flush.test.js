'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createStateFlush } = require('../src/main/state-flush');
const { createStateSessions } = require('../src/main/state-sessions');

it('requires a literal acknowledgement from the same renderer; failed/timeout flush blocks', async () => {
  const ipc = new EventEmitter();
  const flush = createStateFlush(ipc, 20);
  const sender = new EventEmitter();
  const win = { isDestroyed: () => false, webContents: sender };
  sender.send = (_channel, token) => {
    ipc.emit('state-flush-ack', { sender: {} }, token, true);
    ipc.emit('state-flush-ack', { sender }, token, true);
  };
  assert.equal(await flush.flush([win]), true);
  sender.send = (_channel, token) => ipc.emit('state-flush-ack', { sender }, token, { success: true });
  assert.equal(await flush.flush([win]), false);
  sender.send = () => {};
  assert.equal(await flush.flush([win]), false);
  sender.send = () => sender.emit('destroyed');
  assert.equal(await flush.flush([win]), false);
  flush.close();
  assert.equal(ipc.listenerCount('state-flush-ack'), 0);
});

it('revision lease protects both tiers and rejects stale windows before mutation', () => {
  const sessions = createStateSessions();
  const first = new EventEmitter(), second = new EventEmitter();
  assert.equal(sessions.acquire(first, 0).ok, true);
  assert.equal(sessions.acquire(second, 0).code, 'BUSY');
  assert.throws(() => sessions.assertOwner(second), /LEASE_REQUIRED/);
  assert.throws(() => sessions.assertReadable(second), /STATE_BUSY/);
  sessions.assertOwner(first);
  assert.deepEqual(sessions.release(first), { ok: true, revision: 1 });
  assert.equal(sessions.acquire(second, 0).code, 'CONFLICT');
  assert.equal(sessions.acquire(second, 1).ok, true);
  sessions.release(second);
  assert.equal(second.listenerCount('destroyed'), 0);
  assert.equal(sessions.acquire(first, 1).ok, true);
  sessions.assertOwner(first);
  first.emit('destroyed');
  assert.equal(sessions.acquire(second, 1).code, 'RECOVERY_REQUIRED');
  assert.throws(() => sessions.assertReadable(second), /RECOVERY_REQUIRED/);
});
