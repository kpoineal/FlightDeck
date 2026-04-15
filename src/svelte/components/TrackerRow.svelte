<script>
  import { createEventDispatcher } from 'svelte';
  import { scanners } from '../lib/stores.js';
  import { severityClass, safeDate, relativeTime, signalRecencyLabel, unseenHistoryCount } from '../lib/utils.js';
  import { LIFECYCLE_STATUSES, LIFECYCLE_LABELS } from '../lib/constants.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import ScheduleControls from './ScheduleControls.svelte';

  export let item;
  export let expanded = false;

  const dispatch = createEventDispatcher();

  let isExpanded = expanded;
  let monitoringOpen = false;
  let promptPanelOpen = false;
  let peopleOpen = true;
  let linksOpen = true;

  $: isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
  $: hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
  $: unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);
  $: people = Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed';
  $: links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
  $: lastUpdate = item.lastChangedAt || item.lastRunAt || null;
  $: lastUpdateTime = lastUpdate ? new Date(lastUpdate) : null;
  $: lastUpdateStr = lastUpdateTime && Number.isFinite(lastUpdateTime.getTime()) ? lastUpdateTime.toLocaleString() : null;
  $: rt = relativeTime(lastUpdate);
  $: steps = Array.isArray(item.suggestedNextSteps) ? item.suggestedNextSteps : [];
  $: sevClass = severityClass(item.severity);
  $: summaryTruncated = (item.summary || '').replace(/\n/g, ' ').slice(0, 140);
  $: summaryEllipsis = (item.summary || '').length > 140;
</script>

<div
  class="tracker-row-wrapper"
  class:is-new={hasNew}
  class:snoozed-card={item.lifecycleStatus === 'snoozed'}
  data-tracker-id={item.id}
  data-item-severity={item.severity || 'Observe'}
  data-item-status={item.lifecycleStatus || 'in-progress'}
  data-item-new={hasNew ? 'true' : 'false'}
