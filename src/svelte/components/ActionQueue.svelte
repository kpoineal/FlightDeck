<script>
  import {
    actionProposals,
    actionsQueueFocusOrigin,
    actionsQueueOpen,
    history,
    expandedBriefingMeetingIds,
    items,
    mode,
    selectedProposalId,
  } from '../lib/stores.js';
  import {
    actionProposalDuplicateKey,
    actionForState,
    archiveActionProposal,
    canPermanentlyDeleteActionProposal,
    classifyActionProposalEffect,
    classifyActionProposalView,
    countActionProposalViews,
    executeOutlookDraftAction,
    findActionProposalDuplicateGroups,
    filterActionProposalsByView,
    isReviewableActionProposal,
    restoreActionProposal,
    transitionActionProposal,
    updateActionProposal,
  } from '../lib/action-proposals.js';
  import { createActionEventId, permanentlyDeleteActionProposal, recordActionEvent } from '../lib/item-actions.js';
  import { navigateToRadarItem } from '../lib/radar-navigation.js';
  import ConfirmModal from './ConfirmModal.svelte';

  const VIEWS = [
    { id: 'open', label: 'Open' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'archived', label: 'Archived' },
  ];

  let activeView = $state('open');
  let viewCounts = $derived(countActionProposalViews($actionProposals));
  let visibleProposals = $derived(filterActionProposalsByView($actionProposals, activeView));
  let selected = $derived(visibleProposals.find((proposal) => proposal.id === $selectedProposalId) || visibleProposals[0] || null);
  let nextAction = $derived(actionForState(selected));
  let dialog = $state(null);
  let returnFocus = null;
  let wasOpen = false;
  let draftPending = $state(false);
  let confirmOpen = $state(false);
  let confirmSummary = $state('');
  let confirmTargets = $state('');
  let confirmTitle = $state('Confirm Action');
  let confirmLabel = $state('Confirm');
  let confirmAcknowledgement = $state('');
  let confirmReturnFocus = $state(null);
  let pendingManagement = null;
  let deletePending = $state(false);
  let queueStatus = $state('');
  let queueStatusError = $state(false);
  let duplicateGroups = $derived(findActionProposalDuplicateGroups($actionProposals));
  let selectedDuplicateGroup = $derived(duplicateGroups.find((group) => group.proposalIds.includes(selected?.id)) || null);
  let managementAction = $derived(managementForProposal(selected));

  $effect(() => {
    if ($actionsQueueOpen && !wasOpen) {
      returnFocus = $actionsQueueFocusOrigin || document.activeElement;
      requestAnimationFrame(() => dialog?.focus());
    }
    wasOpen = $actionsQueueOpen;
  });

  $effect(() => {
    if (selected?.id && selected.id !== $selectedProposalId) selectedProposalId.set(selected.id);
  });

  function close() {
    const target = returnFocus;
    returnFocus = null;
    actionsQueueOpen.set(false);
    actionsQueueFocusOrigin.set(null);
    requestAnimationFrame(() => {
      if (target?.isConnected && target !== document.body && !target.disabled && target.getClientRects().length) target.focus();
    });
  }

  function selectProposal(id) {
    selectedProposalId.set(id);
  }

  function returnToSource() {
    if (!selected) return;
    if (selected.sourceDestination === 'Briefings') {
      mode.set('Briefings');
      if (selected.sourceContextId) {
        expandedBriefingMeetingIds.update((ids) => ids.includes(selected.sourceContextId) ? ids : [...ids, selected.sourceContextId]);
      }
    } else if (selected.sourceDestination === 'Today') {
      mode.set('Today');
    } else {
      if (selected.sourceItemId) void navigateToRadarItem(selected.sourceItemId);
    }
    close();
  }

  async function advance(nextState) {
    if (!selected) return;
    let updated = null;
    actionProposals.update((proposals) => proposals.map((proposal) => {
      if (proposal.id !== selected.id) return proposal;
      const next = transitionActionProposal(proposal, nextState);
      if (next !== proposal) updated = next;
      return next;
    }));
    if (!updated) return;
    selectedProposalId.set(updated.id);
    activeView = classifyActionProposalView(updated) || activeView;
    await recordProposalEvent(updated, eventForState(nextState));
  }

  function eventForState(state) {
    return ({
      'Awaiting review': 'review-submitted',
      Approved: 'approved',
      Queued: 'queued',
      Executing: 'execution-started',
      Succeeded: 'succeeded',
      Failed: 'failed',
      Rejected: 'rejected',
      Cancelled: 'cancelled',
    })[state] || null;
  }

  async function recordProposalEvent(proposal, event, {
    code = null,
    attempt = 0,
    outcome = null,
    verification = null,
  } = {}) {
    if (!proposal?.sourceItemId || !event) return false;
    const eventId = createActionEventId({
      proposalId: proposal.id,
      event,
      timestamp: proposal.updatedAt,
      attempt,
    });
    if (!eventId) return false;
    return recordActionEvent({
      eventId,
      itemId: proposal.sourceItemId,
      proposalId: proposal.id,
      event,
      channel: proposal.channel,
      target: proposal.target,
      outcome: outcome || (event === 'succeeded' ? 'succeeded'
        : event === 'failed' ? 'failed'
          : event === 'rejected' ? 'rejected'
            : event === 'cancelled' ? 'cancelled'
              : event === 'archived' ? 'archived'
                : event === 'restored' ? 'restored'
                  : 'pending'),
      verification: verification || (event === 'succeeded' ? proposal.executionVerification || 'unverified'
        : ['approved', 'rejected', 'cancelled', 'archived', 'restored'].includes(event) ? 'not-applicable' : 'unverified'),
      code,
      timestamp: proposal.updatedAt,
    });
  }

  function managementForProposal(proposal) {
    if (!proposal) return null;
    if (proposal.archivedAt) return {
      operation: 'restore',
      event: 'restored',
      label: 'Restore',
      summary: 'Restore this proposal to its previous state?',
    };
    if (proposal.state === 'Drafted') return {
      operation: 'archive',
      event: 'archived',
      label: 'Dismiss proposal',
      reason: 'Dismissed while drafted',
      summary: 'Dismiss this drafted proposal? It will move to Archived and can be restored.',
    };
    if (proposal.state === 'Awaiting review') return {
      operation: 'transition',
      nextState: 'Rejected',
      event: 'rejected',
      label: 'Reject proposal',
      summary: 'Reject this proposal? It will remain in the source thread and audit history.',
    };
    if (['Approved', 'Queued'].includes(proposal.state)) return {
      operation: 'transition',
      nextState: 'Cancelled',
      event: 'cancelled',
      label: 'Cancel proposal',
      summary: 'Cancel this proposal? No external action has occurred.',
    };
    if (['Succeeded', 'Rejected', 'Cancelled', 'Failed'].includes(proposal.state)) return {
      operation: 'archive',
      event: 'archived',
      label: 'Archive',
      reason: 'Archived by user',
      summary: 'Archive this proposal? The source thread and audit history will remain unchanged.',
    };
    return null;
  }

  function requestManagement(event) {
    if (!selected || !managementAction) return;
    confirmReturnFocus = event.currentTarget;
    pendingManagement = { ...managementAction, proposalId: selected.id };
    confirmTitle = 'Confirm Action';
    confirmSummary = managementAction.summary;
    confirmTargets = `${selected.sourceTitle} · ${selected.state}`;
    confirmLabel = 'Confirm';
    confirmAcknowledgement = '';
    confirmOpen = true;
  }

  function duplicateCountFor(proposal) {
    return duplicateGroups.find((group) => group.proposalIds.includes(proposal.id))?.proposalIds.length || 1;
  }

  function effectForProposals(proposals) {
    const threadEvents = $items.flatMap((item) => Array.isArray(item?.updateHistory) ? item.updateHistory : []);
    const effects = proposals.map((proposal) => classifyActionProposalEffect(proposal, {
      threadEvents,
      globalEvents: $history,
    }));
    if (effects.includes('confirmed')) return 'confirmed';
    return effects.includes('uncertain') ? 'uncertain' : 'no-effect';
  }

  function deletionSummary(effect, count, includesExecuting) {
    let summary = effect === 'confirmed'
      ? 'An external draft or message exists. Deleting the FlightDeck proposal will not delete it externally. Effect evidence remains in the thread timeline and History.'
      : effect === 'uncertain'
        ? 'FlightDeck cannot verify whether Outlook or Teams acted. Deletion will not cancel or delete external content. Effect evidence remains in the thread timeline and History.'
        : 'No external action occurred. This removes the proposal from FlightDeck and cannot be undone.';
    if (count > 1) summary = summary.replace('the proposal', `these ${count} proposals`);
    if (includesExecuting) {
      summary += ' An active external request cannot be cancelled. The proposal disappears immediately; a late result may add thread or History evidence but will never recreate the row.';
    }
    return summary;
  }

  function requestDeletion(event, includeDuplicates = false) {
    if (!selected || deletePending || !canPermanentlyDeleteActionProposal(selected)) return;
    const duplicateIds = includeDuplicates ? selectedDuplicateGroup?.proposalIds || [selected.id] : [selected.id];
    const proposals = $actionProposals.filter((proposal) => duplicateIds.includes(proposal.id));
    const effect = effectForProposals(proposals);
    confirmReturnFocus = event.currentTarget;
    pendingManagement = {
      operation: 'delete',
      proposalId: selected.id,
      includeDuplicates,
      selectedIndex: Math.max(0, visibleProposals.findIndex((proposal) => proposal.id === selected.id)),
    };
    confirmTitle = includeDuplicates ? `Delete ${proposals.length} duplicates permanently?` : 'Delete proposal permanently?';
    confirmSummary = deletionSummary(effect, proposals.length, proposals.some((proposal) => proposal.state === 'Executing'));
    confirmTargets = includeDuplicates
      ? `${proposals.length} matching proposals · source thread remains`
      : `${selected.sourceTitle} · ${selected.state} · source thread remains`;
    confirmLabel = includeDuplicates ? `Delete ${proposals.length} duplicates` : 'Delete permanently';
    confirmAcknowledgement = effect === 'no-effect'
      ? ''
      : 'I understand this deletes only the FlightDeck proposal';
    confirmOpen = true;
  }

  async function confirmManagement() {
    const action = pendingManagement;
    confirmOpen = false;
    pendingManagement = null;
    if (!action) return;
    if (action.operation === 'delete') {
      await confirmDeletion(action);
      return;
    }
    const current = $actionProposals.find((proposal) => proposal.id === action.proposalId);
    if (!current) return;
    const changedAt = new Date().toISOString();
    const updated = action.operation === 'archive'
      ? archiveActionProposal(current, action.reason, changedAt)
      : action.operation === 'restore'
        ? restoreActionProposal(current, changedAt)
        : transitionActionProposal(current, action.nextState, changedAt);
    if (updated === current) return;
    actionProposals.update((proposals) => proposals.map((proposal) => proposal.id === current.id ? updated : proposal));
    selectedProposalId.set(updated.id);
    activeView = classifyActionProposalView(updated) || activeView;
    await recordProposalEvent(updated, action.event);
  }

  async function confirmDeletion(action) {
    deletePending = true;
    queueStatus = '';
    queueStatusError = false;
    const result = await permanentlyDeleteActionProposal(action.proposalId, {
      includeDuplicates: action.includeDuplicates,
    });
    if (result.ok) {
      const remaining = filterActionProposalsByView($actionProposals, activeView);
      const nearest = remaining[Math.min(action.selectedIndex, Math.max(0, remaining.length - 1))] || null;
      selectedProposalId.set(nearest?.id || null);
      queueStatus = result.deletedCount === 1
        ? 'Proposal permanently deleted. Source thread retained.'
        : `${result.deletedCount} duplicate proposals permanently deleted. Source thread retained.`;
      requestAnimationFrame(() => {
        const nearestRow = nearest && dialog?.querySelector(`[data-proposal-id="${CSS.escape(nearest.id)}"]`);
        (nearestRow || dialog)?.focus();
      });
    } else {
      const restored = $actionProposals.find((proposal) => proposal.id === action.proposalId);
      if (restored) {
        selectedProposalId.set(restored.id);
        activeView = classifyActionProposalView(restored) || activeView;
      }
      queueStatus = result.code === 'PERSISTENCE_RECOVERY_REQUIRED'
        ? 'Deletion recovery could not be persisted. Reload FlightDeck before continuing.'
        : 'Could not delete the proposal. Nothing was removed.';
      queueStatusError = true;
    }
    deletePending = false;
  }

  function cancelManagement() {
    confirmOpen = false;
    pendingManagement = null;
  }

  function updateSelected(field, value) {
    if (!selected) return;
    actionProposals.update((proposals) => proposals.map((proposal) =>
      proposal.id === selected.id
        ? field === 'sourceTitle' && proposal.state === 'Drafted'
          ? { ...proposal, sourceTitle: String(value || '').trim().slice(0, 500), updatedAt: new Date().toISOString() }
          : updateActionProposal(proposal, { [field]: value })
        : proposal
    ));
  }

  function missingEmailAddress(proposal) {
    if (proposal?.channel !== 'outlook-draft' || proposal.state !== 'Drafted') return false;
    const recipients = String(proposal.target || '').split(/[;,]/).map((value) => value.trim()).filter(Boolean);
    return recipients.length === 0 || recipients.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  }

  async function createOutlookDraft() {
    if (!selected || selected.channel !== 'outlook-draft' || draftPending) return;
    const proposalId = selected.id;
    const executing = {
      ...selected,
      state: 'Executing',
      outcome: null,
      executionVerification: null,
      updatedAt: new Date().toISOString(),
    };
    draftPending = true;
    actionProposals.update((proposals) => proposals.map((proposal) => proposal.id === proposalId ? executing : proposal));
    await recordProposalEvent(executing, 'execution-started');

    const executionResult = await executeOutlookDraftAction(
      executing,
      window.workiq?.createOutlookDraft,
    );
    const { executionAudit = null, ...completed } = executionResult;
    let proposalStillExists = false;
    actionProposals.update((proposals) => proposals.map((proposal) => {
      if (proposal.id !== proposalId) return proposal;
      proposalStillExists = true;
      return completed;
    }));
    if (proposalStillExists) {
      selectedProposalId.set(completed.id);
      activeView = classifyActionProposalView(completed) || activeView;
    }
    if (executionAudit) await recordProposalEvent(completed, executionAudit.event, executionAudit);
    draftPending = false;
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

{#if $actionsQueueOpen}
  <div class="action-queue-backdrop" role="presentation" on:click={(event) => event.target === event.currentTarget && close()}>
    <aside class="action-queue" role="dialog" aria-modal="true" aria-labelledby="action-queue-title"
      data-testid="action-queue"
      tabindex="-1" bind:this={dialog} on:keydown={handleKeydown}>
      <header class="action-queue__header">
        <div>
          <span>Local review workspace</span>
          <h2 id="action-queue-title">Actions</h2>
        </div>
        <button type="button" class="icon-btn" aria-label="Close actions" on:click={close}>×</button>
      </header>
      <p class="action-queue__notice">External actions require explicit confirmation. Outlook drafts are saved only after native confirmation and are never sent automatically.</p>

      <nav class="action-queue__segments" aria-label="Action status" role="tablist">
        {#each VIEWS as view (view.id)}
          <button type="button" role="tab" aria-selected={activeView === view.id}
            class:active={activeView === view.id}
            data-testid={`action-segment-${view.id}`}
            on:click={() => { activeView = view.id; }}>
            <span>{view.label}</span>
            <strong>{viewCounts[view.id]}</strong>
          </button>
        {/each}
      </nav>

      {#if queueStatus}
        <p class="action-queue__status" class:error={queueStatusError}
          role={queueStatusError ? 'alert' : 'status'}>{queueStatus}</p>
      {/if}

      <div class="action-queue__layout">
        <nav class="action-queue__list" aria-label="Action proposals">
          {#if visibleProposals.length}
            {#each visibleProposals as proposal (proposal.id)}
              <button type="button" class:active={selected?.id === proposal.id}
                data-proposal-id={proposal.id} on:click={() => selectProposal(proposal.id)}>
                <span>{proposal.sourceTitle}</span>
                <small>{proposal.state} · {proposal.channel}</small>
                {#if duplicateCountFor(proposal) > 1}<small class="action-duplicate-count">{duplicateCountFor(proposal)} duplicates</small>{/if}
              </button>
            {/each}
          {:else}
            <p data-testid="action-segment-empty">No {activeView} proposals.</p>
          {/if}
        </nav>

        {#if selected}
          <section class="action-review" aria-label="Proposal review">
            <div class="action-review__body">
              <div class="action-review__title">
                <div>
                  <span>{selected.sourceType} source</span>
                  <h3>{selected.sourceTitle}</h3>
                </div>
                <strong>{selected.state}</strong>
              </div>
              {#if selectedDuplicateGroup}
                <p class="action-duplicate-summary" data-testid="action-duplicate-count">{selectedDuplicateGroup.proposalIds.length} duplicates</p>
              {/if}
              <dl>
                <div>
                  <dt><label for="action-target">Exact target</label></dt>
                  <dd>
                    {#if selected.state === 'Drafted'}
                      <input id="action-target" class="action-review__input" value={selected.target}
                        on:change={(event) => updateSelected('target', event.currentTarget.value)} />
                    {:else}{selected.target}{/if}
                  </dd>
                </div>
                <div><dt>Channel</dt><dd>{selected.channel}</dd></div>
                {#if selected.channel === 'outlook-draft'}
                  <div>
                    <dt><label for="action-subject">Subject</label></dt>
                    <dd>
                      {#if selected.state === 'Drafted'}
                        <input id="action-subject" class="action-review__input" value={selected.sourceTitle}
                          on:change={(event) => updateSelected('sourceTitle', event.currentTarget.value)} />
                      {:else}{selected.sourceTitle}{/if}
                    </dd>
                  </div>
                {/if}
                <div>
                  <dt><label for="action-content">Payload / content</label></dt>
                  <dd>
                    {#if selected.state === 'Drafted'}
                      <textarea id="action-content" class="action-review__content action-review__editor"
                        value={selected.content}
                        on:change={(event) => updateSelected('content', event.currentTarget.value)}></textarea>
                    {:else}<div class="action-review__content">{selected.content}</div>{/if}
                  </dd>
                </div>
                <div><dt>Evidence / reason</dt><dd>{selected.reason}{#if selected.evidence.length}<ul>{#each selected.evidence as evidence}<li>{evidence}</li>{/each}</ul>{/if}</dd></div>
                <div><dt>Risk / policy</dt><dd>{selected.risk}</dd></div>
                <div><dt>Provenance</dt><dd>{selected.provenance}</dd></div>
                {#if selected.outcome}<div><dt>Channel outcome</dt><dd>{selected.outcome}</dd></div>{/if}
              </dl>
              <ol class="action-lifecycle" aria-label="Proposal lifecycle">
                {#each ['Drafted', 'Awaiting review', 'Approved', 'Queued', 'Executing', 'Succeeded/Failed'] as state}
                  <li
                    class:current={state === selected.state || (state === 'Succeeded/Failed' && ['Succeeded', 'Failed'].includes(selected.state))}
                    aria-current={state === selected.state || (state === 'Succeeded/Failed' && ['Succeeded', 'Failed'].includes(selected.state)) ? 'step' : undefined}
                    aria-label={state}>
                    {#if state === selected.state || (state === 'Succeeded/Failed' && ['Succeeded', 'Failed'].includes(selected.state))}
                      <span class="action-lifecycle__marker" aria-hidden="true">Current</span>
                    {/if}
                    {state}
                  </li>
                {/each}
              </ol>
              {#if missingEmailAddress(selected)}
                <p class="action-target-warning" role="alert">Email address required for {selected.target || 'recipient'}. Enter an email address above.</p>
              {:else if selected.state === 'Drafted' && !isReviewableActionProposal(selected)}
                <p class="action-target-warning" role="alert">Set a concrete target and content before submitting this proposal for review.</p>
              {/if}
            </div>
            <div class="action-review__buttons">
              <button type="button" class="small-btn" on:click={returnToSource}>Return to source</button>
              {#if managementAction}
                <button type="button" class="small-btn" data-testid="action-manage" on:click={requestManagement}>{managementAction.label}</button>
              {/if}
              {#if selected.state === 'Executing' && selected.channel !== 'outlook-draft'}
                <button type="button" class="small-btn" on:click={() => advance('Failed')}>Mark demo failed</button>
              {/if}
              {#if nextAction}
                <button type="button" class="small-btn primary" disabled={draftPending}
                  on:click={() => selected.channel === 'outlook-draft' && ['Queued', 'Executing', 'Failed'].includes(selected.state)
                    ? createOutlookDraft()
                    : advance(nextAction.state)}>
                  {draftPending && selected.channel === 'outlook-draft' ? 'Creating Outlook draft…' : nextAction.label}
                </button>
              {/if}
              <button type="button" class="small-btn warn action-delete" data-testid="action-delete"
                disabled={deletePending} on:click={(event) => requestDeletion(event)}>
                Delete permanently…
              </button>
              {#if selectedDuplicateGroup}
                <button type="button" class="small-btn warn action-delete" data-testid="action-delete-duplicates"
                  disabled={deletePending} on:click={(event) => requestDeletion(event, true)}>
                  Delete {selectedDuplicateGroup.proposalIds.length} duplicates…
                </button>
              {/if}
            </div>
          </section>
        {/if}
      </div>
    </aside>
    <ConfirmModal open={confirmOpen} title={confirmTitle} summary={confirmSummary} targets={confirmTargets}
      confirmLabel={confirmLabel} acknowledgementLabel={confirmAcknowledgement}
      returnFocus={confirmReturnFocus} onconfirm={confirmManagement} oncancel={cancelManagement} />
  </div>
{/if}
