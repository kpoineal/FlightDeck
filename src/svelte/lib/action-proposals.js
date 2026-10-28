const STATES = [
  'Drafted',
  'Awaiting review',
  'Approved',
  'Queued',
  'Executing',
  'Succeeded',
  'Failed',
  'Rejected',
  'Cancelled',
];

const NEXT_STATES = {
  Drafted: ['Awaiting review', 'Cancelled'],
  'Awaiting review': ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Queued', 'Cancelled'],
  Queued: ['Executing', 'Cancelled'],
  Executing: ['Succeeded', 'Failed'],
  Failed: ['Executing', 'Cancelled'],
};

const CHANNELS = new Set(['local-chat', 'planner', 'teams', 'email-send', 'outlook-draft']);
const TERMINAL_STATES = new Set(['Succeeded', 'Rejected', 'Cancelled']);
const TRUSTED_EXECUTION_VERIFICATIONS = new Set(['local-demo', 'runtime-backend-confirmed']);
const DISPATCH_STATUSES = new Set(['not-started', 'not-dispatched', 'dispatched', 'unknown', 'not-applicable']);
const ACTION_UNCONFIRMED_CODE = 'ACTION_UNCONFIRMED';
const EXECUTION_INTERRUPTED_CODE = 'EXECUTION_INTERRUPTED_BEFORE_DISPATCH';
const OUTLOOK_UNCONFIRMED_OUTCOME = 'Outlook draft result could not be confirmed. Check Outlook Drafts before trying again.';
const GENERIC_UNCONFIRMED_OUTCOME = 'Action result could not be confirmed. Check the destination service before trying again.';
const UNVERIFIED_OUTCOME = 'Execution status could not be verified; no external write occurred.';
const FAILED_OUTCOME = 'Action failed; review before retrying.';
const REJECTED_OUTCOME = 'Action rejected during review.';
const AUDIT_ONLY_CODE = 'AUDIT_ONLY';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let proposalSequence = 0;

export const ACTION_PROPOSAL_STATES = Object.freeze(STATES);
export const ACTION_PROPOSAL_VIEWS = Object.freeze(['open', 'resolved', 'archived']);
export const ACTION_PROPOSAL_DISPATCH_STATUSES = Object.freeze([...DISPATCH_STATUSES]);

export function normalizeActionProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  if (proposal.localOnly !== true || !STATES.includes(proposal.state)) return null;

  const id = String(proposal.id || '').trim();
  const target = String(proposal.target || '').trim();
  const content = String(proposal.content || '').trim();
  const createdAt = normalizeTimestamp(proposal.createdAt);
  const updatedAt = normalizeTimestamp(proposal.updatedAt);
  if (!id || !target || !content || !createdAt || !updatedAt || !CHANNELS.has(proposal.channel)) {
    return null;
  }

  const executionCode = normalizeExecutionCode(proposal.executionCode);
  const canonicalSuccess = proposal.state === 'Succeeded'
    ? canonicalSuccessOutcome(proposal.channel, proposal.executionVerification, executionCode)
    : null;
  const trustedSucceeded = Boolean(canonicalSuccess);
  const unconfirmedOutlook = proposal.channel === 'outlook-draft' && (
    (proposal.state === 'Succeeded' && !trustedSucceeded)
    || (proposal.state === 'Failed' && executionCode === ACTION_UNCONFIRMED_CODE)
  );
  const normalizedState = unconfirmedOutlook
    ? 'Failed'
    : proposal.state === 'Succeeded' && !trustedSucceeded
      ? 'Executing'
      : proposal.state;
  const normalizedExecutionCode = unconfirmedOutlook ? ACTION_UNCONFIRMED_CODE : executionCode;
  const archivedAt = normalizedState === 'Executing' ? null : normalizeTimestamp(proposal.archivedAt);
  const dispatchStatus = normalizeDispatchStatus(
    proposal.dispatchStatus,
    normalizedState,
    proposal.executionVerification,
    normalizedExecutionCode
  );
  return {
    id,
    sourceItemId: nullableString(proposal.sourceItemId),
    sourceTitle: String(proposal.sourceTitle || 'Local proposal').trim(),
    sourceType: String(proposal.sourceType || 'FlightDeck').trim(),
    sourceDestination: String(proposal.sourceDestination || 'Radar').trim(),
    sourceContextId: nullableString(proposal.sourceContextId),
    channel: proposal.channel,
    target,
    content,
    reason: String(proposal.reason || '').trim(),
    evidence: Array.isArray(proposal.evidence)
      ? proposal.evidence.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    risk: String(proposal.risk || '').trim(),
    provenance: String(proposal.provenance || '').trim(),
    state: normalizedState,
    outcome: normalizeOutcome(proposal.channel, proposal.state, normalizedState, canonicalSuccess, normalizedExecutionCode),
    executionVerification: trustedSucceeded ? proposal.executionVerification : unconfirmedOutlook ? 'unverified' : null,
    executionCode: normalizedExecutionCode,
    dispatchStatus,
    archivedAt,
    archivedReason: archivedAt ? normalizeArchivedReason(proposal.archivedReason) : null,
    createdAt,
    updatedAt,
    localOnly: true,
    ...(proposal.auditOnly === true ? { auditOnly: true } : {}),
  };
}

