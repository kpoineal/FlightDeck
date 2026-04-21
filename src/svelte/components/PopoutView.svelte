<script>
  import { onMount } from 'svelte';
  import { items } from '../lib/stores.js';
  import { severityClass, safeDate, relativeTime, signalRecencyLabel, unseenHistoryCount } from '../lib/utils.js';
  import { useClock } from '../lib/clock.svelte.js';
  import { LIFECYCLE_STATUSES, LIFECYCLE_LABELS } from '../lib/constants.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import ScheduleControls from './ScheduleControls.svelte';
  import SeverityPill from './SeverityPill.svelte';

  let { itemId, onseveritychange, onmarkseen, ondelete, onschedulechange, onrunnow, onpromptchange } = $props();

  const RESIZE_STORAGE_KEY = 'flightdeck_popout_panel_ratio';
  const MIN_PANEL_PX = 250;

  let item = $derived($items.find((entry) => entry.id === itemId) || null);

  const clock = useClock();
  $effect(() => { if (item) document.title = item.title || 'Tracked Item'; });

  let isTerminalStatus = $derived(item && (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived'));
  let hasNew = $derived(item && !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true));
  let unseenCount = $derived(item ? (isTerminalStatus ? 0 : unseenHistoryCount(item)) : 0);
  let historyEntries = $derived(item && Array.isArray(item.updateHistory) ? item.updateHistory : []);
  let links = $derived(item && Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : []);
  let lastUpdate = $derived(item ? (item.lastChangedAt || item.lastRunAt || null) : null);
  let lastUpdateTime = $derived(lastUpdate ? new Date(lastUpdate) : null);
  let lastUpdateStr = $derived(lastUpdateTime && Number.isFinite(lastUpdateTime.getTime()) ? lastUpdateTime.toLocaleString() : null);
  let rt = $derived(relativeTime(lastUpdate, clock.now));
  let sevClass = $derived(item ? severityClass(item.severity) : '');

  let peoplePanelOpen = $state(true);
  let linksPanelOpen = $state(true);
  let monitoringPanelOpen = $state(false);
  let promptPanelOpen = $state(false);

  // Resizable panels
  let panelsEl;
  let dragging = $state(false);

  function initResize() {
    if (!panelsEl) return;
    const stored = localStorage.getItem(RESIZE_STORAGE_KEY);
    if (stored) {
      const ratio = parseFloat(stored);
      if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
        panelsEl.style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
      }
    }
  }

  function onMouseDown(e) {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e) {
    if (!dragging || !panelsEl) return;
    requestAnimationFrame(() => {
      const rect = panelsEl.getBoundingClientRect();
      const totalW = rect.width;
      let leftW = e.clientX - rect.left;
      leftW = Math.max(MIN_PANEL_PX, Math.min(leftW, totalW - MIN_PANEL_PX));
      const ratio = leftW / totalW;
      panelsEl.style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
    });
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (panelsEl) {
      const cols = panelsEl.style.gridTemplateColumns;
      const match = cols.match(/^([\d.]+)fr/);
      if (match) localStorage.setItem(RESIZE_STORAGE_KEY, match[1]);
    }
  }

  onMount(() => {
    initResize();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  });

  function handleSeverityChange(e) {
    onseveritychange?.({ itemId: item.id, value: e.target.value });
  }

  function handleMarkSeen() {
    onmarkseen?.({ itemId: item.id });
  }

  function handleDelete() {
    ondelete?.({ itemId: item.id });
  }

  function handleScheduleChange(data) {
    onschedulechange?.(data);
  }

  function handleRunNow(data) {
    onrunnow?.(data);
  }

  function handlePromptChange(e) {
    onpromptchange?.({ itemId: item.id, value: e.target.value });
  }
</script>

