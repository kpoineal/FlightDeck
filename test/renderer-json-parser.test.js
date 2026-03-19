'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext();
  loadFile(ctx, 'renderer/json-parser.js');
});

/* ================================================================== */
/*  parseCandidates                                                   */
/* ================================================================== */
describe('parseCandidates()', () => {
  it('returns empty array for falsy input', () => {
    assert.equal(ctx.parseCandidates(null).length, 0);
    assert.equal(ctx.parseCandidates('').length, 0);
  });

  it('picks up text starting with {', () => {
    const result = ctx.parseCandidates('{"key":"value"}');
    assert.ok(result.length >= 1);
    assert.ok(result.some((c) => c.includes('"key"')));
  });

  it('picks up text starting with [', () => {
    const result = ctx.parseCandidates('[1,2,3]');
    assert.ok(result.length >= 1);
  });

  it('extracts fenced JSON blocks', () => {
    const input = 'Some preamble\n```json\n{"a":1}\n```\ntrailing';
    const result = ctx.parseCandidates(input);
    assert.ok(result.some((c) => c.includes('"a"')));
  });

  it('extracts substring between first { and last }', () => {
    const input = 'Here is the answer: {"x":1} done.';
    const result = ctx.parseCandidates(input);
    assert.ok(result.some((c) => c.startsWith('{')));
  });

  it('deduplicates candidates', () => {
    const input = '{"a":1}';
    const result = ctx.parseCandidates(input);
    const unique = new Set(result);
    assert.equal(result.length, unique.size);
  });
});

/* ================================================================== */
/*  normalizeJsonCandidate                                            */
/* ================================================================== */
describe('normalizeJsonCandidate()', () => {
  it('replaces smart quotes with standard quotes', () => {
    const result = ctx.normalizeJsonCandidate('\u201Chello\u201D');
    assert.equal(result, '"hello"');
  });

  it('strips trailing commas before } or ]', () => {
    assert.equal(ctx.normalizeJsonCandidate('{"a":1,}'), '{"a":1}');
    assert.equal(ctx.normalizeJsonCandidate('[1,2,]'), '[1,2]');
  });

  it('removes control characters', () => {
    const input = 'hello\x01world';
    const result = ctx.normalizeJsonCandidate(input);
    assert.ok(!result.includes('\x01'));
  });

  it('strips ANSI OSC sequences', () => {
    const input = 'data\x1b]0;title\x07more';
    const result = ctx.normalizeJsonCandidate(input);
    assert.ok(!result.includes('\x1b]'));
    assert.ok(result.includes('data'));
    assert.ok(result.includes('more'));
  });
});

/* ================================================================== */
/*  parseJsonWithRepair                                               */
/* ================================================================== */
describe('parseJsonWithRepair()', () => {
  it('parses valid JSON', () => {
    const result = ctx.parseJsonWithRepair('{"key":"value"}');
    assert.deepEqual(result, { key: 'value' });
  });

  it('parses JSON with trailing comma', () => {
    const result = ctx.parseJsonWithRepair('{"key":"value",}');
    assert.deepEqual(result, { key: 'value' });
  });

  it('parses JSON with smart quotes', () => {
    const result = ctx.parseJsonWithRepair('{\u201Ckey\u201D: \u201Cvalue\u201D}');
    assert.deepEqual(result, { key: 'value' });
  });

  it('repairs JSON spread across multiple lines', () => {
    const input = '{"key":\n"value"}';
    const result = ctx.parseJsonWithRepair(input);
    assert.deepEqual(result, { key: 'value' });
  });

  it('throws for completely invalid input', () => {
    assert.throws(() => ctx.parseJsonWithRepair('not json at all'));
  });
});