export function normalizeActionProposals(proposals) {
  if (!Array.isArray(proposals)) return [];
  return proposals.map(normalizeActionProposal).filter(Boolean);
}

export function createActionProposal(item, suggestion, overrides = {}) {
  const createdAt = overrides.createdAt || new Date().toISOString();
  const channel = overrides.channel || inferChannel(suggestion);
  return {
    id: overrides.id || `proposal_${item?.id || 'local'}_${Date.parse(createdAt) || Date.now()}_${proposalSequence++}`,
    sourceItemId: item?.id || null,
    sourceTitle: item?.title || 'Local proposal',
    sourceType: item?.sourceType || 'FlightDeck',
    sourceDestination: overrides.sourceDestination || 'Radar',
    sourceContextId: overrides.sourceContextId || item?.id || null,
    channel,
    target: overrides.target || targetFor(item, channel),
    content: String(overrides.content || suggestion || item?.suggestedNextSteps?.[0] || 'Review the proposed next action.').trim(),
    reason: overrides.reason || item?.reason || item?.summary || 'Recommended from the selected work thread.',
    evidence: Array.isArray(overrides.evidence)
      ? overrides.evidence
      : (item?.evidenceLinks || []).slice(0, 3).map((entry) => entry.label || entry.url).filter(Boolean),
    risk: overrides.risk || (item?.severity === 'Critical'
      ? 'Critical work: verify target and wording before authorizing.'
      : 'Human review is required before any external action.'),
    provenance: overrides.provenance || `${item?.sourceType || 'FlightDeck'} signal; local review model`,
    state: 'Drafted',
    outcome: null,
    executionVerification: null,
    executionCode: null,
    dispatchStatus: 'not-started',
    archivedAt: null,
    archivedReason: null,
    createdAt,
    updatedAt: createdAt,
    localOnly: true,
  };
}

export function transitionActionProposal(proposal, nextState, at = new Date().toISOString()) {
  const transitionedAt = normalizeTimestamp(at);
  if (!proposal || proposal.auditOnly === true || normalizeTimestamp(proposal.archivedAt) || !transitionedAt || !NEXT_STATES[proposal.state]?.includes(nextState)) {
    return proposal;
  }
  return {
    ...proposal,
    state: nextState,
    updatedAt: transitionedAt,
    outcome: nextState === 'Succeeded'
      ? canonicalSuccessOutcome(proposal.channel, 'local-demo', null)
      : nextState === 'Failed'
        ? `${channelLabel(proposal.channel)} failed in local demo state; no external write occurred.`
        : nextState === 'Rejected'
          ? REJECTED_OUTCOME
          : nextState === 'Cancelled'
            ? cancellationOutcome(proposal.channel)
        : null,
    executionVerification: nextState === 'Succeeded' || nextState === 'Failed' ? 'local-demo' : null,
    executionCode: nextState === 'Cancelled' ? 'CANCELLED' : null,
    dispatchStatus: nextState === 'Executing'
      ? 'not-dispatched'
      : nextState === 'Succeeded' || nextState === 'Failed'
        ? 'not-applicable'
        : nextState === 'Cancelled'
          ? 'not-dispatched'
          : 'not-started',
  };
}