<div class="popout-container">
  {#if !item}
    <div class="popout-empty">This tracked item no longer exists.</div>
  {:else}
    <article
      class="tracker-card tracker-card--popout"
      class:has-new-update={hasNew}
      class:is-new={hasNew}
      data-tracker-id={item.id}
    >
      <div class="tracker-head">
        <select class="severity-select {sevClass}" value={item.severity}
          on:change={handleSeverityChange}>
          <option value="Critical">Critical</option>
          <option value="Elevated">Elevated</option>
          <option value="Observe">Observe</option>
        </select>
        {#if item.monitorEnabled !== false}
          <span class="pill automation-pill">Monitored</span>
        {/if}
        {#if hasNew}
          <span class="tracker-new-badge">{unseenCount > 1 ? `${unseenCount} New Updates` : 'New Update'}</span>
        {:else if rt}
          <span class="pill last-updated-pill" title="Updated: {safeDate(lastUpdate)}">{rt}</span>
        {/if}
        <div class="popout-head-actions">
          {#if unseenCount > 0}
            <button class="small-btn primary" on:click={handleMarkSeen}>Mark as Seen</button>
          {/if}
          <button class="small-btn warn" on:click={handleDelete}>Delete</button>
        </div>
      </div>

      <div class="popout-panels" bind:this={panelsEl}>
        <div class="popout-panel-left">
          {#if hasNew && lastUpdateStr}
            <div class="tracker-updated-at">Updated: {lastUpdateStr} ({rt})</div>
          {/if}
          <h3 class="tracker-title">{item.title || 'Untitled item'}</h3>

          <ActivityTimeline entries={historyEntries} {item} maxVisible={5} />

          <div class="tracker-meta">
            <span>Source: {item.sourceType || 'Signal'}</span>
            <span>Due: {safeDate(item.dueAt)}</span>
            <span>Owner: {item.owner || 'You'}</span>
          </div>
          <div class="tracker-timestamp">
            Tracked: {safeDate(item.trackedAt, 'Unknown')} &middot; Last checked: {safeDate(item.lastRunAt, 'Never')}
          </div>

          <!-- People section -->
          <button class="tracker-section-toggle" class:expanded={peoplePanelOpen}
            on:click={() => { peoplePanelOpen = !peoplePanelOpen; }}>
            <span class="chevron" class:chevron--expanded={peoplePanelOpen}>&#9654;</span>
            People ({Array.isArray(item.counterparties) ? item.counterparties.length : 0})
          </button>
          {#if peoplePanelOpen}
            <div class="tracker-section-panel show">
              <div class="people-chips">
                {#if Array.isArray(item.counterparties) && item.counterparties.length}
                  {#each item.counterparties as person}
                    <span class="people-chip">{person}</span>
                  {/each}
                {:else}
                  <span class="people-text">No counterparties listed</span>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Links section -->
          {#if links.length}
            <button class="tracker-section-toggle" class:expanded={linksPanelOpen}
              on:click={() => { linksPanelOpen = !linksPanelOpen; }}>
              <span class="chevron" class:chevron--expanded={linksPanelOpen}>&#9654;</span>
              Links ({links.length})
            </button>
            {#if linksPanelOpen}
              <div class="tracker-section-panel show">
                <ul class="source-list">
                  {#each links as l}
                    {@const recency = signalRecencyLabel(l.signalAt)}
                    <li>
                      {l.type || 'source'} &bull;
                      <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || 'source'}</a>
                      {#if recency} <span class="source-recency">({recency})</span>{/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}

          <!-- Monitoring section -->
          <button class="tracker-section-toggle" class:expanded={monitoringPanelOpen}
            on:click={() => { monitoringPanelOpen = !monitoringPanelOpen; }}>
            <span class="chevron" class:chevron--expanded={monitoringPanelOpen}>&#9654;</span>
            Monitoring{item.monitorEnabled !== false
              ? ` \u00B7 ${item.scheduleType === 'weekly' ? 'Scheduled' : item.scheduleType === 'one-time' ? 'One-time' : 'Every ' + (item.scheduleValue || '4h')}`
              : ' \u00B7 Disabled'}
          </button>
          {#if monitoringPanelOpen}
            <div class="tracker-section-panel show">
              <div class="tracker-schedule-bar">
                <ScheduleControls {item}
                  onchange={handleScheduleChange}
                  onrunnow={handleRunNow} />
                <p class="task-next-run">Next run: {safeDate(item.nextRunAt, 'Not scheduled')}</p>
                <button class="tracker-prompt-toggle" on:click={() => { promptPanelOpen = !promptPanelOpen; }}>
                  <span class="chevron" class:chevron--expanded={promptPanelOpen}>&#9654;</span> Edit monitoring prompt
                </button>
                {#if promptPanelOpen}
                  <div class="tracker-prompt-panel show">
                    <textarea class="tracking-textarea" placeholder="Monitoring context for WorkIQ"
                      value={item.monitorPrompt || ''}
                      on:change={handlePromptChange}></textarea>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="popout-resize-handle" on:mousedown={onMouseDown}>
          <div class="popout-resize-grip"></div>
        </div>

        <div class="popout-panel-right">
          <h4 class="popout-panel-heading">Activity Timeline</h4>
          <ActivityTimeline entries={historyEntries} {item} maxVisible={0} />
        </div>
      </div>
    </article>
  {/if}
</div>