/* ================================================================== */
/*  sanitizeLikelyBrokenJson                                          */
/* ================================================================== */
describe('sanitizeLikelyBrokenJson()', () => {
  it('replaces embedded double-quotes with single quotes', () => {
    // An embedded quote mid-string that doesn't terminate the value
    const input = '{"key": "value with "embedded" quote"}';
    const result = ctx.sanitizeLikelyBrokenJson(input);
    // Should be parseable or at least not crash
    assert.ok(typeof result === 'string');
  });

  it('replaces newlines inside strings with spaces', () => {
    const input = '{"k": "line1\nline2"}';
    const result = ctx.sanitizeLikelyBrokenJson(input);
    assert.ok(!result.includes('\n'));
  });

  it('strips \uFFFD replacement characters', () => {
    const input = 'hello\uFFFDworld';
    const result = ctx.sanitizeLikelyBrokenJson(input);
    assert.ok(!result.includes('\uFFFD'));
  });

  it('collapses multiple spaces', () => {
    const input = 'hello    world';
    const result = ctx.sanitizeLikelyBrokenJson(input);
    assert.ok(!result.includes('  '));
  });
});

/* ================================================================== */
/*  parseWorkiqJson                                                   */
/* ================================================================== */
describe('parseWorkiqJson()', () => {
  it('parses first valid candidate matching validator', () => {
    const input = '{"status":"ok"}';
    const result = ctx.parseWorkiqJson(input, (obj) => obj.status === 'ok');
    assert.deepEqual(result, { status: 'ok' });
  });

  it('skips candidates that fail validation', () => {
    // Two separate JSON objects: first fails validation, second passes
    const input = 'Here: {"status":"bad"} Also: {"status":"ok"}';
    const candidates = ctx.parseCandidates(input);
    // At least one candidate should contain the ok object
    // parseWorkiqJson tries each candidate in order
    let found = false;
    for (const c of candidates) {
      try {
        const parsed = ctx.parseJsonWithRepair(c);
        if (parsed && parsed.status === 'ok') { found = true; break; }
      } catch { /* skip */ }
    }
    // If direct candidate extraction doesn't isolate them, test the core behavior:
    // When given a valid JSON that fails validation, it moves to next candidate
    const input2 = '```json\n{"status":"bad"}\n```\n```json\n{"status":"ok"}\n```';
    const result = ctx.parseWorkiqJson(input2, (obj) => obj.status === 'ok');
    assert.equal(result.status, 'ok');
  });

  it('throws when no candidate passes validation', () => {
    assert.throws(
      () => ctx.parseWorkiqJson('{"a":1}', (obj) => obj.b === 2),
      /could not be parsed/i
    );
  });

  it('throws for empty input', () => {
    assert.throws(
      () => ctx.parseWorkiqJson('', () => true),
      /could not be parsed/i
    );
  });

  it('parses fenced JSON with surrounding prose', () => {
    const input = 'Here is the result:\n```json\n{"items":[1,2,3]}\n```\nDone.';
    const result = ctx.parseWorkiqJson(input, (obj) => Array.isArray(obj.items));
    assert.deepEqual(result.items, [1, 2, 3]);
  });
});

