<script>
  import { isMailboxActive, mailboxActivityAt, mailboxWorkStatus, mailboxWorkStatusClass, summariesMatch } from '../lib/mailbox.js';
  import { formatTodayTitle, nextUnfinishedMove, todayDeadlineAt } from '../lib/today.js';
  import { safeDate } from '../lib/utils.js';
  import { navigateToRadarItem } from '../lib/radar-navigation.js';

  let { item, now, scannerName = '', reason = '', needsDeadlineReview = false, primary = false } = $props();
  const detailsId = $props.id();
  let expanded = $state(false);
  let nextMove = $derived(isMailboxActive(item) ? nextUnfinishedMove(item) : '');
  let context = $derived(item.summary || item.reason || '');
  let showContext = $derived(context && !summariesMatch(context, nextMove));
  let due = $derived(todayDeadlineAt(item.dueAt));
  let dated = $derived(Number.isFinite(due));
  let dueLabel = $derived(dated && /^\d{4}-\d{2}-\d{2}$/.test(item.dueAt)
    ? new Date(due).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : safeDate(item.dueAt));
  let compactDueLabel = $derived(dated ? new Date(due).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(new Date(due).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  }) : '');
  let activityAt = $derived(mailboxActivityAt(item));
  let hasActivity = $derived(Number.isFinite(Date.parse(activityAt)));
  let title = $derived(formatTodayTitle(item.title));
</script>

<article class="today-thread-card" class:next-move={primary} class:is-expanded={expanded} data-item-id={item.id}
  data-work-status={mailboxWorkStatusClass(item)}>
  <div class="today-thread-card__badges">
    <span class="mailbox-status mailbox-status-{mailboxWorkStatusClass(item)}">{mailboxWorkStatus(item)}</span>
    <span class="pill {(item.severity || 'Observe').toLowerCase()}">{item.severity || 'Observe'}</span>
    {#if item.sourceType}<span class="today-thread-card__source">{item.sourceType}</span>{/if}
    {#if reason}<span class="today-attention-reason">{reason}</span>{/if}
  </div>
  <h2><button type="button" class="today-thread-card__title" title={title} onclick={() => navigateToRadarItem(item.id)}>{title}</button></h2>
  {#if nextMove}
    <div class="today-thread-card__next"><span>Next move</span><p>{nextMove}</p></div>
  {:else if isMailboxActive(item)}
    <p class="today-thread-card__empty">No unfinished recommended move recorded. Open the work plan to review.</p>
  {/if}
  <dl class="today-thread-card__details">
    <div><dt>Owner</dt><dd title={item.owner || 'Owner not set'}>{item.owner || 'Owner not set'}</dd></div>
    <div><dt>Deadline</dt><dd class:today-overdue={dated && due < now}>
      {#if dated}
        {#if due < now}<span>Overdue · </span>{/if}
        <time datetime={item.dueAt} title={dueLabel}>{expanded ? dueLabel : compactDueLabel}</time>
      {:else}No recorded deadline{/if}
    </dd></div>
  </dl>
  <div class="today-thread-card__extra" id={detailsId} hidden={!expanded}>
    {#if showContext}<p class="today-thread-card__summary">{context}</p>{/if}
    <dl class="today-thread-card__details today-thread-card__details--secondary">
      <div><dt>Scanner</dt><dd>{scannerName ? formatTodayTitle(scannerName) : 'Unassigned / unavailable scanner'}</dd></div>
      <div><dt>Last activity</dt><dd>{#if hasActivity}<time datetime={activityAt}>{safeDate(activityAt)}</time>{:else}Not recorded{/if}</dd></div>
    </dl>
  </div>
  <footer>
    {#if needsDeadlineReview}<span class="today-old-deadline">Verify older deadline</span>{/if}
    <button type="button" class="small-btn" aria-expanded={expanded} aria-controls={detailsId}
      onclick={() => { expanded = !expanded; }}>{expanded ? 'Hide details' : 'Show details'}</button>
    <button type="button" class="small-btn" onclick={() => navigateToRadarItem(item.id)}>Open thread</button>
  </footer>
</article>
