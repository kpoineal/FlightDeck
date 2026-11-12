import { get } from 'svelte/store';
import { items, coldItems, deletedItemIds, actionProposals, history, isDemo } from './stores.js';
import * as persistence from './persistence.js';
import { usesRepository, rememberRepositoryThread } from './repository-context.js';
import { hydrateRadarColdItems, resolveRadarItem } from './radar-navigation.js';
import { activeMatchThread, combineThreads, matchSnapshot, relinkMergedProposal, relinkMergedHistory, mergeDraftPlanCompatible } from './thread-matching.js';
import { undoMutation, rollbackThreadStores } from './mutation-rollback.js';
import { threadComposer } from './thread-composer.js';
import { itemOperationKey, tryAcquireOperationGuards, releaseOperationGuards } from './operation-guards.js';

export async function mergeDestinations(sourceId, query = '') {
  if (usesRepository()) return window.workiq.stateQuery('mergeDestinations', { sourceId, query: query.slice(0, 200) });
  await hydrateRadarColdItems();
  return [...new Map([...get(coldItems), ...get(items)].map(item => [item.id, item])).values()]
    .filter(item => item.id !== sourceId && activeMatchThread(item) && !get(deletedItemIds).includes(item.id)
      && `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
}
const draftPresent = state => Boolean(state.teamsDraft || state.emailProposalId || state.result);
export async function mergeThreads(source, target) {
  if (!source || !target || source.id === target.id) return { ok: false, code: 'INVALID_MERGE_TARGET' };
  const lease = tryAcquireOperationGuards([itemOperationKey(source.id), itemOperationKey(target.id)], { type: 'merge' });
  if (!lease) return { ok: false, code: 'BUSY' };
  try {
    const sourceComposer = get(threadComposer).get(source.id) || source.mergedComposer || threadComposer.read(source.id);
    const targetComposer = get(threadComposer).get(target.id) || target.mergedComposer || threadComposer.read(target.id);
    if ([sourceComposer, targetComposer].some(state => state.status === 'generating'
      || ['sending', 'unconfirmed'].includes(state.teamsSendState.status))
      || (draftPresent(sourceComposer) && draftPresent(targetComposer))) return { ok: false, code: 'DRAFT_CONFLICT' };
    if (get(actionProposals).some(proposal => [source.id, target.id].includes(proposal.sourceItemId)
      && proposal.state === 'Executing')) return { ok: false, code: 'BUSY' };
    const liveSource = await resolveRadarItem(source.id), liveTarget = await resolveRadarItem(target.id);
    if (!liveSource || !liveTarget || matchSnapshot(liveSource) !== matchSnapshot(source)
      || matchSnapshot(liveTarget) !== matchSnapshot(target)) return { ok: false, code: 'MATCH_TARGET_CHANGED' };
    let merged = combineThreads(liveTarget, liveSource);
    if (!mergeDraftPlanCompatible(merged, [sourceComposer, targetComposer],
      get(actionProposals).filter(proposal => [source.id, target.id].includes(proposal.sourceItemId)))) {
      return { ok: false, code: 'DRAFT_PLAN_CONFLICT' };
    }
    const pendingEmails = get(actionProposals).filter(proposal => [source.id, target.id].includes(proposal.sourceItemId)
      && proposal.channel === 'outlook-draft' && !['Succeeded', 'Rejected'].includes(proposal.state));
    if (pendingEmails.some(proposal => proposal.sourceItemId === source.id)
      && pendingEmails.some(proposal => proposal.sourceItemId === target.id)) return { ok: false, code: 'DRAFT_CONFLICT' };
    const composer = draftPresent(sourceComposer) ? { ...sourceComposer, threadId: target.id,
      teamsDraft: sourceComposer.teamsDraft ? { ...sourceComposer.teamsDraft,
        originalSourceItemId: sourceComposer.teamsDraft.sourceItemId, sourceItemId: target.id } : null } : targetComposer;
    if (draftPresent(composer)) merged.mergedComposer = composer;
    const proposals = get(actionProposals);
    const relink = proposal => relinkMergedProposal(proposal, source.id, target.id);
    const auditBefore = get(history);
    if (usesRepository()) {
      if (!await persistence.flushPersistentState()) return { ok: false, code: 'PERSISTENCE_FAILED' };
      const result = await persistence.executeRepositoryCommand('mergeThreads', {
        sourceId: source.id, targetId: target.id, sourceRevision: source.repositoryRevision, targetRevision: target.repositoryRevision,
        composer: draftPresent(composer) ? composer : null,
      });
      if (!result.ok) return result;
      merged = await window.workiq.stateQuery('getThread', { id: target.id });
      if (!merged || get(deletedItemIds).includes(target.id)) throw new Error('MERGE_RELOAD_FAILED');
      rememberRepositoryThread(merged);
      items.update(rows => [merged, ...rows.filter(row => ![source.id, target.id].includes(row.id))]);
      coldItems.update(rows => rows.filter(row => ![source.id, target.id].includes(row.id)));
      deletedItemIds.update(ids => [...new Set([...ids, source.id])]);
      actionProposals.update(rows => rows.map(relink));
      history.update(rows => rows.map(entry => relinkMergedHistory(entry, source.id, target.id)));
    } else {
      const before = structuredClone({ hot: get(items), cold: get(coldItems), deleted: get(deletedItemIds),
        proposals, history: auditBefore });
      let applied;
      let mutated = false;
      const affected = new Set([source.id, target.id]);
      const changedCold = before.cold.some(item => [source.id, target.id].includes(item.id));
      if (changedCold && typeof window.workiq?.setColdItems !== 'function') return { ok: false, code: 'PERSISTENCE_FAILED' };
      const result = await persistence.runPersistentStateTransaction({
        isDemo: get(isDemo),
        mutate() {
          const live = [...get(items), ...get(coldItems)];
          if ([source, target].some(snapshot => !live.some(item => item.id === snapshot.id
            && matchSnapshot(item) === matchSnapshot(snapshot))) || [source.id, target.id].some(id => get(deletedItemIds).includes(id))) throw new Error('MATCH_TARGET_CHANGED');
          mutated = true;
          items.update(rows => [merged, ...rows.filter(row => !affected.has(row.id))]);
          coldItems.set(before.cold.filter(row => ![source.id, target.id].includes(row.id)));
          deletedItemIds.set([...new Set([...before.deleted, source.id])]);
          actionProposals.set(proposals.map(relink));
          history.update(rows => rows.map(entry => relinkMergedHistory(entry, source.id, target.id)));
          applied = structuredClone({ hot: get(items), cold: get(coldItems),
            proposals: get(actionProposals), history: get(history) });
        },
        rollback() {
          if (!mutated) return;
          const restored = rollbackThreadStores(before, applied, get(items), get(coldItems));
          items.set(restored.hot);
          coldItems.set(restored.cold);
          deletedItemIds.update(ids => ids.filter(id => id !== source.id || before.deleted.includes(id)));
          actionProposals.update(rows => undoMutation(before.proposals, applied.proposals, rows));
          history.update(rows => undoMutation(before.history, applied.history, rows));
        },
        persistExternal: changedCold ? async () => persistence.isAcceptedPersistenceReceipt(await window.workiq.setColdItems(get(coldItems))) : null,
        rollbackExternal: changedCold ? async () => persistence.isAcceptedPersistenceReceipt(await window.workiq.setColdItems(get(coldItems))) : null,
      });
      if (!result.ok) return result;
    }
    if (draftPresent(sourceComposer)) {
      threadComposer.update(target.id, { ...sourceComposer, threadId: target.id,
        teamsDraft: sourceComposer.teamsDraft ? { ...sourceComposer.teamsDraft,
          originalSourceItemId: sourceComposer.teamsDraft.sourceItemId, sourceItemId: target.id } : null });
    }
    threadComposer.forget(source.id);
    return { ok: true, targetId: target.id };
  } catch (error) {
    return { ok: false, code: error.code || error.message || 'MERGE_FAILED' };
  } finally { releaseOperationGuards(lease); }
}
