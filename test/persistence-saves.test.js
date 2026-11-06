'use strict';
const { it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../../demo/fixture.json' && context.parentURL?.endsWith('/persistence.js')) {
      return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
let persistence, stores, get, state, writes, broadcasts, dispose;
const canonical = 'flightdeck.persisted.v2';
const { createGeneratedProfile, removeGeneratedProfile } = require('./fixtures/state-profile');
const { createStateService } = require('../src/main/state-service');
const fixture = () => ({
  items: [{ id: 'one', title: 'Cached', lifecycleStatus: 'in-progress', updateHistory: [] }],
  scanners: [{ id: 'scanner', name: 'Test', enabled: false }], connected: false,
});

it('production renderer sends incremental commands, preserves held edits and retries a lost acknowledgement idempotently', async () => {
  const { directory } = createGeneratedProfile({});
  const service = createStateService(directory);
  const calls = [];
  let release, hold = false, loseAck = false;
  try {
    global.window = { workiq: {
      stateQuery: (method, input) => service.query(method, input),
      stateCommand: async input => {
        calls.push(structuredClone(input));
        const result = await service.command(input);
        if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
        if (loseAck) { loseAck = false; throw new Error('Generated acknowledgement loss'); }
        return result;
      },
    } };
    assert.equal(await persistence.loadPersistentState(), true);
    dispose = persistence.subscribePersistentState();
    const target = get(stores.items)[0];
    stores.items.update(rows => rows.map(row => row.id === target.id ? { ...row, severity: 'Critical' } : row));
    hold = true;
    const flush = persistence.flushPersistentState();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    stores.items.update(rows => { rows.find(row => row.id === target.id).title = 'During acknowledgement'; return rows; });
    release();
    assert.equal(await flush, true);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.payload.changes.length === 1 && call.payload.changes[0].domain === 'threads'));
    assert.deepEqual(Object.keys(calls[0].payload.changes[0].patch), ['severity']);
    assert.equal((await service.query('getThread', { id: target.id })).title, 'During acknowledgement');
    stores.density.set('minimal');
    loseAck = true;
    assert.equal(await persistence.flushPersistentState(), false);
    assert.equal(await persistence.flushPersistentState(), true);
    assert.equal(calls.at(-1).commandId, calls.at(-2).commandId);
    assert.equal((await service.query('projection')).value.density, 'minimal');
  } finally {
    dispose?.(); dispose = null;
    persistence.cancelScheduledPersistentStateSave();
    await service.close();
    removeGeneratedProfile(directory);
  }
});

it('markItemRead persists unhydrated history with isNew false without replaying read intent on later edits', async () => {
  const { markItemRead, setItemSeverity } = await import('../src/svelte/lib/item-actions.js');
  const { isMailboxUnread } = await import('../src/svelte/lib/mailbox.js');
  const { directory } = createGeneratedProfile({});
  const service = createStateService(directory);
  const calls = [];
  try {
    const initial = await service.query('projection');
    const id = initial.value.items[0].id;
    await service.command({ commandId: 'seed-unseen', expectedRevision: initial.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id, patch: { isNew: false, hasNewUpdate: false,
        updateHistory: [0, 1, 2].map(index => ({
          eventId: `unseen_${index}`, kind: 'update', timestamp: `2026-11-0${5 - index}T12:00:00Z`,
          summary: `Unseen ${index}`, seen: false,
        })) } }] } });
    global.window = { workiq: {
      stateQuery: (method, input) => service.query(method, input),
      stateCommand: async input => { calls.push(structuredClone(input)); return service.command(input); },
    } };
    assert.equal(await persistence.loadPersistentState(), true);
    dispose = persistence.subscribePersistentState();
    const projected = get(stores.items).find(row => row.id === id);
    assert.equal(projected.isNew, false);
    assert.equal(projected.historyPartial, true);
    assert.equal(projected.updateHistory.length, 1);
    assert.equal(markItemRead(id), true);
    assert.equal(await persistence.flushPersistentState(), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.changes[0].markRead, true);
    const detail = await service.query('getThread', { id });
    assert.equal(detail.updateHistory.length, 3);
    assert.ok(detail.updateHistory.every(event => event.seen === true));
    assert.equal(isMailboxUnread(detail), false);
    assert.equal((await service.query('radarPage', { view: 'inbox', quickFilter: 'unread' })).total, 0);
    assert.equal(markItemRead(id), false);
    assert.equal(setItemSeverity(id, 'Critical'), true);
    assert.equal(await persistence.flushPersistentState(), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].payload.changes[0].patch, { severity: 'Critical' });
    assert.equal(Object.hasOwn(calls[1].payload.changes[0], 'markRead'), false);
    assert.equal(await persistence.loadPersistentState(), true);
    assert.equal(isMailboxUnread(get(stores.items).find(row => row.id === id)), false);
  } finally {
    dispose?.(); dispose = null;
    persistence.cancelScheduledPersistentStateSave();
    await service.close();
    removeGeneratedProfile(directory);
  }
});

before(async () => {
  ({ get } = await import('svelte/store'));
  stores = await import('../src/svelte/lib/stores.js');
  persistence = await import('../src/svelte/lib/persistence.js');
});
beforeEach(async () => {
  state = fixture(); writes = []; broadcasts = 0;
  global.window = { workiq: {
    storeGet: async key => key === canonical ? structuredClone(state) : null,
    storeSet: async (_key, value) => { writes.push(structuredClone(value)); return { success: true }; },
    storeDelete: async () => ({ success: true }),
    broadcastStateChanged: () => { broadcasts++; },
  } };
  await persistence.loadPersistentState();
});
afterEach(() => {
  dispose?.(); dispose = null;
  persistence.cancelScheduledPersistentStateSave();
});

