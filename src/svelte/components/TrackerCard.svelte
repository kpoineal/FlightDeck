<script>
  import { scanners, highlightedItemId } from '../lib/stores.js';
  import { severityClass, safeDate, relativeTime, signalRecencyLabel, unseenHistoryCount } from '../lib/utils.js';
  import { LIFECYCLE_STATUSES, LIFECYCLE_LABELS } from '../lib/constants.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import ScheduleControls from './ScheduleControls.svelte';
  import EditableField from './EditableField.svelte';

  let { item, onseveritychange, onstatuschange, onpopout, onmarkseen, ondelete, ondraftstep, onschedulechange, onpromptchange, onmovescanner, onrunnow, onfieldedit } = $props();

  let activeTab = $state('summary');
  let cardEl = $state(null);
  let isHighlighted = $derived($highlightedItemId === item.id);
  let hasAnimated = $state(false);

  // Scroll into view when this card is highlighted
  $effect(() => {
    if (isHighlighted && cardEl) {
      hasAnimated = false;
      // Small delay ensures DOM is settled after section expand
      requestAnimationFrame(() => {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasAnimated = true;
      });
    }
    if (!isHighlighted) hasAnimated = false;
  });

  let showHighlight = $derived(isHighlighted && hasAnimated);
  let promptPanelOpen = $state(false);

  let isTerminalStatus = $derived(item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
  let hasNew = $derived(!isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true));
  let unseenCount = $derived(isTerminalStatus ? 0 : unseenHistoryCount(item));
  let historyEntries = $derived(Array.isArray(item.updateHistory) ? item.updateHistory : []);
  let people = $derived(Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed');
  let links = $derived(Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : []);
  let lastUpdate = $derived(item.lastChangedAt || item.lastRunAt || null);
  let lastUpdateTime = $derived(lastUpdate ? new Date(lastUpdate) : null);
  let lastUpdateStr = $derived(lastUpdateTime && Number.isFinite(lastUpdateTime.getTime()) ? lastUpdateTime.toLocaleString() : null);
  let rt = $derived(relativeTime(lastUpdate));
  let steps = $derived(Array.isArray(item.suggestedNextSteps) ? item.suggestedNextSteps : []);
  let sevClass = $derived(severityClass(item.severity));

  let historyBadgeClass = $derived(
    unseenCount >= 6 ? 'history-badge--critical'
    : unseenCount >= 3 ? 'history-badge--elevated'
    : unseenCount >= 1 ? 'history-badge--observe'
    : ''
  );

  function setTab(tab) { activeTab = tab; }
</script>

<article
  bind:this={cardEl}
  class="tracker-card"
  class:has-new-update={hasNew}
  class:is-new={hasNew}
  class:highlighted={showHighlight}
  class:snoozed-card={item.lifecycleStatus === 'snoozed'}
  data-tracker-id={item.id}
  data-item-severity={item.severity || 'Observe'}
  data-item-status={item.lifecycleStatus || 'in-progress'}
  data-item-new={hasNew ? 'true' : 'false'}
>
  <div class="tracker-head">
    <div class="tracker-head-left">
      <select class="severity-select {sevClass}" value={item.severity}
        on:change={(e) => onseveritychange?.({ itemId: item.id, value: e.target.value })}>
        <option value="Critical">Critical</option>
        <option value="Elevated">Elevated</option>
        <option value="Observe">Observe</option>
      </select>
      <select class="status-select status-{item.lifecycleStatus || 'in-progress'}" value={item.lifecycleStatus}
        on:change={(e) => onstatuschange?.({ itemId: item.id, value: e.target.value })}>
        {#each LIFECYCLE_STATUSES as s}
          <option value={s}>{LIFECYCLE_LABELS[s]}</option>
        {/each}
      </select>
      {#if item.lifecycleStatus === 'snoozed'}
        <span class="snooze-until-label" title="Snoozed until {item.snoozeUntil ? safeDate(item.snoozeUntil) : 'next scan'}">
          💤 {item.snoozeUntil ? (relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}
        </span>
      {/if}
    </div>
    <div class="tracker-head-right">
      {#if item.monitorEnabled === false && !isTerminalStatus}
        <span class="pill paused-pill">Paused</span>
      {/if}
      {#if hasNew}
        <span class="tracker-new-badge">{unseenCount > 1 ? unseenCount + ' ' : ''}New</span>
      {:else if rt}
        <span class="pill last-updated-pill" title="Last update: {safeDate(lastUpdate)}">{rt}</span>
      {/if}
      <button class="popout-icon-btn" title="Pop Out" aria-label="Pop out"
        on:click={() => onpopout?.({ itemId: item.id })}>↗</button>
    </div>
  </div>

  <div class="card-body">
    <div class="item-title-wrap">
      <h3 class="tracker-title">
        <span class="item-title-text">{item.title || 'Untitled item'}</span>
      </h3>
    </div>

    <!-- Card tabs -->
    <div class="card-tabs">
      <div class="card-tab-bar">
        <button class="card-tab" class:active={activeTab === 'summary'} title="Activity Timeline"
          on:click={() => setTab('summary')}>
          <span class="card-tab-icon">⏱️</span><span class="card-tab-label">Activity</span>
          {#if unseenCount > 0}<span class="card-tab-badge {historyBadgeClass}">{unseenCount}</span>{/if}
        </button>
        <button class="card-tab" class:active={activeTab === 'overview'} title="Overview"
          on:click={() => setTab('overview')}>
          <span class="card-tab-icon">📋</span><span class="card-tab-label">Overview</span>
        </button>
        <button class="card-tab" class:active={activeTab === 'monitor'} title="Monitoring"
          on:click={() => setTab('monitor')}>
          <span class="card-tab-icon">⚙️</span><span class="card-tab-label">Monitor</span>
        </button>
      </div>

      <!-- Activity tab -->
      <div class="card-tab-panel" class:active={activeTab === 'summary'}>
        {#if hasNew && lastUpdateStr}
          <div class="tracker-updated-at">Updated: {lastUpdateStr} ({rt})</div>
        {/if}
        <ActivityTimeline entries={historyEntries} {item} maxVisible={3} />
      </div>

      <!-- Overview tab -->
      <div class="card-tab-panel" class:active={activeTab === 'overview'}>
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
        <div class="card-tab-section">
          <h4 class="card-tab-section-title">People ({Array.isArray(item.counterparties) ? item.counterparties.length : 0})</h4>
          <p class="people-text">{people}</p>
        </div>
        <div class="card-tab-section">
          <h4 class="card-tab-section-title">Links</h4>
          {#if links.length}
            <ul class="source-list">
              {#each links as l}
                {@const recency = signalRecencyLabel(l.signalAt)}
                <li>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || 'source'}</a>
                  {#if recency} <span class="source-recency">({recency})</span>{/if}
                </li>
              {/each}
            </ul>
          {:else}
            <div class="empty text-sm">No links yet.</div>
          {/if}
        </div>
      </div>

      <!-- Monitor tab -->
      <div class="card-tab-panel" class:active={activeTab === 'monitor'}>
        <div class="monitor-source-section">
          <label class="monitor-source-label">Source</label>
          <select class="monitor-source-select" value={item.scannerId || ''}
            on:change={(e) => onmovescanner?.({ itemId: item.id, scannerId: e.target.value })}>
            {#each $scanners as s}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </div>
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
          <div class="monitor-danger-zone">
            <button class="small-btn warn" on:click={() => ondelete?.({ itemId: item.id })}>Delete this item</button>
          </div>
        </div>
      </div>
    </div>

    <div class="action-row">
      {#if hasNew || unseenCount > 0}
        <button class="small-btn primary" on:click={() => onmarkseen?.({ itemId: item.id })}>Mark as Seen</button>
      {/if}
    </div>
  </div>
</article>

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
