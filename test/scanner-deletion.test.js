'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

const persistenceStub = `data:text/javascript,${encodeURIComponent(`
  function isAcceptedPersistenceReceipt(receipt) {
    if (receipt === true) return true;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    if (Object.getPrototypeOf(receipt) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(receipt);
    if (keys.length !== 1 || keys[0] !== 'success') return false;
    const descriptor = Object.getOwnPropertyDescriptor(receipt, 'success');
    return descriptor !== undefined
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && descriptor.value === true
      && descriptor.writable === true
      && descriptor.enumerable === true
      && descriptor.configurable === true;
  }

  export { isAcceptedPersistenceReceipt };
  export function pruneHistory() {}
  export function savePersistentState() {}

  export async function runPersistentStateTransaction({ mutate, rollback, persistExternal, rollbackExternal }) {
    if (globalThis.__scannerTransactionMode === 'busy') return { ok: false, code: 'BUSY' };

    mutate();
    let externalAttempted = false;
    let canonicalAttempted = false;
    let result = { ok: true };

    if (persistExternal) {
      externalAttempted = true;
      try {
        if (await persistExternal() !== true) result = { ok: false, code: 'PERSISTENCE_FAILED' };
      } catch (_) {
        result = { ok: false, code: 'PERSISTENCE_FAILED' };
      }
    }

    if (result.ok) {
      canonicalAttempted = true;
      globalThis.__scannerCanonicalWrites += 1;
      globalThis.__scannerCanonicalCapture?.();
      if (globalThis.__scannerCanonicalGate) await globalThis.__scannerCanonicalGate;
      const receipt = globalThis.__scannerCanonicalReceipts.length
        ? globalThis.__scannerCanonicalReceipts.shift()
        : { success: true };
      if (!isAcceptedPersistenceReceipt(receipt)) result = { ok: false, code: 'PERSISTENCE_FAILED' };
    }

    if (!result.ok) {
      let restored = rollback() !== false;
      if (restored && externalAttempted) {
        restored = Boolean(rollbackExternal) && await rollbackExternal() === true;
      }
      if (restored && canonicalAttempted) {
        globalThis.__scannerCanonicalWrites += 1;
        const rollbackReceipt = globalThis.__scannerCanonicalReceipts.length
          ? globalThis.__scannerCanonicalReceipts.shift()
          : { success: true };
        restored = isAcceptedPersistenceReceipt(rollbackReceipt);
      }
      if (!restored) return { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' };
    }

    return result;
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './persistence.js' && context.parentURL?.includes('/src/svelte/lib/')) {
      return { url: persistenceStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let actionProposals;
let activeOperations;
let coldItems;
let deletedItemIds;
let executeScannerDeletion;
let get;
let highlightedItemId;
let history;
let items;
let previewScannerDeletion;
let scanners;
let selectedProposalId;

function scanner(overrides = {}) {
  return {
    id: 'scanner-1',
    name: 'Launch radar',
    enabled: true,
    scheduleType: 'interval',
    scheduleValue: '4h',
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    id: 'hot-1',
    scannerId: 'scanner-1',
    title: 'Review launch plan',
    lifecycleStatus: 'in-progress',
    monitorEnabled: true,
    updateHistory: [],
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'proposal-no-effect',
    sourceItemId: 'hot-1',
    channel: 'outlook-draft',
    state: 'Drafted',
    dispatchStatus: 'not-started',
    executionVerification: null,
    executionCode: null,
    ...overrides,
  };
}

function globalEvent(overrides = {}) {
  return {
    id: 'event-admin',
    eventId: 'event-admin',
    at: '2026-09-08T15:00:00Z',
    kind: 'action',
    payload: {
      proposalId: 'proposal-no-effect',
      event: 'proposal-created',
    },
    ...overrides,
  };
}

function seedAffectedState() {
  const hot = card({
    id: 'hot-1',
    lifecycleStatus: 'blocked',
    updateHistory: [{
      eventId: 'receipt-confirmed',
      proposalId: 'proposal-confirmed',
      event: 'succeeded',
      channel: 'outlook-draft',
      verification: 'runtime-backend-confirmed',
      code: 'DRAFT_SAVED',
    }],
  });
  const duplicate = card({ id: 'shared-1', title: 'Shared storage record', monitorEnabled: false });
  const cold = card({
    id: 'cold-1',
    title: 'Archived launch evidence',
    lifecycleStatus: 'archived',
    monitorEnabled: false,
    updateHistory: [{
      eventId: 'receipt-uncertain',
      proposalId: 'proposal-uncertain',
      event: 'execution-started',
      channel: 'teams',
      verification: 'unverified',
      code: 'ACTION_UNCONFIRMED',
    }],
  });
  const unrelatedHot = card({ id: 'other-hot', scannerId: 'scanner-2', title: 'Unrelated hot item' });
  const unrelatedCold = card({
    id: 'other-cold',
    scannerId: 'scanner-2',
    title: 'Unrelated cold item',
    lifecycleStatus: 'archived',
  });

  scanners.set([scanner(), scanner({ id: 'scanner-2', name: 'Customer radar' })]);
  items.set([hot, duplicate, unrelatedHot]);
  coldItems.set([cold, duplicate, unrelatedCold]);
  actionProposals.set([
    proposal(),
    proposal({
      id: 'proposal-confirmed',
      sourceItemId: 'hot-1',
      state: 'Succeeded',
      dispatchStatus: 'dispatched',
      executionVerification: 'runtime-backend-confirmed',
      executionCode: 'DRAFT_SAVED',
    }),
    proposal({
      id: 'proposal-uncertain',
      sourceItemId: 'cold-1',
      channel: 'teams',
      state: 'Executing',
      dispatchStatus: 'dispatched',
    }),
    proposal({ id: 'proposal-other', sourceItemId: 'other-hot' }),
  ]);
  history.set([
    globalEvent(),
    globalEvent({
      id: 'receipt-confirmed',
      eventId: 'receipt-confirmed',
      payload: {
        proposalId: 'proposal-confirmed',
        event: 'succeeded',
        channel: 'outlook-draft',
        verification: 'runtime-backend-confirmed',
        code: 'DRAFT_SAVED',
      },
    }),
    globalEvent({
      id: 'receipt-uncertain',
      eventId: 'receipt-uncertain',
      payload: {
        proposalId: 'proposal-uncertain',
        event: 'execution-started',
        channel: 'teams',
        verification: 'unverified',
        code: 'ACTION_UNCONFIRMED',
      },
    }),
    globalEvent({
      id: 'event-other',
      eventId: 'event-other',
      payload: { proposalId: 'proposal-other', event: 'proposal-created' },
    }),
  ]);
  deletedItemIds.set(['preexisting-tombstone']);
  highlightedItemId.set('shared-1');
  selectedProposalId.set('proposal-confirmed');

  return { hot, duplicate, cold, unrelatedHot, unrelatedCold };
}

function snapshotState() {
  return structuredClone({
    scanners: get(scanners),
    items: get(items),
    coldItems: get(coldItems),
    proposals: get(actionProposals),
    history: get(history),
    deletedItemIds: get(deletedItemIds),
    highlightedItemId: get(highlightedItemId),
    selectedProposalId: get(selectedProposalId),
  });
}

before(async () => {
  ({ get } = await import('svelte/store'));
  ({
    actionProposals,
    activeOperations,
    coldItems,
    deletedItemIds,
    highlightedItemId,
    history,
    items,
    scanners,
    selectedProposalId,
  } = await import('../src/svelte/lib/stores.js'));
  ({ executeScannerDeletion, previewScannerDeletion } = await import('../src/svelte/lib/scanner-actions.js'));
  await import('../src/svelte/lib/operation-guards.js');
});

beforeEach(() => {
  actionProposals.set([]);
  activeOperations.set(new Map());
  coldItems.set([]);
  deletedItemIds.set([]);
  highlightedItemId.set(null);
  history.set([]);
  items.set([]);
  scanners.set([]);
  selectedProposalId.set(null);
  globalThis.__scannerCanonicalCapture = null;
  globalThis.__scannerCanonicalGate = null;
  globalThis.__scannerCanonicalReceipts = [{ success: true }];
  globalThis.__scannerCanonicalWrites = 0;
  globalThis.__scannerTransactionMode = 'normal';
  globalThis.__scannerColdConcurrentMutation = null;
  globalThis.__scannerColdReceipts = [{ success: true }];
  globalThis.__scannerColdWrites = [];
  globalThis.__scannerExternalColdItems = [];
  globalThis.__scannerExternalColdReads = 0;
  globalThis.window = {
    workiq: {
      async getColdItems() {
        globalThis.__scannerExternalColdReads += 1;
        return structuredClone(globalThis.__scannerExternalColdItems);
      },
      async setColdItems(entries) {
        globalThis.__scannerColdWrites.push(structuredClone(entries));
        globalThis.__scannerExternalColdItems = structuredClone(entries);
        const mutation = globalThis.__scannerColdConcurrentMutation;
        globalThis.__scannerColdConcurrentMutation = null;
        mutation?.();
        return globalThis.__scannerColdReceipts.length
          ? globalThis.__scannerColdReceipts.shift()
          : { success: true };
      },
    },
  };
});

describe('previewScannerDeletion', () => {
  it('loads external-only cold records before building the deletion preview token', async () => {
    seedAffectedState();
    const externalOnly = card({
      id: 'external-only-cold',
      title: 'Externally stored archive record',
      lifecycleStatus: 'archived',
      monitorEnabled: false,
    });
    globalThis.__scannerExternalColdItems = [externalOnly];
    coldItems.set([]);

    const preview = await previewScannerDeletion('scanner-1');

    assert.deepEqual(preview.coldItemIds, ['external-only-cold']);
    assert.deepEqual(preview.itemIds, ['hot-1', 'shared-1', 'external-only-cold']);
    assert.equal(get(coldItems).some((entry) => entry.id === externalOnly.id), true);
  });

  it('returns stable unique impact IDs, counts, token, selections, and valid destinations', async () => {
    seedAffectedState();

    const preview = await previewScannerDeletion('scanner-1');
    const repeated = await previewScannerDeletion('scanner-1');

    assert.deepEqual(preview.scanner, { id: 'scanner-1', name: 'Launch radar' });
    assert.deepEqual(preview.hotItemIds, ['hot-1', 'shared-1']);
    assert.deepEqual(preview.coldItemIds, ['cold-1', 'shared-1']);
    assert.deepEqual(preview.itemIds, ['hot-1', 'shared-1', 'cold-1']);
    assert.deepEqual(preview.proposalIds, [
      'proposal-no-effect',
      'proposal-confirmed',
      'proposal-uncertain',
    ]);
    assert.deepEqual(preview.noEffectProposalIds, ['proposal-no-effect']);
    assert.deepEqual(preview.effectfulProposalIds, ['proposal-confirmed', 'proposal-uncertain']);
    assert.deepEqual(preview.auditIds, ['receipt-confirmed', 'receipt-uncertain']);
    assert.deepEqual(preview.tombstoneItemIds, ['hot-1', 'shared-1', 'cold-1']);
    assert.deepEqual(preview.selectedItemIds, ['shared-1']);
    assert.deepEqual(preview.selectedProposalIds, ['proposal-confirmed']);
    assert.deepEqual(preview.counts, {
      hotItems: 2,
      coldItems: 2,
      uniqueItems: 3,
      linkedProposals: 3,
      noEffectProposals: 1,
      effectfulProposals: 2,
      audits: 2,
      tombstones: 3,
      selections: 2,
    });
    assert.deepEqual(preview.reassignmentTargets, [
      { id: null, name: 'Unassigned Inbox' },
      { id: 'scanner-2', name: 'Customer radar' },
    ]);
    assert.equal(typeof preview.previewToken, 'string');
    assert.ok(preview.previewToken.length >= 16);
    assert.equal(repeated.previewToken, preview.previewToken);
  });

  it('fails closed for a missing scanner without manufacturing a preview', async () => {
    seedAffectedState();

    assert.deepEqual(await previewScannerDeletion('missing'), { ok: false, code: 'NOT_FOUND' });
  });
});

describe('executeScannerDeletion reassign', () => {
  it('reassigns an external-only cold record and reloads the accepted external write', async () => {
    seedAffectedState();
    const externalOnly = card({
      id: 'external-only-reassign',
      title: 'External-only reassignment record',
      lifecycleStatus: 'archived',
      monitorEnabled: false,
    });
    const unrelated = card({
      id: 'external-unrelated',
      scannerId: 'scanner-2',
      title: 'Unrelated external archive record',
      lifecycleStatus: 'archived',
      monitorEnabled: false,
    });
    coldItems.set([]);
    globalThis.__scannerExternalColdItems = [externalOnly, unrelated];
    const preview = await previewScannerDeletion('scanner-1');

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'reassign',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.equal(result.ok, true);
    const acceptedWrite = globalThis.__scannerColdWrites.at(-1);
    assert.ok(acceptedWrite, 'Reassign skipped the authoritative cold-store write');
    assert.deepEqual(acceptedWrite.map((entry) => [entry.id, entry.scannerId]), [
      ['external-only-reassign', null],
      ['external-unrelated', 'scanner-2'],
    ]);
    coldItems.set([]);
    coldItems.set(await window.workiq.getColdItems());
    assert.equal(get(coldItems).find((entry) => entry.id === externalOnly.id)?.scannerId, null);
    assert.equal(get(coldItems).find((entry) => entry.id === unrelated.id)?.scannerId, 'scanner-2');
    assert.equal(globalThis.__scannerCanonicalWrites, 1);
  });

  for (const [name, targetScannerId] of [['Unassigned Inbox', null], ['another scanner', 'scanner-2']]) {
    it(`reassigns unique hot and cold items to ${name} while preserving linked state`, async () => {
      const seeded = seedAffectedState();
      const beforeProposals = structuredClone(get(actionProposals));
      const beforeHistory = structuredClone(get(history));
      const beforeTombstones = [...get(deletedItemIds)];
      const preview = await previewScannerDeletion('scanner-1');

      const result = await executeScannerDeletion({
        scannerId: 'scanner-1',
        disposition: 'reassign',
        targetScannerId,
        previewToken: preview.previewToken,
      });

      assert.deepEqual(result, {
        ok: true,
        code: 'OK',
        disposition: 'reassign',
        affectedItemIds: ['hot-1', 'shared-1', 'cold-1'],
        removedProposalCount: 0,
        preservedAuditCount: 2,
        recoveryRequired: false,
      });
      assert.deepEqual(get(scanners).map((entry) => entry.id), ['scanner-2']);
      assert.deepEqual(
        get(items).filter((entry) => ['hot-1', 'shared-1'].includes(entry.id)).map((entry) => entry.scannerId),
        [targetScannerId, targetScannerId]
      );
      assert.deepEqual(
        get(coldItems).filter((entry) => ['cold-1', 'shared-1'].includes(entry.id)).map((entry) => entry.scannerId),
        [targetScannerId, targetScannerId]
      );
      assert.equal(get(items).find((entry) => entry.id === 'hot-1').lifecycleStatus, seeded.hot.lifecycleStatus);
      assert.equal(get(coldItems).find((entry) => entry.id === 'cold-1').lifecycleStatus, seeded.cold.lifecycleStatus);
      assert.deepEqual(get(actionProposals), beforeProposals);
      assert.deepEqual(get(history).slice(1), beforeHistory);
      assert.deepEqual(get(deletedItemIds), beforeTombstones);
      assert.equal(get(highlightedItemId), 'shared-1');
      assert.equal(get(selectedProposalId), 'proposal-confirmed');
      assert.equal(globalThis.__scannerCanonicalWrites, 1);
      assert.equal(get(history)[0].payload.event, 'scanner-deleted');
      assert.equal(get(history)[0].payload.disposition, 'reassign');
      assert.equal(get(history)[0].payload.targetScannerId, targetScannerId);
    });
  }
});

describe('executeScannerDeletion delete-all', () => {
  it('deletes an external-only cold record and reloads the accepted external write', async () => {
    seedAffectedState();
    const externalOnly = card({
      id: 'external-only-delete',
      title: 'External-only deletion record',
      lifecycleStatus: 'archived',
      monitorEnabled: false,
    });
    const unrelated = card({
      id: 'external-unrelated',
      scannerId: 'scanner-2',
      title: 'Unrelated external archive record',
      lifecycleStatus: 'archived',
      monitorEnabled: false,
    });
    coldItems.set([]);
    globalThis.__scannerExternalColdItems = [externalOnly, unrelated];
    const preview = await previewScannerDeletion('scanner-1');

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.equal(result.ok, true);
    const acceptedWrite = globalThis.__scannerColdWrites.at(-1);
    assert.ok(acceptedWrite, 'Delete all skipped the authoritative cold-store write');
    assert.deepEqual(acceptedWrite.map((entry) => entry.id), ['external-unrelated']);
    coldItems.set([]);
    coldItems.set(await window.workiq.getColdItems());
    assert.deepEqual(get(coldItems).map((entry) => entry.id), ['external-unrelated']);
    assert.equal(get(deletedItemIds).includes(externalOnly.id), true);
    assert.equal(globalThis.__scannerCanonicalWrites, 1);
  });

  it('deletes owned hot and cold items, tombstones IDs, removes no-effect state, and preserves detached audit evidence', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, {
      ok: true,
      code: 'OK',
      disposition: 'delete-all',
      affectedItemIds: ['hot-1', 'shared-1', 'cold-1'],
      removedProposalCount: 1,
      preservedAuditCount: 2,
      recoveryRequired: false,
    });
    assert.deepEqual(get(scanners).map((entry) => entry.id), ['scanner-2']);
    assert.deepEqual(get(items).map((entry) => entry.id), ['other-hot']);
    assert.deepEqual(get(coldItems).map((entry) => entry.id), ['other-cold']);
    assert.deepEqual(get(deletedItemIds), [
      'preexisting-tombstone',
      'hot-1',
      'shared-1',
      'cold-1',
    ]);
    assert.deepEqual(get(actionProposals).map((entry) => entry.id), [
      'proposal-confirmed',
      'proposal-uncertain',
      'proposal-other',
    ]);
    for (const proposalId of ['proposal-confirmed', 'proposal-uncertain']) {
      const retained = get(actionProposals).find((entry) => entry.id === proposalId);
      assert.equal(retained.auditOnly, true);
    }
    assert.equal(get(history).some((entry) => entry.eventId === 'event-admin'), false);
    assert.equal(get(history).some((entry) => entry.eventId === 'receipt-confirmed'), true);
    assert.equal(get(history).some((entry) => entry.eventId === 'receipt-uncertain'), true);
    assert.equal(get(history).some((entry) => entry.eventId === 'event-other'), true);
    assert.equal(get(highlightedItemId), null);
    assert.equal(get(selectedProposalId), 'proposal-confirmed');
  });

  it('clears a selected proposal when delete-all removes that no-effect proposal', async () => {
    seedAffectedState();
    selectedProposalId.set('proposal-no-effect');
    const preview = await previewScannerDeletion('scanner-1');

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.equal(result.ok, true);
    assert.equal(get(selectedProposalId), null);
  });
});

describe('scanner deletion persistence and rollback', () => {
  it('accepts only confirmed cold-store receipts and restores all state after an ambiguous primary receipt', async () => {
    seedAffectedState();
    const before = snapshotState();
    const preview = await previewScannerDeletion('scanner-1');
    globalThis.__scannerColdReceipts = [{}, { success: true }];

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(snapshotState(), before);
    assert.equal(globalThis.__scannerCanonicalWrites, 0);
  });

  it('rolls back cold storage and all owned state when canonical persistence fails after cold success', async () => {
    seedAffectedState();
    const before = snapshotState();
    const preview = await previewScannerDeletion('scanner-1');
    globalThis.__scannerCanonicalReceipts = [{}, { success: true }];

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
    assert.deepEqual(snapshotState(), before);
    assert.deepEqual(globalThis.__scannerColdWrites.map((entries) => entries.map((entry) => entry.id)), [
      ['other-cold'],
      ['cold-1', 'shared-1', 'other-cold'],
    ]);
    assert.equal(globalThis.__scannerCanonicalWrites, 2);
  });

  it('requires recovery when rollback persistence is ambiguous', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');
    globalThis.__scannerCanonicalReceipts = [{}, {}];

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_RECOVERY_REQUIRED' });
  });

  it('preserves unrelated concurrent changes on success and retries the live cold snapshot', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');
    globalThis.__scannerColdConcurrentMutation = () => {
      items.update((entries) => entries.map((entry) => entry.id === 'other-hot'
        ? { ...entry, title: 'Concurrent hot edit' }
        : entry).concat(card({ id: 'concurrent-hot', scannerId: 'scanner-2' })));
      coldItems.update((entries) => entries.map((entry) => entry.id === 'other-cold'
        ? { ...entry, title: 'Concurrent cold edit' }
        : entry).concat(card({
          id: 'concurrent-cold',
          scannerId: 'scanner-2',
          lifecycleStatus: 'archived',
        })));
      actionProposals.update((entries) => entries.concat(proposal({
        id: 'proposal-concurrent',
        sourceItemId: 'concurrent-hot',
      })));
      history.update((entries) => entries.concat(globalEvent({
        id: 'event-concurrent',
        eventId: 'event-concurrent',
        payload: { proposalId: 'proposal-concurrent', event: 'proposal-created' },
      })));
      deletedItemIds.update((ids) => ids.concat('concurrent-tombstone'));
      highlightedItemId.set('concurrent-hot');
      selectedProposalId.set('proposal-concurrent');
    };

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.equal(result.ok, true);
    assert.equal(get(items).find((entry) => entry.id === 'other-hot').title, 'Concurrent hot edit');
    assert.equal(get(items).some((entry) => entry.id === 'concurrent-hot'), true);
    assert.equal(get(coldItems).find((entry) => entry.id === 'other-cold').title, 'Concurrent cold edit');
    assert.equal(get(coldItems).some((entry) => entry.id === 'concurrent-cold'), true);
    assert.equal(get(actionProposals).some((entry) => entry.id === 'proposal-concurrent'), true);
    assert.equal(get(history).some((entry) => entry.eventId === 'event-concurrent'), true);
    assert.equal(get(deletedItemIds).includes('concurrent-tombstone'), true);
    assert.equal(get(highlightedItemId), 'concurrent-hot');
    assert.equal(get(selectedProposalId), 'proposal-concurrent');
    assert.deepEqual(globalThis.__scannerColdWrites.map((entries) => entries.map((entry) => entry.id)), [
      ['other-cold'],
      ['other-cold', 'concurrent-cold'],
    ]);
  });
});

