import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { get } from 'svelte/store';

import { createThreadComposerRequestTracker } from '../src/svelte/lib/thread-composer.js';
import { actionsQueueOpen, openActionsQueue, selectedProposalId } from '../src/svelte/lib/stores.js';

test.beforeEach(() => {
  actionsQueueOpen.set(false);
  selectedProposalId.set(null);
});

test.afterEach(() => {
  actionsQueueOpen.set(false);
  selectedProposalId.set(null);
});

test('rejects a stale request after A to B to A navigation', () => {
  const tracker = createThreadComposerRequestTracker();
  const firstA = tracker.begin('thread-a');

  tracker.setThread('thread-b');
  tracker.setThread('thread-a');

  assert.equal(tracker.isCurrent(firstA), false);
});

test('accepts a current response for the selected thread', () => {
  const tracker = createThreadComposerRequestTracker();
  const current = tracker.begin('thread-a');

  assert.equal(tracker.isCurrent(current), true);
  assert.equal(tracker.begin('thread-a').generation, current.generation);
});

test('Action Queue selection invalidates proposal synthesis for the previous thread', () => {
  const tracker = createThreadComposerRequestTracker();
  const request = tracker.begin('thread-a');

  selectedProposalId.set('proposal-b');
  openActionsQueue('action-queue');

  assert.equal(tracker.isCurrent(request), false);
  assert.equal(get(selectedProposalId), 'proposal-b');
  assert.equal(get(actionsQueueOpen), true);
});

test('hidden Action Queue cannot invalidate proposal synthesis during persistence', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/ActionQueue.svelte', import.meta.url), 'utf8');
  assert.match(source, /if \(\$actionsQueueOpen && visibleSelectionId !== \$selectedProposalId\) selectedProposalId\.set\(visibleSelectionId\)/);
});