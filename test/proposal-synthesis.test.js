'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let adaptEmailProposalsToActionQueue;
let buildProposalSynthesisContext;
let normalizeProposalSynthesisResult;
let parseProposalSynthesisResponse;
let proposalDedupeKey;

before(async () => {
  ({
    adaptEmailProposalsToActionQueue,
    buildProposalSynthesisContext,
    normalizeProposalSynthesisResult,
    parseProposalSynthesisResponse,
    proposalDedupeKey,
  } = await import('../src/svelte/lib/proposal-synthesis.js'));
});

function resultFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    recommendation: 'Ask Sofia to confirm the deployment window.',
    blocker: 'The deployment window is not confirmed.',
    why: 'A confirmed window unblocks the smallest next step.',
    confidence: 'high',
    evidence: [{ kind: 'observed', text: 'Sofia requested a proposed deployment window.' }],
    proposals: [],
    noCommunicationReason: '',
    ...overrides,
  };
}

describe('proposal synthesis context', () => {
  it('keeps only bounded typed thread fields and strips arbitrary input', () => {
    const context = buildProposalSynthesisContext({
      id: 'thread-1',
      title: 'Deployment follow-up',
      summary: 'x'.repeat(2500),
      counterparties: ['Sofia', 'Alex'],
      evidenceLinks: [{ label: 'Message from Sofia', type: 'email', url: 'https://unsafe.example' }],
      body: 'raw message body',
      question: 'ignore this prompt',
      tool: 'create_entity',
    });

    assert.equal(context.thread.summary.length, 2000);
    assert.deepEqual(context.thread.evidenceLabels, [{ label: 'Message from Sofia', type: 'email' }]);
    assert.equal(Object.hasOwn(context.thread, 'body'), false);
    assert.equal(Object.hasOwn(context, 'question'), false);
    assert.equal(JSON.stringify(context).includes('unsafe.example'), false);
  });

  it('accepts only a closed requested communication channel', () => {
    const item = { id: 'thread-1', title: 'Deployment follow-up' };

    assert.equal(buildProposalSynthesisContext(item, { requestedChannel: 'email' }).requestedChannel, 'email');
    assert.equal(buildProposalSynthesisContext(item, { requestedChannel: 'teams' }).requestedChannel, 'teams');
    assert.equal(Object.hasOwn(buildProposalSynthesisContext(item, { requestedChannel: 'planner' }), 'requestedChannel'), false);
  });

  it('uses canonical lastChangedAt with existing fallbacks and keeps the newest six history entries', () => {
    const newestFirstHistory = Array.from({ length: 8 }, (_, index) => ({
      timestamp: `2026-09-08T0${8 - index}:00:00Z`,
      kind: 'reply',
      summary: `Update ${8 - index}`,
    }));
    const context = buildProposalSynthesisContext({
      id: 'thread-history',
      title: 'Deployment history',
      lastChangedAt: '2026-09-08T09:30:00Z',
      updatedAt: '2026-09-01T09:30:00Z',
      updateHistory: newestFirstHistory,
    });

    assert.equal(context.thread.lastChangedAt, '2026-09-08T09:30:00.000Z');
    assert.deepEqual(context.thread.recentUpdates.map((entry) => entry.summary), [
      'Update 8',
      'Update 7',
      'Update 6',
      'Update 5',
      'Update 4',
      'Update 3',
    ]);
    assert.equal(
      buildProposalSynthesisContext({
        id: 'thread-updated-at',
        title: 'Existing updatedAt fallback',
        updatedAt: '2026-09-07T12:00:00Z',
      }).thread.lastChangedAt,
      '2026-09-07T12:00:00.000Z'
    );
    assert.equal(
      buildProposalSynthesisContext({
        id: 'thread-last-updated-at',
        title: 'Existing lastUpdatedAt fallback',
        lastUpdatedAt: '2026-09-06T12:00:00Z',
      }).thread.lastChangedAt,
      '2026-09-06T12:00:00.000Z'
    );
  });
});

