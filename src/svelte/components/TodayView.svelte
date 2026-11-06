<script>
  import { onMount, tick } from 'svelte';
  import { actionProposals, coldItems, deletedItemIds, expandedBriefingMeetingIds, items, meetings, mode, openActionsQueue, scanners, selectedProposalId, repositoryRevision } from '../lib/stores.js';
  import { usesRepository } from '../lib/persistence.js';
  import { safeDate } from '../lib/utils.js';
  import { navigateToRadarItem } from '../lib/radar-navigation.js';
  import { buildTodayOverview, formatTodayTitle, todaySelectionItems } from '../lib/today.js';
  import TodayThreadCard from './TodayThreadCard.svelte';

  const eventKinds = [
    { key: 'discovery', label: 'New signals' }, { key: 'update', label: 'Updates' },
    { key: 'lifecycle', label: 'Status changes' }, { key: 'communication', label: 'Confirmed actions' },
  ];
  let now = $state(Date.now());
  let selection = $state(null);
  let selectionOrigin = null;
  let showAll = $state(false);
  let showMeetings = $state(false);
  const database = usesRepository();
  let savedOverview = $state(null);
  let selectionPage = $state(null);
  let selectionOffset = $state(0);
  let queryError = $state('');
  let dashboard = $derived(savedOverview || buildTodayOverview([...$coldItems, ...$items], {
    now, deletedIds: $deletedItemIds, scanners: $scanners, meetings: $meetings,
  }));
  let selectedItems = $derived(database ? selectionPage?.rows || [] : todaySelectionItems(dashboard, selection));
  const bucketCount = bucket => bucket?.count ?? bucket?.items?.length ?? 0;
  let activeCount = $derived(dashboard.activeCount ?? dashboard.active.length);
  let overdueCount = $derived(dashboard.overdueCount ?? dashboard.overdue.length);
  let completedCount = $derived(dashboard.completedCount ?? dashboard.completed.length);
  let dueToday = $derived(bucketCount(dashboard.deadlines.find(bucket => bucket.key === 'today')));
  let maxDeadline = $derived(Math.max(1, ...dashboard.deadlines.map(bucketCount)));
  let maxGroup = $derived(Math.max(1, ...dashboard.groups.map(bucketCount)));
  $effect(() => {
    if (!database) return;
    const revision = $repositoryRevision;
    const time = now;
    let active = true;
    void window.workiq.stateQuery('today', { now: time }).then(result => {
      if (active) { savedOverview = result; queryError = ''; }
    }).catch(() => { if (active) queryError = 'Could not load the saved Today overview.'; });
    return () => { active = false; };
  });
  $effect(() => {
    if (!database || !selection) return;
    const revision = $repositoryRevision;
    const input = { selection: { kind: selection.kind, key: selection.key }, now, offset: selectionOffset, limit: 100 };
    let active = true;
    void window.workiq.stateQuery('today', input).then(result => { if (active) selectionPage = result; })
      .catch(() => { if (active) queryError = 'Could not load this selection.'; });
    return () => { active = false; };
  });
  let maxActivity = $derived(Math.max(1, ...dashboard.activity.map(day => eventTotal(day))));
  let activityCount = $derived(dashboard.activity.reduce((total, day) => total + eventTotal(day), 0));
  let schedule = $derived([...dashboard.schedule].sort((left, right) =>
    Number(Date.parse(left.endAt || left.startAt) < now) - Number(Date.parse(right.endAt || right.startAt) < now)
      || Date.parse(left.startAt) - Date.parse(right.startAt)));
  let approvals = $derived($actionProposals.filter((proposal) => proposal.auditOnly !== true
    && !proposal.archivedAt && !$deletedItemIds.includes(proposal.sourceItemId)
    && ['Drafted', 'Awaiting review', 'Approved'].includes(proposal.state)));
  let progress = $derived([
    ...dashboard.completed.map(entry => ({ ...entry, id: `thread:${entry.item.id}`, label: 'Thread completed' })),
    ...dashboard.confirmed.map(entry => ({
      ...entry, id: `action:${entry.id}`,
      label: entry.channel === 'teams' ? 'Teams message sent' : 'Outlook draft created',
    })),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)));

  onMount(() => {
    const refresh = () => { now = Date.now(); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  });

  function eventTotal(day) {
    return Object.values(day.counts).reduce((total, count) => total + count, 0);
  }

  function segmentOffset(index) {
    return dashboard.statuses.slice(0, index).reduce((total, bucket) => total + bucketCount(bucket), 0)
      / Math.max(1, activeCount) * -100;
  }

  function groupCount(group, key) {
    if (group.statusCounts) return group.statusCounts[key] || 0;
    return group.items.filter(item => (['in-progress', 'blocked', 'waiting'].includes(item.lifecycleStatus)
      ? item.lifecycleStatus : 'unknown') === key).length;
  }

  function groupOffset(group, index) {
    return dashboard.statuses.slice(0, index).reduce((total, bucket) => total + groupCount(group, bucket.key), 0) / maxGroup * 100;
  }

  function activityTop(day, index) {
    return 110 - eventKinds.slice(0, index + 1).reduce((total, kind) => total + day.counts[kind.key], 0) / maxActivity * 100;
  }

  function selected(kind, key) {
    return selection?.kind === kind && selection.key === key;
  }

  async function selectBucket(kind, bucket, origin) {
    if (selected(kind, bucket.key)) return clearSelection();
    selectionOrigin = origin;
    selection = { kind, key: bucket.key, label: bucket.label };
    selectionOffset = 0;
    selectionPage = null;
    showAll = false;
    await tick();
    document.getElementById('today-selection-heading')?.focus();
  }

  async function clearSelection() {
    selection = null;
    showAll = false;
    await tick();
    if (selectionOrigin?.isConnected) selectionOrigin.focus();
  }

  function activateSegment(event, bucket) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectBucket('status', bucket, event.currentTarget);
  }

  function reviewDrafts(initiator) {
    if (!approvals.length) return;
    selectedProposalId.set(approvals[0].id);
    openActionsQueue(initiator);
  }

  async function openMeeting(meetingId) {
    expandedBriefingMeetingIds.update(ids => ids.includes(meetingId) ? ids : [...ids, meetingId]);
    mode.set('Briefings');
    await tick();
    const header = document.getElementById(`meeting-card-${meetingId}`);
    header?.scrollIntoView({ block: 'center' });
    header?.focus({ preventScroll: true });
  }