>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="tracker-row" class:has-new-update={hasNew} class:expanded={isExpanded}
    on:click|self={() => { isExpanded = !isExpanded; }}>
    <select class="severity-select {sevClass}" value={item.severity}
      on:change={(e) => dispatch('severitychange', { itemId: item.id, value: e.target.value })}
      on:click|stopPropagation>
      <option value="Critical">Critical</option>
      <option value="Elevated">Elevated</option>
      <option value="Observe">Observe</option>
    </select>
    <select class="status-select status-{item.lifecycleStatus || 'in-progress'}" value={item.lifecycleStatus}
      on:change={(e) => dispatch('statuschange', { itemId: item.id, value: e.target.value })}
      on:click|stopPropagation>
      {#each LIFECYCLE_STATUSES as s}
        <option value={s}>{LIFECYCLE_LABELS[s]}</option>
      {/each}
    </select>
    {#if item.lifecycleStatus === 'snoozed'}
      <span class="snooze-until-label" title="Snoozed until {item.snoozeUntil ? safeDate(item.snoozeUntil) : 'next scan'}">
        \uD83D\uDCA4 {item.snoozeUntil ? (relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}
      </span>
    {/if}
    {#if item.monitorEnabled === false && !isTerminalStatus}
      <span class="pill paused-pill">Paused</span>
    {/if}
    {#if hasNew}
      <span class="pill badge-pill">{unseenCount > 1 ? unseenCount + ' ' : ''}New</span>
    {/if}
    {#if rt}
      <span class="pill last-updated-pill" class:popped={hasNew} title="Updated: {safeDate(lastUpdate)}">{rt}</span>
    {/if}
    <span class="tracker-row-title">{item.title || 'Untitled item'}</span>
    <span class="tracker-row-summary">{summaryTruncated}{summaryEllipsis ? '\u2026' : ''}</span>
    <span class="tracker-row-due">{item.dueAt ? safeDate(item.dueAt) : 'Set due'}</span>
    <span class="row-expand-chevron" class:open={isExpanded}>&#9660;</span>
  </div>

  {#if isExpanded}
    <div class="tracker-row-detail show">
      {#if hasNew && lastUpdateStr}
        <div class="tracker-updated-at">Updated: {lastUpdateStr} ({rt})</div>
      {/if}
      <ActivityTimeline entries={Array.isArray(item.updateHistory) ? item.updateHistory : []} {item} maxVisible={3} />

      {#if steps.length}
        <div class="next-step-hints">
          {#each steps as s}
            <button class="next-step-hint"
              on:click={() => dispatch('draftstep', { suggestion: s, itemId: item.id })}>
              &rarr; {s} <span class="draft-cta">Draft &nearr;</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="tracker-meta">
        <span>Source: {item.sourceType || 'Signal'}</span>
        <span>Due: {item.dueAt ? safeDate(item.dueAt) : 'Set due date'}</span>
        <span>Owner: {item.owner || 'Set owner'}</span>
        <span>Done when: {item.doneCriteria || 'Set done criteria'}</span>
      </div>
      <div class="tracker-timestamp">
        Tracked: {safeDate(item.trackedAt, 'Unknown')} &middot; Last checked: {safeDate(item.lastRunAt, 'Never')}
      </div>

      <button class="tracker-section-toggle" class:expanded={peopleOpen}
        on:click={() => { peopleOpen = !peopleOpen; }}>
        <span class="chevron" class:chevron--expanded={peopleOpen}>&#9654;</span> People ({Array.isArray(item.counterparties) ? item.counterparties.length : 0})
      </button>
      {#if peopleOpen}
        <div class="tracker-section-panel show">
          <p class="people-text">{people}</p>
        </div>
      {/if}

      {#if links.length}
        <button class="tracker-section-toggle" class:expanded={linksOpen}
          on:click={() => { linksOpen = !linksOpen; }}>
          <span class="chevron" class:chevron--expanded={linksOpen}>&#9654;</span> Links ({links.length})
        </button>
        {#if linksOpen}
          <div class="tracker-section-panel show">
            <ul class="source-list">
              {#each links as l}
                {@const recency = signalRecencyLabel(l.signalAt)}
                <li>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || 'source'}</a>
                  {#if recency} <span class="source-recency">({recency})</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}

      <button class="tracker-section-toggle" class:expanded={monitoringOpen}
        on:click={() => { monitoringOpen = !monitoringOpen; }}>
        <span class="chevron" class:chevron--expanded={monitoringOpen}>&#9654;</span> Monitoring
      </button>
      {#if monitoringOpen}
        <div class="tracker-section-panel show">
          <div class="tracker-schedule-bar">
            <ScheduleControls {item}
              on:change={(e) => dispatch('schedulechange', e.detail)}
              on:runnow={(e) => dispatch('runnow', e.detail)} />
            <p class="task-next-run">Next run: {safeDate(item.nextRunAt, 'Not scheduled')}</p>
            <button class="tracker-prompt-toggle" on:click={() => { promptPanelOpen = !promptPanelOpen; }}>
              <span class="chevron" class:chevron--expanded={promptPanelOpen}>&#9654;</span> Edit monitoring prompt
            </button>
            {#if promptPanelOpen}
              <div class="tracker-prompt-panel show">
                <textarea class="tracking-textarea" placeholder="Monitoring context for WorkIQ"
                  value={item.monitorPrompt || ''}
                  on:change={(e) => dispatch('promptchange', { itemId: item.id, value: e.target.value })}></textarea>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="action-row">
        {#if hasNew || unseenCount > 0}
          <button class="small-btn primary" on:click={() => dispatch('markseen', { itemId: item.id })}>Mark as Seen</button>
        {/if}
        <button class="small-btn popout" on:click={() => dispatch('popout', { itemId: item.id })}>&nearr; Pop Out</button>
        <button class="small-btn warn" on:click={() => dispatch('delete', { itemId: item.id })}>Delete</button>
      </div>
    </div>
  {/if}
</div>