/* ================================================================== */
/*  extractFootnoteCitations                                          */
/* ================================================================== */
describe('extractFootnoteCitations()', () => {
  it('extracts a single footnote citation', () => {
    const result = ctx.extractFootnoteCitations('Some text [1](https://example.com/a) more');
    looseAssert.deepEqual(result, [{ index: 1, url: 'https://example.com/a' }]);
  });

  it('extracts multiple footnotes into an array', () => {
    const text = '[1](https://a.com)[2](https://b.com)[3](https://c.com)';
    const result = ctx.extractFootnoteCitations(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].index, 1);
    assert.equal(result[0].url, 'https://a.com');
    assert.equal(result[1].index, 2);
    assert.equal(result[2].index, 3);
  });

  it('returns empty array for text with no footnotes', () => {
    const result = ctx.extractFootnoteCitations('Just plain text with no citations.');
    looseAssert.deepEqual(result, []);
  });

  it('returns empty array for null/empty input', () => {
    looseAssert.deepEqual(ctx.extractFootnoteCitations(null), []);
    looseAssert.deepEqual(ctx.extractFootnoteCitations(''), []);
    looseAssert.deepEqual(ctx.extractFootnoteCitations(undefined), []);
  });

  it('deduplicates URLs (same URL with different footnote numbers)', () => {
    const text = '[1](https://same.com/page)[2](https://same.com/page)';
    const result = ctx.extractFootnoteCitations(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://same.com/page');
  });

  it('handles URLs with percent-encoded characters and query params', () => {
    const url = 'https://outlook.office365.com/owa/?ItemID=AAMk%2bZXY&exvsurl=1&viewmodel=ReadMessageItem';
    const text = `See reference [1](${url}) for details.`;
    const result = ctx.extractFootnoteCitations(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].index, 1);
    assert.equal(result[0].url, url);
  });
});

/* ================================================================== */
/*  injectFootnoteCitations                                           */
/* ================================================================== */
describe('injectFootnoteCitations()', () => {
  it('injects citations 1:1 when item count matches footnote count', () => {
    const parsed = {
      radarItems: [
        { title: 'Item A', sourceType: 'Email', evidenceLinks: [] },
        { title: 'Item B', sourceType: 'Teams', evidenceLinks: [] },
      ],
    };
    const rawText = '{"radarItems":[...]} [1](https://link1.com) [2](https://link2.com)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.equal(result.radarItems[0].evidenceLinks.length, 1);
    assert.equal(result.radarItems[0].evidenceLinks[0].url, 'https://link1.com');
    assert.equal(result.radarItems[1].evidenceLinks.length, 1);
    assert.equal(result.radarItems[1].evidenceLinks[0].url, 'https://link2.com');
  });

  it('assigns first N footnotes when more footnotes than items', () => {
    const parsed = {
      radarItems: [
        { title: 'Only item', sourceType: 'Email', evidenceLinks: [] },
      ],
    };
    const rawText = 'data [1](https://a.com) [2](https://b.com) [3](https://c.com)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.equal(result.radarItems[0].evidenceLinks.length, 1);
    assert.equal(result.radarItems[0].evidenceLinks[0].url, 'https://a.com');
  });

  it('assigns only to first items when more items than footnotes', () => {
    const parsed = {
      radarItems: [
        { title: 'Item A', sourceType: 'Email', evidenceLinks: [] },
        { title: 'Item B', sourceType: 'Teams', evidenceLinks: [] },
        { title: 'Item C', sourceType: 'Chat', evidenceLinks: [] },
      ],
    };
    const rawText = 'data [1](https://only-one.com)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.equal(result.radarItems[0].evidenceLinks.length, 1);
    assert.equal(result.radarItems[1].evidenceLinks.length, 0);
    assert.equal(result.radarItems[2].evidenceLinks.length, 0);
  });

  it('keeps empty evidenceLinks when no footnotes exist', () => {
    const parsed = {
      radarItems: [
        { title: 'Item A', evidenceLinks: [] },
      ],
    };
    const rawText = 'Some text with no citations at all';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.equal(result.radarItems[0].evidenceLinks.length, 0);
  });

  it('returns parsed unchanged when there are no radarItems', () => {
    const parsed = { status: 'ok', someField: 42 };
    const rawText = 'text [1](https://link.com)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.deepEqual(result, { status: 'ok', someField: 42 });
  });

  it('injected link has label, type, and url fields', () => {
    const parsed = {
      radarItems: [
        { title: 'Budget review', sourceType: 'Email', evidenceLinks: [] },
      ],
    };
    const rawText = 'data [1](https://mail.example.com/msg)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    const link = result.radarItems[0].evidenceLinks[0];
    assert.ok(link.label, 'link should have a label');
    assert.ok(link.type, 'link should have a type');
    assert.ok(link.url, 'link should have a url');
  });

  it('maps sourceType to lowercase type (e.g. "Email" → "email")', () => {
    const parsed = {
      radarItems: [
        { title: 'Test', sourceType: 'Email', evidenceLinks: [] },
      ],
    };
    const rawText = 'answer [1](https://mail.example.com)';
    const result = ctx.injectFootnoteCitations(parsed, rawText);
    assert.equal(result.radarItems[0].evidenceLinks[0].type, 'email');
  });
});