</script>

<section class="command-view today-view" aria-label="Today" data-testid="today-dashboard">
  {#if queryError}<p role="alert">{queryError}</p>{/if}
  <header class="command-view__heading today-heading">
    <div>
      <span>{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</span>
      <h1>Your day at a glance</h1>
      <p>{activeCount} active threads · {dueToday} deadlines remaining today · {dashboard.schedule.length} meetings on your saved calendar.</p>
    </div>
    <div class="command-buttons">
      <button type="button" class="small-btn" disabled={!approvals.length} onclick={event => reviewDrafts(event.currentTarget)}>Review drafts ({approvals.length})</button>
      <button type="button" class="small-btn" onclick={() => mode.set('Radar')}>Open Radar</button>
    </div>
  </header>

  <dl class="today-stats" aria-label="Today's work at a glance">
    <div><dt>Active threads</dt><dd data-testid="today-active-count">{activeCount}</dd><dd class="today-stat-caption">Excludes snoozed and finished work</dd></div>
    <div class:has-attention={overdueCount > 0}><dt>Overdue</dt><dd data-testid="today-overdue-count">{overdueCount}</dd><dd class="today-stat-caption">Recorded deadlines in the past</dd></div>
    <div><dt>Due today</dt><dd data-testid="today-due-count">{dueToday}</dd><dd class="today-stat-caption">Still ahead, not already overdue</dd></div>
    <div class="today-stat-complete"><dt>Completed today</dt><dd data-testid="today-completed-count">{completedCount}</dd><dd class="today-stat-caption">Threads marked complete</dd></div>
  </dl>

  <div class="today-chart-grid">
    <section class="today-panel" aria-labelledby="today-workload-heading" data-testid="today-workload-chart">
      <header><div><h2 id="today-workload-heading">The shape of your work</h2><p>Select a segment or label to explore its threads.</p></div></header>
      <div class="today-workload">
        <svg class="today-donut" viewBox="0 0 160 160" role="group" aria-label="Active workload by status">
          <circle class="today-chart-track" cx="80" cy="80" r="58" fill="none" stroke-width="16" />
          {#each dashboard.statuses as bucket, index (bucket.key)}
            {#if bucketCount(bucket)}
              <circle class="today-donut-segment today-color-{bucket.key}" cx="80" cy="80" r="58" fill="none"
                stroke-width="16" pathLength="100" transform="rotate(-90 80 80)"
                stroke-dasharray={`${bucketCount(bucket) / activeCount * 100} ${100 - bucketCount(bucket) / activeCount * 100}`}
                stroke-dashoffset={segmentOffset(index)} role="button" tabindex="0"
                aria-label={`${bucket.label}: ${bucketCount(bucket)} threads`} aria-pressed={selected('status', bucket.key)}
                onclick={event => selectBucket('status', bucket, event.currentTarget)}
                onkeydown={event => activateSegment(event, bucket)}><title>{bucket.label}: {bucketCount(bucket)} threads</title></circle>
            {/if}
          {/each}
          <text x="80" y="79" class="today-donut-total" text-anchor="middle" aria-hidden="true">{activeCount}</text>
          <text x="80" y="98" class="today-donut-caption" text-anchor="middle" aria-hidden="true">active threads</text>
        </svg>
        <div class="today-chart-legend">
          {#each dashboard.statuses as bucket (bucket.key)}
            <button type="button" disabled={!bucketCount(bucket)} aria-pressed={selected('status', bucket.key)}
              data-testid="today-status-{bucket.key}" onclick={event => selectBucket('status', bucket, event.currentTarget)}>
              <span class="today-swatch today-color-{bucket.key}"></span><span>{bucket.label}</span><strong>{bucketCount(bucket)}</strong>
            </button>
          {/each}
          <p><span data-testid="today-blocked-count">{dashboard.blockedCount ?? dashboard.blocked.length}</span> blocked or waiting. Status groups do not overlap.</p>
        </div>
      </div>
    </section>

    <section class="today-panel" aria-labelledby="today-deadlines-heading" data-testid="today-deadline-chart">
      <header><div><h2 id="today-deadlines-heading">The deadline picture</h2><p>Each active thread belongs to one bucket. Today means deadlines still ahead.</p></div></header>
      <div class="today-horizontal-chart">
        {#each dashboard.deadlines as bucket (bucket.key)}
          <button type="button" class="today-chart-row" disabled={!bucketCount(bucket)} aria-pressed={selected('deadline', bucket.key)}
            data-testid="today-deadline-{bucket.key}" onclick={event => selectBucket('deadline', bucket, event.currentTarget)}>
            <span class="today-chart-row-label">{bucket.label}</span><strong>{bucketCount(bucket)}</strong>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="today-chart-track" width="100" height="8" rx="3" />
              <rect class="today-color-deadline-{bucket.key}" width={bucketCount(bucket) / maxDeadline * 100} height="8" rx="3" />
            </svg>
          </button>
        {/each}
      </div>
    </section>

    <section class="today-panel" aria-labelledby="today-activity-heading" data-testid="today-activity-chart">
      <header><div><h2 id="today-activity-heading">What has been moving</h2><p>Recorded events over seven local calendar days. Not a reconstructed workload trend.</p></div><span>{activityCount} events</span></header>
      <div class="today-activity-chart">
        {#each dashboard.activity as day (day.key)}
          <button type="button" class="today-activity-day" disabled={!eventTotal(day)} aria-pressed={selected('activity', day.key)}
            aria-label={`${day.label}: ${eventTotal(day)} recorded events across ${bucketCount(day)} threads`}
            data-testid="today-activity-{day.key}" onclick={event => selectBucket('activity', day, event.currentTarget)}>
            <svg viewBox="0 0 44 120" aria-hidden="true">
              <rect class="today-chart-track" x="8" y="10" width="28" height="100" rx="3" />
              {#each eventKinds as kind, index (kind.key)}
                <rect class="today-event-{kind.key}" x="8" y={activityTop(day, index)} width="28" height={day.counts[kind.key] / maxActivity * 100}>
                  <title>{kind.label}: {day.counts[kind.key]}</title>
                </rect>
              {/each}
              <text class="today-activity-total" x="22" y={Math.max(9, 105 - eventTotal(day) / maxActivity * 100)} text-anchor="middle">{eventTotal(day)}</text>
            </svg>
            <span>{day.label}</span>
          </button>
        {/each}
      </div>
      <div class="today-event-legend">{#each eventKinds as kind (kind.key)}<span><i class="today-swatch today-event-{kind.key}"></i>{kind.label}</span>{/each}</div>
      {#if !activityCount}<p class="today-chart-note">No events recorded in the available history for this period.</p>{/if}
    </section>

    <section class="today-panel" aria-labelledby="today-groups-heading" data-testid="today-scanner-chart">
      <header><div><h2 id="today-groups-heading">Where work sits</h2><p>Active work by saved scanner assignment, colored by status. No guessed account names.</p></div></header>
      <div class="today-horizontal-chart">
        {#each dashboard.groups as group (group.key)}
          <button type="button" class="today-chart-row" aria-pressed={selected('scanner', group.key)}
            onclick={event => selectBucket('scanner', group, event.currentTarget)}>
            <span class="today-chart-row-label">{formatTodayTitle(group.label)}</span><strong>{bucketCount(group)}</strong>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="today-chart-track" width="100" height="8" rx="3" />
              {#each dashboard.statuses as bucket, index (bucket.key)}
                <rect class="today-color-{bucket.key}" x={groupOffset(group, index)} width={groupCount(group, bucket.key) / maxGroup * 100} height="8" />
              {/each}
            </svg>
          </button>
        {:else}<p class="command-empty">No active work to group yet.</p>{/each}
      </div>
    </section>
  </div>

  {#if selection}
    <section class="today-panel today-selection" data-testid="today-chart-selection" aria-labelledby="today-selection-heading">
      <header><div><h2 id="today-selection-heading" tabindex="-1">{formatTodayTitle(selection.label)}</h2><p aria-live="polite">{database ? selectionPage?.total || 0 : selectedItems.length} matching threads · open a thread to review its work plan.</p></div><button type="button" class="small-btn" onclick={clearSelection}>Clear selection</button></header>
      <div class="today-selection-list">
        {#each (showAll ? selectedItems : selectedItems.slice(0, 8)) as item (item.id)}
          <TodayThreadCard {item} {now} scannerName={$scanners.find(scanner => scanner.id === item.scannerId)?.name || ''} />
        {:else}<p class="command-empty">No threads remain in this selection. Clear it to explore the current overview.</p>{/each}
      </div>
      {#if selectedItems.length > 8}<button type="button" class="small-btn today-show-all" aria-expanded={showAll} onclick={() => { showAll = !showAll; }}>{showAll ? 'Show fewer threads' : `Show all ${selectedItems.length} threads`}</button>{/if}
      {#if database}
        <nav aria-label="Today selection pages">
          <button class="small-btn" disabled={selectionOffset === 0} onclick={() => { selectionOffset = Math.max(0, selectionOffset - 100); }}>Previous threads</button>
          <button class="small-btn" disabled={!selectionPage?.more} onclick={() => { selectionOffset += 100; }}>Next threads</button>
        </nav>
      {/if}
    </section>
  {/if}

  <div class="today-bottom-grid">
    <section class="today-panel" aria-labelledby="today-attention-heading" data-testid="today-attention">
      <header><div><h2 id="today-attention-heading">Worth your attention</h2><p>A few places to look. Not another copy of your inbox.</p></div></header>
      <div class="today-attention-list">
        {#each dashboard.attention as entry, index (entry.item.id)}
          <TodayThreadCard item={entry.item} {now} reason={entry.reason} needsDeadlineReview={entry.needsDeadlineReview}
            primary={index === 0} scannerName={$scanners.find(scanner => scanner.id === entry.item.scannerId)?.name || ''} />
        {:else}<p class="command-empty" data-testid="today-clear">No urgent, blocked, or waiting work in your active threads. Explore the charts for the rest of your work.</p>{/each}
      </div>
    </section>

    <div class="today-side-column">
      <section class="today-panel" aria-labelledby="today-schedule-heading" data-testid="today-schedule">
        <header><div><h2 id="today-schedule-heading">Today's schedule</h2><p>From your last calendar refresh. Open a meeting for its briefing.</p></div><span>{schedule.length}</span></header>
        {#each (showMeetings ? schedule : schedule.slice(0, 4)) as meeting (meeting.id)}
          <button type="button" class="today-meeting-row" onclick={() => openMeeting(meeting.id)}>
            <time datetime={meeting.startAt}>{new Date(meeting.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
            <span><strong>{formatTodayTitle(meeting.title)}</strong>{#if Date.parse(meeting.startAt) < now}<small>Started earlier today</small>{/if}</span>
          </button>
        {:else}<p class="command-empty">No meetings saved for today. Refresh Briefings to update your calendar.</p>{/each}
        {#if schedule.length > 4}<button type="button" class="small-btn today-show-all" aria-expanded={showMeetings} onclick={() => { showMeetings = !showMeetings; }}>{showMeetings ? 'Show fewer meetings' : `Show all ${schedule.length} meetings`}</button>{/if}
        <button type="button" class="small-btn today-show-all" onclick={() => mode.set('Briefings')}>Open Briefings</button>
      </section>
      <section class="today-panel today-progress" aria-labelledby="today-progress-heading" data-testid="today-progress">
        <header><div><h2 id="today-progress-heading">Progress recorded today</h2><p>Available tracked records and retained history. Outlook drafts are created, not sent.</p></div><span>{progress.length}</span></header>
        {#each progress.slice(0, 5) as entry (entry.id)}
          <button type="button" class="today-work-row today-progress-row" onclick={() => navigateToRadarItem(entry.item.id)}>
            <span class="today-progress-label">{entry.label}</span><strong>{formatTodayTitle(entry.item.title)}</strong><time datetime={entry.at}>{safeDate(entry.at)}</time>
          </button>
        {:else}<p class="command-empty">No completions recorded today yet. Only confirmed outcomes appear here.</p>{/each}
        {#if progress.length > 5}<p class="today-chart-note">{progress.length - 5} more recorded events. Explore today's activity bar for the related threads.</p>{/if}
      </section>
    </div>
  </div>
</section>
