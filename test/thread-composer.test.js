import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { canAddressTeamsDraft, createThreadComposer, threadComposer } from '../src/svelte/lib/thread-composer.js';
import { adaptEmailProposalsToActionQueue } from '../src/svelte/lib/proposal-synthesis.js';
import { deletedItemIds, selectedProposalId } from '../src/svelte/lib/stores.js';
import { draftMatchesWorkPlan, resolveWorkPlan } from '../src/svelte/lib/work-plan.js';
import { normalizeItem } from '../src/svelte/lib/models/item.js';
import { isWorkPlanStepCompleted } from '../src/svelte/lib/action-proposals.js';

test('work-plan choice survives normalization and round trip without dropping hidden moves or completion data', () => {
  const raw = {
    id: 'a', title: 'Thread A', suggestedNextSteps: ['Ask Alex for status', 'Ask Jo for acceptance', 'Older hidden move'],
    completedNextSteps: ['Ask Alex for status'],
    workPlanChoice: { mode: 'custom', customText: '  Ask Alex for an update.\nKeep the scope narrow.  ' },
  };
  const restored = normalizeItem(JSON.parse(JSON.stringify(normalizeItem(raw))));
  assert.equal(restored.workPlanChoice.customText, raw.workPlanChoice.customText);
  assert.deepEqual(restored.suggestedNextSteps, raw.suggestedNextSteps);
  assert.equal(restored.completedNextSteps.length, 1);
  const plan = resolveWorkPlan(restored);
  assert.equal(plan.moves.length, 2);
  assert.equal(plan.step, raw.workPlanChoice.customText.trim());
  assert.equal(plan.blockedReason, '');
  assert.equal(isWorkPlanStepCompleted(restored, plan.step), false, 'Typing is not a completed action');
  assert.equal(resolveWorkPlan({ id: 'b' }).customText, '', 'Another thread inherited custom text');
  assert.equal(resolveWorkPlan({ ...restored, suggestedNextSteps: [] }).customText, raw.workPlanChoice.customText);
});

test('blank custom input never falls back to recommendations and new custom asks work after suggestions complete', async () => {
  const composer = createThreadComposer();
  for (const text of ['', ' \n\t ']) {
    const item = { id: 'a', title: 'A', suggestedNextSteps: ['Ask Alex'], workPlanChoice: { mode: 'custom', customText: text } };
    const plan = resolveWorkPlan(item);
    assert.equal(plan.step, '');
    assert.match(plan.blockedReason, /Enter a custom/);
    for (const channel of ['email', 'teams']) assert.equal(await composer.generate({
      item, channel, requestedNextStep: plan.step,
      propose: () => assert.fail('Blank custom instruction reached WorkIQ'),
    }), null);
  }
  const item = { id: 'a', title: 'A', suggestedNextSteps: ['Ask Alex'], completedNextSteps: ['Ask Alex'],
    workPlanChoice: { mode: 'custom', customText: 'Ask Alex to clarify the remaining blocker' } };
  assert.equal(resolveWorkPlan(item).completed, true);
  assert.equal(resolveWorkPlan(item).blockedReason, '');
  assert.ok(await composer.generate({ item, channel: 'teams', requestedNextStep: resolveWorkPlan(item).step,
    propose: async () => response('teams') }));
});

test('selection and text edits never match stale or unrelated drafts; original drafts remain intact', () => {
  const composer = createThreadComposer();
  const draft = { sourceItemId: 'a', nextStep: 'Ask Alex for status', message: 'Reviewed text' };
  composer.update('a', { teamsDraft: draft, emailProposalId: 'older-email', teamsSendState: { status: 'unconfirmed' } });
  for (const step of ['Ask Jo for acceptance', '', 'Ask Alex for status and timeline']) {
    assert.equal(draftMatchesWorkPlan(draft.nextStep, step), false);
  }
  assert.equal(draftMatchesWorkPlan(draft.nextStep, ' Ask Alex for status '), true);
  assert.equal(draftMatchesWorkPlan(undefined, 'Ask Alex for status'), false);
  assert.equal(composer.read('a').teamsDraft, draft);
  assert.equal(composer.read('a').emailProposalId, 'older-email');
  assert.equal(composer.read('a').teamsSendState.status, 'unconfirmed');
  assert.equal(composer.read('b').teamsDraft, null);
});

