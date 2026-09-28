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
