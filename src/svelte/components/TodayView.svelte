<script>
  import { actionProposals, items, meetings, mode, openActionsQueue, selectedProposalId } from '../lib/stores.js';
  import { createActionProposal } from '../lib/action-proposals.js';
  import { isMailboxActive, isMailboxSnoozed, isMailboxUnread } from '../lib/mailbox.js';
  import { safeDate } from '../lib/utils.js';
  import { navigateToRadarItem } from '../lib/radar-navigation.js';

  let active = $derived($items.filter((item) => isMailboxActive(item) && !isMailboxSnoozed(item)));
  let ranked = $derived([...active].sort((a, b) => {
    const rank = { Critical: 0, Elevated: 1, Observe: 2 };
    return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
  }));
  let nextMove = $derived(ranked.find((item) => /meridian/i.test(item.title)) || ranked[0] || null);
  let urgent = $derived(ranked.filter((item) => item.severity === 'Critical' || item.isBlocked).slice(0, 4));
  let approvals = $derived($actionProposals.filter((proposal) => !proposal.archivedAt && ['Drafted', 'Awaiting review', 'Approved'].includes(proposal.state)));

  function propose(item, content = null, initiator = null) {
    if (!item) return;
    const proposal = createActionProposal(item, content || item.suggestedNextSteps?.[0] || `Prepare an update for ${item.title}`, {
      sourceDestination: 'Today',
    });
    actionProposals.update((entries) => [proposal, ...entries.filter((entry) => entry.id !== proposal.id)]);
    selectedProposalId.set(proposal.id);
    openActionsQueue(initiator);
  }
</script>

<section class="command-view today-view" aria-label="Today">
  <header class="command-view__heading">
    <div><span>TODAY</span><h1>Your next move</h1></div>
    <p>{active.length} active threads · {active.filter(isMailboxUnread).length} unread · {$meetings.length} upcoming</p>
  </header>

  {#if nextMove}
    <article class="next-move">
      <div class="next-move__rank">01</div>
      <div class="next-move__body">
        <span class="eyebrow">{nextMove.severity} · {nextMove.status || nextMove.lifecycleStatus}</span>
        <h2>{nextMove.title}</h2>
        <p>{nextMove.summary || nextMove.reason}</p>
        <strong>Recommended next action</strong>
        <p>{nextMove.suggestedNextSteps?.[0] || 'Review the latest evidence and prepare a targeted update.'}</p>
        <div class="command-buttons">
          <button type="button" class="small-btn primary" on:click={(event) => propose(nextMove, null, event.currentTarget)}>Propose update</button>
          <button type="button" class="small-btn" on:click={() => navigateToRadarItem(nextMove.id)}>Open thread</button>
          <button type="button" class="small-btn" on:click={(event) => propose(nextMove, `Confirm owner and timing for: ${nextMove.title}`, event.currentTarget)}>Prepare follow-up</button>
        </div>
      </div>
      <dl class="next-move__health">
        <div><dt>Owner</dt><dd>{nextMove.owner || 'You'}</dd></div>
        <div><dt>Due</dt><dd>{safeDate(nextMove.dueAt, 'No date')}</dd></div>
        <div><dt>Monitoring</dt><dd>{nextMove.monitorEnabled ? 'Active' : 'Off'}</dd></div>
        <div><dt>Evidence</dt><dd>{nextMove.evidenceLinks?.length || 0} linked</dd></div>
      </dl>
    </article>
  {:else}
    <div class="command-empty">No active work. Radar will surface the next move when signals arrive.</div>
  {/if}

  <div class="today-operations">
    <section>
      <header><h2>Urgent work</h2><span>{urgent.length}</span></header>
      {#each urgent as item}
        <button type="button" class="operation-row" on:click={() => navigateToRadarItem(item.id)}>
          <strong>{item.title}</strong><span>{item.owner || 'You'} · {item.status || item.lifecycleStatus}</span>
        </button>
      {:else}<p class="command-empty">No urgent work.</p>{/each}
    </section>
    <section>
      <header><h2>Upcoming meetings</h2><span>{$meetings.length}</span></header>
      {#each $meetings.slice(0, 4) as meeting}
        <button type="button" class="operation-row" on:click={() => mode.set('Briefings')}>
          <strong>{meeting.title}</strong><span>{safeDate(meeting.startAt, 'Time pending')} · {meeting.organizer}</span>
        </button>
      {:else}<p class="command-empty">No upcoming meetings.</p>{/each}
    </section>
    <section>
      <header><h2>Pending approvals</h2><span>{approvals.length}</span></header>
      {#each approvals.slice(0, 4) as proposal}
        <button type="button" class="operation-row" on:click={(event) => { selectedProposalId.set(proposal.id); openActionsQueue(event.currentTarget); }}>
          <strong>{proposal.sourceTitle}</strong><span>{proposal.state} · {proposal.channel}</span>
        </button>
      {:else}<p class="command-empty">No proposals awaiting review.</p>{/each}
    </section>
  </div>
</section>
