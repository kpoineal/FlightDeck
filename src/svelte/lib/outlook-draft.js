import { get } from 'svelte/store';
import { actionProposals, coldItems, deletedItemIds, items } from './stores.js';
import { buildOutlookDraftPayload, executeOutlookDraftAction, isConfirmedCommunication, isWorkPlanStepCompleted, transitionActionProposal } from './action-proposals.js';
import { createActionEventId, recordActionEvent } from './item-actions.js';
import { threadComposer } from './thread-composer.js';

export async function recordProposalEvent(proposal, event, {
  code = null, attempt = 0, outcome = null, verification = null,
} = {}) {
  if (!proposal?.sourceItemId || !event) return false;
  const eventId = createActionEventId({ proposalId: proposal.id, event, timestamp: proposal.updatedAt, attempt });
  if (!eventId) return false;
  return recordActionEvent({
    eventId, itemId: proposal.sourceItemId, proposalId: proposal.id, event,
    channel: proposal.channel, target: proposal.target, code, timestamp: proposal.updatedAt,
    nextStep: proposal.sourceNextStep,
    outcome: outcome || ({
      succeeded: 'succeeded', failed: 'failed', rejected: 'rejected', cancelled: 'cancelled',
      archived: 'archived', restored: 'restored',
    })[event] || 'pending',
    verification: verification || (event === 'succeeded' ? proposal.executionVerification || 'unverified'
      : ['approved', 'rejected', 'cancelled', 'archived', 'restored'].includes(event) ? 'not-applicable' : 'unverified'),
  });
}

export async function createOutlookDraftProposal(proposalId, { reviewed = false, createDraft } = {}) {
  let proposal = get(actionProposals).find((entry) => entry.id === proposalId);
  if (!proposal || proposal.auditOnly || proposal.archivedAt || proposal.channel !== 'outlook-draft'
    || proposal.executionCode === 'ACTION_UNCONFIRMED' || !buildOutlookDraftPayload(proposal).ok) return null;
  const item = [...get(items), ...get(coldItems)].find((entry) => entry.id === proposal.sourceItemId);
  const composer = threadComposer.read(proposal.sourceItemId);
  if (isWorkPlanStepCompleted(item, proposal.sourceNextStep)
    || composer.teamsSendState.status === 'sending'
    || (composer.teamsSendState.status === 'unconfirmed' && composer.teamsDraft?.nextStep
      && composer.teamsDraft.nextStep === proposal.sourceNextStep)) return null;
  const events = [];
  if (reviewed) {
    for (const [from, to, event] of [
      ['Drafted', 'Awaiting review', 'review-submitted'],
      ['Awaiting review', 'Approved', 'approved'],
      ['Approved', 'Queued', 'queued'],
    ]) {
      if (proposal.state !== from) continue;
      proposal = transitionActionProposal(proposal, to);
      events.push({ proposal, event });
    }
  }
  if (!['Queued', 'Failed'].includes(proposal.state)) return null;
  const executing = transitionActionProposal(proposal, 'Executing');
  actionProposals.update((entries) => entries.map((entry) => entry.id === proposalId ? executing : entry));
  for (const entry of [...events, { proposal: executing, event: 'execution-started' }]) {
    await recordProposalEvent(entry.proposal, entry.event);
  }
  if (!get(actionProposals).some((entry) => entry.id === proposalId && entry.state === 'Executing')
    || get(deletedItemIds).includes(executing.sourceItemId)) return null;
  const { executionAudit, ...completed } = await executeOutlookDraftAction(executing, createDraft);
  actionProposals.update((entries) => entries.map((entry) => entry.id === proposalId ? completed : entry));
  if (isConfirmedCommunication(completed) && threadComposer.read(completed.sourceItemId).emailProposalId === completed.id) {
    threadComposer.update(completed.sourceItemId, { emailOpen: false });
  }
  if (executionAudit) await recordProposalEvent(completed, executionAudit.event, executionAudit);
  return completed;
}
