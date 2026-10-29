import test from 'node:test';
import assert from 'node:assert/strict';
import { queuePresentation, watchWorkiqQueue } from '../src/svelte/lib/workiq-queue-status.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('presentation uses real running/queued counts, cooldown, and ready/connected states', () => {
  assert.deepEqual(queuePresentation(null, false), { label: 'Ready', className: '' });
  assert.equal(queuePresentation(null, true).label, 'Connected');
  assert.equal(queuePresentation({ active: 4, pending: 12 }, true).label, '4 running / 12 queued');
  assert.equal(queuePresentation({ active: 0, pending: 2 }, true).label, '0 running / 2 queued');
  assert.equal(queuePresentation({ active: 0, pending: 2, cooldownUntil: 3500 }, true, 1000).label,
    '0 running / 2 queued · retry in 3s');
  assert.equal(queuePresentation({ active: 0, pending: 0, cooldownUntil: 1000 }, true, 1000).label, 'Connected');
});

test('subscription ignores stale initial snapshots and unsubscribes on cleanup', async () => {
  let listener;
  let resolveInitial;
  let unsubscribed = 0;
  const seen = [];
  const stop = watchWorkiqQueue({
    onWorkiqQueueStatus(callback) { listener = callback; return () => { unsubscribed++; }; },
    getWorkiqQueueStatus() { return new Promise((resolve) => { resolveInitial = resolve; }); },
  }, (status) => seen.push(status));
  await flush();
  listener({ active: 4, pending: 12 });
  resolveInitial({ active: 0, pending: 0 });
  await flush();
  assert.deepEqual(seen, [{ active: 4, pending: 12 }]);
  stop();
  listener({ active: 1, pending: 0 });
  assert.equal(seen.length, 1);
  assert.equal(unsubscribed, 1);
});

test('initial snapshot is read and late completion after destroy is ignored', async () => {
  const seen = [];
  const stop = watchWorkiqQueue({ getWorkiqQueueStatus: async () => ({ active: 1, pending: 2 }) }, (status) => seen.push(status));
  await flush();
  assert.deepEqual(seen, [{ active: 1, pending: 2 }]);
  stop();
  const stopBeforeRead = watchWorkiqQueue({ getWorkiqQueueStatus: async () => ({ active: 2, pending: 0 }) }, (status) => seen.push(status));
  stopBeforeRead();
  await flush();
  assert.equal(seen.length, 1);
});

test('a synchronous subscription snapshot wins over a stale initial getter', async () => {
  const seen = [];
  const stop = watchWorkiqQueue({
    onWorkiqQueueStatus(callback) { callback({ active: 3, pending: 2 }); },
    getWorkiqQueueStatus: async () => ({ active: 0, pending: 0 }),
  }, (status) => seen.push(status));
  await flush();
  stop();
  assert.deepEqual(seen, [{ active: 3, pending: 2 }]);
});

test('countdown exists only during cooldown and is cleared on destroy', () => {
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalNow = Date.now;
  const timers = new Map();
  let nextId = 0;
  let listener;
  let now = 1000;
  const seen = [];
  globalThis.setInterval = (callback) => { timers.set(++nextId, callback); return nextId; };
  globalThis.clearInterval = (id) => timers.delete(id);
  Date.now = () => now;
  let stop;
  try {
    stop = watchWorkiqQueue({ onWorkiqQueueStatus(callback) { listener = callback; } }, (status) => seen.push(queuePresentation(status, true, now).label));
    listener({ active: 0, pending: 0 });
    assert.equal(timers.size, 0);
    listener({ active: 0, pending: 1, cooldownUntil: 3000 });
    assert.equal(timers.size, 1);
    now = 2000;
    [...timers.values()][0]();
    assert.match(seen.at(-1), /retry in 1s/);
    now = 3000;
    [...timers.values()][0]();
    assert.equal(timers.size, 0);
    listener({ active: 0, pending: 1, cooldownUntil: 5000 });
    stop();
    assert.equal(timers.size, 0);
  } finally {
    stop?.();
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
    Date.now = originalNow;
  }
});

test('missing fixture methods are tolerated, real getter/subscription failures are reported', async () => {
  const errors = [];
  watchWorkiqQueue({}, () => assert.fail('no snapshot expected'), (error) => errors.push(error))();
  const stop = watchWorkiqQueue({
    onWorkiqQueueStatus() { throw new Error('subscribe failed'); },
    getWorkiqQueueStatus() { throw new Error('read failed'); },
  }, () => {}, (error) => errors.push(error.message));
  await flush();
  stop();
  assert.deepEqual(errors, ['subscribe failed', 'read failed']);
});
