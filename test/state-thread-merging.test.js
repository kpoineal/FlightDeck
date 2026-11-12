'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createGeneratedProfile, removeGeneratedProfile } = require('./fixtures/state-profile');
const { openStateRepository } = require('../src/main/state-repository');
const { canonicalizeState } = require('../src/main/state-migration');
const source = id => [{ type: 'email', label: id, url: `https://outlook.office.com/mail/deeplink/read/${id}` }];
const make = (id, patch = {}) => ({ id, scannerId: 'scanner', title: 'Bass Pro pilot migration',
  summary: 'Move five pilot machines to the new environment.', evidenceLinks: source(id), ...patch });
async function setup(callback) {
  const { directory } = createGeneratedProfile({});
  const database = path.join(directory, 'merging.sqlite');
  let repository = openStateRepository(database);
  const api = {
    call: (...args) => repository.call(...args),
    async command(type, payload, expectedRevision = null) {
      const revision = expectedRevision ?? (await repository.call('status')).revision;
      return repository.call('command', { commandId: crypto.randomUUID(), expectedRevision: revision, type, payload });
    },
    async reopen() { await repository.close(); repository = openStateRepository(database); },
  };
  try { await callback(api); } finally { await repository.close(); removeGeneratedProfile(directory); }
}
test('canonical matcher finds off-cache cold targets beyond twenty hints and accepts updates atomically/idempotently', async () => setup(async repo => {
  const cold = make('cold', { workPlanChoice: { mode: 'custom', customText: 'User next move', selectedNextStep: '' }, completedNextSteps: ['Ask Alex'] });
  await repo.call('import', await canonicalizeState({
    scanners: [{ id: 'scanner', name: 'Scan', enabled: true }],
    items: Array.from({ length: 30 }, (_, index) => make(`noise-${index}`, { title: 'Collect invoices', summary: 'Pay bills' })),
  }, [cold]));
  const finding = make('new', { title: 'RDP testing blocked for Bass Pro pilot migration', summary: 'Five pilot machines migration needs RDP testing unblocked.', severity: 'Critical' });
  const matches = await repo.call('matchCandidates', { findings: [finding] });
  assert.equal(matches[0].candidates.length, 1);
  const target = matches[0].candidates[0];
  assert.equal(target.id, 'cold'); assert.equal(target.residency, 'cold');
  const payload = { scannerId: 'scanner', items: [], updates: [{ targetId: 'cold', finding, expectedRecordRevision: target.repositoryRevision, reason: 'Same pilot migration completion goal.' }] };
  await repo.command('acceptScannerResults', payload);
  let updated = await repo.call('getThread', { id: 'cold' });
  assert.equal(updated.summary, finding.summary); assert.equal(updated.hasNewUpdate, true);
  assert.equal(updated.evidenceLinks.length, 2); assert.deepEqual(updated.workPlanChoice, cold.workPlanChoice);
  assert.deepEqual(updated.completedNextSteps, ['Ask Alex']);
  payload.updates[0].expectedRecordRevision = updated.repositoryRevision;
  await repo.command('acceptScannerResults', payload);
  assert.equal((await repo.call('getThread', { id: 'cold' })).mergedRecords.length, 1);
  await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [{ ...finding, id: 'new-id' }] });
  assert.equal(await repo.call('getThread', { id: 'new-id' }), null);
  await repo.reopen();
  updated = await repo.call('getThread', { id: 'cold' });
  assert.equal(updated.mergedRecords[0].id, 'new');
  await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [{ id: 'new', title: 'No source identity' }] });
  assert.equal(await repo.call('getThread', { id: 'new' }), null);
}));
test('changed/deleted/completed match targets reject the entire canonical scan with no new cards', async () => {
  for (const change of ['change', 'delete', 'complete']) await setup(async repo => {
    await repo.call('import', await canonicalizeState({ scanners: [{ id: 'scanner', enabled: true }], items: [make('old')] }, []));
    const target = await repo.call('getThread', { id: 'old' });
    if (change === 'delete') await repo.command('deleteThread', { id: 'old' });
    else await repo.command('patchThread', { id: 'old', expectedRecordRevision: target.repositoryRevision,
      patch: change === 'complete' ? { lifecycleStatus: 'complete' } : { summary: 'Changed by user' } });
    await assert.rejects(repo.command('acceptScannerResults', { scannerId: 'scanner', items: [make('unrelated')],
      updates: [{ targetId: 'old', finding: make('new'), expectedRecordRevision: target.repositoryRevision }] }), /RECORD_CONFLICT|MATCH_TARGET_UNAVAILABLE/);
    assert.equal(await repo.call('getThread', { id: 'unrelated' }), null);
  });
});
test('manual canonical merge preserves original action/draft identity, custom/completion history and source tombstones after reopen', async () => setup(async repo => {
  const custom = customText => ({ mode: 'custom', customText, selectedNextStep: '' });
  const history = id => Array.from({ length: 20 }, (_, index) => ({ kind: 'action', eventId: `${id}-${index}`, proposalId: 'draft',
    timestamp: new Date(Date.UTC(2026, 10, 11, 0, index)).toISOString(), summary: `${id}-${index}`, seen: true }));
  await repo.call('import', await canonicalizeState({
    scanners: [{ id: 'scanner', enabled: true }],
    items: [make('source', { workPlanChoice: custom('Source custom'), completedNextSteps: ['Source completed'], updateHistory: history('source') })],
    actionProposals: [{ id: 'draft', sourceItemId: 'source', sourceContextId: 'source', sourceTitle: 'Original source',
      channel: 'outlook-draft', sourceNextStep: 'Destination custom', target: 'alex@example.com', content: 'Reviewed draft', state: 'Drafted', localOnly: true,
      createdAt: '2026-11-11T12:00:00Z', updatedAt: '2026-11-11T12:00:00Z' }],
  }, [make('target', { workPlanChoice: custom('Destination custom'), completedNextSteps: ['Target completed'], updateHistory: history('target') })]));
  const from = await repo.call('getThread', { id: 'source' }), to = await repo.call('getThread', { id: 'target' });
  const destinations = await repo.call('mergeDestinations', { sourceId: 'source', query: 'pilot' });
  assert.deepEqual(destinations.map(row => row.id), ['target']);
  await assert.rejects(repo.command('mergeThreads', { sourceId: 'source', targetId: 'source', sourceRevision: from.repositoryRevision, targetRevision: from.repositoryRevision }), /INVALID_MERGE_TARGET/);
  await repo.command('mergeThreads', { sourceId: 'source', targetId: 'target', sourceRevision: from.repositoryRevision, targetRevision: to.repositoryRevision,
    composer: { threadId: 'target', teamsDraft: { proposalId: 'teams-original', sourceItemId: 'target',
      nextStep: 'Destination custom', message: 'Reviewed Teams draft' } } });
  await repo.reopen();
  const saved = await repo.call('getThread', { id: 'target' });
  assert.equal(await repo.call('getThread', { id: 'source' }), null);
  assert.equal(saved.workPlanChoice.customText, 'Destination custom');
  assert.equal(saved.mergedRecords[0].workPlanChoice.customText, 'Source custom');
  assert.deepEqual(saved.completedNextSteps.sort(), ['Source completed', 'Target completed']);
  assert.equal(saved.mergedComposer.teamsDraft.proposalId, 'teams-original');
  assert.equal(new Set([...saved.updateHistory, ...saved.mergeHistory].filter(entry => entry.kind === 'action').map(entry => entry.eventId)).size, 40);
  const proposal = (await repo.call('listProposals', {})).rows.find(row => row.id === 'draft');
  assert.equal(proposal.sourceItemId, 'target'); assert.equal(proposal.originalSourceItemId, 'source');
  assert.equal(proposal.sourceContextId, 'target'); assert.equal(proposal.originalSourceContextId, 'source');
  assert.equal(proposal.sourceTitle, 'Original source'); assert.equal(proposal.content, 'Reviewed draft');
  await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [{ id: 'source', title: 'No source identity' }] });
  assert.equal(await repo.call('getThread', { id: 'source' }), null);
  await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [make('source'), make('different-id', { evidenceLinks: source('source') })] });
  assert.equal(await repo.call('getThread', { id: 'different-id' }), null);
}));
test('manual merge stale revision failure retains both cards and proposals', async () => setup(async repo => {
  await repo.call('import', await canonicalizeState({ items: [make('source'), make('target')],
    actionProposals: [{ id: 'reviewed', sourceItemId: 'source', channel: 'outlook-draft',
      target: 'alex@example.com', content: 'Keep my reviewed text', state: 'Drafted', localOnly: true,
      createdAt: '2026-11-11T12:00:00Z', updatedAt: '2026-11-11T12:00:00Z' }] }, []));
  const proposals = await repo.call('listProposals', {});
  const from = await repo.call('getThread', { id: 'source' }), to = await repo.call('getThread', { id: 'target' });
  await repo.command('patchThread', { id: 'target', expectedRecordRevision: to.repositoryRevision, patch: { summary: 'User edit' } });
  await assert.rejects(repo.command('mergeThreads', { sourceId: from.id, targetId: to.id, sourceRevision: from.repositoryRevision, targetRevision: to.repositoryRevision }), /RECORD_CONFLICT/);
  assert.ok(await repo.call('getThread', { id: 'source' }));
  assert.equal((await repo.call('getThread', { id: 'target' })).summary, 'User edit');
  assert.deepEqual((await repo.call('listProposals', {})).rows, proposals.rows);
}));