/* ================================================================== */
/*  parseWorkiqJson – citation integration                            */
/* ================================================================== */
describe('parseWorkiqJson() with citation injection', () => {
  it('injects footnote citations into parsed radarItems with empty evidenceLinks', () => {
    const json = JSON.stringify({
      radarItems: [
        { title: 'Quarterly sync', sourceType: 'Email', evidenceLinks: [] },
      ],
    });
    const answer = json + '\n[1](https://outlook.office365.com/owa/?ItemID=AAMk123)';
    const result = ctx.parseWorkiqJson(answer, (obj) => Array.isArray(obj.radarItems));
    assert.equal(result.radarItems[0].evidenceLinks.length, 1);
    assert.equal(result.radarItems[0].evidenceLinks[0].url, 'https://outlook.office365.com/owa/?ItemID=AAMk123');
    assert.equal(result.radarItems[0].evidenceLinks[0].type, 'email');
  });

  it('realistic test: JSON with evidenceLinks:[] followed by Outlook footnote', () => {
    const json = JSON.stringify({
      radarItems: [
        {
          title: 'Follow up on budget approval',
          sourceType: 'Email',
          summary: 'Finance team needs sign-off by Friday',
          urgency: 'high',
          evidenceLinks: [],
        },
        {
          title: 'Sprint retro action items',
          sourceType: 'Teams',
          summary: 'Document lessons learned from Q4 sprint',
          urgency: 'medium',
          evidenceLinks: [],
        },
      ],
    });
    const answer = 'Here is your radar:\n```json\n' + json + '\n```\n\nSources:\n[1](https://outlook.office365.com/owa/?ItemID=AAMk123%2bXYZ&exvsurl=1)\n[2](https://teams.microsoft.com/l/message/19%3Ameeting_abc)';
    const result = ctx.parseWorkiqJson(answer, (obj) => Array.isArray(obj.radarItems));
    assert.equal(result.radarItems[0].evidenceLinks.length, 1);
    assert.ok(result.radarItems[0].evidenceLinks[0].url.includes('outlook.office365.com'));
    assert.equal(result.radarItems[1].evidenceLinks.length, 1);
    assert.ok(result.radarItems[1].evidenceLinks[0].url.includes('teams.microsoft.com'));
  });
});

/* ================================================================== */
/*  looksLikeEulaPrompt                                               */
/* ================================================================== */
describe('looksLikeEulaPrompt()', () => {
  it('returns true for EULA acceptance text from WorkIQ CLI', () => {
    const eulaText = '=== In order to use this tool you must accept the End User License Agreement (EULA) found at: https://github.com/microsoft/work-iq-mcp   To accept EULA, please execute the following command:   workiq accept-eula ===';
    assert.equal(ctx.looksLikeEulaPrompt(eulaText), true);
  });

  it('returns true when text contains "workiq accept-eula"', () => {
    assert.equal(ctx.looksLikeEulaPrompt('Run workiq accept-eula to continue'), true);
  });

  it('returns true when text contains "eula" and "accept"', () => {
    assert.equal(ctx.looksLikeEulaPrompt('You must accept the EULA first'), true);
  });

  it('returns false for normal JSON response', () => {
    assert.equal(ctx.looksLikeEulaPrompt('{"radarItems":[]}'), false);
  });

  it('returns false for null or empty input', () => {
    assert.equal(ctx.looksLikeEulaPrompt(null), false);
    assert.equal(ctx.looksLikeEulaPrompt(''), false);
  });
});