for (const channel of ['email', 'teams']) {
  test(`custom ${channel} instruction follows draft/completion mapping without leaking local fields or bypassing targets`, async () => {
    const composer = createThreadComposer();
    const instruction = 'Ask Alex to confirm the blocker.\nRequest the update.';
    const item = { id: 'custom-a', title: 'A', doneCriteria: 'Alex confirms the resolution',
      workPlanChoice: { mode: 'custom', customText: `  ${instruction}  ` }, completedNextSteps: [] };
    const contexts = [];
    let saved;
    await composer.generate({
      item, channel, requestedNextStep: resolveWorkPlan(item).step,
      propose: async context => {
        contexts.push(context);
        const result = response(channel);
        result.result.proposals[0].target = { displayName: '', address: '' };
        result.result.proposals[0].needsTargetResolution = true;
        return result;
      },
      saveEmail: async (source, result, current, step) => {
        saved = adaptEmailProposalsToActionQueue(source, result, [], { sourceNextStep: step })[0];
        return saved.id;
      },
    });
    assert.equal(contexts[0].requestedNextStep, instruction);
    assert.equal(contexts[0].thread.doneCriteria, item.doneCriteria);
    assert.equal(Object.hasOwn(contexts[0].thread, 'workPlanChoice'), false);
    assert.equal(isWorkPlanStepCompleted(item, instruction), false);
    if (channel === 'email') {
      assert.equal(saved.sourceNextStep, instruction);
      assert.equal(saved.target, '');
      assert.equal(saved.state, 'Drafted');
    } else {
      const draft = composer.read(item.id).teamsDraft;
      assert.equal(draft.nextStep, instruction);
      assert.equal(draft.targetEmail, '');
      assert.equal(draft.needsTargetResolution, true);
      assert.equal(canAddressTeamsDraft(draft), false);
    }
    item.completedNextSteps = [instruction];
    assert.match(resolveWorkPlan(item).blockedReason, /complete/);
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(channel, text = 'Confirm the window') {
  return { ok: true, result: {
    schemaVersion: 1, recommendation: text, confidence: 'high', why: 'Observed request',
    evidence: [{ kind: 'observed', text: 'Customer requested confirmation' }],
    proposals: [{
      channel, target: { displayName: 'Alex', address: 'alex@example.com' },
      payload: channel === 'email' ? { subject: 'Window', body: text } : { message: text },
    }],
  } };
}

function harness(composer = createThreadComposer()) {
  const saved = [];
  return {
    composer, saved,
    generate(id, channel, pending) {
      return composer.generate({
        item: { id, title: `Thread ${id}`, sourceType: 'Email' }, channel,
        propose: () => pending.promise,
        saveEmail: async (item, result) => {
          const created = adaptEmailProposalsToActionQueue(item, result, saved);
          saved.push(...created);
          return created[0]?.id || saved.find((entry) => entry.sourceItemId === item.id)?.id;
        },
      });
    },
  };
}

test.afterEach(() => {
  selectedProposalId.set(null);
  deletedItemIds.set([]);
});

test('A then B concurrent drafts retain progress and out-of-order results for both threads', async () => {
  const { composer, generate, saved } = harness();
  const a = deferred();
  const b = deferred();
  const first = generate('a', 'email', a);
  const second = generate('b', 'teams', b);
  assert.equal(composer.read('a').status, 'generating');
  assert.equal(composer.read('b').status, 'generating');
  b.resolve(response('teams', 'Message B'));
  await second;
  assert.equal(composer.read('b').teamsDraft.sourceItemId, 'b');
  assert.equal(composer.read('b').teamsDraft.message, 'Message B');
  assert.equal(composer.read('b').teamsDraft.targetEmail, 'alex@example.com');
  assert.equal(composer.read('a').status, 'generating');
  a.resolve(response('email', 'Message A'));
  await first;
  assert.equal(saved[0].sourceItemId, 'a');
  assert.equal(saved[0].content, 'Message A');
  assert.equal(composer.read('a').emailProposalId, saved[0].id);
  assert.equal(composer.read('a').emailOpen, true);
  assert.equal(composer.read('a').status, 'ready');
  assert.equal(composer.read('b').status, 'ready');
});

test('Teams recipients support verified email without a name and reject invalid supplied emails', () => {
  assert.equal(canAddressTeamsDraft({ target: '', targetEmail: ' alex@example.com ' }), true);
  assert.equal(canAddressTeamsDraft({ target: 'Alex' }), true);
  assert.equal(canAddressTeamsDraft({ target: 'Alex', targetEmail: 'not-an-email' }), false);
  assert.equal(canAddressTeamsDraft({ target: 'Alex', targetEmail: 'alex\n@example.com' }), false);
  assert.equal(canAddressTeamsDraft({ target: 'Alex', targetEmail: 'alex\u0000@example.com' }), false);
  assert.equal(canAddressTeamsDraft({ targetEmail: `${'a'.repeat(250)}@example.com` }), false);
  assert.equal(canAddressTeamsDraft({ target: '', targetEmail: '' }), false);
  assert.equal(canAddressTeamsDraft(null), false);
});

for (const channel of ['email', 'teams']) {
  test(`${channel} composition carries the selected next move and keeps selections thread-scoped`, async () => {
    const composer = createThreadComposer();
    const steps = ['Confirm the deployment window.', 'Ask Alex to verify the owner.'];
    composer.update('a', { selectedNextStep: steps[1] });
    composer.update('b', { selectedNextStep: steps[0] });
    const contexts = [];
    const pending = deferred();
    const generation = composer.generate({
      item: { id: 'a', title: 'Thread A', suggestedNextSteps: steps },
      channel, requestedNextStep: composer.read('a').selectedNextStep,
      propose: (context) => { contexts.push(context); return pending.promise; },
      saveEmail: async () => 'saved-email-a',
    });
    assert.equal(composer.read('a').requestedNextStep, steps[1]);
    pending.resolve(response(channel));
    await generation;
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].requestedNextStep, steps[1]);
    assert.equal(contexts[0].requestedChannel, channel);
    assert.deepEqual(contexts[0].thread.suggestedNextSteps, steps);
    assert.equal(composer.read('a').selectedNextStep, steps[1]);
    assert.equal(composer.read('b').selectedNextStep, steps[0]);
    if (channel === 'teams') assert.equal(composer.read('a').teamsDraft.nextStep, steps[1]);
    const unsubscribe = composer.subscribe(() => {});
    unsubscribe();
    assert.equal(composer.read('a').selectedNextStep, steps[1]);
  });
}

test('completed work-plan steps cannot be regenerated in either channel', async () => {
  const composer = createThreadComposer();
  const step = 'Confirm the deployment window.';
  let calls = 0;
  for (const channel of ['email', 'teams']) {
    assert.equal(await composer.generate({
      item: { id: 'a', title: 'Thread A', completedNextSteps: [step] },
      channel, requestedNextStep: step,
      propose: async () => { calls++; return response(channel); },
      saveEmail: async () => 'saved-email-a',
    }), null);
  }
  assert.equal(calls, 0);
});

test('email-only Teams targets retain the address and reviewed unconfirmed state across subscriptions', async () => {
  const { composer, generate } = harness();
  const pending = deferred();
  const generation = generate('a', 'teams', pending);
  const result = response('teams');
  result.result.proposals[0].target.displayName = '';
  pending.resolve(result);
  await generation;
  assert.equal(composer.read('a').teamsDraft.targetEmail, 'alex@example.com');
  assert.equal(composer.read('a').teamsDraft.needsTargetResolution, false);
  assert.equal(canAddressTeamsDraft(composer.read('a').teamsDraft), true);
  composer.update('a', { teamsSendState: { status: 'unconfirmed', message: 'Check Teams before retrying' } });
  const unsubscribe = composer.subscribe(() => {});
  unsubscribe();
  assert.equal(get(composer).get('a').teamsSendState.status, 'unconfirmed');
  assert.equal(await generate('a', 'teams', deferred()), null,
    'Regenerating a draft must not clear an unconfirmed send');
});

test('selecting saved draft history never discards pending drafts on other threads', async () => {
  const { composer, generate } = harness();
  const a = deferred();
  const pending = generate('a', 'teams', a);
  selectedProposalId.set('unrelated-proposal');
  a.resolve(response('teams'));
  await pending;
  assert.equal(composer.read('a').status, 'ready');
  assert.equal(composer.read('a').teamsDraft.sourceItemId, 'a');
  assert.equal(get(selectedProposalId), 'unrelated-proposal');
});

test('duplicate clicks cannot start a second request; failures and retries stay thread-scoped', async () => {
  const { composer, generate } = harness();
  const a = deferred();
  const b = deferred();
  const first = generate('a', 'email', a);
  assert.equal(await generate('a', 'teams', deferred()), null);
  const second = generate('b', 'teams', b);
  a.resolve({ ok: false, code: 'TIMEOUT' });
  b.resolve(response('teams'));
  await Promise.all([first, second]);
  assert.equal(composer.read('a').status, 'error');
  assert.match(composer.read('a').error, /timed out/);
  assert.equal(composer.read('b').status, 'ready');
  const retry = deferred();
  const retried = generate('a', 'email', retry);
  retry.resolve(response('email'));
  await retried;
  assert.equal(composer.read('a').status, 'ready');
  assert.equal(composer.read('a').error, '');
  assert.equal(composer.read('b').teamsDraft.sourceItemId, 'b');
});

test('unsubscribing a Radar view does not lose drafts or edits on remount', async () => {
  const { composer, generate } = harness();
  const a = deferred();
  const unsubscribe = composer.subscribe(() => {});
  const pending = generate('a', 'teams', a);
  unsubscribe();
  a.resolve(response('teams'));
  await pending;
  composer.update('a', {
    teamsDraft: { ...composer.read('a').teamsDraft, target: 'Taylor', message: 'Edited message' },
    teamsSendState: { status: 'sending', message: '' },
  });
  composer.update('a', { teamsSendState: { status: 'sent', message: 'Confirmed' } });
  const restored = get(composer).get('a');
  assert.equal(restored.teamsDraft.target, 'Taylor');
  assert.equal(restored.teamsDraft.message, 'Edited message');
  assert.equal(restored.teamsSendState.status, 'sent');
});

test('deleted threads cannot resurrect drafts or insert late email proposals', async () => {
  const { composer, generate, saved } = harness(threadComposer);
  const a = deferred();
  const first = generate('deleted-a', 'email', a);
  deletedItemIds.set(['deleted-a']);
  a.resolve(response('email'));
  await first;
  assert.equal(saved.length, 0);
  assert.equal(composer.read('deleted-a').status, 'idle');
});

test('forgetting an old request prevents it from overwriting a newer request for the same thread', async () => {
  const { composer, generate } = harness();
  const old = deferred();
  const pending = generate('a', 'teams', old);
  composer.forget('a');
  const fresh = deferred();
  const latest = generate('a', 'teams', fresh);
  fresh.resolve(response('teams', 'New'));
  await latest;
  old.resolve(response('teams', 'Old'));
  await pending;
  assert.equal(composer.read('a').teamsDraft.message, 'New');
});

test('no-communication and malformed responses remain actionable without inventing drafts', async () => {
  const { composer, generate, saved } = harness();
  const none = deferred();
  const pending = generate('a', 'email', none);
  const noProposal = response('email');
  noProposal.result.proposals = [];
  noProposal.result.noCommunicationReason = 'Wait for the owner';
  none.resolve(noProposal);
  await pending;
  assert.equal(composer.read('a').result.noCommunicationReason, 'Wait for the owner');
  assert.equal(saved.length, 0);
  const malformed = deferred();
  const retry = generate('a', 'email', malformed);
  malformed.resolve({ ok: true, result: {} });
  await retry;
  assert.equal(composer.read('a').status, 'error');
  assert.match(composer.read('a').error, /invalid proposal/);
});

test('a later generation failure preserves reviewed Teams edits and blocks generation during send', async () => {
  const { composer, generate } = harness();
  const first = deferred();
  const pending = generate('a', 'teams', first);
  first.resolve(response('teams'));
  await pending;
  const edited = { ...composer.read('a').teamsDraft, target: 'Taylor', message: 'Keep my edits' };
  composer.update('a', { teamsDraft: edited, teamsSendState: { status: 'sending', message: '' } });
  assert.equal(await generate('a', 'email', deferred()), null);
  composer.update('a', { teamsSendState: { status: 'error', message: 'Check Teams before retrying' } });
  await composer.generate({
    item: { id: 'a', title: 'Thread A' }, channel: 'email',
    propose: async () => { throw new Error('private service diagnostic'); },
  });
  assert.equal(composer.read('a').status, 'error');
  assert.equal(composer.read('a').teamsDraft, edited);
  assert.equal(composer.read('a').error.includes('private'), false);
  assert.equal(composer.read('a').teamsSendState.status, 'error');
});

test('a generated email without a saved review proposal is an explicit failure, not invisible success', async () => {
  const composer = createThreadComposer();
  await composer.generate({
    item: { id: 'a', title: 'Thread A' }, channel: 'email',
    propose: async () => response('email'),
    saveEmail: async () => null,
  });
  assert.equal(composer.read('a').status, 'error');
  assert.equal(composer.read('a').emailProposalId, null);
  assert.match(composer.read('a').error, /No draft was created/);
});