test('canonical updates respect cross-scanner opt-out and receipt every accepted or skipped finding', async () => {
  for (const optOut of [false, true]) await setup(async repo => {
    const finding = make('new', { summary: 'Pilot migration RDP testing is blocked.' });
    await repo.call('import', await canonicalizeState({
      scanners: [{ id: 'scanner', enabled: true, crossScannerDedup: !optOut }, { id: 'other', enabled: true }],
      items: [make('target'), make('invoice', { scannerId: 'other', title: 'Invoice payment',
        summary: 'Pay an unrelated invoice', evidenceLinks: source('new') })],
    }, []));
    const target = await repo.call('getThread', { id: 'target' });
    const receipt = await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [],
      updates: [{ targetId: target.id, finding, expectedRecordRevision: target.repositoryRevision }] });
    assert.deepEqual(receipt.acceptedFindings, optOut ? [{ findingId: 'new', targetId: 'target', disposition: 'updated' }] : []);
    assert.deepEqual(receipt.skippedFindings, optOut ? [] : [{ findingId: 'new', reason: 'exact-source-duplicate' }]);
    assert.equal((await repo.call('getThread', { id: 'target' })).mergedRecords.length, optOut ? 1 : 0);
    // A skipped finding is not tombstoned; removing its owner permits a later acceptance.
    if (!optOut) {
      await repo.command('deleteThread', { id: 'invoice' });
      const later = await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [finding] });
      assert.equal(later.acceptedFindings[0].disposition, 'inserted');
    } else {
      const later = await repo.command('acceptScannerResults', { scannerId: 'scanner', items: [finding] });
      assert.deepEqual(later.skippedFindings, [{ findingId: 'new', reason: 'deleted' }]);
    }
  });
});

