import { get, writable } from 'svelte/store';
import { buildProposalSynthesisContext, normalizeProposalSynthesisResult } from './proposal-synthesis.js';
import { isValidEmail } from '../../shared/recipient-validation.mjs';
import { isWorkPlanStepCompleted } from './action-proposals.js';

export function canAddressTeamsDraft(draft) {
  const email = String(draft?.targetEmail || '').trim();
  return email
    ? isValidEmail(email)
    : Boolean(String(draft?.target || '').trim());
}

export function emptyThreadComposer() {
  return {
    threadId: null, requestedChannel: null, status: 'idle', result: null, error: '',
    selectedNextStep: '', requestedNextStep: '',
    viewedActionId: null,
    emailProposalId: null, emailOpen: false, teamsDraft: null, teamsCopyStatus: '',
    teamsSendState: { status: 'idle', message: '' },
  };
}

export function synthesisError(code) {
  if (code === 'AUTH_REQUIRED') return 'WorkIQ sign-in is required before generating a proposal.';
  if (code === 'TIMEOUT') return 'WorkIQ timed out before returning a draft. The request may still be running. Wait for WorkIQ activity to finish before retrying.';
  if (code === 'QUEUE_FULL') return 'WorkIQ is busy. Wait for a running request to finish, then retry.';
  if (code === 'THROTTLED') return 'WorkIQ is temporarily rate limited. Wait for the cooldown, then retry.';
  if (code === 'INVALID_RESPONSE') return 'WorkIQ returned an invalid proposal. No draft was created. Try again.';
  if (code === 'UNSUPPORTED') return 'Proposal synthesis is unavailable through the connected WorkIQ service.';
  if (code === 'SHUTTING_DOWN') return 'Proposal synthesis is unavailable while FlightDeck is closing.';
  return 'Could not generate a grounded proposal. Try again.';
}

export function createThreadComposer() {
  const states = writable(new Map());
  const requests = new Map();
  const read = (id) => get(states).get(id) || emptyThreadComposer();
  function update(id, patch) {
    states.update((entries) => new Map(entries).set(id, { ...(entries.get(id) || emptyThreadComposer()), ...patch }));
  }
  function forget(id) {
    requests.delete(id);
    states.update((entries) => {
      const next = new Map(entries);
      next.delete(id);
      return next;
    });
  }

  async function generate({ item, channel, requestedNextStep = '', propose, saveEmail, isAvailable = () => true }) {
    if (!item || isWorkPlanStepCompleted(item, requestedNextStep) || read(item.id).status === 'generating'
      || read(item.id).teamsSendState.status === 'sending'
      || (channel === 'teams' && read(item.id).teamsSendState.status === 'unconfirmed')) return null;
    const request = {};
    requests.set(item.id, request);
    const current = () => requests.get(item.id) === request && isAvailable(item.id);
    update(item.id, { threadId: item.id, requestedChannel: channel, requestedNextStep, status: 'generating', result: null, error: '' });
    try {
      const context = buildProposalSynthesisContext(item, { requestedChannel: channel, requestedNextStep });
      if (!context || typeof propose !== 'function') throw new Error('UNSUPPORTED');
      const response = await propose(context);
      if (!current()) return null;
      const result = response?.ok === true ? normalizeProposalSynthesisResult(response.result) : null;
      if (!result) throw new Error(response?.code || 'INVALID_RESPONSE');
      const channelResult = { ...result, proposals: result.proposals.filter((proposal) => proposal.channel === channel) };
      const patch = { status: 'ready', result: channelResult, error: '' };
      if (channel === 'email' && channelResult.proposals.length) {
        patch.emailProposalId = await saveEmail(item, channelResult, current, context.requestedNextStep || '');
        if (current() && !patch.emailProposalId) throw new Error('INVALID_RESPONSE');
        patch.emailOpen = true;
      } else if (channel === 'teams' && channelResult.proposals.length) {
        const proposal = channelResult.proposals[0];
        const createdAt = new Date().toISOString();
        const safeItemId = String(item.id).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 80);
        patch.teamsDraft = {
          proposalId: `teams:${safeItemId}:${Date.parse(createdAt)}`,
          sourceItemId: item.id, sourceTitle: item.title, sourceType: item.sourceType, createdAt, attempt: 0,
          nextStep: context.requestedNextStep || '',
          target: proposal.target.displayName, targetEmail: proposal.target.address,
          message: proposal.payload.message, why: result.why, risk: proposal.risk,
          reviewNote: proposal.reviewNote, needsTargetResolution: proposal.needsTargetResolution,
        };
        patch.teamsCopyStatus = '';
        patch.teamsSendState = { status: 'idle', message: '' };
      }
      if (!current()) return null;
      update(item.id, patch);
      return read(item.id);
    } catch (error) {
      if (current()) update(item.id, { status: 'error', result: null, error: synthesisError(error?.message) });
      return null;
    }
  }

  return { subscribe: states.subscribe, read, update, forget, generate };
}

// Drafts belong to threads, not a mounted Radar view or its current selection.
export const threadComposer = createThreadComposer();
