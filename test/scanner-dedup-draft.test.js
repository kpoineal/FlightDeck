'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerHooks } = require('node:module');

const fixtureStub = 'data:text/javascript,export default {}';
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
  export async function runWorkiqJson() {
    return globalThis.__scannerDedupPayloads?.shift() || { radarItems: [] };
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (specifier === '../../demo/fixture.json' && parent.endsWith('/src/svelte/lib/persistence.js')) {
      return { url: fixtureStub, shortCircuit: true };
    }
    if (parent.endsWith('/src/svelte/lib/scanner-engine.js')) {
      if (specifier === './persistence.js') return { url: persistenceStub, shortCircuit: true };
      if (specifier === './actions.js') return { url: actionsStub, shortCircuit: true };
      if (specifier === './json-parser.js') return { url: jsonParserStub, shortCircuit: true };
      if (specifier === '../components/Toast.svelte') return { url: toastStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let actionProposals;
let get;
let items;
let loadPersistentState;
let savePersistentState;
let scanners;
let scannerEngine;

function makeScanner(overrides = {}) {
  return {
    id: 'scanner-a',
    name: 'Launch radar',
    enabled: true,
    scheduleType: 'interval',
    scheduleValue: '4h',
    maxItemsPerScan: 10,
    recentTitles: [],
    excludedItemIds: [],
    crossScannerDedup: true,
    dedupStrategy: 'both',
    autoMonitorNewItems: false,
    ...overrides,
  };
}

function evidence(url, label = 'Source signal') {
  return [{ label, type: 'chat', url }];
}

async function scan(scannerId, payload) {
  globalThis.__scannerDedupPayloads.push(payload);
  const scanner = get(scanners).find((entry) => entry.id === scannerId);
  assert.ok(scanner, `scanner ${scannerId} must exist`);
  return scannerEngine.runScanner(scanner);
}

function validPersistedDraft(overrides = {}) {
  return {
    id: 'proposal-a',
    sourceItemId: 'thread-a',
    sourceTitle: 'Follow up with Sofia',
    sourceType: 'Email',
    sourceDestination: 'Radar',
    sourceContextId: 'thread-a',
    channel: 'outlook-draft',
    target: 'sofia@example.com',
    content: 'Can you confirm the deployment window?',
    reason: 'The deployment window is still open.',
    evidence: ['Deployment thread'],
    risk: 'Human review is required before any external action.',
    provenance: 'Test fixture',
    state: 'Drafted',
    outcome: null,
    executionVerification: null,
    executionCode: null,
    dispatchStatus: 'not-started',
    archivedAt: null,
    archivedReason: null,
    createdAt: '2026-09-11T10:00:00.000Z',
    updatedAt: '2026-09-11T10:00:00.000Z',
    localOnly: true,
    ...overrides,
  };
}

test.before(async () => {
  ({ get } = await import('svelte/store'));
  ({ actionProposals, items, scanners } = await import('../src/svelte/lib/stores.js'));
  scannerEngine = await import('../src/svelte/lib/scanner-engine.js');
  ({ loadPersistentState, savePersistentState } = await import('../src/svelte/lib/persistence.js'));
});

test.beforeEach(() => {
  globalThis.__scannerDedupPayloads = [];
  globalThis.window = {
    workiq: {
      storeGet: async () => structuredClone(globalThis.__scannerPersistedState || {}),
      storeSet: async (_key, payload) => {
        globalThis.__scannerPersistedState = structuredClone(payload);
        return { success: true };
      },
      storeDelete: async () => ({ success: true }),
      readPromptFile: async () => ({ success: false }),
      getColdItems: async () => [],
      setColdItems: async () => ({ success: true }),
      broadcastStateChanged: () => {},
    },
  };
  globalThis.__scannerPersistedState = {};
  actionProposals.set([]);
  items.set([]);
  scanners.set([]);
});

test.afterEach(() => {
  delete globalThis.__scannerDedupPayloads;
  delete globalThis.__scannerPersistedState;
  delete globalThis.window;
  actionProposals.set([]);
  items.set([]);
  scanners.set([]);
});

test('same evidence identity with different model ids and titles is accepted only once', async () => {
  const sharedEvidence = 'https://teams.microsoft.com/l/message/shared-source';
  scanners.set([makeScanner()]);

  await scan('scanner-a', {
    radarItems: [{
      id: 'model-id-a',
      title: 'Launch approval is waiting',
      evidenceLinks: evidence(sharedEvidence, 'Approval request'),
    }],
  });
  await scan('scanner-a', {
    radarItems: [{
      id: 'model-id-b',
      title: 'Approval request still needs an owner',
      evidenceLinks: evidence(sharedEvidence, 'Same approval request'),
    }],
  });

  assert.equal(get(items).length, 1);
  assert.equal(get(items)[0].id, 'model-id-a');
});

test('equivalent candidates in one scanner response collapse to one accepted item', async () => {
  const sharedEvidence = 'https://outlook.office.com/mail/deeplink/read/shared-source';
  scanners.set([makeScanner()]);

  await scan('scanner-a', {
    radarItems: [
      { id: 'candidate-a', title: 'Confirm the launch window', evidenceLinks: evidence(sharedEvidence) },
      { id: 'candidate-b', title: 'Launch window confirmation', evidenceLinks: evidence(sharedEvidence) },
    ],
  });

  assert.equal(get(items).length, 1);
  assert.equal(get(items)[0].id, 'candidate-a');
});

test('missing model ids receive a deterministic fallback identity across runs', async () => {
  const payload = {
    radarItems: [{
      title: 'Stable source without a model id',
      summary: 'The source identity is available from the evidence link.',
      evidenceLinks: evidence('https://contoso.sharepoint.com/sites/launch/shared-plan'),
    }],
  };

  scanners.set([makeScanner()]);
  await scan('scanner-a', payload);
  const firstId = get(items)[0].id;

  await new Promise((resolve) => setTimeout(resolve, 25));
  items.set([]);
  scanners.set([makeScanner()]);
  await scan('scanner-a', payload);
  const secondId = get(items)[0].id;

  assert.equal(secondId, firstId);
});

test('cross-scanner dedup is explicit and does not fuzzy-merge different sources', async () => {
  const sharedEvidence = 'https://teams.microsoft.com/l/message/cross-scanner-source';
  scanners.set([
    makeScanner({ id: 'scanner-a', crossScannerDedup: false }),
    makeScanner({ id: 'scanner-b', name: 'Customer radar', crossScannerDedup: false }),
  ]);

  await scan('scanner-a', {
    radarItems: [{ id: 'scanner-a-item', title: 'Customer launch blocker', evidenceLinks: evidence(sharedEvidence) }],
  });
  await scan('scanner-b', {
    radarItems: [{ id: 'scanner-b-item', title: 'Launch blocker needs follow-up', evidenceLinks: evidence(sharedEvidence) }],
  });
  assert.equal(get(items).length, 2);

  items.set([]);
  scanners.set([
    makeScanner({ id: 'scanner-a', crossScannerDedup: true }),
    makeScanner({ id: 'scanner-b', name: 'Customer radar', crossScannerDedup: true }),
  ]);
  await scan('scanner-a', {
    radarItems: [{ id: 'cross-enabled-a', title: 'Customer launch blocker', evidenceLinks: evidence(sharedEvidence) }],
  });
  await scan('scanner-b', {
    radarItems: [{ id: 'cross-enabled-b', title: 'Launch blocker needs follow-up', evidenceLinks: evidence(sharedEvidence) }],
  });
  assert.equal(get(items).length, 1);

  items.set([]);
  scanners.set([
    makeScanner({ id: 'scanner-a', crossScannerDedup: true }),
    makeScanner({ id: 'scanner-b', name: 'Customer radar', crossScannerDedup: true }),
  ]);
  await scan('scanner-a', {
    radarItems: [{
      id: 'different-source-a',
      title: 'Customer launch blocker',
      evidenceLinks: evidence('https://teams.microsoft.com/l/message/different-source-a'),
    }],
  });
  await scan('scanner-b', {
    radarItems: [{
      id: 'different-source-b',
      title: 'Customer launch blocker follow-up',
      evidenceLinks: evidence('https://teams.microsoft.com/l/message/different-source-b'),
    }],
  });
  assert.equal(get(items).length, 2);
});

test('persisted drafts retain thread ownership and only match their originating thread', async () => {
  const draftA = validPersistedDraft();
  const draftB = validPersistedDraft({
    id: 'proposal-b',
    sourceItemId: 'thread-b',
    sourceContextId: 'thread-b',
    sourceTitle: 'Follow up with Alex',
    target: 'alex@example.com',
  });
  globalThis.__scannerPersistedState = { items: [], scanners: [], actionProposals: [draftA, draftB] };

  await loadPersistentState();
  assert.deepEqual(
    get(actionProposals).filter((proposal) => proposal.sourceItemId === 'thread-a').map((proposal) => proposal.id),
    ['proposal-a']
  );
  assert.deepEqual(
    get(actionProposals).filter((proposal) => proposal.sourceItemId === 'thread-b').map((proposal) => proposal.id),
    ['proposal-b']
  );

  await savePersistentState();
  assert.deepEqual(globalThis.__scannerPersistedState.actionProposals.map((proposal) => proposal.sourceItemId), [
    'thread-a',
    'thread-b',
  ]);
});

test('proposal identity is thread-scoped even when draft content is identical', async () => {
  const { proposalDedupeKey } = await import('../src/svelte/lib/proposal-synthesis.js');
  const proposal = {
    channel: 'email',
    target: { address: 'sofia@example.com' },
    payload: { subject: 'Follow up', body: 'Can you confirm?' },
  };

  assert.notEqual(proposalDedupeKey('thread-a', proposal), proposalDedupeKey('thread-b', proposal));
});

test('Radar does not render an in-memory draft outside its owning selected thread', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/svelte/components/RadarView.svelte'), 'utf8');
  assert.match(source, /\{#if teamsDraft(?:\s*&&\s*teamsDraft)?\.sourceItemId\s*===\s*selected\.id\}/);
  assert.match(source, /sourceItemId:\s*sourceItem\.id/);
});