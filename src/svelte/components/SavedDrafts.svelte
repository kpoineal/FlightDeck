<script>
  import { get } from 'svelte/store';
  import { actionProposals, coldItems, history, items, meetings, selectedProposalId, expandedBriefingMeetingIds, mode } from '../lib/stores.js';
  import {
    archiveActionProposal, restoreActionProposal, transitionActionProposal,
    classifyActionProposalView, countActionProposalViews, filterActionProposalsByView,
    findActionProposalDuplicateGroups, classifyActionProposalEffect,
  } from '../lib/action-proposals.js';
  import { permanentlyDeleteActionProposal } from '../lib/item-actions.js';
  import { recordProposalEvent } from '../lib/outlook-draft.js';
  import { openSavedDraft, proposalManagement } from '../lib/saved-drafts.js';
  import { normalizeTodayMeetings } from '../lib/meetings.js';
  import ConfirmModal from './ConfirmModal.svelte';

  let { threadId = null, blocked = false, onselect = null } = $props();
  let activeView = $state('open');
  let localId = $state(null);
  let orphan = $state(false);
  let busy = $state(false);
  let status = $state('');
  let error = $state(false);
  let confirmation = $state(null);
  let returnFocus = $state(null);
  let root = $state(null);
  let scoped = $derived($actionProposals.filter(entry => !threadId || entry.sourceItemId === threadId));
  let counts = $derived(countActionProposalViews(scoped));
  let visible = $derived(filterActionProposalsByView(scoped, activeView));
  let selected = $derived(scoped.find(entry => entry.id === (threadId ? $selectedProposalId : localId)
    && !entry.auditOnly) || null);
  let management = $derived(proposalManagement(selected));
  let duplicates = $derived(findActionProposalDuplicateGroups(scoped)
    .find(group => group.proposalIds.includes(selected?.id)));
  let sourceMeetingAvailable = $derived(normalizeTodayMeetings($meetings)
    .some(meeting => meeting.id === selected?.sourceContextId));

  $effect(() => {
    const view = classifyActionProposalView(selected);
    if (view) activeView = view;
  });

  async function select(proposal) {
    if (busy || blocked) return;
    status = '';
    error = false;
    if (threadId) {
      selectedProposalId.set(proposal.id);
      onselect?.(proposal);
    } else {
      localId = proposal.id;
      orphan = false;
      try {
        orphan = !await openSavedDraft(proposal.id);
      } catch {
        orphan = true;
        status = 'Could not load the source thread. Try opening the draft again.';
        error = true;
      }
    }
  }

  function changeView(view) {
    activeView = view;
    if (!selected || classifyActionProposalView(selected) === view) return;
    if (threadId) {
      selectedProposalId.set(null);
      onselect?.(null);
    } else {
      localId = null;
      orphan = false;
    }
  }

  function request(event, deleting = false, includeDuplicates = false) {
    if (!selected || busy || blocked) return;
    returnFocus = event.currentTarget;
    if (!deleting) {
      if (management) confirmation = { ...management, id: selected.id, label: 'Confirm' };
      return;
    }
    const ids = includeDuplicates ? duplicates?.proposalIds || [selected.id] : [selected.id];
    const entries = scoped.filter(entry => ids.includes(entry.id));
    const threadEvents = [...$items, ...$coldItems].flatMap(item => item.updateHistory || []);
    const effects = entries.map(entry => classifyActionProposalEffect(entry, { threadEvents, globalEvents: $history }));
    const external = effects.some(effect => effect !== 'no-effect');
    confirmation = {
      operation: 'delete', id: selected.id, includeDuplicates,
      label: includeDuplicates ? `Delete ${ids.length} duplicates` : 'Delete permanently',
      summary: external
        ? 'An external action exists or its result is uncertain. Deletion removes only the FlightDeck proposal, not external content. Check the destination service. Evidence remains in Activity and History.'
        : 'No external action occurred. Permanently delete this saved proposal? The source thread and audit history remain.',
      acknowledgement: external ? 'I understand this deletes only the FlightDeck proposal' : '',
    };
    if (entries.some(entry => entry.state === 'Executing')) {
      confirmation.summary += ' An active request cannot be cancelled. A late result may add evidence but will not recreate the proposal.';
    }
  }

  async function confirm() {
    const action = confirmation;
    confirmation = null;
    if (!action || busy) return;
    busy = true;
    status = '';
    error = false;
    try {
      if (action.operation === 'delete') {
        const result = await permanentlyDeleteActionProposal(action.id, { includeDuplicates: action.includeDuplicates });
        if (!result.ok) throw new Error(result.code === 'PERSISTENCE_RECOVERY_REQUIRED'
          ? 'Deletion recovery could not be persisted. Reload FlightDeck before continuing.'
          : 'Could not delete the proposal. Nothing was removed.');
        if (threadId && get(selectedProposalId) === action.id) selectedProposalId.set(null);
        else localId = null;
        status = `${result.deletedCount} proposal(s) permanently deleted. Source thread retained.`;
      } else {
        const current = $actionProposals.find(entry => entry.id === action.id);
        // Recheck the live state: native execution may have claimed this proposal.
        if (!current || proposalManagement(current)?.operation !== action.operation
          || proposalManagement(current)?.event !== action.event) return;
        const updated = action.operation === 'archive' ? archiveActionProposal(current, action.reason)
          : action.operation === 'restore' ? restoreActionProposal(current)
          : transitionActionProposal(current, action.nextState);
        if (updated === current) return;
        actionProposals.update(entries => entries.map(entry => entry.id === current.id ? updated : entry));
        if (threadId && action.operation !== 'restore') {
          selectedProposalId.set(null);
          onselect?.(null);
        }
        await recordProposalEvent(updated, action.event);
        status = `Proposal ${action.event}.`;
      }
    } catch (failure) {
      status = failure.message || 'Could not update this proposal.';
      error = true;
    } finally {
      busy = false;
      requestAnimationFrame(() => root?.querySelector('h4')?.focus());
    }
  }

  function openBriefing() {
    if (!selected?.sourceContextId) return;
    expandedBriefingMeetingIds.update(ids => ids.includes(selected.sourceContextId) ? ids : [...ids, selected.sourceContextId]);
    mode.set('Briefings');
  }