export function recoverStaleExecutingActionProposal(proposal, at = new Date().toISOString()) {
  const normalized = normalizeActionProposal(proposal);
  if (!normalized || normalized.auditOnly === true || normalized.state !== 'Executing') return normalized;

  const updatedAt = normalizeTimestamp(at) || normalized.updatedAt;
  if (normalized.dispatchStatus === 'not-dispatched') {
    return {
      ...normalized,
      state: 'Failed',
      outcome: `${channelLabel(normalized.channel)} execution was interrupted before dispatch. No external action occurred; review before retrying.`,
      executionVerification: null,
      executionCode: EXECUTION_INTERRUPTED_CODE,
      dispatchStatus: 'not-dispatched',
      updatedAt,
    };
  }

  return {
    ...normalized,
    state: 'Failed',
    outcome: unconfirmedOutcome(normalized.channel),
    executionVerification: 'unverified',
    executionCode: ACTION_UNCONFIRMED_CODE,
    dispatchStatus: normalized.dispatchStatus === 'dispatched' ? 'dispatched' : 'unknown',
    updatedAt,
  };
}

export function classifyActionProposalEffect(proposal, { threadEvents = [], globalEvents = [] } = {}) {
  if (!proposal || typeof proposal !== 'object') return 'uncertain';
  const events = [...asArray(threadEvents), ...asArray(globalEvents)]
    .map(actionEventEvidence)
    .filter((event) => event && event.proposalId === proposal.id);

  const proposalCode = normalizeExecutionCode(proposal.executionCode);
  if (
    canonicalSuccessOutcome(proposal.channel, proposal.executionVerification, proposalCode)
    || events.some((event) => event.event === 'succeeded'
      && canonicalSuccessOutcome(event.channel || proposal.channel, event.verification, event.code))
  ) {
    return 'confirmed';
  }

  const dispatchStatus = normalizeDispatchStatus(
    proposal.dispatchStatus,
    proposal.state,
    proposal.executionVerification,
    proposalCode
  );
  if (
    proposal.auditOnly === true
    || proposalCode === ACTION_UNCONFIRMED_CODE
    || proposal.state === 'Executing'
    || dispatchStatus === 'dispatched'
    || dispatchStatus === 'unknown'
    || events.some((event) => ['execution-started', 'action-unconfirmed'].includes(event.event))
    || events.some((event) => event.event === 'succeeded')
  ) {
    return 'uncertain';
  }

  return 'no-effect';
}

export function actionProposalDuplicateKey(proposal) {
  if (!proposal || typeof proposal !== 'object' || proposal.auditOnly === true) return '';
  return [
    normalizeDuplicateText(proposal.sourceItemId),
    normalizeDuplicateText(proposal.channel),
    normalizeDuplicateTarget(proposal.target),
    normalizeDuplicateText(proposal.sourceTitle),
    normalizeDuplicateText(proposal.content),
  ].join('|');
}

export function findActionProposalDuplicateGroups(proposals) {
  const groups = new Map();
  for (const proposal of asArray(proposals)) {
    const key = actionProposalDuplicateKey(proposal);
    const id = String(proposal?.id || '').trim();
    if (!key || !id) continue;
    const proposalIds = groups.get(key) || [];
    proposalIds.push(id);
    groups.set(key, proposalIds);
  }
  return [...groups.entries()]
    .filter(([, proposalIds]) => proposalIds.length > 1)
    .map(([key, proposalIds]) => ({ key, proposalIds }));
}

export function canInsertActionProposal(proposals, candidate) {
  const candidateKey = actionProposalDuplicateKey(candidate);
  if (!candidateKey) return false;
  return !asArray(proposals).some((proposal) => (
    classifyActionProposalView(proposal) === 'open'
    && actionProposalDuplicateKey(proposal) === candidateKey
  ));
}

export function canPermanentlyDeleteActionProposal(proposal) {
  return Boolean(
    proposal
    && typeof proposal === 'object'
    && proposal.auditOnly !== true
    && STATES.includes(proposal.state)
    && String(proposal.id || '').trim()
  );
}

export function classifyActionProposalView(proposal) {
  if (!proposal || proposal.auditOnly === true || !STATES.includes(proposal.state)) return null;
  if (normalizeTimestamp(proposal.archivedAt)) return 'archived';
  return TERMINAL_STATES.has(proposal.state) ? 'resolved' : 'open';
}