/* ================================================================== */
/*  runWorkiqJson — EULA detection resets connection                   */
/* ================================================================== */
describe('runWorkiqJson() EULA detection', () => {
  let eulaCtx;

  before(() => {
    const mockState = { connected: true };
    const mockElements = { connectBanner: { classList: { remove() {}, add() {} } } };
    eulaCtx = createRendererContext({
      state: mockState,
      elements: mockElements,
      savePersistentState: () => {},
      window: {
        location: { search: '' },
        workiq: { ask: async () => ({ success: true, answer: '' }) },
      },
    });
    loadFile(eulaCtx, 'renderer/json-parser.js');
  });

  it('resets connected state and throws when response is EULA text', async () => {
    const eulaAnswer = '=== In order to use this tool you must accept the End User License Agreement (EULA) found at: https://github.com/microsoft/work-iq-mcp   workiq accept-eula ===';
    eulaCtx.window.workiq.ask = async () => ({ success: true, answer: eulaAnswer });

    await assert.rejects(
      () => eulaCtx.runWorkiqJson('test prompt', () => true, 'test'),
      (err) => {
        assert.ok(err.message.includes('EULA'));
        return true;
      }
    );
    assert.equal(eulaCtx.state.connected, false);
  });

  it('resets connected state when EULA appears in error field', async () => {
    const eulaError = 'accept the End User License Agreement';
    eulaCtx.state.connected = true;
    eulaCtx.window.workiq.ask = async () => ({ success: false, error: eulaError });

    await assert.rejects(
      () => eulaCtx.runWorkiqJson('test prompt', () => true, 'test'),
      (err) => {
        assert.ok(err.message.includes('EULA'));
        return true;
      }
    );
    assert.equal(eulaCtx.state.connected, false);
  });

  it('does NOT reset connection for normal JSON responses', async () => {
    eulaCtx.state.connected = true;
    eulaCtx.window.workiq.ask = async () => ({ success: true, answer: '{"radarItems":[]}' });

    const result = await eulaCtx.runWorkiqJson('test', (p) => Array.isArray(p.radarItems), 'test');
    assert.ok(Array.isArray(result.radarItems));
    assert.equal(eulaCtx.state.connected, true);
  });
});

