<script>
  import { scanners, highlightedItemId } from '../lib/stores.js';
  import { severityClass, safeDate, relativeTime, signalRecencyLabel, unseenHistoryCount } from '../lib/utils.js';
  import { LIFECYCLE_STATUSES, LIFECYCLE_LABELS } from '../lib/constants.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import ScheduleControls from './ScheduleControls.svelte';
  import EditableField from './EditableField.svelte';

  let { item, expanded = false, onseveritychange, onstatuschange, onpopout, onmarkseen, ondelete, ondraftstep, onschedulechange, onpromptchange, onrunnow, onrowexpand, onfieldedit } = $props();

  let isExpanded = $state(expanded);
  let rowEl = $state(null);
  let isHighlighted = $derived($highlightedItemId === item.id);
  let hasAnimated = $state(false);

  // Scroll into view and expand when highlighted
  $effect(() => {
    if (isHighlighted && rowEl) {
      hasAnimated = false;
      isExpanded = true;
      onrowexpand?.({ itemId: item.id });
      requestAnimationFrame(() => {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasAnimated = true;
      });
    }
    if (!isHighlighted) hasAnimated = false;
  });

  let showHighlight = $derived(isHighlighted && hasAnimated);
  let monitoringOpen = $state(false);
  let promptPanelOpen = $state(false);
  let peopleOpen = $state(true);
  let linksOpen = $state(true);

  function handleRowClick(e) {
    // Don't toggle if clicking interactive elements
    if (e.target.closest('select') || e.target.closest('input') ||
        e.target.closest('label') || e.target.closest('button')) return;
    isExpanded = !isExpanded;
    // Notify parent for accordion behavior
    if (isExpanded) onrowexpand?.({ itemId: item.id });
  }

  // Accordion: collapse when another row expands
  $effect(() => {
    if (expanded === false && isExpanded) {
      isExpanded = false;
    }
  });

  let isTerminalStatus = $derived(item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
  let isNewItem = $derived(!isTerminalStatus && item.isNew === true);
  let hasUpdate = $derived(!isTerminalStatus && item.hasNewUpdate === true);
  let hasNew = $derived(isNewItem || hasUpdate);
  let unseenCount = $derived(isTerminalStatus ? 0 : unseenHistoryCount(item));
  let people = $derived(Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed');
  let links = $derived(Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : []);
  let lastUpdate = $derived(item.lastChangedAt || item.discoveredAt || null);
  let lastUpdateTime = $derived(lastUpdate ? new Date(lastUpdate) : null);
  let lastUpdateStr = $derived(lastUpdateTime && Number.isFinite(lastUpdateTime.getTime()) ? lastUpdateTime.toLocaleString() : null);
  let rt = $derived(relativeTime(lastUpdate));
  let discoveredSource = $derived(item.discoveredAt || item.trackedAt || null);
  let discoveredTime = $derived(discoveredSource ? new Date(discoveredSource) : null);
  let discoveredStr = $derived(discoveredTime && Number.isFinite(discoveredTime.getTime()) ? discoveredTime.toLocaleString() : null);
  let discoveredRt = $derived(relativeTime(discoveredSource));
  let steps = $derived(Array.isArray(item.suggestedNextSteps) ? item.suggestedNextSteps : []);
  let sevClass = $derived(severityClass(item.severity));
  let summaryTruncated = $derived((item.summary || '').replace(/\n/g, ' ').slice(0, 140));
  let summaryEllipsis = $derived((item.summary || '').length > 140);
</script>

<div
  bind:this={rowEl}
  class="tracker-row-wrapper"
  class:is-new={isNewItem}
  class:is-updated={hasUpdate}
  class:highlighted={showHighlight}
  class:snoozed-card={item.lifecycleStatus === 'snoozed'}
  data-tracker-id={item.id}
  data-item-severity={item.severity || 'Observe'}
  data-item-status={item.lifecycleStatus || 'in-progress'}
  data-item-new={hasNew ? 'true' : 'false'}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="tracker-row" class:has-new-update={hasNew} class:expanded={isExpanded}
    on:click={handleRowClick}
    role="button" tabindex="0"
    on:keydown={(e) => e.key === 'Enter' && handleRowClick(e)}>
    <select class="severity-select {sevClass}" value={item.severity}
      on:change={(e) => onseveritychange?.({ itemId: item.id, value: e.target.value })}
      on:click|stopPropagation>
      <option value="Critical">Critical</option>
      <option value="Elevated">Elevated</option>
      <option value="Observe">Observe</option>
    </select>
    <select class="status-select status-{item.lifecycleStatus || 'in-progress'}" value={item.lifecycleStatus}
      on:change={(e) => onstatuschange?.({ itemId: item.id, value: e.target.value })}
      on:click|stopPropagation>
      {#each LIFECYCLE_STATUSES as s}
        <option value={s}>{LIFECYCLE_LABELS[s]}</option>
      {/each}
    </select>
    {#if item.lifecycleStatus === 'snoozed'}
      <span class="snooze-until-label" title="Snoozed until {item.snoozeUntil ? safeDate(item.snoozeUntil) : 'next scan'}">
        💤 {item.snoozeUntil ? (relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}
      </span>
    {/if}
    {#if item.monitorEnabled === false && !isTerminalStatus}
      <span class="pill paused-pill">Paused</span>
    {/if}
    {#if isNewItem}
      <span class="pill badge-pill">NEW</span>
    {/if}
    {#if hasUpdate}
      <span class="pill badge-pill badge-pill--updated">{unseenCount > 1 ? unseenCount + ' ' : ''}UPDATED</span>
    {/if}
    {#if rt}
      <span class="pill last-updated-pill" class:popped={hasNew} title="Updated: {safeDate(lastUpdate)}">{rt}</span>
    {/if}
    <span class="tracker-row-title">{item.title || 'Untitled item'}</span>
    <span class="tracker-row-summary">{summaryTruncated}{summaryEllipsis ? '\u2026' : ''}</span>
    <span class="tracker-row-due"><EditableField field="dueAt" value={item.dueAt} itemId={item.id} placeholder="Set due" onchange={onfieldedit} /></span>
    <span class="row-expand-chevron" class:open={isExpanded}>&#9660;</span>
  </div>

  {#if isExpanded}
    <div class="tracker-row-detail show">
      {#if isNewItem && discoveredStr}
        <div class="tracker-updated-at">Discovered: {discoveredStr} ({discoveredRt})</div>
      {/if}
      {#if hasUpdate && lastUpdateStr}
        <div class="tracker-change-at">Updated: {lastUpdateStr} ({rt})</div>
      {/if}
      <ActivityTimeline entries={Array.isArray(item.updateHistory) ? item.updateHistory : []} {item} maxVisible={3} />

      {#if steps.length}
        <div class="next-step-hints">
          {#each steps as s}
            <button class="next-step-hint"
              on:click={() => ondraftstep?.({ suggestion: s, itemId: item.id })}>
              &rarr; {s} <span class="draft-cta">Draft &nearr;</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="tracker-meta">
        <span>Source: {item.sourceType || 'Signal'}</span>
        <span>Due: <EditableField field="dueAt" value={item.dueAt} itemId={item.id} placeholder="Set due date" onchange={onfieldedit} /></span>
        <span>Owner: <EditableField field="owner" value={item.owner} itemId={item.id} placeholder="Set owner" onchange={onfieldedit} /></span>
        <span>Done when: <EditableField field="doneCriteria" value={item.doneCriteria} itemId={item.id} placeholder="Set done criteria" onchange={onfieldedit} /></span>
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
              onchange={(data) => onschedulechange?.(data)}
              onrunnow={(data) => onrunnow?.(data)} />
            <p class="task-next-run">Next run: {safeDate(item.nextRunAt, 'Not scheduled')}</p>
            <button class="tracker-prompt-toggle" on:click={() => { promptPanelOpen = !promptPanelOpen; }}>
              <span class="chevron" class:chevron--expanded={promptPanelOpen}>&#9654;</span> Edit monitoring prompt
            </button>
            {#if promptPanelOpen}
              <div class="tracker-prompt-panel show">
                <textarea class="tracking-textarea" placeholder="Monitoring context for WorkIQ"
                  value={item.monitorPrompt || ''}
                  on:change={(e) => onpromptchange?.({ itemId: item.id, value: e.target.value })}></textarea>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="action-row">
        {#if hasNew || unseenCount > 0}
          <button class="small-btn primary" on:click={() => onmarkseen?.({ itemId: item.id })}>Mark as Seen</button>
        {/if}
        <button class="small-btn popout" on:click={() => onpopout?.({ itemId: item.id })}>↗ Pop Out</button>
        <button class="small-btn warn" on:click={() => ondelete?.({ itemId: item.id })}>Delete</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .highlighted {
    animation: highlight-pulse 2.5s ease-out forwards;
    outline: 2px solid var(--accent, #0a84ff);
    outline-offset: 2px;
    z-index: 10;
  }
  @keyframes highlight-pulse {
    0% { box-shadow: 0 0 24px rgba(10, 132, 255, 0.6); outline-color: rgba(10, 132, 255, 1); }
    40% { box-shadow: 0 0 16px rgba(10, 132, 255, 0.4); outline-color: rgba(10, 132, 255, 0.8); }
    100% { box-shadow: none; outline-color: transparent; }
  }
</style>