export function filterActionProposalsByView(proposals, view) {
  if (!ACTION_PROPOSAL_VIEWS.includes(view) || !Array.isArray(proposals)) return [];
  return proposals.filter((proposal) => classifyActionProposalView(proposal) === view);
}

export function countActionProposalViews(proposals) {
  const counts = { open: 0, resolved: 0, archived: 0 };
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const view = classifyActionProposalView(proposal);
    if (view) counts[view] += 1;
  }
  return counts;
}

export function canArchiveActionProposal(proposal) {
  return Boolean(
    proposal
    && proposal.auditOnly !== true
    && STATES.includes(proposal.state)
    && proposal.state !== 'Executing'
    && !normalizeTimestamp(proposal.archivedAt)
  );
}

export function archiveActionProposal(proposal, reason = null, at = new Date().toISOString()) {
  const archivedAt = normalizeTimestamp(at);
  if (!canArchiveActionProposal(proposal) || !archivedAt) return proposal;
  return {
    ...proposal,
    archivedAt,
    archivedReason: normalizeArchivedReason(reason),
    updatedAt: archivedAt,
  };
}

export function canRestoreActionProposal(proposal) {
  return Boolean(
    proposal
    && proposal.auditOnly !== true
    && STATES.includes(proposal.state)
    && proposal.state !== 'Executing'
    && normalizeTimestamp(proposal.archivedAt)
  );
}

export function restoreActionProposal(proposal, at = new Date().toISOString()) {
  const restoredAt = normalizeTimestamp(at);
  if (!canRestoreActionProposal(proposal) || !restoredAt) return proposal;
  return {
    ...proposal,
    archivedAt: null,
    archivedReason: null,
    updatedAt: restoredAt,
  };
}

export function buildOutlookDraftPayload(proposal) {
  if (proposal?.auditOnly === true) {
    return { ok: false, code: AUDIT_ONLY_CODE };
  }
  if (!proposal || proposal.channel !== 'outlook-draft') {
    return { ok: false, code: 'INVALID_CHANNEL' };
  }

  const subject = String(proposal.sourceTitle || '').trim();
  const body = String(proposal.content || '').trim();
  const to = String(proposal.target || '')
    .split(/[;,]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);

  if (
    !subject
    || subject.length > 500
    || !body
    || body.length > 100000
    || to.length === 0
    || to.length > 50
    || to.some((recipient) => recipient.length > 254 || !EMAIL_PATTERN.test(recipient))
  ) {
    return { ok: false, code: 'INVALID_DRAFT' };
  }

  return { ok: true, payload: { to, subject, body } };
}

export function applyOutlookDraftResult(proposal, result, at = new Date().toISOString()) {
  if (!proposal || proposal.auditOnly === true || proposal.channel !== 'outlook-draft') return proposal;

  if (result?.ok === true && result.action === 'outlook-draft-created') {
    return {
      ...proposal,
      state: 'Succeeded',
      outcome: 'Outlook draft saved in Outlook Drafts. Nothing was sent.',
      executionVerification: 'runtime-backend-confirmed',
      executionCode: 'DRAFT_SAVED',
      dispatchStatus: 'dispatched',
      executionAudit: {
        event: 'succeeded',
        outcome: 'succeeded',
        verification: 'runtime-backend-confirmed',
        code: 'DRAFT_SAVED',
      },
      updatedAt: at,
    };
  }

  if (result?.code === 'CANCELLED' && result.dispatched === false) {
    return {
      ...proposal,
      state: 'Queued',
      outcome: cancellationOutcome(proposal.channel),
      executionVerification: null,
      executionCode: 'CANCELLED',
      dispatchStatus: 'not-dispatched',
      executionAudit: {
        event: 'cancelled',
        outcome: 'cancelled',
        verification: 'not-applicable',
        code: 'CANCELLED',
      },
      updatedAt: at,
    };
  }

  if (result?.dispatched !== false) {
    return {
      ...proposal,
      state: 'Failed',
      outcome: OUTLOOK_UNCONFIRMED_OUTCOME,
      executionVerification: 'unverified',
      executionCode: ACTION_UNCONFIRMED_CODE,
      dispatchStatus: result?.dispatched === true ? 'dispatched' : 'unknown',
      executionAudit: {
        event: 'action-unconfirmed',
        outcome: 'unverified',
        verification: 'unverified',
        code: ACTION_UNCONFIRMED_CODE,
      },
      updatedAt: at,
    };
  }

  const code = typeof result?.code === 'string' && /^[A-Z_]+$/.test(result.code)
    ? result.code
    : 'CREATE_FAILED';
  return {
    ...proposal,
    state: 'Failed',
    outcome: failedOutcome(proposal.channel, code),
    executionVerification: null,
    executionCode: code,
    dispatchStatus: 'not-dispatched',
    executionAudit: {
      event: 'failed',
      outcome: 'failed',
      verification: 'not-applicable',
      code,
    },
    updatedAt: at,
  };
}

