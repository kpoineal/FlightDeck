const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && new URL(context.parentURL).pathname.endsWith('/lib/briefings.js')) {
      const stubs = {
        './persistence.js': 'export function savePersistentState() { globalThis.__briefingSaves++; }',
        './actions.js': 'export function addHistory(...args) { globalThis.__briefingHistory.push(args); }',
        './json-parser.js': 'export async function runWorkiqJson(...args) { return globalThis.__briefingQuery(...args); }',
      };
      if (stubs[specifier]) return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

let stores;
let get;
let subject;
let connection;
let calls;
let normalizeTodayMeetings;
const now = new Date(2026, 10, 11, 13).getTime();
const at = (offset, hour, minute = 0) => new Date(2026, 10, 11 + offset, hour, minute).toISOString();
const meeting = (id, offset, hour, endHour = hour + 1) => ({
  id, title: id, startAt: at(offset, hour), endAt: at(offset, endHour),
});

test.before(async () => {
  ({ get } = await import('svelte/store'));
  stores = await import('../src/svelte/lib/stores.js');
  connection = await import('../src/svelte/lib/connection.js');
  ({ normalizeTodayMeetings } = await import('../src/svelte/lib/meetings.js'));
});

test.beforeEach(async (context) => {
  // The orchestration uses local calendar dates as well as epoch timestamps.
  context.mock.timers.enable({ apis: ['Date'], now });
  calls = [];
  globalThis.__briefingSaves = 0;
  globalThis.__briefingHistory = [];
  globalThis.__briefingQuery = async (...args) => {
    calls.push(args);
    return args[2] === 'meetings'
      ? { meetings: [meeting('Earlier', 0, 9), meeting('Later', 0, 15)] }
      : { headline: 'Your day', generatedAt: at(-1, 9) };
  };
  global.window = { workiq: {
    ask() {},
    readPromptFile: async () => ({ success: true, content: 'Custom day instructions' }),
  } };
  stores.connected.set(true);
  stores.isDemo.set(false);
  stores.meetings.set([]);
  stores.meetingsLastFetched.set(0);
  stores.briefingsByMeetingId.set({});
  stores.dayBriefingGenerating.set(false);
  stores.dayBriefingError.set('');
  stores.items.set([]);
  subject = await import(`../src/svelte/lib/briefings.js?case=${context.name}`);
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('full-day filtering retains earlier, ended, ongoing, upcoming and overlapping meetings', () => {
  const raw = [
    meeting('Tomorrow', 1, 9), meeting('Later', 0, 15), meeting('Ended', 0, 9),
    meeting('Ongoing', 0, 12, 14), meeting('Yesterday', -1, 9),
    { ...meeting('Overnight', -1, 23), endAt: at(0, 1) },
    { ...meeting('Ends-at-midnight', -1, 23), endAt: at(0, 0) },
    meeting('Midnight', 0, 0), { id: 'Invalid', startAt: 'bad-date' },
  ];
  assert.deepEqual(normalizeTodayMeetings(raw, now).map(m => m.id),
    ['Overnight', 'Midnight', 'Ended', 'Ongoing', 'Later']);
  assert.equal(normalizeTodayMeetings([{ title: 'No ID', startAt: at(0, 9), joinUrl: 'javascript:bad' }], now)[0].joinUrl, null);
});

test('calendar normalization preserves opaque meeting IDs across fetch, view and reload', () => {
  const source = meeting('mtg_q3_planning', 0, 9);
  const fetched = normalizeTodayMeetings([source], now);
  const restored = normalizeTodayMeetings(fetched, now);
  assert.equal(restored[0].id, source.id);
  assert.deepEqual(restored, fetched);
});

test('calendar loads before one automatic day briefing and both are persisted', async () => {
  await subject.refreshMeetings();
  await settle();
  assert.deepEqual(calls.map(call => call[2]), ['meetings', 'day-briefing']);
  assert.match(calls[0][0], /already ended today/);
  assert.match(calls[1][0], /Custom day instructions/);
  assert.match(calls[1][0], /Earlier at/);
  assert.match(calls[1][0], /Later at/);
  assert.equal(calls[1][3].priority, 'background');
  assert.equal(get(stores.dayBriefingGenerating), false);
  assert.equal(get(stores.briefingsByMeetingId).__day_briefing__.generatedAt, new Date(now).toISOString());
  assert.equal(globalThis.__briefingSaves, 2);
  await subject.refreshMeetings();
  await subject.refreshMeetings(true);
  await settle();
  assert.deepEqual(calls.map(call => call[2]), ['meetings', 'day-briefing', 'meetings']);
});

test('an empty same-day calendar is cached and still generates My Day', async () => {
  globalThis.__briefingQuery = async (...args) => {
    calls.push(args);
    return args[2] === 'meetings' ? { meetings: [] } : { headline: 'A quiet day' };
  };
  await subject.refreshMeetings();
  await settle();
  await subject.refreshMeetings();
  assert.deepEqual(calls.map(call => call[2]), ['meetings', 'day-briefing']);
  assert.equal(get(stores.briefingsByMeetingId).__day_briefing__.headline, 'A quiet day');
});

test('a saved day briefing prevents regeneration across a new module session', async () => {
  const saved = { headline: 'Saved today', generatedAt: at(0, 8) };
  stores.briefingsByMeetingId.set({ __day_briefing__: saved });
  stores.meetingsLastFetched.set(now);
  await subject.refreshMeetings();
  await settle();
  assert.equal(calls.length, 0);
  assert.deepEqual(get(stores.briefingsByMeetingId).__day_briefing__, saved);
});

test('yesterday calendar and briefing are refreshed even inside the hour cache window', async (context) => {
  context.mock.timers.setTime(new Date(2026, 10, 11, 0, 15).getTime());
  stores.meetingsLastFetched.set(new Date(2026, 10, 10, 23, 45).getTime());
  stores.briefingsByMeetingId.set({ __day_briefing__: { headline: 'Yesterday', generatedAt: at(-1, 8) } });
  await subject.refreshMeetings();
  await settle();
  assert.deepEqual(calls.map(call => call[2]), ['meetings', 'day-briefing']);
  assert.equal(get(stores.briefingsByMeetingId).__day_briefing__.headline, 'Your day');
});

test('automatic failure is visible, does not loop, and manual retry succeeds', async () => {
  stores.meetingsLastFetched.set(now);
  globalThis.__briefingQuery = async (...args) => {
    calls.push(args);
    throw new Error('WorkIQ timed out');
  };
  await subject.generateDayBriefing({ automatic: true });
  assert.match(get(stores.dayBriefingError), /WorkIQ timed out/);
  assert.equal(get(stores.dayBriefingGenerating), false);
  await subject.refreshMeetings();
  await subject.generateDayBriefing({ automatic: true });
  assert.equal(calls.length, 1);
  globalThis.__briefingQuery = async (...args) => { calls.push(args); return { headline: 'Retry worked' }; };
  await subject.generateDayBriefing();
  assert.equal(calls[1][3].priority, 'interactive');
  assert.equal(get(stores.dayBriefingError), '');
  assert.equal(get(stores.briefingsByMeetingId).__day_briefing__.headline, 'Retry worked');
});

test('simultaneous refreshes and manual generation do not duplicate requests', async () => {
  let release;
  globalThis.__briefingQuery = (...args) => {
    calls.push(args);
    return new Promise(resolve => { release = resolve; });
  };
  const first = subject.refreshMeetings();
  const second = subject.refreshMeetings(true);
  assert.equal(calls.length, 1);
  release({ meetings: [] });
  await Promise.all([first, second]);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(get(stores.dayBriefingGenerating), true);
  await subject.generateDayBriefing();
  assert.equal(calls.length, 2);
  release({ headline: 'One day briefing' });
  await settle();
  assert.equal(get(stores.dayBriefingGenerating), false);
});

test('late calendar responses after disconnect never replace saved meetings', async () => {
  let release;
  globalThis.__briefingQuery = () => new Promise(resolve => { release = resolve; });
  stores.meetings.set([meeting('Keep saved calendar', 0, 9)]);
  const pending = subject.refreshMeetings();
  connection.applyConnectionStatus({ status: 'disconnected' });
  release({ meetings: [] });
  await pending;
  assert.equal(get(stores.meetings)[0].id, 'Keep saved calendar');
  assert.equal(globalThis.__briefingSaves, 0);
});

test('a reconnect starts a new calendar read without waiting for an obsolete request', async () => {
  const pendingReads = [];
  globalThis.__briefingQuery = (prompt, validator, label) => label === 'meetings'
    ? new Promise(resolve => pendingReads.push(resolve)) : Promise.resolve({ headline: 'New session' });
  const old = subject.refreshMeetings();
  connection.applyConnectionStatus({ status: 'disconnected' });
  connection.applyConnectionStatus({ status: 'ready' });
  const fresh = subject.refreshMeetings();
  assert.equal(pendingReads.length, 2);
  pendingReads[1]({ meetings: [meeting('Fresh session', 0, 15)] });
  await fresh;
  pendingReads[0]({ meetings: [meeting('Obsolete session', 0, 9)] });
  await old;
  assert.equal(get(stores.meetings)[0].id, 'Fresh session');
});

test('a new local day refreshes the calendar and generates exactly one new overview', async (context) => {
  await subject.refreshMeetings();
  await settle();
  context.mock.timers.setTime(new Date(2026, 10, 12, 9).getTime());
  await subject.refreshMeetings();
  await settle();
  await subject.refreshMeetings();
  assert.deepEqual(calls.map(call => call[2]), ['meetings', 'day-briefing', 'meetings', 'day-briefing']);
});

test('a briefing finishing after midnight is not saved as the next day overview', async (context) => {
  let release;
  globalThis.__briefingQuery = () => new Promise(resolve => { release = resolve; });
  const pending = subject.generateDayBriefing();
  await settle();
  context.mock.timers.setTime(new Date(2026, 10, 12, 0, 1).getTime());
  release({ headline: 'Yesterday request' });
  await pending;
  assert.deepEqual(get(stores.briefingsByMeetingId), {});
});

test('missing prompt files are recorded and the built-in day prompt still works', async () => {
  window.workiq.readPromptFile = async () => ({ success: false, error: 'Missing file' });
  await subject.generateDayBriefing();
  assert.match(calls[0][0], /grounded Microsoft 365 context/);
  assert.match(calls[0][0], /never infer outcomes merely because time has passed/);
  assert.ok(globalThis.__briefingHistory.some(entry => /Missing file/.test(entry[1])));
});

test('failed manual regeneration preserves an existing day briefing', async () => {
  const saved = { headline: 'Keep existing summary', generatedAt: at(0, 8) };
  stores.briefingsByMeetingId.set({ __day_briefing__: saved });
  globalThis.__briefingQuery = async () => { throw new Error('Try later'); };
  await subject.generateDayBriefing();
  assert.deepEqual(get(stores.briefingsByMeetingId).__day_briefing__, saved);
  assert.match(get(stores.dayBriefingError), /Try later/);
});

test('late day briefings after disconnect/reconnect are discarded', async () => {
  let release;
  globalThis.__briefingQuery = () => new Promise(resolve => { release = resolve; });
  const pending = subject.generateDayBriefing();
  await settle();
  connection.applyConnectionStatus({ status: 'disconnected' });
  connection.applyConnectionStatus({ status: 'ready' });
  release({ headline: 'Stale result' });
  await pending;
  assert.deepEqual(get(stores.briefingsByMeetingId), {});
  assert.equal(get(stores.dayBriefingGenerating), false);
});

test('failed calendar refresh keeps the cache and does not generate a misleading empty day', async () => {
  const saved = [meeting('Keep saved meeting', 0, 9)];
  stores.meetings.set(saved);
  globalThis.__briefingQuery = async () => { throw new Error('Calendar unavailable'); };
  await subject.refreshMeetings();
  assert.deepEqual(get(stores.meetings), saved);
  assert.equal(get(stores.meetingsLastFetched), 0);
  assert.deepEqual(get(stores.briefingsByMeetingId), {});
  assert.ok(globalThis.__briefingHistory.some(entry => /Meetings refresh failed/.test(entry[1])));
});

test('demo and disconnected sessions never request live calendar or briefing data', async () => {
  stores.isDemo.set(true);
  await subject.refreshMeetings();
  await subject.generateDayBriefing();
  stores.isDemo.set(false);
  stores.connected.set(false);
  await subject.refreshMeetings();
  await subject.generateDayBriefing();
  assert.equal(calls.length, 0);
});
