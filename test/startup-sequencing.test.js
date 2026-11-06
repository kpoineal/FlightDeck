const { it } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { generateStateProfile } = require('./fixtures/state-profile');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../../demo/fixture.json' && context.parentURL?.endsWith('/persistence.js')) {
      return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

function resetBridge() {
  global.window ??= {};
  window.workiq = {
    stateDiagnosticsEnabled: true,
    getStateDiagnostics: async () => ({ entries: [] }),
  };
}

it('cached hydration resolves before a held validator; validation never republishes stale items', async () => {
  resetBridge();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  Object.assign(window.workiq, {
    storeGet: async () => { calls.push('read'); return generateStateProfile({ connected: true }).state; },
    acceptEula: () => { calls.push('validate'); return gate; },
  });
  const { get } = await import('svelte/store');
  const { items, connected } = await import('../src/svelte/lib/stores.js');
  const { loadPersistentState } = await import('../src/svelte/lib/persistence.js');
  const { stateDiagnostics } = await import('../src/svelte/lib/state-diagnostics.js');
  items.set([{ id: 'existing' }]);
  connected.set(false);
  const pending = loadPersistentState();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['read', 'validate']);
  assert.equal(await pending, true);
  assert.equal(get(items)[0].id, 'hot_0');
  assert.equal(get(connected), false);
  assert.ok(stateDiagnostics.snapshot().entries.some(entry => entry.operation === 'cached-published'));
  items.update(entries => [{ ...entries[0], title: 'Local edit during validation' }, ...entries.slice(1)]);
  release({ success: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get(items).length, 100);
  assert.ok(get(items)[0].sourceIdentities.length > 0);
  assert.equal(get(connected), true);
  assert.equal(get(items)[0].title, 'Local edit during validation');
  const operations = stateDiagnostics.snapshot().entries.map(entry => entry.operation);
  assert.ok(operations.indexOf('hydrate-read') < operations.indexOf('connection-validate'));
  assert.ok(operations.indexOf('cached-published') < operations.indexOf('remote-ready'));
  assert.ok(operations.indexOf('cached-published') < operations.lastIndexOf('hydrate'));
  assert.equal((await window.__flightdeck_state_diagnostics()).renderer.enabled, true);
});

it('disconnected hydration does not validate; identity collisions remain separate items', async () => {
  resetBridge();
  const fixture = generateStateProfile({ collisions: true });
  window.workiq.storeGet = async () => structuredClone(fixture.state);
  window.workiq.acceptEula = () => assert.fail('disconnected validator');
  window.workiq.disconnect = () => assert.fail('hydration must not disconnect another window’s live session');
  const { loadPersistentState } = await import('../src/svelte/lib/persistence.js');
  const { items } = await import('../src/svelte/lib/stores.js');
  const { get } = await import('svelte/store');
  assert.equal(await loadPersistentState(), true);
  assert.equal(get(items).length, 100);
  assert.notEqual(get(items)[0].id, get(items)[1].id);
  assert.deepEqual(get(items)[0].sourceIdentities, get(items)[1].sourceIdentities);
});

it('failed validation retains enabled intent and cache without a repair write or private error export', async () => {
  resetBridge();
  const fixture = generateStateProfile({ connected: true });
  let writes = 0;
  window.workiq.storeGet = async () => structuredClone(fixture.state);
  window.workiq.storeSet = async () => { writes++; return { success: true }; };
  window.workiq.acceptEula = async () => { throw new Error('PRIVATE_VALIDATOR_ERROR'); };
  const { loadPersistentState } = await import('../src/svelte/lib/persistence.js');
  const { connected, connectionIntent, connectionStatus, items } = await import('../src/svelte/lib/stores.js');
  const { disconnectWorkiq } = await import('../src/svelte/lib/connection.js');
  await disconnectWorkiq();
  const { get } = await import('svelte/store');
  assert.equal(await loadPersistentState(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get(connected), false);
  assert.equal(get(items).length, 100);
  assert.equal(writes, 0);
  assert.equal(get(connectionIntent), true);
  assert.equal(get(connectionStatus), 'failed');
  const report = await window.__flightdeck_state_diagnostics();
  assert.ok(report.renderer.entries.some(entry => entry.operation === 'connection-validate' && entry.outcome === 'failed'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_VALIDATOR_ERROR'));
});

it('demo intent is not runtime authorization and also waits for independent validation', async () => {
  resetBridge();
  const { disconnectWorkiq } = await import('../src/svelte/lib/connection.js');
  await disconnectWorkiq();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  window.workiq.storeGet = async () => generateStateProfile({ connected: true }).state;
  window.workiq.acceptEula = () => gate;
  const { loadPersistentState } = await import('../src/svelte/lib/persistence.js');
  const { connected, items } = await import('../src/svelte/lib/stores.js');
  const { get } = await import('svelte/store');
  assert.equal(await loadPersistentState(true), true);
  assert.equal(get(items).length, 100);
  assert.equal(get(connected), false);
  release({ success: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get(connected), true);
});
