import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJsonFromText, runWorkiqJson } from '../src/svelte/lib/json-parser.js';

const response = JSON.stringify({ summary: 'probe', status: 'No Update' });
const duplicatedResponse = `${response}\n${response}`;

test('extracts individual JSON values from repeated WorkIQ output', () => {
  const candidates = extractJsonFromText(duplicatedResponse);

  assert.ok(candidates.includes(response));
});

test('runWorkiqJson accepts a repeated WorkIQ JSON response', async () => {
  globalThis.window = {
    workiq: {
      ask: async () => ({ success: true, answer: duplicatedResponse }),
    },
  };

  try {
    const payload = await runWorkiqJson(
      'probe',
      (candidate) => candidate?.status === 'No Update' && typeof candidate.summary === 'string',
      'json-parser-test',
      { maxRetries: 0 }
    );

    assert.deepEqual(payload, { summary: 'probe', status: 'No Update' });
  } finally {
    delete globalThis.window;
  }
});

for (const prefix of [
  '{"old":[{"summary":"unfinished',
  'Type": "Teams Chat", "doneCriteria": "unfinished',
  ' licensing guidance accurate.", "url": "https://example.invalid/recording/MS',
  '{"rows":[{"index":99,"text":"This is deterministic',
]) {
  test(`recovers an intact snapshot after a streaming fragment: ${prefix.slice(0, 25)}`, async () => {
    const payload = {
      generatedAt: '2026-11-09T20:33:00Z',
      summary: 'Complete snapshot with "quotes", a trailing slash \\, brackets [] and braces {}.',
      status: 'No Update',
      nested: [{ text: 'Escaped quote: \\" and unicode \u00e9 \u{1f680}' }],
    };
    const snapshot = JSON.stringify(payload);
    const answer = `${prefix}${snapshot}`;
    assert.ok(extractJsonFromText(answer).includes(snapshot));
    let calls = 0;
    globalThis.window = { workiq: { ask: async () => {
      calls++;
      return { success: true, answer, attempts: 1 };
    } } };
    try {
      assert.deepEqual(await runWorkiqJson('probe',
        candidate => candidate?.status === 'No Update' && typeof candidate.summary === 'string',
        'streaming-fragment', { maxRetries: 0 }), payload);
      assert.equal(calls, 1);
    } finally { delete globalThis.window; }
  });
}

test('reverse extraction preserves complete arrays and trailing citations', () => {
  const snapshot = JSON.stringify([{ text: 'Literal "quote", \\, } and ]', nested: [1, 2] }]);
  assert.ok(extractJsonFromText(`{"partial":"broken${snapshot}\n[1](https://example.invalid/source)`).includes(snapshot));
});

test('reverse extraction does not promote JSON-like text inside a complete JSON string', () => {
  const payload = { summary: '{"status":"No Update","summary":"not the payload"}', status: 'Changed' };
  const snapshot = JSON.stringify(payload);
  const candidates = extractJsonFromText(snapshot);
  assert.ok(candidates.includes(snapshot));
  assert.equal(candidates.includes(payload.summary), false);
});

test('a fragment without a complete replacement snapshot still fails without replay', async () => {
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls++;
    return { success: true, answer: `{"partial":"broken${response.slice(0, -1)}`, attempts: 1 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe',
      candidate => candidate?.status === 'No Update' && typeof candidate.summary === 'string',
      'incomplete-snapshot', { maxRetries: 0 }), /unexpected response/);
    assert.equal(calls, 1);
  } finally { delete globalThis.window; }
});

const briefingTail = ` remaining follow-ups.",
  "priorities": ["Review commitments"],
  "meetings": [],
  "sources": [{"label":"Source","url":"https://example.invalid/source"}]
}
[1](https://example.invalid/source)`;

test('a genuinely missing briefing prefix is not replaced with nested JSON', async () => {
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls++;
    return { success: true, answer: briefingTail, attempts: 1 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe', candidate => typeof candidate?.headline === 'string',
      'missing-briefing-prefix', { maxRetries: 0 }), /unexpected response/);
    assert.equal(calls, 1);
  } finally { delete globalThis.window; }
});

