'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionState } = require('../src/main/connection-state');

it('coalesces window validation, caches success, and explicitly retries', async () => {
  let release, calls = 0;
  const states = [];
  const connection = createConnectionState(() => { calls++; return new Promise(resolve => { release = resolve; }); }, state => states.push(state.status));
  const first = connection.validate(), second = connection.validate();
  assert.equal(first, second);
  assert.equal(connection.isReady(), false);
  await Promise.resolve();
  release({ success: true });
  assert.equal((await first).success, true);
  assert.equal(connection.isReady(), true);
  await connection.validate();
  assert.equal(calls, 1);
  const retry = connection.validate({ retry: true });
  assert.equal(connection.isReady(), false);
  await Promise.resolve();
  release({ success: false });
  await retry;
  assert.equal(connection.getStatus().status, 'failed');
  assert.deepEqual(states, ['validating', 'ready', 'validating', 'failed']);
});

it('failure is retryable and a disconnected generation cannot become ready', async () => {
  let release, calls = 0;
  const connection = createConnectionState(() => {
    calls++;
    if (calls === 1) throw new Error('private');
    return new Promise(resolve => { release = resolve; });
  });
  assert.deepEqual(await connection.validate(), { success: false });
  const pending = connection.validate();
  await Promise.resolve();
  connection.disconnect();
  release({ success: true });
  assert.equal((await pending).code, 'SUPERSEDED');
  assert.equal(connection.getStatus().status, 'disconnected');
  const next = connection.validate();
  await Promise.resolve();
  release({ success: true });
  await next;
  assert.equal(connection.isReady(), true);
});