describe('scanner deletion fail-closed guards', () => {
  it('rejects a stale preview token with no mutation', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');
    items.update((entries) => entries.map((entry) => entry.id === 'hot-1'
      ? { ...entry, lifecycleStatus: 'waiting' }
      : entry));
    const before = snapshotState();

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'STALE_PREVIEW' });
    assert.deepEqual(snapshotState(), before);
    assert.equal(globalThis.__scannerCanonicalWrites, 0);
  });

  it('rejects a missing reassignment target with no mutation', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');
    const before = snapshotState();

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'reassign',
      targetScannerId: 'missing-target',
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'INVALID_TARGET' });
    assert.deepEqual(snapshotState(), before);
  });

  it('rejects a missing scanner with no mutation', async () => {
    seedAffectedState();
    const before = snapshotState();

    const result = await executeScannerDeletion({
      scannerId: 'missing',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: 'missing-preview',
    });

    assert.deepEqual(result, { ok: false, code: 'NOT_FOUND' });
    assert.deepEqual(snapshotState(), before);
  });

  it('rejects an overlapping persistence transaction with no mutation', async () => {
    seedAffectedState();
    const preview = await previewScannerDeletion('scanner-1');
    const before = snapshotState();
    globalThis.__scannerTransactionMode = 'busy';

    const result = await executeScannerDeletion({
      scannerId: 'scanner-1',
      disposition: 'delete-all',
      targetScannerId: null,
      previewToken: preview.previewToken,
    });

    assert.deepEqual(result, { ok: false, code: 'BUSY' });
    assert.deepEqual(snapshotState(), before);
  });

  for (const [operationName, operationKey] of [
    ['scanner operation', 'scanner:scanner-1'],
    ['affected item operation', 'item:hot-1'],
  ]) {
    it(`rejects an active ${operationName} with no mutation`, async () => {
      seedAffectedState();
      activeOperations.set(new Map([[operationKey, { startedAt: Date.now() }]]));
      const preview = await previewScannerDeletion('scanner-1');
      const before = snapshotState();

      const result = await executeScannerDeletion({
        scannerId: 'scanner-1',
        disposition: 'delete-all',
        targetScannerId: null,
        previewToken: preview.previewToken,
      });

      assert.deepEqual(result, { ok: false, code: 'BUSY' });
      assert.deepEqual(snapshotState(), before);
      assert.equal(globalThis.__scannerCanonicalWrites, 0);
    });
  }
});