test('a missing briefing prefix uses only the remaining safe-read attempt', async () => {
  const options = [];
  const payload = { headline: 'Complete briefing', priorities: [] };
  globalThis.window = { workiq: { ask: async (_prompt, requestOptions) => {
    options.push(requestOptions);
    return { success: true, answer: options.length === 1 ? briefingTail : JSON.stringify(payload), attempts: 1 };
  } } };
  try {
    assert.deepEqual(await runWorkiqJson('probe', candidate => typeof candidate?.headline === 'string',
      'missing-briefing-prefix-retry', { retryDelayMs: 0 }), payload);
    assert.deepEqual(options, [
      { priority: 'interactive', maxAttempts: 2 },
      { priority: 'interactive', maxAttempts: 1 },
    ]);
  } finally { delete globalThis.window; }
});

test('network attempts consume the shared two-attempt parse budget', async () => {
  const calls = [];
  globalThis.window = { workiq: { ask: async (_prompt, options) => {
    calls.push(options);
    return { success: true, answer: 'not JSON', attempts: 2 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe', () => true, 'budget', { retryDelayMs: 0 }), /unexpected response/);
    assert.deepEqual(calls, [{ priority: 'interactive', maxAttempts: 2 }]);
  } finally { delete globalThis.window; }
});

test('a valid response after two backend attempts is accepted without renderer retry', async () => {
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls++;
    return { success: true, answer: response, attempts: 2 };
  } } };
  try {
    assert.deepEqual(await runWorkiqJson('probe', () => true, 'network-success'), JSON.parse(response));
    assert.equal(calls, 1);
  } finally { delete globalThis.window; }
});

test('legacy results use one attempt and parse retry sends only the remaining budget and metadata', async () => {
  const calls = [];
  globalThis.window = { workiq: { ask: async (_prompt, options) => {
    calls.push(options);
    return { success: true, answer: calls.length === 1 ? 'invalid' : response };
  } } };
  try {
    assert.deepEqual(await runWorkiqJson('probe', () => true, 'legacy', {
      priority: 'background', key: 'scanner:probe', maxRetries: 10, retryDelayMs: 0,
    }), JSON.parse(response));
    assert.deepEqual(calls, [
      { priority: 'background', key: 'scanner:probe', maxAttempts: 2 },
      { priority: 'background', key: 'scanner:probe', maxAttempts: 1 },
    ]);
  } finally { delete globalThis.window; }
});

test('maxRetries zero also disables backend retry', async () => {
  const calls = [];
  globalThis.window = { workiq: { ask: async (_prompt, options) => {
    calls.push(options);
    return { success: true, answer: 'invalid', attempts: 1 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe', () => true, 'single', { maxRetries: 0 }), /unexpected response/);
    assert.deepEqual(calls, [{ priority: 'interactive', maxAttempts: 1 }]);
  } finally { delete globalThis.window; }
});

test('backend failure codes propagate without renderer replay', async () => {
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls++;
    return { success: false, error: 'Queue is full', code: 'QUEUE_FULL', attempts: 1 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe', () => true, 'full'), { message: 'Queue is full', code: 'QUEUE_FULL' });
    assert.equal(calls, 1);
  } finally { delete globalThis.window; }
});

test('EULA recovery remains explicit and does not retry', async () => {
  let calls = 0;
  globalThis.window = { workiq: { ask: async () => {
    calls++;
    return { success: true, answer: 'Please accept the end user license', attempts: 1 };
  } } };
  try {
    await assert.rejects(runWorkiqJson('probe', () => true, 'eula'), /EULA not accepted/);
    assert.equal(calls, 1);
  } finally { delete globalThis.window; }
});

test('demo mode makes no backend calls', async () => {
  const { isDemo } = await import('../src/svelte/lib/stores.js');
  isDemo.set(true);
  globalThis.window = { workiq: { ask: () => { throw new Error('must not call'); } } };
  try {
    assert.equal(await runWorkiqJson('probe', () => true, 'demo'), null);
  } finally {
    isDemo.set(false);
    delete globalThis.window;
  }
});
