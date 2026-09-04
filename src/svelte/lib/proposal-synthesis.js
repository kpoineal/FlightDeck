import { canInsertActionProposal, createActionProposal } from './action-proposals.js';

export const PROPOSAL_SYNTHESIS_SCHEMA_VERSION = 1;

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const CHANNELS = new Set(['email', 'teams', 'planner', 'local']);
const REQUESTED_CHANNELS = new Set(['email', 'teams']);
const EVIDENCE_KINDS = new Set(['observed', 'inference']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildProposalSynthesisContext(item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const threadId = boundedString(item.id, 160);
  const title = boundedString(item.title, 240);
  if (!threadId || !title) return null;

  return normalizeProposalSynthesisContext({
    schemaVersion: PROPOSAL_SYNTHESIS_SCHEMA_VERSION,
    requestedChannel: options.requestedChannel,
    thread: {
      id: threadId,
      title,
      summary: boundedString(item.summary, 2000),
      reason: boundedString(item.reason, 1200),
      sourceType: boundedString(item.sourceType, 80),
      severity: boundedString(item.severity, 40),
      owner: boundedString(item.owner, 120),
      updatedAt: validTimestamp(item.updatedAt || item.lastUpdatedAt),
      counterparties: boundedStrings(item.counterparties, 10, 120),
      suggestedNextSteps: boundedStrings(item.suggestedNextSteps, 5, 500),
      evidenceLabels: Array.isArray(item.evidenceLinks)
        ? item.evidenceLinks.slice(0, 8).map((entry) => ({
            label: boundedString(entry?.label, 240),
            type: boundedString(entry?.type, 40),
          })).filter((entry) => entry.label)
        : [],
      recentUpdates: Array.isArray(item.updateHistory)
        ? item.updateHistory.slice(-6).map((entry) => ({
            at: validTimestamp(entry?.at || entry?.timestamp),
            kind: boundedString(entry?.kind || entry?.type, 40),
            summary: boundedString(entry?.summary || entry?.text, 600),
          })).filter((entry) => entry.summary)
        : [],
    },
  });
}

export function normalizeProposalSynthesisContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== PROPOSAL_SYNTHESIS_SCHEMA_VERSION) return null;
  const thread = value.thread;
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) return null;

  const id = boundedString(thread.id, 160);
  const title = boundedString(thread.title, 240);
  if (!id || !title) return null;

  const requestedChannel = boundedString(value.requestedChannel, 16).toLowerCase();
  return {
    schemaVersion: PROPOSAL_SYNTHESIS_SCHEMA_VERSION,
    ...(REQUESTED_CHANNELS.has(requestedChannel) ? { requestedChannel } : {}),
    thread: {
      id,
      title,
      summary: boundedString(thread.summary, 2000),
      reason: boundedString(thread.reason, 1200),
      sourceType: boundedString(thread.sourceType, 80),
      severity: boundedString(thread.severity, 40),
      owner: boundedString(thread.owner, 120),
      updatedAt: validTimestamp(thread.updatedAt),
      counterparties: boundedStrings(thread.counterparties, 10, 120),
      suggestedNextSteps: boundedStrings(thread.suggestedNextSteps, 5, 500),
      evidenceLabels: Array.isArray(thread.evidenceLabels)
        ? thread.evidenceLabels.slice(0, 8).map((entry) => ({
            label: boundedString(entry?.label, 240),
            type: boundedString(entry?.type, 40),
          })).filter((entry) => entry.label)
        : [],
      recentUpdates: Array.isArray(thread.recentUpdates)
        ? thread.recentUpdates.slice(-6).map((entry) => ({
            at: validTimestamp(entry?.at),
            kind: boundedString(entry?.kind, 40),
            summary: boundedString(entry?.summary, 600),
          })).filter((entry) => entry.summary)
        : [],
    },
  };
}

export function parseProposalSynthesisResponse(rawResponse) {
  if (typeof rawResponse !== 'string' || rawResponse.length > 100000) return null;
  try {
    return normalizeProposalSynthesisResult(JSON.parse(rawResponse));
  } catch {
    return null;
  }
}

export function normalizeProposalSynthesisResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== PROPOSAL_SYNTHESIS_SCHEMA_VERSION) return null;

  const confidence = boundedString(value.confidence, 16).toLowerCase();
  if (!CONFIDENCE.has(confidence)) return null;

  const evidence = Array.isArray(value.evidence)
    ? value.evidence.slice(0, 8).map(normalizeEvidence).filter(Boolean)
    : [];
  const proposalsInput = Array.isArray(value.proposals) ? value.proposals.slice(0, 3) : [];
  if (proposalsInput.some((proposal) => !CHANNELS.has(boundedString(proposal?.channel, 20).toLowerCase()))) {
    return null;
  }

  const hasObservedEvidence = evidence.some((entry) => entry.kind === 'observed');
  const proposals = proposalsInput
    .map(normalizeProposal)
    .filter(Boolean)
    .filter((proposal) => proposal.channel === 'local' || hasObservedEvidence);
  const recommendation = boundedString(value.recommendation, 1000);
  if (!recommendation) return null;

  return {
    schemaVersion: PROPOSAL_SYNTHESIS_SCHEMA_VERSION,
    recommendation,
    blocker: boundedString(value.blocker, 800),
    why: boundedString(value.why, 1200),
    confidence: hasObservedEvidence ? confidence : 'low',
    evidence,
    proposals,
    noCommunicationReason: boundedString(value.noCommunicationReason, 800)
      || (proposals.length ? '' : 'No grounded communication proposal was returned.'),
  };
}

export function proposalDedupeKey(threadId, proposal) {
  if (!proposal || typeof proposal !== 'object') return '';
  const payload = proposal.payload || {};
  return [
    boundedString(threadId, 160).toLowerCase(),
    boundedString(proposal.channel, 20).toLowerCase(),
    boundedString(proposal.target?.address || proposal.target?.displayName, 254).toLowerCase(),
    boundedString(payload.subject || payload.title, 500).toLowerCase(),
    boundedString(payload.body || payload.message || payload.description || payload.note, 4000).toLowerCase(),
  ].join('|');
}

export function adaptEmailProposalsToActionQueue(item, result, existing = [], options = {}) {
  if (!item || !result || !Array.isArray(result.proposals)) return [];
  const created = [];

  for (const proposal of result.proposals) {
    if (proposal.channel !== 'email') continue;
    const target = proposal.target.address || proposal.target.displayName;
    const content = proposal.payload.body;
    if (!target || !content) continue;

    const createdProposal = createActionProposal(item, content, {
      ...options,
      channel: 'outlook-draft',
      target,
      content,
      reason: result.why || proposal.intent,
      evidence: result.evidence.map((entry) => entry.text),
      risk: proposal.risk || proposal.reviewNote,
      provenance: 'Grounded WorkIQ proposal synthesis; local review required',
      sourceContextId: item.id,
    });
    const actionProposal = {
      ...createdProposal,
      sourceTitle: proposal.payload.subject || createdProposal.sourceTitle,
    };
    if (!canInsertActionProposal([...(Array.isArray(existing) ? existing : []), ...created], actionProposal)) continue;
    created.push(actionProposal);
  }

  return created;
}

function normalizeEvidence(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const kind = boundedString(entry.kind, 20).toLowerCase();
  const text = boundedString(entry.text, 600);
  return EVIDENCE_KINDS.has(kind) && text ? { kind, text } : null;
}

function normalizeProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const channel = boundedString(value.channel, 20).toLowerCase();
  const target = normalizeTarget(value.target);
  const payload = normalizePayload(channel, value.payload);
  if (!payload) return null;

  const missingContext = boundedStrings(value.missingContext, 8, 240);
  const needsTargetResolution = channel === 'teams'
    ? !target.displayName
    : value.needsTargetResolution === true || (channel === 'email' && !target.address);

  return {
    channel,
    intent: boundedString(value.intent, 500),
    target,
    payload,
    expectedOutcome: boundedString(value.expectedOutcome, 600),
    risk: boundedString(value.risk, 500),
    reviewNote: boundedString(value.reviewNote, 500),
    needsTargetResolution,
    missingContext,
  };
}

function normalizeTarget(value) {
  const target = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const address = boundedString(target.address, 254).toLowerCase();
  return {
    displayName: boundedString(target.displayName, 160),
    address: EMAIL_PATTERN.test(address) ? address : '',
    channelId: boundedString(target.channelId, 240),
    threadId: boundedString(target.threadId, 240),
  };
}

function normalizePayload(channel, value) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (channel === 'email') {
    const subject = boundedString(payload.subject, 500);
    const body = boundedString(payload.body, 10000);
    return subject && body ? { subject, body } : null;
  }
  if (channel === 'teams') {
    const message = boundedString(payload.message, 4000);
    return message ? { message } : null;
  }
  if (channel === 'planner') {
    const title = boundedString(payload.title, 300);
    const description = boundedString(payload.description, 4000);
    return title ? { title, description } : null;
  }
  if (channel === 'local') {
    const note = boundedString(payload.note, 4000);
    return note ? { note } : null;
  }
  return null;
}

function boundedStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((entry) => boundedString(entry, maxLength)).filter(Boolean);
}

function boundedString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '';
}