it('installs domain tracking without idle writes and writes canonical arrays only', async () => {
  dispose = persistence.subscribePersistentState();
  await persistence.flushPersistentState();
  assert.equal(writes.length, 0);
  stores.density.set(get(stores.density));
  await persistence.flushPersistentState();
  assert.equal(writes.length, 0);
  stores.items.update(entries => { entries[0].title = 'In-place edit'; return entries; });
  assert.equal(await persistence.flushPersistentState(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].items[0].title, 'In-place edit');
  assert.equal(Object.hasOwn(writes[0], 'trackingItems'), false);
  assert.equal(Object.hasOwn(writes[0], 'radarItems'), false);
});

it('same-value thread actions do not publish a fake mutation or schedule a snapshot', async () => {
  const { setItemSeverity } = await import('../src/svelte/lib/item-actions.js');
  dispose = persistence.subscribePersistentState();
  assert.equal(setItemSeverity('one', get(stores.items)[0].severity), false);
  assert.equal(await persistence.flushPersistentState(), true);
  assert.equal(writes.length, 0);
});

it('tracks edits immediately and does not apply a delayed hydration over unsaved changes', async () => {
  dispose = persistence.subscribePersistentState();
  let release;
  window.workiq.storeGet = () => new Promise(resolve => { release = resolve; });
  const hydration = persistence.loadPersistentState();
  stores.items.update(entries => entries.map(entry => ({ ...entry, title: 'Local' })));
  release(fixture());
  assert.equal(await hydration, false);
  assert.equal(get(stores.items)[0].title, 'Local');
  assert.equal(await persistence.flushPersistentState(), true);
});

it('flush includes an edit made while the previous write acknowledgement is held', async () => {
  dispose = persistence.subscribePersistentState();
  let release;
  window.workiq.storeSet = async (_key, value) => {
    writes.push(structuredClone(value));
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    return { success: true };
  };
  stores.density.set('minimal');
  const flush = persistence.flushPersistentState();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  stores.items.update(entries => entries.map(entry => ({ ...entry, title: 'During write' })));
  release();
  assert.equal(await flush, true);
  assert.equal(writes.at(-1).items[0].title, 'During write');
  assert.equal(get(stores.persistenceStatus), 'saved');
});

it('failed receipts preserve dirty edits and never emit success invalidation', async () => {
  dispose = persistence.subscribePersistentState();
  window.workiq.storeSet = async () => ({});
  stores.density.set('minimal');
  assert.equal(await persistence.flushPersistentState(), false);
  assert.equal(broadcasts, 0);
  assert.equal(get(stores.persistenceStatus), 'failed');
  window.workiq.storeSet = async () => ({ success: true });
  assert.equal(await persistence.flushPersistentState(), true);
  assert.equal(broadcasts, 1);
});

it('idle flush owns no lease and transactions own one across external writes and rollback', async () => {
  let leased = false;
  let acquisitions = 0;
  let releases = 0;
  window.workiq.acquireStateLease = async () => {
    assert.equal(leased, false);
    leased = true;
    acquisitions++;
    return { ok: true, revision: 0 };
  };
  window.workiq.releaseStateLease = async () => {
    assert.equal(leased, true);
    leased = false;
    releases++;
    return { ok: true, revision: 1 };
  };
  assert.equal(await persistence.flushPersistentState(), true);
  assert.equal(acquisitions, 0);
  const result = await persistence.runPersistentStateTransaction({
    mutate: () => { assert.equal(leased, true); },
    persistExternal: async () => { assert.equal(leased, true); return false; },
    rollback: () => { assert.equal(leased, true); return true; },
    rollbackExternal: async () => { assert.equal(leased, true); return true; },
  });
  assert.equal(result.code, 'PERSISTENCE_FAILED');
  assert.equal(leased, false);
  assert.equal(acquisitions, 1);
  assert.equal(releases, 1);
});

it('failed canonical promotion leaves legacy source untouched', async () => {
  let deletes = 0;
  window.workiq.storeGet = async key => key === canonical ? null : fixture();
  window.workiq.storeSet = async () => false;
  window.workiq.storeDelete = async () => { deletes++; };
  assert.equal(await persistence.loadPersistentState(), true);
  assert.equal(deletes, 0);
  assert.equal(get(stores.persistenceStatus), 'failed');
});

it('read failure never authorizes empty fallback saves', async () => {
  window.workiq.storeGet = async () => { throw new Error('unreadable'); };
  assert.equal(await persistence.loadPersistentState(), false);
  stores.items.set([]);
  assert.equal(await persistence.savePersistentState(), false);
  assert.equal(await persistence.flushPersistentState(), false);
  assert.equal(writes.length, 0);
});

it('malformed canonical profiles fail visibly without legacy fallback or empty replacement', async () => {
  for (const malformed of [false, [], { items: {} }, { items: [null] }, { scanners: 'bad' },
    { briefingsByMeetingId: [] }]) {
    let legacyReads = 0;
    window.workiq.storeGet = async key => {
      if (key === canonical) return malformed;
      legacyReads++;
      return fixture();
    };
    assert.equal(await persistence.loadPersistentState(), false);
    assert.equal(get(stores.persistenceStatus), 'load-failed');
    assert.equal(await persistence.savePersistentState(), false);
    assert.equal(legacyReads, 0);
    assert.equal(writes.length, 0);
  }
});
