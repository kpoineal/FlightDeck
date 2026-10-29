'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkiqRequestQueue } = require('../src/main/workiq-request-queue');

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function harness(options = {}) {
  let time = 0;
  let id = 0;
  const timers = new Map();
  const queue = createWorkiqRequestQueue({
    now: () => time,
    setTimeout: (callback, delay) => {
      timers.set(++id, { callback, at: time + delay });
      return id;
    },
    clearTimeout: (timer) => timers.delete(timer),
    random: () => 0.5,
    ...options,
  });
  return {
    queue, timers,
    async tick(milliseconds) {
      const end = time + milliseconds;
      await flush();
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function track(queue, run, options) {
  return queue.schedule(run, options).catch((error) => ({ code: error.code, attempts: error.attempts }));
}

describe('global WorkIQ request queue', () => {
  it('paces starts, reserves a click slot, and never exceeds five total/four background', async () => {
    const h = harness();
    const gate = deferred();
    const starts = [];
    const jobs = Array.from({ length: 6 }, (_, index) =>
      track(h.queue, () => { starts.push(`b${index}`); return gate.promise; }, { priority: 'background' }));
    await h.tick(749);
    assert.equal(starts.length, 3);
    await h.tick(1);
    assert.equal(starts.length, 4);
    jobs.push(track(h.queue, () => { starts.push('click'); return gate.promise; }));
    await h.tick(250);
    assert.equal(starts.at(-1), 'click');
    assert.deepEqual(h.queue.getStatus(), {
      active: 5, pending: 2, limit: 5, backgroundLimit: 4, cooldownUntil: 0,
    });
    await h.tick(1000);
    assert.equal(starts.length, 5);
    gate.resolve('done');
    await h.tick(1000);
    await Promise.all(jobs);
    assert.equal(h.queue.getStatus().active, 0);
    assert.equal(h.queue.getStatus().pending, 0);
    assert.equal(h.timers.size, 0);
  });

  it('bounds waiting work at fifty total/forty background with explicit overflow', async () => {
    const h = harness({ pacingMs: 0 });
    const gate = deferred();
    const jobs = Array.from({ length: 4 }, () =>
      track(h.queue, () => gate.promise, { priority: 'background' }));
    jobs.push(track(h.queue, () => gate.promise));
    for (let i = 0; i < 40; i += 1) jobs.push(track(h.queue, () => gate.promise, { priority: 'background' }));
    assert.equal((await track(h.queue, () => null, { priority: 'background' })).code, 'QUEUE_FULL');
    for (let i = 0; i < 10; i += 1) jobs.push(track(h.queue, () => gate.promise));
    assert.equal((await track(h.queue, () => null)).code, 'QUEUE_FULL');
    assert.equal(h.queue.getStatus().pending, 50);
    h.queue.shutdown();
    await Promise.all(jobs);
    gate.resolve();
  });

  it('coalesces queued/running reads, promotes clicks, but never coalesces writes', async () => {
    const h = harness({ pacingMs: 0, limit: 1 });
    const gate = deferred();
    const blocker = track(h.queue, () => gate.promise);
    let runs = 0;
    const first = h.queue.schedule(() => { runs += 1; return 'answer'; }, { priority: 'background', key: 'same' });
    const second = h.queue.schedule(() => assert.fail('duplicate'), { key: 'same' });
    assert.equal(first, second);
    gate.resolve();
    await h.tick(0);
    assert.deepEqual(await first, { value: 'answer', attempts: 1 });
    await blocker;
    const write = () => { runs += 1; };
    await Promise.all([
      h.queue.schedule(write, { key: 'same', readOnly: false }),
      h.queue.schedule(write, { key: 'same', readOnly: false }),
    ]);
    assert.equal(runs, 3);
  });

  it('gives clicks priority with a background turn after four interactive starts', async () => {
    const h = harness({ pacingMs: 0, limit: 1 });
    const gate = deferred();
    const jobs = [track(h.queue, () => gate.promise)];
    const starts = [];
    jobs.push(track(h.queue, () => starts.push('background'), { priority: 'background' }));
    for (let i = 0; i < 8; i += 1) jobs.push(track(h.queue, () => starts.push('click')));
    gate.resolve();
    await h.tick(0);
    await Promise.all(jobs);
    assert.deepEqual(starts.slice(0, 4), ['click', 'click', 'click', 'background']);
  });

  it('releases active slots during jittered backoff and applies supplied cooldown globally', async () => {
    const h = harness({ pacingMs: 0 });
    let attempts = 0;
    const retried = h.queue.schedule(() => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('private'), { code: 'THROTTLED', retryAfterMs: 2000 });
      return 'recovered';
    });
    await h.tick(0);
    assert.equal(h.queue.getStatus().active, 0);
    assert.equal(h.queue.getStatus().cooldownUntil, 2000);
    let clicks = 0;
    const click = h.queue.schedule(() => { clicks += 1; });
    await h.tick(1999);
    assert.equal(clicks, 0);
    assert.equal(attempts, 1);
    await h.tick(1);
    await click;
    assert.deepEqual(await retried, { value: 'recovered', attempts: 2 });
  });

  it('does not invent cooldown, lets clicks use retry-delay slots, and honors attempt budgets', async () => {
    const h = harness({ pacingMs: 0, limit: 1 });
    let attempts = 0;
    const retried = track(h.queue, () => {
      attempts += 1;
      throw Object.assign(new Error('private'), { code: 'TIMEOUT' });
    });
    await h.tick(0);
    assert.equal(h.queue.getStatus().cooldownUntil, 0);
    assert.equal((await h.queue.schedule(() => 'click')).value, 'click');
    await h.tick(500);
    assert.deepEqual(await retried, { code: 'TIMEOUT', attempts: 2 });
    assert.equal(attempts, 2);
    const fail = () => { throw Object.assign(new Error('private'), { code: 'TIMEOUT' }); };
    assert.equal((await track(h.queue, fail, { maxAttempts: 1 })).attempts, 1);
    assert.equal((await track(h.queue, fail, { readOnly: false })).attempts, 1);
    assert.equal(h.timers.size, 0);
  });

  it('shutdown rejects active, queued, and delayed retries and removes timers/listeners', async () => {
    const h = harness({ pacingMs: 0, limit: 1 });
    const statuses = [];
    const unsubscribe = h.queue.subscribe((status) => statuses.push(status));
    const retry = track(h.queue, () => { throw Object.assign(new Error('private'), { code: 'TIMEOUT' }); });
    await h.tick(0);
    const gate = deferred();
    const active = track(h.queue, () => gate.promise);
    const queued = track(h.queue, () => assert.fail('must not dispatch'));
    await h.tick(0);
    h.queue.shutdown();
    for (const result of await Promise.all([retry, active, queued])) assert.equal(result.code, 'SHUTTING_DOWN');
    assert.equal(h.timers.size, 0);
    assert.equal(h.queue.getStatus().pending, 0);
    assert.equal(h.queue.getStatus().active, 0);
    assert.equal((await track(h.queue, () => null)).code, 'SHUTTING_DOWN');
    unsubscribe();
    gate.resolve();
    await h.tick(10000);
    assert.equal(statuses.at(-1).active, 0);
    assert.equal(JSON.stringify(statuses).includes('private'), false);
  });

  it('retains transport capacity after caller completion without retry and cleans up held/queued work on shutdown', async () => {
    const h = harness({ pacingMs: 0, limit: 1 });
    let release;
    let attempts = 0;
    const timedOut = track(h.queue, (lease) => {
      attempts++;
      release = lease.retain();
      throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    }, { key: 'retained' });
    await h.tick(0);
    assert.deepEqual(await timedOut, { code: 'TIMEOUT', attempts: 1 });
    const queued = track(h.queue, () => assert.fail('transport slot is still held'));
    await h.tick(10000);
    assert.equal(attempts, 1);
    assert.equal(h.queue.getStatus().active, 1);
    assert.equal(h.queue.getStatus().pending, 1);
    h.queue.shutdown();
    assert.equal((await queued).code, 'SHUTTING_DOWN');
    release();
    release();
    await h.tick(0);
    assert.equal(h.queue.getStatus().active, 0);
    assert.equal(h.queue.getStatus().pending, 0);
    assert.equal(h.timers.size, 0);
  });
});
