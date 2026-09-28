import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { adaptEmailProposalsToActionQueue } from '../src/svelte/lib/proposal-synthesis.js';
import { normalizeActionProposals } from '../src/svelte/lib/action-proposals.js';

function synthesisResult() {
  return {
    why: 'The customer needs a confirmed deployment window.',
    evidence: [{ kind: 'observed', text: 'Customer asked for deployment timing.' }],
    proposals: [{
      channel: 'email',
      intent: 'Confirm timing',
      target: { displayName: 'Sofia Martinez', address: 'sofia@example.com' },
      payload: { subject: 'Deployment window', body: 'Can you confirm Tuesday at 10:00?' },
    }],
  };
}

test('keeps persisted proposals scoped to their source item', () => {
  const result = synthesisResult();
  const first = adaptEmailProposalsToActionQueue(
    { id: 'thread-a', title: 'Thread A', sourceType: 'Email' },
    result,
    [],
    { id: 'proposal-a', createdAt: '2026-09-11T10:00:00Z' }
  );
  const second = adaptEmailProposalsToActionQueue(
    { id: 'thread-b', title: 'Thread B', sourceType: 'Email' },
    result,
    first,
    { id: 'proposal-b', createdAt: '2026-09-11T10:01:00Z' }
  );

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].sourceItemId, 'thread-a');
  assert.equal(second[0].sourceItemId, 'thread-b');

  const persisted = normalizeActionProposals(JSON.parse(JSON.stringify([...first, ...second])));
  assert.deepEqual(persisted.map((proposal) => proposal.sourceItemId), ['thread-a', 'thread-b']);
});

test('RadarView uses generation checks around both composer proposal paths', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');

  assert.match(source, /createThreadComposerRequestTracker/);
  assert.match(source, /await window\.workiq\.proposeThreadActions\(context\);\s*if \(!isCurrentComposerRequest\(request\)\) return;/s);
  assert.match(source, /await recordRadarActionEvent\([\s\S]*?\);\s*if \(!isCurrentComposerRequest\(request\)\) return;/s);
  assert.match(source, /selectedProposalId\.set\(emailProposal\.id\);\s*openActionsQueue\(initiator\);/s);
  assert.match(source, /sourceItemId: sourceItem\.id/);
});