test('canonical incompatible draft transfers leave both cards and populated proposals unchanged', async () => {
  for (const channel of ['teams', 'email', 'two-emails']) await setup(async repo => {
    await repo.call('import', await canonicalizeState({
      items: [make('source', { suggestedNextSteps: ['Ask source owner'] }),
        make('target', { suggestedNextSteps: ['Validate machines', 'Approve rollout'] })],
      actionProposals: ['source', 'target'].map(id => ({
        id: `draft-${id}`, sourceItemId: id, channel: 'outlook-draft', target: 'alex@example.com',
        sourceNextStep: id === 'source' && channel === 'email' ? 'Ask source owner' : 'Validate machines',
        content: `Reviewed ${id}`, state: 'Drafted', localOnly: true,
        createdAt: '2026-11-11T12:00:00Z', updatedAt: '2026-11-11T12:00:00Z',
      })),
    }, []));
    const source = await repo.call('getThread', { id: 'source' }), target = await repo.call('getThread', { id: 'target' });
    const proposals = await repo.call('listProposals', {});
    await assert.rejects(repo.command('mergeThreads', { sourceId: source.id, targetId: target.id,
      sourceRevision: source.repositoryRevision, targetRevision: target.repositoryRevision,
      ...(channel === 'teams' ? { composer: { teamsDraft: { nextStep: 'Ask source owner', message: 'Reviewed Teams' } } } : {}) }),
    channel === 'two-emails' ? /DRAFT_CONFLICT/ : /DRAFT_PLAN_CONFLICT/);
    assert.deepEqual(await repo.call('getThread', { id: 'source' }), source);
    assert.deepEqual(await repo.call('getThread', { id: 'target' }), target);
    assert.deepEqual(await repo.call('listProposals', {}), proposals);
  });
});
