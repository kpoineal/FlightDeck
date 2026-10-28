'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  export function savePersistentState() {}
`)}`;
const actionsStub = `data:text/javascript,${encodeURIComponent(`
  export function addHistory() {}
`)}`;
const toastStub = `data:text/javascript,${encodeURIComponent(`
  export function showToast() {}
`)}`;
const jsonParserStub = `data:text/javascript,${encodeURIComponent(`
  export async function runWorkiqJson(prompt) {
    const transport = globalThis.__scannerDedupTransport;
    return typeof transport === 'function' ? transport(prompt) : { radarItems: [] };
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentIsScannerEngine = context.parentURL?.endsWith('/src/svelte/lib/scanner-engine.js');
    if (parentIsScannerEngine && specifier === './persistence.js') {
      return { url: persistenceStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === './actions.js') {
      return { url: actionsStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === './json-parser.js') {
      return { url: jsonParserStub, shortCircuit: true };
    }
    if (parentIsScannerEngine && specifier === '../components/Toast.svelte') {
      return { url: toastStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let get;
let engine;
let coldItems;
let items;
let scanners;
let deletedItemIds;
let normalizeItem;
let deriveStableItemId;
let collectItemSourceIdentities;

function makeScanner(overrides = {}) {
  return {
    id: 'scanner-dedup',
    name: 'Dedup test scanner',
    enabled: true,
    prompt: 'Find current commitments.',
    lastRunAt: '2026-09-08T12:00:00.000Z',
    scheduleType: 'interval',
    scheduleValue: '2h',
    workHoursOnly: false,
    maxItemsPerScan: 10,
    recentTitles: [],
    excludedItemIds: [],
    crossScannerDedup: true,
    ...overrides,
  };
}

const sharedEvidence = {
  label: 'Approval email',
  type: 'email',
  url: 'https://outlook.office.com/mail/deeplink/read/approval-42',
  signalAt: '2026-09-10T10:00:00.000Z',
};

test.before(async () => {
  ({ get } = await import('svelte/store'));
  ({ coldItems, deletedItemIds, items, scanners } = await import('../src/svelte/lib/stores.js'));
  engine = await import('../src/svelte/lib/scanner-engine.js');
  ({ collectItemSourceIdentities, deriveStableItemId, normalizeItem } = await import('../src/svelte/lib/models/item.js'));
});

test.beforeEach(() => {
  globalThis.window = { workiq: { showDesktopNotification: async () => {} } };
  globalThis.__scannerDedupTransport = null;
  coldItems.set([]);
  deletedItemIds.set([]);
  items.set([]);
  scanners.set([]);
});

test.afterEach(() => {
  engine.stopScannerEngine();
  delete globalThis.window;
  delete globalThis.__scannerDedupTransport;
  coldItems.set([]);
  deletedItemIds.set([]);
  items.set([]);
  scanners.set([]);
});

test('source-backed IDs are deterministic while title-only identity stays unavailable', () => {
  const sourceItem = {
    title: 'Approve launch brief',
    scannerId: 'scanner-dedup',
    evidenceLinks: [sharedEvidence],
  };
  const firstSourceId = deriveStableItemId(sourceItem, 'scanner-dedup');
  const secondSourceId = deriveStableItemId(sourceItem, 'scanner-dedup');
  assert.equal(firstSourceId, secondSourceId);
  assert.match(firstSourceId, /^radar_[0-9a-f]{8}$/);

  const titleItem = { title: 'Approve launch brief' };
  assert.equal(deriveStableItemId(titleItem, 'scanner-dedup'), null);
  assert.match(normalizeItem({ ...titleItem, scannerId: 'scanner-dedup' }).id, /^custom_[0-9a-f]{8}$/);
  assert.equal(normalizeItem({ ...titleItem, id: 'model-provided-id' }).id, 'model-provided-id');
});

test('unqualified opaque fields are ignored and qualified IDs preserve provider context', () => {
  assert.deepEqual(collectItemSourceIdentities({ sourceId: 'ABC-123' }), []);
  assert.deepEqual(collectItemSourceIdentities({ sourceId: 'ABC-123', sourceType: 'Email' }), []);

  const outlookIdentity = collectItemSourceIdentities({
    provider: 'Outlook',
    sourceType: 'Email',
    messageId: 'ABC-123',
  });
  const outlookCaseVariant = collectItemSourceIdentities({
    provider: 'Outlook',
    sourceType: 'Email',
    messageId: 'abc-123',
  });
  const teamsIdentity = collectItemSourceIdentities({
    provider: 'Teams',
    sourceType: 'Chat',
    messageId: 'ABC-123',
  });

  assert.equal(outlookIdentity.length, 1);
  assert.match(outlookIdentity[0], /ABC-123/);
  assert.notDeepEqual(outlookIdentity, outlookCaseVariant);
  assert.notDeepEqual(outlookIdentity, teamsIdentity);
});

test('malformed stored source identities are ignored', () => {
  const validIdentity = 'source:v1:provider%3Doutlook%3Btype%3Demail:messageId:ABC-123';
  const identities = collectItemSourceIdentities({
    sourceIdentities: [
      validIdentity,
      'source:v1:type%3Demail:messageId:ABC-123',
      'source:v1:provider%3Doutlook:unknownField:ABC-123',
      'source:v1:provider%3Doutlook:messageId',
      'source:v1:provider%3Doutlook:messageId:ABC-123:extra',
      'source:v1:provider%3Doutlook%3Bgarbage:messageId:ABC-123',
    ],
  });

  assert.deepEqual(identities, [validIdentity]);
});

test('persisted source identities remain canonical across normalization round trips', () => {
  const persisted = normalizeItem({
    id: 'approval-42',
    provider: 'Outlook',
    sourceType: 'Email',
    messageId: 'ABC-123',
    title: 'Approve launch brief',
  });
  const expectedIdentity = 'source:v1:provider%3Doutlook%3Btype%3Demail:messageId:ABC-123';

  assert.deepEqual(persisted.sourceIdentities, [expectedIdentity]);
  const roundTripped = normalizeItem(JSON.parse(JSON.stringify(persisted)));
  assert.deepEqual(roundTripped.sourceIdentities, [expectedIdentity]);

  const malformed = normalizeItem({
    id: 'malformed',
    title: 'Malformed identity',
    sourceIdentities: [
      'source:v1:type%3Demail:messageId:ABC-123',
      'source:v1:provider%3Doutlook:messageId',
    ],
  });
  assert.deepEqual(malformed.sourceIdentities, []);
});

test('scanner hydrates cold items before accepting a matching source', async () => {
  const scanner = makeScanner();
  const cold = normalizeItem({
    id: 'cold-approval',
    scannerId: 'scanner-archive',
    title: 'Archived approval',
    lifecycleStatus: 'archived',
    evidenceLinks: [sharedEvidence],
  });
  scanners.set([scanner]);
  globalThis.window.workiq.getColdItems = async () => [cold];
  globalThis.__scannerDedupTransport = async () => ({
    radarItems: [{
      id: 'new-model-id',
      title: 'Approval from another view',
      evidenceLinks: [sharedEvidence],
    }],
  });

  await engine.runScanner(scanner);

  assert.deepEqual(get(coldItems).map((item) => item.id), ['cold-approval']);
  assert.deepEqual(get(items), []);
});

test('same-response candidates sharing verified evidence produce one item', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerDedupTransport = async () => ({
    radarItems: [
      { id: 'model-id-a', title: 'Approve launch brief', evidenceLinks: [sharedEvidence] },
      { id: 'model-id-b', title: 'Launch brief approval', evidenceLinks: [sharedEvidence] },
    ],
  });

  await engine.runScanner(scanner);

  assert.deepEqual(get(items).map((item) => item.id), ['model-id-a']);
  assert.deepEqual(get(items)[0].sourceIdentities, [
    'url:https://outlook.office.com/mail/deeplink/read/approval-42',
  ]);
});

test('same-title candidates with different evidence remain separate', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerDedupTransport = async () => ({
    radarItems: [
      {
        id: 'model-id-a',
        title: 'Waiting for customer approval',
        evidenceLinks: [{ ...sharedEvidence, url: 'https://outlook.office.com/mail/deeplink/read/approval-43' }],
      },
      {
        id: 'model-id-b',
        title: 'Waiting for customer approval',
        evidenceLinks: [{ ...sharedEvidence, url: 'https://outlook.office.com/mail/deeplink/read/approval-44' }],
      },
    ],
  });

  await engine.runScanner(scanner);

  assert.deepEqual(get(items).map((item) => item.id), ['model-id-a', 'model-id-b']);
});

test('same-response title-only candidates remain separate without verified evidence', async () => {
  const scanner = makeScanner();
  scanners.set([scanner]);
  globalThis.__scannerDedupTransport = async () => ({
    radarItems: [
      { id: 'model-id-a', title: 'Waiting for customer approval' },
      { id: 'model-id-b', title: 'Waiting for customer approval' },
    ],
  });

  await engine.runScanner(scanner);

  assert.deepEqual(get(items).map((item) => item.id), ['model-id-a', 'model-id-b']);
});

test('cross-scanner source dedup follows the scanner setting', async () => {
  const existing = normalizeItem({
    id: 'other-scanner-item',
    scannerId: 'other-scanner',
    title: 'Existing approval item',
    evidenceLinks: [sharedEvidence],
  });
  items.set([existing]);

  const enabledScanner = makeScanner({ crossScannerDedup: true });
  scanners.set([enabledScanner]);
  globalThis.__scannerDedupTransport = async () => ({
    radarItems: [{ id: 'new-model-id', title: 'Approval from another view', evidenceLinks: [sharedEvidence] }],
  });
  await engine.runScanner(enabledScanner);
  assert.deepEqual(get(items).map((item) => item.id), ['other-scanner-item']);

  items.set([existing]);
  const disabledScanner = makeScanner({ crossScannerDedup: false });
  scanners.set([disabledScanner]);
  await engine.runScanner(disabledScanner);
  assert.deepEqual(get(items).map((item) => item.id), ['new-model-id', 'other-scanner-item']);
});