export async function executeOutlookDraftAction(proposal, createDraft, at = new Date().toISOString()) {
  if (proposal?.auditOnly === true) return proposal;
  const draft = buildOutlookDraftPayload(proposal);
  if (!draft.ok) return applyOutlookDraftResult(proposal, { ...draft, dispatched: false }, at);
  if (typeof createDraft !== 'function') {
    return applyOutlookDraftResult(proposal, { ok: false, code: 'API_UNAVAILABLE', dispatched: false }, at);
  }

  try {
    const result = await createDraft(draft.payload);
    return applyOutlookDraftResult(proposal, result, at);
  } catch (_) {
    return applyOutlookDraftResult(proposal, { ok: false, code: 'CREATE_FAILED', dispatched: true }, at);
  }
}

export function actionForState(proposal) {
  if (!proposal) return null;
  if (!isReviewableActionProposal(proposal)) return null;
  if (proposal.state === 'Drafted') return { state: 'Awaiting review', label: 'Submit for review' };
  if (proposal.state === 'Awaiting review') return { state: 'Approved', label: 'Approve content' };
  if (proposal.state === 'Approved') return { state: 'Queued', label: `Queue ${channelLabel(proposal.channel)}` };
  if (proposal.state === 'Queued') return { state: 'Executing', label: channelAuthorizationLabel(proposal.channel) };
  if (proposal.state === 'Failed' && proposal.executionCode !== ACTION_UNCONFIRMED_CODE) return {
    state: 'Executing',
    label: proposal.channel === 'outlook-draft' ? 'Retry Outlook draft' : `Retry ${channelLabel(proposal.channel)}`,
  };
  if (proposal.state === 'Executing') return null;
  return null;
}

export function updateActionProposal(proposal, patch, at = new Date().toISOString()) {
  if (!proposal || proposal.auditOnly === true || proposal.archivedAt || proposal.state !== 'Drafted') return proposal;
  const next = {};
  if (Object.hasOwn(patch || {}, 'target')) next.target = String(patch.target || '').trim();
  if (Object.hasOwn(patch || {}, 'content')) next.content = String(patch.content || '').trim();
  if (Object.hasOwn(patch || {}, 'reason')) next.reason = String(patch.reason || '').trim();
  if (!Object.keys(next).length) return proposal;
  return { ...proposal, ...next, updatedAt: at };
}

export function isConcreteActionTarget(target) {
  const value = String(target || '').trim();
  return value.length > 0 && !/^(target to confirm|selected teams channel)$/i.test(value);
}

export function isReviewableActionProposal(proposal) {
  if (proposal?.auditOnly === true || proposal?.archivedAt) return false;
  if (!isConcreteActionTarget(proposal?.target) || String(proposal?.content || '').trim().length === 0) return false;
  return proposal?.channel !== 'outlook-draft' || buildOutlookDraftPayload(proposal).ok;
}

function inferChannel(value = '') {
  const text = String(value).toLowerCase();
  if (text.includes('planner') || text.includes('task')) return 'planner';
  if (text.includes('channel') || text.includes('teams') || text.includes('post')) return 'teams';
  if (text.includes('send')) return 'email-send';
  return 'outlook-draft';
}

function targetFor(item, channel) {
  const people = Array.isArray(item?.counterparties) ? item.counterparties.filter(Boolean) : [];
  if (channel === 'planner') return item?.owner || 'You';
  if (channel === 'teams') return people[0] || 'Selected Teams channel';
  return people.join(', ') || 'Target to confirm';
}

