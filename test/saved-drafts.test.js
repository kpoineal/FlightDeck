import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import fs from 'node:fs';
import { actionProposals, coldItems, deletedItemIds, highlightedItemId, items, mode, selectedProposalId } from '../src/svelte/lib/stores.js';
import { createActionProposal, archiveActionProposal, restoreActionProposal, transitionActionProposal,
  countActionProposalViews, filterActionProposalsByView } from '../src/svelte/lib/action-proposals.js';
import { openSavedDraft, proposalManagement, selectThreadEmail } from '../src/svelte/lib/saved-drafts.js';
import { prepareMeetingFollowUp, meetingFollowUpId } from '../src/svelte/lib/meeting-follow-up.js';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../../demo/fixture.json' && context.parentURL?.endsWith('/src/svelte/lib/persistence.js')) {
      return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createOutlookDraftProposal } = await import('../src/svelte/lib/outlook-draft.js');

const thread = { id: 'one', title: 'Source thread', suggestedNextSteps: ['Ask for timing'] };
const proposal = (id, patch = {}) => ({ ...createActionProposal(thread, 'Email the owner', {
  id, channel: 'outlook-draft', sourceNextStep: 'Ask for timing',
  target: 'alex@example.com', content: 'Please confirm the timing.',
  createdAt: '2026-11-12T10:00:00Z',
}), ...patch });

test.beforeEach(() => {
  globalThis.window = { workiq: {} };
  actionProposals.set([]);
  items.set([]);
  coldItems.set([]);
  deletedItemIds.set([]);
  selectedProposalId.set(null);
  highlightedItemId.set(null);
  mode.set('Today');
});

test('one pending definition includes queued, executing and failed, excludes terminal, archived and audit records', () => {
  const states = ['Drafted', 'Awaiting review', 'Approved', 'Queued', 'Executing', 'Failed', 'Succeeded', 'Rejected', 'Cancelled'];
  const records = states.map(state => proposal(state, { state }));
  records.push(archiveActionProposal(proposal('dismissed')), proposal('audit', { auditOnly: true }));
  assert.deepEqual(countActionProposalViews(records), { open: 6, resolved: 3, archived: 1 });
  assert.deepEqual(filterActionProposalsByView(records, 'open').map(entry => entry.state), states.slice(0, 6));
});

test('stale and archived composer IDs do not pin a disabled email; intentional older/history selection is exact', () => {
  const older = proposal('older', { sourceNextStep: 'An older move' });
  const dismissed = archiveActionProposal(proposal('dismissed'));
  const active = proposal('active');
  const resolved = proposal('sent', { state: 'Succeeded' });
  const records = [older, dismissed, active, resolved];
  assert.equal(selectThreadEmail(records, thread.id, 'Ask for timing', dismissed.id)?.id, active.id);
  assert.equal(selectThreadEmail(records, thread.id, 'Ask for timing', 'deleted')?.id, active.id);
  assert.equal(selectThreadEmail(records, thread.id, 'Ask for timing', active.id, older.id)?.id, older.id);
  assert.equal(selectThreadEmail(records, thread.id, 'Ask for timing', active.id, dismissed.id)?.id, dismissed.id);
  assert.equal(selectThreadEmail(records, thread.id, 'Ask for timing', active.id, resolved.id)?.id, resolved.id);
  assert.equal(selectThreadEmail(records, 'other-thread', 'Ask for timing', active.id, older.id), null);
});

test('Today opens the exact saved draft and originating cold thread, without copying or generating proposals', async () => {
  const saved = archiveActionProposal(proposal('older'));
  const cold = { ...thread, lifecycleStatus: 'archived' };
  actionProposals.set([saved]);
  window.workiq.getColdItems = async () => [cold];
  assert.equal(await openSavedDraft(saved.id), true);
  assert.equal(get(mode), 'Radar');
  assert.equal(get(highlightedItemId), thread.id);
  assert.equal(get(selectedProposalId), saved.id);
  assert.deepEqual(get(actionProposals), [saved]);
});

test('orphan, deleted and audit records never silently select another thread or dispatch', async () => {
  actionProposals.set([proposal('orphan'), proposal('audit', { auditOnly: true })]);
  assert.equal(await openSavedDraft('orphan'), false);
  assert.equal(await openSavedDraft('audit'), false);
  items.set([thread]);
  deletedItemIds.set([thread.id]);
  assert.equal(await openSavedDraft('orphan'), false);
  assert.equal(get(mode), 'Today');
  assert.equal(get(selectedProposalId), null);
});

test('management preserves state and saved text across dismiss/restore and retains reject/cancel/archive policy', () => {
  const original = proposal('managed');
  const dismissed = archiveActionProposal(original, 'Dismissed while drafted');
  assert.equal(proposalManagement(original).label, 'Dismiss proposal');
  assert.equal(proposalManagement(dismissed).operation, 'restore');
  const restored = restoreActionProposal(dismissed);
  assert.equal(restored.state, original.state);
  assert.equal(restored.content, original.content);
  assert.equal(proposalManagement(proposal('review', { state: 'Awaiting review' })).nextState, 'Rejected');
  for (const state of ['Approved', 'Queued']) {
    const saved = proposal('cancel', { state });
    const action = proposalManagement(saved);
    assert.equal(transitionActionProposal(saved, action.nextState).state, 'Cancelled');
  }
  for (const state of ['Succeeded', 'Rejected', 'Cancelled', 'Failed']) {
    assert.equal(proposalManagement(proposal('archive', { state })).operation, 'archive');
  }
  assert.equal(proposalManagement(proposal('executing', { state: 'Executing' })), null);
  assert.equal(proposalManagement(proposal('audit', { auditOnly: true })), null);
});