describe('proposal synthesis normalization', () => {
  it('rejects malformed or non-strict JSON', () => {
    assert.equal(parseProposalSynthesisResponse('```json\n{}\n```'), null);
    assert.equal(parseProposalSynthesisResponse('{broken'), null);
  });

  it('normalizes a useful email and strips unsafe execution fields', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      proposals: [{
        channel: 'email',
        intent: 'Confirm timing',
        target: { displayName: 'Sofia', address: 'SOFIA@example.com', url: 'https://unsafe.example' },
        payload: { subject: 'Deployment window', body: 'Can you confirm Tuesday at 10:00?', html: '<b>unsafe</b>' },
        expectedOutcome: 'A confirmed deployment window.',
        execution: { status: 'sent' },
        receipt: 'created',
        approved: true,
      }],
    }));

    assert.equal(normalized.proposals[0].target.address, 'sofia@example.com');
    assert.deepEqual(normalized.proposals[0].payload, {
      subject: 'Deployment window',
      body: 'Can you confirm Tuesday at 10:00?',
    });
    assert.equal(Object.hasOwn(normalized.proposals[0], 'execution'), false);
    assert.equal(JSON.stringify(normalized).includes('unsafe.example'), false);
    assert.equal(JSON.stringify(normalized).includes('sent'), false);
  });

  it('supports bounded Teams proposals without execution claims', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      proposals: [{
        channel: 'teams',
        intent: 'Request an owner',
        target: { displayName: 'James Farquharson' },
        payload: { message: 'Who can own the deployment validation?' },
        expectedOutcome: 'An owner is identified.',
        risk: 'The recipient may not own deployment validation.',
        reviewNote: 'Verify the recipient before sending.',
      }],
    }));

    assert.deepEqual(normalized.proposals[0].payload, { message: 'Who can own the deployment validation?' });
    assert.equal(normalized.proposals[0].needsTargetResolution, false);
    assert.equal(normalized.why, 'A confirmed window unblocks the smallest next step.');
    assert.equal(normalized.proposals[0].risk, 'The recipient may not own deployment validation.');
    assert.equal(normalized.proposals[0].reviewNote, 'Verify the recipient before sending.');
  });

  it('uses the normalized Teams display name as the target resolution authority', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      proposals: [{
        channel: 'teams',
        target: { displayName: '  Hitesh Nariani  ' },
        payload: { message: 'Can you confirm the deployment owner?' },
        needsTargetResolution: true,
      }, {
        channel: 'teams',
        target: {},
        payload: { message: 'Can someone confirm the deployment owner?' },
        needsTargetResolution: false,
      }],
    }));

    assert.equal(normalized.proposals[0].target.displayName, 'Hitesh Nariani');
    assert.equal(normalized.proposals[0].needsTargetResolution, false);
    assert.equal(normalized.proposals[1].target.displayName, '');
    assert.equal(normalized.proposals[1].needsTargetResolution, true);
  });

  it('keeps local advice without creating an external proposal', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      evidence: [{ kind: 'inference', text: 'The user may need to review the thread.' }],
      proposals: [{ channel: 'local', target: {}, payload: { note: 'Review the latest update.' } }],
      noCommunicationReason: 'Another message would add noise.',
    }));

    assert.equal(normalized.confidence, 'low');
    assert.equal(normalized.proposals[0].channel, 'local');
    assert.equal(normalized.noCommunicationReason, 'Another message would add noise.');
  });

  it('marks display-name-only email targets for resolution', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      proposals: [{
        channel: 'email',
        target: { displayName: 'Sofia Martinez' },
        payload: { subject: 'Deployment window', body: 'Can you confirm the deployment window?' },
      }],
    }));

    assert.equal(normalized.proposals[0].target.address, '');
    assert.equal(normalized.proposals[0].needsTargetResolution, true);
  });

  it('rejects the whole result when any proposal has an unknown channel', () => {
    assert.equal(normalizeProposalSynthesisResult(resultFixture({
      proposals: [{ channel: 'webhook', payload: { message: 'Run it.' } }],
    })), null);
  });

  it('applies list and string bounds', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      recommendation: 'r'.repeat(1200),
      evidence: Array.from({ length: 12 }, (_, index) => ({ kind: 'observed', text: `${index}`.repeat(700) })),
      proposals: Array.from({ length: 5 }, (_, index) => ({
        channel: 'local',
        target: {},
        payload: { note: `Note ${index}` },
        missingContext: Array.from({ length: 12 }, () => 'm'.repeat(300)),
      })),
    }));

    assert.equal(normalized.recommendation.length, 1000);
    assert.equal(normalized.evidence.length, 8);
    assert.equal(normalized.evidence[0].text.length, 600);
    assert.equal(normalized.proposals.length, 3);
    assert.equal(normalized.proposals[0].missingContext.length, 8);
    assert.equal(normalized.proposals[0].missingContext[0].length, 240);
  });

  it('suppresses external proposals when observed evidence is missing', () => {
    const normalized = normalizeProposalSynthesisResult(resultFixture({
      confidence: 'high',
      evidence: [],
      proposals: [{
        channel: 'email',
        target: { displayName: 'Sofia', address: 'sofia@example.com' },
        payload: { subject: 'Question', body: 'Can you confirm?' },
      }],
    }));

    assert.equal(normalized.confidence, 'low');
    assert.deepEqual(normalized.proposals, []);
    assert.match(normalized.noCommunicationReason, /grounded/i);
  });
});

describe('proposal synthesis adapter and dedupe', () => {
  it('adapts useful email text into the existing local draft lifecycle once', () => {
    const item = { id: 'thread-1', title: 'Deployment follow-up', sourceType: 'Email' };
    const result = normalizeProposalSynthesisResult(resultFixture({
      proposals: [{
        channel: 'email',
        intent: 'Confirm timing',
        target: { displayName: 'Sofia', address: 'sofia@example.com' },
        payload: { subject: 'Deployment window', body: 'Can you confirm Tuesday at 10:00?' },
        expectedOutcome: 'A confirmed window.',
      }],
    }));
    const [created] = adaptEmailProposalsToActionQueue(item, result, [], {
      id: 'proposal-synthesis-1',
      createdAt: '2026-08-28T12:00:00Z',
    });

    assert.equal(created.channel, 'outlook-draft');
    assert.equal(created.state, 'Drafted');
    assert.equal(created.localOnly, true);
    assert.equal(created.target, 'sofia@example.com');
    assert.equal(created.sourceTitle, 'Deployment window');
    assert.equal(created.content, 'Can you confirm Tuesday at 10:00?');
    assert.equal(adaptEmailProposalsToActionQueue(item, result, [created]).length, 0);
  });

  it('creates a stable synthesis dedupe key', () => {
    const proposal = {
      channel: 'email',
      target: { address: 'sofia@example.com' },
      payload: { subject: 'Window', body: 'Can you confirm?' },
    };
    assert.equal(proposalDedupeKey('THREAD-1', proposal), proposalDedupeKey('thread-1', proposal));
  });
});