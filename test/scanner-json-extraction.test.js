'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const demoStoreStub = 'data:text/javascript,export const isDemo = { subscribe(run) { run(false); return () => {}; } };';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './stores.js' && context.parentURL?.endsWith('/json-parser.js')) {
      return { url: demoStoreStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const validator = (payload) => payload && Array.isArray(payload.radarItems);

test('scanner accepts adjacent copies of a complete JSON document without duplicating items', async (t) => {
  const { runWorkiqJson } = await import('../src/svelte/lib/json-parser.js');
  const payload = {
    radarItems: [{
      title: 'Synthetic item',
      summary: 'Literal } and [ with "quoted" text and a \\ backslash',
      evidenceLinks: [{ url: 'https://example.com/synthetic' }],
    }],
  };
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls += 1;
    return { success: true, answer: JSON.stringify(payload) + JSON.stringify(payload, null, 2) };
  } } };
  t.after(() => { delete globalThis.window; });

  assert.deepEqual(await runWorkiqJson('Synthetic prompt', validator, 'scanner', { maxRetries: 0 }), payload);
  assert.equal(calls, 1);
});

test('scanner still rejects wrong wrappers, incomplete outer documents, and malformed JSON', async (t) => {
  const { runWorkiqJson } = await import('../src/svelte/lib/json-parser.js');
  t.mock.method(console, 'warn', () => {});
  t.after(() => { delete globalThis.window; });
  for (const answer of [
    '{"wrapper":{"radarItems":[]}}{"wrapper":{"radarItems":[]}}',
    '{"wrapper":{"radarItems":[]}',
    '{"radarItems":[broken]}{"radarItems":[broken]}',
  ]) {
    globalThis.window = { workiq: { ask: async () => ({ success: true, answer }) } };
    await assert.rejects(runWorkiqJson('Synthetic prompt', validator, 'scanner', { maxRetries: 0 }),
      /unexpected response/);
  }
});

test('scanner preserves empty results, fenced JSON, prose extraction, and citation injection', async (t) => {
  const { runWorkiqJson } = await import('../src/svelte/lib/json-parser.js');
  t.after(() => { delete globalThis.window; });
  for (const answer of [
    '{"radarItems":[]}',
    '```json\n{"radarItems":[]}\n```',
    'Synthetic response:\n{"radarItems":[]} End.',
  ]) {
    globalThis.window = { workiq: { ask: async () => ({ success: true, answer }) } };
    assert.deepEqual(await runWorkiqJson('Synthetic prompt', validator, 'scanner', { maxRetries: 0 }),
      { radarItems: [] });
  }
  globalThis.window = { workiq: { ask: async () => ({
    success: true,
    answer: '{"radarItems":[{"title":"Synthetic item"}]}\n[1](https://example.com/synthetic)',
  }) } };
  const result = await runWorkiqJson('Synthetic prompt', validator, 'scanner', { maxRetries: 0 });
  assert.equal(result.radarItems[0].evidenceLinks[0].url, 'https://example.com/synthetic');
});
