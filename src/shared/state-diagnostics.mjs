// Shared, content-free recorder. Never pass storage keys or error objects here.
const OPERATIONS = new Set([
  'app-start', 'app-ready', 'window-navigation', 'renderer-bootstrap', 'renderer-reload',
  'popout-bootstrap', 'app-mount', 'startup-complete', 'log-load', 'version-load',
  'update-check', 'engines-start', 'subscriptions-installed', 'state-sync',
  'hydrate', 'hydrate-read', 'hydrate-normalize', 'hydrate-publish', 'cached-published',
  'connection-validate', 'remote-ready', 'svelte-tick', 'frame-opportunity',
  'save-request', 'save-write', 'save-ipc', 'invalidation',
  'hot-get', 'hot-set', 'hot-delete', 'hot-get-all', 'cold-get', 'cold-set',
  'ipc-get', 'ipc-set', 'ipc-delete', 'ipc-get-all', 'ipc-cold-get', 'ipc-cold-set', 'ipc-validate',
]);
const OUTCOMES = new Set(['ok', 'failed', 'rejected', 'superseded']);
const NUMBERS = ['count', 'bytes', 'navigation'];
const noop = () => {};

export function createStateDiagnostics({ enabled = false, capacity = 256, clock = () => performance.now() } = {}) {
  const limit = Number.isInteger(capacity) ? Math.min(1024, Math.max(1, capacity)) : 256;
  const buffer = [];
  let sequence = 0;
  const run = enabled ? globalThis.crypto.randomUUID() : null;
  function record(operation, durationMs = 0, metadata = null) {
    if (!enabled || !OPERATIONS.has(operation)) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const entry = { sequence: ++sequence, operation, durationMs };
    // Data descriptors only: metadata getters, prototypes and arbitrary fields are not evaluated.
    for (const key of NUMBERS) {
      const value = metadata && Object.getOwnPropertyDescriptor(metadata, key)?.value;
      if (Number.isSafeInteger(value) && value >= 0) entry[key] = value;
    }
    const outcome = metadata && Object.getOwnPropertyDescriptor(metadata, 'outcome')?.value;
    if (OUTCOMES.has(outcome)) entry.outcome = outcome;
    if (buffer.length === limit) buffer.shift();
    buffer.push(entry);
  }
  function begin(operation) {
    if (!enabled || !OPERATIONS.has(operation)) return noop;
    const start = clock();
    let ended = false;
    return (metadata) => {
      if (ended) return;
      ended = true;
      record(operation, Math.max(0, clock() - start), metadata);
    };
  }
  return {
    enabled, begin, record,
    snapshot: () => ({ schemaVersion: 1, enabled, run, capacity: limit, dropped: Math.max(0, sequence - limit), entries: buffer.map(entry => ({ ...entry })) }),
  };
}