test('completed work-plan guard also applies to historical cold thread emails', async () => {
  coldItems.set([{ ...thread, completedNextSteps: ['Ask for timing'] }]);
  const saved = proposal('cold-email');
  actionProposals.set([saved]);
  assert.equal(await createOutlookDraftProposal(saved.id, { reviewed: true,
    createDraft: () => assert.fail('Completed cold step dispatched') }), null);
  assert.equal(get(actionProposals)[0].state, 'Drafted');
});

test('meeting follow-up uses the real Work plan, retains context, and never infers an executable channel from the title', () => {
  const meeting = { id: 'meeting', title: 'Teams Planner rollout', organizer: 'Alex', summary: 'Confirm rollout timing.' };
  const briefing = { headline: 'Timing is unresolved', bullets: ['Owner has not confirmed.'],
    sources: [{ label: 'Decision', url: 'https://contoso.sharepoint.com/sites/project/Shared%20Documents/decision.docx' }] };
  const created = prepareMeetingFollowUp(meeting, briefing, []);
  assert.equal(created.created, true);
  assert.equal(created.item.id, meetingFollowUpId(meeting));
  assert.equal(created.item.monitorEnabled, false);
  assert.match(created.item.summary, /Timing is unresolved/);
  assert.match(created.item.summary, /Owner has not confirmed/);
  assert.equal(created.item.evidenceLinks[0].url, briefing.sources[0].url);
  assert.equal(created.workPlanChoice.selectedNextStep, created.suggestedNextSteps[0]);
  assert.equal(Object.hasOwn(created, 'channel'), false);
  assert.equal(get(actionProposals).length, 0);
  const matched = prepareMeetingFollowUp(meeting, briefing, [{ ...created.item,
    suggestedNextSteps: ['Existing ask'], workPlanChoice: { mode: 'custom', customText: 'Unsent ask' } }]);
  assert.equal(matched.created, false);
  assert.equal(matched.item.id, created.item.id);
  assert.equal(matched.workPlanChoice.customText, 'Unsent ask');
  assert.ok(matched.suggestedNextSteps.includes('Existing ask'));
  const retained = prepareMeetingFollowUp(meeting, briefing, [{ id: 'existing', title: meeting.title,
    summary: 'Existing thread context.', suggestedNextSteps: ['Existing ask'] }]);
  assert.equal(retained.created, false);
  assert.match(retained.item.summary, /Existing thread context/);
  assert.match(retained.item.summary, /Timing is unresolved/);
  assert.equal(retained.item.evidenceLinks[0].url, briefing.sources[0].url);
  const selectedSecond = prepareMeetingFollowUp(meeting, briefing, [{ id: 'existing', title: meeting.title,
    suggestedNextSteps: ['First ask', 'Second ask'],
    workPlanChoice: { mode: 'recommended', selectedNextStep: 'Second ask' } }]);
  assert.deepEqual(selectedSecond.suggestedNextSteps, ['First ask', 'Second ask']);
  assert.equal(selectedSecond.workPlanChoice.selectedNextStep, 'Second ask', 'Meeting navigation hid an unsent draft behind a different move');
});

test('unmatched/ambiguous meetings get real threads rather than attaching by a customer word; deleted IDs are not reused', () => {
  const meeting = { id: 'meeting', title: 'Customer renewal review' };
  const unrelated = { id: 'unrelated', title: 'Customer capacity request' };
  assert.equal(prepareMeetingFollowUp(meeting, null, [unrelated]).created, true);
  assert.equal(prepareMeetingFollowUp(meeting, null, [{ id: 'exact', title: meeting.title }]).created, false);
  assert.equal(prepareMeetingFollowUp(meeting, null, [{ id: 'a', title: meeting.title }, { id: 'b', title: meeting.title }]).created, true);
  assert.notEqual(prepareMeetingFollowUp(meeting, null, [], [meetingFollowUpId(meeting)]).item.id, meetingFollowUpId(meeting));
  const completed = { id: meetingFollowUpId(meeting), title: meeting.title, lifecycleStatus: 'complete' };
  const afterCompletion = prepareMeetingFollowUp(meeting, null, [completed]);
  assert.equal(afterCompletion.created, true);
  assert.notEqual(afterCompletion.item.id, completed.id, 'New follow-up overwrote a completed source thread');
  assert.equal(prepareMeetingFollowUp(null, null, []), null);
});

test('no separate Actions destination, fake execution, or second email editor remains', () => {
  const read = path => fs.readFileSync(new URL(`../src/svelte/${path}`, import.meta.url), 'utf8');
  for (const path of ['App.svelte', 'components/Topbar.svelte', 'components/TodayView.svelte', 'components/BriefingsView.svelte',
    'components/EmailDraft.svelte', 'components/RadarView.svelte', 'lib/stores.js']) {
    assert.doesNotMatch(read(path), /import ActionQueue|<ActionQueue|openActionsQueue|onopenActions|actionsQueueOpen|Mark demo failed/);
  }
  const saved = read('components/SavedDrafts.svelte');
  assert.doesNotMatch(saved, /createOutlookDraftProposal|sendTeamsMessage|<textarea|<input/);
  assert.match(saved, /Source thread unavailable/);
  assert.match(saved, /Unsent Teams drafts stay in their thread for this session/);
  assert.match(saved, /permanentlyDeleteActionProposal/);
});