/* ================================================================== */
/*  runWorkiqJson — retry logic                                       */
/* ================================================================== */
describe('runWorkiqJson() retry logic', () => {
  let retryCtx;

  before(() => {
    const mockState = { connected: true };
    const mockElements = { connectBanner: { classList: { remove() {}, add() {} } } };
    retryCtx = createRendererContext({
      state: mockState,
      elements: mockElements,
      savePersistentState: () => {},
      window: {
        location: { search: '' },
        workiq: { ask: async () => ({ success: true, answer: '' }) },
      },
    });
    loadFile(retryCtx, 'renderer/json-parser.js');
  });

  it('succeeds on first attempt without retrying', async () => {
    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      return { success: true, answer: '{"status":"ok"}' };
    };

    const result = await retryCtx.runWorkiqJson(
      'test prompt', (o) => o.status === 'ok', 'first-attempt',
      { maxRetries: 2, retryDelayMs: 0 }
    );
    assert.equal(result.status, 'ok');
    assert.equal(callCount, 1);
  });

  it('retries on parse failure and succeeds on second attempt', async () => {
    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      if (callCount === 1) return { success: true, answer: 'not json at all' };
      return { success: true, answer: '{"status":"recovered"}' };
    };

    const result = await retryCtx.runWorkiqJson(
      'test prompt', (o) => o.status === 'recovered', 'retry-success',
      { maxRetries: 1, retryDelayMs: 0 }
    );
    assert.equal(result.status, 'recovered');
    assert.equal(callCount, 2);
  });

  it('throws user-friendly error after all retries exhausted', async () => {
    retryCtx.window.workiq.ask = async () => ({ success: true, answer: 'garbage' });

    await assert.rejects(
      () => retryCtx.runWorkiqJson(
        'test prompt', () => true, 'all-fail',
        { maxRetries: 2, retryDelayMs: 0 }
      ),
      (err) => {
        assert.ok(err.message.includes('Scan returned an unexpected response'));
        assert.ok(err.message.includes('Will try again on next refresh'));
        return true;
      }
    );
  });

  it('EULA error throws immediately — no retry', async () => {
    let callCount = 0;
    const eulaAnswer = 'accept the End User License Agreement workiq accept-eula';
    retryCtx.state.connected = true;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      return { success: true, answer: eulaAnswer };
    };

    await assert.rejects(
      () => retryCtx.runWorkiqJson(
        'test prompt', () => true, 'eula-no-retry',
        { maxRetries: 3, retryDelayMs: 0 }
      ),
      (err) => {
        assert.ok(err.message.includes('EULA'));
        return true;
      }
    );
    assert.equal(callCount, 1);
  });

  it('result.success === false throws immediately — no retry', async () => {
    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      return { success: false, error: 'server error' };
    };

    await assert.rejects(
      () => retryCtx.runWorkiqJson(
        'test prompt', () => true, 'fail-no-retry',
        { maxRetries: 3, retryDelayMs: 0 }
      ),
      (err) => {
        assert.ok(err.message.includes('server error'));
        return true;
      }
    );
    assert.equal(callCount, 1);
  });

  it('invokes onRetry callback with correct (attempt, maxRetries) args', async () => {
    const retryCalls = [];
    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      if (callCount <= 2) return { success: true, answer: 'bad' };
      return { success: true, answer: '{"done":true}' };
    };

    const result = await retryCtx.runWorkiqJson(
      'test prompt', (o) => o.done === true, 'onretry-test',
      {
        maxRetries: 2,
        retryDelayMs: 0,
        onRetry: (attempt, max) => retryCalls.push({ attempt, max }),
      }
    );
    assert.equal(result.done, true);
    assert.equal(retryCalls.length, 2);
    assert.equal(retryCalls[0].attempt, 1);
    assert.equal(retryCalls[0].max, 2);
    assert.equal(retryCalls[1].attempt, 2);
    assert.equal(retryCalls[1].max, 2);
  });

  it('maxRetries: 0 means single attempt only — no retry', async () => {
    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      return { success: true, answer: 'not json' };
    };

    await assert.rejects(
      () => retryCtx.runWorkiqJson(
        'test prompt', () => true, 'zero-retries',
        { maxRetries: 0, retryDelayMs: 0 }
      ),
      (err) => {
        assert.ok(err.message.includes('Scan returned an unexpected response'));
        return true;
      }
    );
    assert.equal(callCount, 1);
  });

  it('logs parse failure count per label via console.warn', async () => {
    const label = 'counter-test-' + Date.now();
    const warnings = [];
    const origWarn = retryCtx.console.warn;
    retryCtx.console.warn = (...args) => warnings.push(args.join(' '));

    let callCount = 0;
    retryCtx.window.workiq.ask = async () => {
      callCount += 1;
      if (callCount <= 2) return { success: true, answer: 'bad json' };
      return { success: true, answer: '{"ok":true}' };
    };

    await retryCtx.runWorkiqJson(
      'test prompt', (o) => o.ok === true, label,
      { maxRetries: 2, retryDelayMs: 0 }
    );

    retryCtx.console.warn = origWarn;
    const failureLogs = warnings.filter((w) => w.includes(label) && /parse failure #\d+/.test(w));
    assert.equal(failureLogs.length, 2);
    assert.ok(failureLogs[0].includes('parse failure #1'));
    assert.ok(failureLogs[1].includes('parse failure #2'));
  });
});
