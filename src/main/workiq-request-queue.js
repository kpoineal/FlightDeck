'use strict';

function queueError(code, attempts = 0) {
  return Object.assign(new Error(code), { code, attempts });
}

function createWorkiqRequestQueue(options = {}) {
  const limit = options.limit ?? 5;
  const backgroundLimit = options.backgroundLimit ?? 4;
  const pendingLimit = options.pendingLimit ?? 50;
  const backgroundPendingLimit = options.backgroundPendingLimit ?? 40;
  const pacingMs = options.pacingMs ?? 250;
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const random = options.random || Math.random;
  const pending = [];
  const active = new Set();
  const keyed = new Map();
  const listeners = new Set();
  let closed = false;
  let timer = null;
  let nextStart = 0;
  let cooldownUntil = 0;
  let interactiveStarts = 0;

  function getStatus() {
    return { active: active.size, pending: pending.length, limit, backgroundLimit, cooldownUntil };
  }

  function publish() {
    for (const listener of listeners) {
      try { listener(getStatus()); } catch (_) {}
    }
  }

  function observeFailure(failure) {
    if (!closed && Number.isFinite(failure?.retryAfterMs) && failure.retryAfterMs >= 0) {
      cooldownUntil = Math.max(cooldownUntil, now() + failure.retryAfterMs);
      publish();
      pump();
    }
  }

  function finish(task, error, value) {
    if (task.settled) return;
    task.settled = true;
    if (task.key && !active.has(task)) keyed.delete(task.key);
    if (error) task.reject(queueError(error.code || 'REQUEST_FAILED', task.attempts));
    else task.resolve({ value, attempts: task.attempts });
  }

  function pump() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (closed) return;
    while (active.size < limit) {
      const time = now();
      const backgroundActive = [...active].filter((task) => task.priority === 'background').length;
      const eligible = pending.filter((task) =>
        task.readyAt <= time && (task.priority !== 'background' || backgroundActive < backgroundLimit));
      const interactive = eligible.find((task) => task.priority === 'interactive');
      const background = eligible.find((task) => task.priority === 'background');
      const task = background && (!interactive || interactiveStarts >= 4) ? background : interactive;
      if (!task || time < Math.max(nextStart, cooldownUntil)) break;
      pending.splice(pending.indexOf(task), 1);
      active.add(task);
      task.executionDone = false;
      task.attempts += 1;
      interactiveStarts = task.priority === 'interactive' ? interactiveStarts + 1 : 0;
      nextStart = time + pacingMs;
      publish();
      Promise.resolve().then(() => {
        if (closed) throw queueError('SHUTTING_DOWN');
        return task.run({
          retain() {
            task.retained += 1;
            let released = false;
            return () => {
              if (released) return;
              released = true;
              task.retained -= 1;
              if (task.executionDone && task.retained === 0) {
                active.delete(task);
                if (task.key && keyed.get(task.key) === task) keyed.delete(task.key);
                publish();
                pump();
              }
            };
          },
        });
      }).then((value) => complete(task, null, value), (error) => complete(task, error));
    }
    if (pending.length && active.size < limit) {
      const backgroundActive = [...active].filter((task) => task.priority === 'background').length;
      const candidates = pending.filter((task) =>
        task.priority !== 'background' || backgroundActive < backgroundLimit);
      if (candidates.length) {
        const wakeAt = Math.max(nextStart, cooldownUntil, Math.min(...candidates.map((task) => task.readyAt)));
        timer = setTimer(pump, Math.min(2147483647, Math.max(0, wakeAt - now())));
      }
    }
  }

  function complete(task, error, value) {
    task.executionDone = true;
    // A caller timeout is not remote completion. Keep capacity (and coalescing)
    // until the transport reports a terminal reply or confirmed process exit.
    if (!closed && task.retained > 0) {
      finish(task, error, value);
      publish();
      return;
    }
    active.delete(task);
    if (task.settled) return;
    const failure = error || ((value?.ok === false || value?.success === false) ? value : null);
    if (Number.isFinite(failure?.retryAfterMs) && failure.retryAfterMs >= 0) {
      cooldownUntil = Math.max(cooldownUntil, now() + failure.retryAfterMs);
    }
    const retryable = ['THROTTLED', 'TIMEOUT', 'PROCESS_EXITED', 'START_FAILED'].includes(failure?.code);
    if (!closed && task.readOnly && retryable && task.attempts < task.maxAttempts) {
      // Delayed retries occupy bounded waiting space, never active capacity.
      const backgroundCount = pending.filter((entry) => entry.priority === 'background').length;
      if (pending.length >= pendingLimit
        || (task.priority === 'background' && backgroundCount >= backgroundPendingLimit)) {
        finish(task, queueError('QUEUE_FULL'));
      } else {
        const backoff = Math.min(10000, 500 * (2 ** (task.attempts - 1))) * (0.75 + random() * 0.5);
        task.readyAt = now() + backoff;
        pending.push(task);
      }
    } else {
      finish(task, error, value);
    }
    publish();
    pump();
  }

  function schedule(run, metadata = {}) {
    if (closed) return Promise.reject(queueError('SHUTTING_DOWN'));
    const priority = metadata.priority ?? 'interactive';
    const maxAttempts = metadata.maxAttempts ?? 2;
    const readOnly = metadata.readOnly !== false;
    const key = readOnly && metadata.key ? metadata.key : null;
    const existing = key && keyed.get(key);
    if (existing) {
      // A click can promote queued background work without duplicating it.
      if (priority === 'interactive') existing.priority = 'interactive';
      pump();
      return existing.promise;
    }
    const backgroundCount = pending.filter((task) => task.priority === 'background').length;
    if (pending.length >= pendingLimit || (priority === 'background' && backgroundCount >= backgroundPendingLimit)) {
      return Promise.reject(queueError('QUEUE_FULL'));
    }
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const task = {
      run, priority, maxAttempts, readOnly, key, resolve, reject, promise,
      readyAt: now(), attempts: 0, settled: false, retained: 0, executionDone: false,
    };
    if (key) keyed.set(key, task);
    pending.push(task);
    publish();
    pump();
    return promise;
  }

  function shutdown() {
    closed = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const task of [...pending, ...active]) finish(task, queueError('SHUTTING_DOWN'));
    pending.length = 0;
    active.clear();
    keyed.clear();
    publish();
    listeners.clear();
  }

  return {
    schedule, getStatus, shutdown, observeFailure,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createWorkiqRequestQueue };