</script>

<section class="saved-drafts" class:saved-drafts--index={!threadId} data-testid={threadId ? 'thread-saved-drafts' : 'today-drafts'} aria-label={threadId ? 'Saved drafts and history' : 'Drafts'} bind:this={root}>
  <h4 tabindex="-1">{threadId ? 'Saved drafts & history' : `Drafts (${counts.open} pending)`}</h4>
  {#if !threadId}<p class="saved-drafts__note">Saved drafts only. Unsent Teams drafts stay in their thread for this session.</p>{/if}
  <div class="saved-drafts__filters" role="group" aria-label="Saved draft filters">
    {#each ['open', 'resolved', 'archived'] as view}
      {@const label = view === 'open' ? 'Pending' : view === 'resolved' ? 'Resolved' : 'Archived'}
      <button type="button" aria-pressed={activeView === view} aria-label={`${label} (${counts[view]})`}
        on:click={() => changeView(view)}>{label} <span class="saved-drafts__count">{counts[view]}</span></button>
    {/each}
  </div>
  <ul class="saved-drafts__list">
    {#each visible as proposal (proposal.id)}
      <li><button type="button" class="saved-drafts__row" data-proposal-id={proposal.id}
        disabled={blocked || busy} aria-pressed={selected?.id === proposal.id} on:click={() => select(proposal)}>
        <span class="saved-drafts__title">{proposal.sourceTitle}</span>
        <span class="saved-drafts__meta">{proposal.state} · {proposal.channel === 'outlook-draft' ? 'Email' : proposal.channel}</span>
      </button></li>
    {:else}<li class="saved-drafts__empty">No {activeView === 'open' ? 'pending' : activeView} drafts.</li>{/each}
  </ul>
  {#if selected && (threadId || orphan)}
    <section class="saved-drafts__details" aria-label="Saved proposal details" data-testid="saved-proposal-details">
      <h5>{selected.sourceTitle} · {selected.archivedAt ? 'Archived · ' : ''}{selected.state}</h5>
      {#if !threadId}
        <p role="status">Source thread unavailable. This legacy proposal is retained read-only; it cannot execute here.
          Open or create a real thread in Radar to compose a new message. Nothing below sends or creates external content.</p>
        {#if selected.sourceDestination === 'Briefings' && selected.sourceContextId}
          {#if sourceMeetingAvailable}
            <button type="button" class="small-btn" on:click={openBriefing}>Open meeting in Briefings</button>
          {:else}
            <p>The original meeting is not on today's saved calendar. Its saved proposal is still retained here.</p>
          {/if}
        {/if}
      {:else if selected.channel !== 'outlook-draft'}
        <p>Saved record only. This channel cannot execute from saved proposals. Use the thread's Email or Teams composer for a new message; Planner and other operations are not supported here.</p>
      {/if}
      <dl>
        <div><dt>Target</dt><dd>{selected.target}</dd></div>
        <div><dt>Original next move</dt><dd>{selected.sourceNextStep || 'Not recorded'}</dd></div>
        <div><dt>Saved content</dt><dd class="saved-drafts__content">{selected.content}</dd></div>
        <div><dt>Reason</dt><dd>{selected.reason}</dd></div>
        {#if selected.evidence?.length}<div><dt>Evidence</dt><dd><ul>{#each selected.evidence as evidence}<li>{evidence}</li>{/each}</ul></dd></div>{/if}
        <div><dt>Review note</dt><dd>{selected.risk}</dd></div>
        <div><dt>Provenance</dt><dd>{selected.provenance}</dd></div>
        <div><dt>Updated</dt><dd>{selected.updatedAt}</dd></div>
        {#if selected.outcome}<div><dt>Outcome</dt><dd>{selected.outcome}</dd></div>{/if}
      </dl>
      <div class="command-buttons">
        {#if management}<button type="button" class="small-btn" data-testid="draft-manage" disabled={busy || blocked}
          on:click={event => request(event)}>{management.label}</button>{/if}
        <button type="button" class="small-btn warn" data-testid="draft-delete" disabled={busy || blocked}
          on:click={event => request(event, true)}>Delete permanently…</button>
        {#if duplicates}<button type="button" class="small-btn warn" data-testid="draft-delete-duplicates" disabled={busy || blocked}
          on:click={event => request(event, true, true)}>Delete {duplicates.proposalIds.length} duplicates…</button>{/if}
      </div>
    </section>
  {/if}
  {#if status}<p role={error ? 'alert' : 'status'}>{status}</p>{/if}
</section>
<ConfirmModal open={Boolean(confirmation)} title={confirmation?.operation === 'delete' ? 'Delete saved proposal?' : 'Manage saved proposal'}
  summary={confirmation?.summary || ''} targets={selected?.sourceTitle || ''}
  confirmLabel={confirmation?.label || 'Confirm'} acknowledgementLabel={confirmation?.acknowledgement || ''}
  {returnFocus} onconfirm={confirm} oncancel={() => { confirmation = null; }} />

<style>
  .saved-drafts { margin-block: 14px; padding: 12px; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-inset); }
  .saved-drafts--index { margin: 16px; }
  .saved-drafts h4 { margin: 0 0 10px; color: var(--text-muted); font-size: .61rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .saved-drafts__note { margin-bottom: 10px; color: var(--text-muted); font-size: .73rem; line-height: 1.5; }
  .saved-drafts__filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .saved-drafts__filters button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 8px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text-muted); font: inherit; font-size: .67rem; cursor: pointer; }
  .saved-drafts__filters button:hover { background: var(--bg-raised); color: var(--text); }
  .saved-drafts__filters button[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
  .saved-drafts__count { min-width: 18px; padding: 1px 5px; border-radius: var(--radius-pill); background: var(--bg-raised); color: var(--text-secondary); font-size: .61rem; font-variant-numeric: tabular-nums; text-align: center; }
  [aria-pressed="true"] .saved-drafts__count { background: color-mix(in srgb, var(--accent) 16%, transparent); color: inherit; }
  .saved-drafts__list { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; max-height: 18rem; overflow: auto; }
  .saved-drafts__row { display: grid; gap: 3px; width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-surface); color: var(--text-secondary); font: inherit; white-space: normal; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
  .saved-drafts__row:hover:not(:disabled) { border-color: var(--border-hover); background: var(--bg-raised); }
  .saved-drafts__row[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface)); }
  .saved-drafts__row:disabled { opacity: .6; cursor: not-allowed; }
  .saved-drafts__title { font-size: .73rem; font-weight: 500; line-height: 1.5; }
  .saved-drafts__meta { color: var(--text-muted); font-size: .64rem; line-height: 1.5; }
  .saved-drafts__list .saved-drafts__empty { padding: 6px 2px 2px; color: var(--text-muted); font-size: .73rem; line-height: 1.5; }
  .saved-drafts__details { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: .73rem; line-height: 1.5; overflow-wrap: anywhere; }
  .saved-drafts__details h5 { margin-bottom: 8px; color: var(--text); font-size: .76rem; font-weight: 600; }
  .saved-drafts__details dl { margin-top: 12px; }
  .saved-drafts__details dt { color: var(--text-muted); font-size: .64rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .saved-drafts__content { white-space: pre-wrap; max-height: 16rem; overflow: auto; }
  .saved-drafts__details dd { margin: .25rem 0 .75rem; }
  .saved-drafts__details dd ul { padding-left: 16px; }
  .saved-drafts :is(button, h4):focus-visible { outline: 2px solid var(--border-active); outline-offset: 2px; }
</style>
