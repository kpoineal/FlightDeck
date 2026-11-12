import { get } from 'svelte/store';
import { actionProposals, selectedProposalId } from './stores.js';
import { classifyActionProposalView } from './action-proposals.js';
import { draftMatchesWorkPlan } from './work-plan.js';
import { navigateToRadarItem } from './radar-navigation.js';

export function selectThreadEmail(proposals, threadId, step, composerId, requestedId) {
  const emails = proposals.filter(entry => entry.sourceItemId === threadId
    && entry.channel === 'outlook-draft' && !entry.auditOnly);
  const requested = emails.find(entry => entry.id === requestedId);
  if (requested) return requested;
  const active = emails.filter(entry => classifyActionProposalView(entry) === 'open'
    && draftMatchesWorkPlan(entry.sourceNextStep, step));
  return active.find(entry => entry.id === composerId)
    || active.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null;
}

export async function openSavedDraft(proposalId) {
  const proposal = get(actionProposals).find(entry => entry.id === proposalId && !entry.auditOnly);
  if (!proposal?.sourceItemId || !await navigateToRadarItem(proposal.sourceItemId)) return false;
  selectedProposalId.set(proposal.id);
  return true;
}

export function proposalManagement(proposal) {
  if (!proposal || proposal.auditOnly) return null;
  if (proposal.archivedAt) return { operation: 'restore', event: 'restored', label: 'Restore',
    summary: 'Restore this proposal to its previous state?' };
  if (proposal.state === 'Drafted') return { operation: 'archive', event: 'archived', label: 'Dismiss proposal',
    reason: 'Dismissed while drafted', summary: 'Dismiss this drafted proposal? It will move to Archived and can be restored.' };
  if (proposal.state === 'Awaiting review') return { operation: 'transition', nextState: 'Rejected', event: 'rejected',
    label: 'Reject proposal', summary: 'Reject this proposal? It will remain in the source thread and audit history.' };
  if (['Approved', 'Queued'].includes(proposal.state)) return { operation: 'transition', nextState: 'Cancelled', event: 'cancelled',
    label: 'Cancel proposal', summary: 'Cancel this proposal? This does not undo any earlier external action.' };
  if (['Succeeded', 'Rejected', 'Cancelled', 'Failed'].includes(proposal.state)) return { operation: 'archive', event: 'archived',
    label: 'Archive', reason: 'Archived by user', summary: 'Archive this proposal? The source thread and audit history will remain unchanged.' };
  return null;
}