function channelAuthorizationLabel(channel) {
  if (channel === 'local-chat') return 'Open local thread chat';
  if (channel === 'planner') return 'Create Planner task';
  if (channel === 'teams') return 'Post to channel';
  if (channel === 'email-send') return 'Authorize send to target';
  return 'Create Outlook draft';
}

function channelLabel(channel) {
  if (channel === 'local-chat') return 'Local thread chat';
  if (channel === 'planner') return 'Planner task';
  if (channel === 'teams') return 'Teams post';
  if (channel === 'email-send') return 'Email send';
  return 'Outlook draft';
}

function nullableString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeArchivedReason(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return normalized || null;
}

function normalizeOutcome(channel, persistedState, normalizedState, canonicalSuccess, executionCode) {
  if (channel === 'outlook-draft' && executionCode === ACTION_UNCONFIRMED_CODE) {
    return OUTLOOK_UNCONFIRMED_OUTCOME;
  }
  if (persistedState === 'Succeeded') {
    return canonicalSuccess || UNVERIFIED_OUTCOME;
  }
  if (normalizedState === 'Queued' && executionCode === 'CANCELLED') return cancellationOutcome(channel);
  if (normalizedState === 'Failed') return failedOutcome(channel, executionCode);
  if (normalizedState === 'Rejected') return REJECTED_OUTCOME;
  if (normalizedState === 'Cancelled') return cancellationOutcome(channel);
  return null;
}

function canonicalSuccessOutcome(channel, verification, executionCode) {
  if (!TRUSTED_EXECUTION_VERIFICATIONS.has(verification)) return null;
  if (verification === 'local-demo') {
    return `${channelLabel(channel)} completed in local demo state; no external write occurred.`;
  }
  if (channel === 'outlook-draft' && executionCode === 'DRAFT_SAVED') {
    return 'Outlook draft saved in Outlook Drafts. Nothing was sent.';
  }
  if (channel === 'teams' && executionCode === 'SEND_CONFIRMED') {
    return 'Teams message sent with a matching receipt.';
  }
  return null;
}

function unconfirmedOutcome(channel) {
  return channel === 'outlook-draft' ? OUTLOOK_UNCONFIRMED_OUTCOME : GENERIC_UNCONFIRMED_OUTCOME;
}

function normalizeDispatchStatus(value, state, verification, executionCode) {
  if (DISPATCH_STATUSES.has(value)) return value;
  if (verification === 'local-demo') return 'not-applicable';
  if (verification === 'runtime-backend-confirmed' && executionCode) return 'dispatched';
  if (state === 'Executing' || executionCode === ACTION_UNCONFIRMED_CODE) return 'unknown';
  if (state === 'Succeeded' || state === 'Failed') return 'unknown';
  if (state === 'Cancelled') return executionCode === 'CANCELLED' ? 'not-dispatched' : 'not-applicable';
  if (state === 'Rejected') return 'not-applicable';
  return 'not-started';
}

function actionEventEvidence(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : entry;
  return {
    proposalId: String(payload.proposalId || '').trim(),
    event: String(payload.event || '').trim().toLowerCase(),
    channel: CHANNELS.has(payload.channel) ? payload.channel : null,
    verification: TRUSTED_EXECUTION_VERIFICATIONS.has(payload.verification) ? payload.verification : payload.verification,
    code: normalizeExecutionCode(payload.code),
  };
}

function normalizeDuplicateTarget(value) {
  return String(value || '')
    .split(/[;,]/)
    .map(normalizeDuplicateText)
    .filter(Boolean)
    .sort()
    .join(',');
}

function normalizeDuplicateText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cancellationOutcome(channel) {
  if (channel === 'outlook-draft') {
    return 'Outlook draft creation cancelled before dispatch. No external action occurred.';
  }
  if (channel === 'teams') {
    return 'Teams send cancelled before dispatch. No external action occurred.';
  }
  return `${channelLabel(channel)} cancelled before dispatch. No external action occurred.`;
}

function failedOutcome(channel, executionCode) {
  if (channel === 'outlook-draft' && executionCode) {
    return `Outlook draft was not created (${executionCode}).`;
  }
  return executionCode
    ? `${channelLabel(channel)} failed (${executionCode}); review before retrying.`
    : FAILED_OUTCOME;
}

function normalizeExecutionCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}
