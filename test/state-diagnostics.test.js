const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createStateDiagnostics } = require('../src/shared/state-diagnostics.mjs');
const { measureStore, diagnostics } = require('../src/main/state-diagnostics');

it('drops content, unknown operations, getters, and nonnumeric metadata', () => {
  const recorder = createStateDiagnostics({ enabled: true });
  const metadata = {
    count: 5, bytes: 42, outcome: 'ok', path: 'PRIVATE', sourceId: 'PRIVATE',
    title: 'PRIVATE', error: new Error('PRIVATE'), navigation: 'PRIVATE',
  };
  Object.defineProperty(metadata, 'prompt', { get() { assert.fail('content getter evaluated'); } });
  recorder.record('hot-get', 2, metadata);
  recorder.record('PRIVATE', 2, metadata);
  recorder.record('hot-get', NaN, metadata);
  recorder.record('hot-get', 1, { count: -1, bytes: Infinity, outcome: 'PRIVATE' });
  const getters = {};
  for (const key of ['count', 'outcome']) {
    Object.defineProperty(getters, key, { get() { assert.fail('allowlisted getter evaluated'); } });
  }
  recorder.record('hot-get', 0, getters);
  assert.deepEqual(recorder.snapshot().entries, [
    { sequence: 1, operation: 'hot-get', durationMs: 2, count: 5, bytes: 42, outcome: 'ok' },
    { sequence: 2, operation: 'hot-get', durationMs: 1 },
    { sequence: 3, operation: 'hot-get', durationMs: 0 },
  ]);
  assert.ok(!JSON.stringify(recorder.snapshot()).includes('PRIVATE'));
});

it('bounds memory, copies exports, and ends each span only once', () => {
  let time = 0;
  const recorder = createStateDiagnostics({ enabled: true, capacity: 2, clock: () => time++ });
  const end = recorder.begin('hydrate');
  end({ outcome: 'ok' });
  end({ outcome: 'failed' });
  recorder.record('cached-published');
  recorder.record('remote-ready');
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.dropped, 1);
  assert.deepEqual(snapshot.entries.map(entry => entry.sequence), [2, 3]);
  snapshot.entries[0].operation = 'changed';
  assert.equal(recorder.snapshot().entries[0].operation, 'cached-published');
});

it('disabled diagnostics neither read clocks/metadata nor stat/serialize storage', () => {
  const recorder = createStateDiagnostics({ clock: () => assert.fail('disabled clock') });
  const metadata = new Proxy({}, { getOwnPropertyDescriptor() { assert.fail('disabled metadata'); } });
  recorder.begin('hydrate')(metadata);
  recorder.record('hydrate', 0, metadata);
  assert.deepEqual(recorder.snapshot().entries, []);
  assert.equal(recorder.snapshot().run, null);
  assert.equal(diagnostics.enabled, false);
  const store = { get path() { assert.fail('disabled file stat'); } };
  const value = { toJSON() { assert.fail('extra serialization'); } };
  assert.equal(measureStore('hot-get', store, () => value), value);
  assert.throws(() => measureStore('hot-get', store, () => { throw new Error('original'); }), /original/);
});
