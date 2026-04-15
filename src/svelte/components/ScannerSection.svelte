<script>
  import { createEventDispatcher } from 'svelte';
  import { density, collapsedSections } from '../lib/stores.js';
  import { relativeTime, sortBySeverity } from '../lib/utils.js';
  import { toggleSection } from '../lib/actions.js';
  import TrackerCard from './TrackerCard.svelte';
  import TrackerRow from './TrackerRow.svelte';

  export let scanner;
  export let items = [];

  const dispatch = createEventDispatcher();

  $: sourceId = `scanner-${scanner.id}`;
  $: collapsed = $collapsedSections.includes(sourceId);
  $: enabled = scanner.enabled !== false;
  $: isMinimal = $density === 'minimal';
  $: sorted = sortBySeverity(items, true);

  // Inline filter state
  let inlineFilter = null;

  $: critical = items.filter(i => i.severity === 'Critical').length;
  $: elevated = items.filter(i => i.severity === 'Elevated').length;
  $: observe = items.filter(i => i.severity !== 'Critical' && i.severity !== 'Elevated').length;
  $: blocked = items.filter(i => i.lifecycleStatus === 'blocked').length;
  $: waiting = items.filter(i => i.lifecycleStatus === 'waiting').length;
  $: newCount = items.filter(i =>
    (i.isNew || i.hasNewUpdate) &&
    i.lifecycleStatus !== 'complete' &&
    i.lifecycleStatus !== 'archived' &&
    i.lifecycleStatus !== 'snoozed'
  ).length;

  $: latestActivity = items.reduce((max, i) => {
    const ts = new Date(i.lastChangedAt || i.lastRunAt || 0).getTime();
    return ts > max ? ts : max;
  }, 0);

  $: nextRunLabel = (() => {
    if (!scanner || !scanner.nextRunAt || !enabled) return '';
    const ms = new Date(scanner.nextRunAt).getTime() - Date.now();
    if (ms <= 0) return '\u23f1 due';
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `\u23f1 ${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `\u23f1 ${hrs}h ${mins % 60}m`;
  })();

  $: highestSev = critical > 0 ? 'critical' : elevated > 0 ? 'elevated' : items.length > 0 ? 'observe' : '';
  $: sevBorderClass = highestSev ? `sev-border-${highestSev}` : '';

  $: filteredItems = (() => {
    if (!inlineFilter) return sorted;
    if (inlineFilter.type === 'severity') return sorted.filter(i => i.severity === inlineFilter.value);
    if (inlineFilter.type === 'status') return sorted.filter(i => i.lifecycleStatus === inlineFilter.value);
    if (inlineFilter.type === 'new') return sorted.filter(i => i.isNew === true || i.hasNewUpdate === true);
    return sorted;
  })();

  function toggleFilter(type, value) {
    if (inlineFilter && inlineFilter.type === type && inlineFilter.value === value) {
      inlineFilter = null;
    } else {
      inlineFilter = { type, value };
    }
  }

  function isFilterActive(type, value) {
    return inlineFilter && inlineFilter.type === type && inlineFilter.value === value;
  }

  function forwardEvent(event) {
    dispatch(event.type, event.detail);
  }
</script>

<div class="radar-section" class:disabled={!enabled}>
  <!-- Section header -->
  <div class="radar-section-header {sevBorderClass}" class:disabled={!enabled}>
    <div class="radar-section-header-left">
      <span class="radar-section-icon">\uD83D\uDD0D</span>
      <span class="radar-section-name">{scanner.name || 'Unnamed Scanner'}</span>
      <span class="radar-section-count">({items.length})</span>

      {#if critical > 0 || elevated > 0 || observe > 0}
        <span class="radar-sev-dots">
          {#if critical > 0}
            <span class="radar-sev-dot sev-critical" class:active={isFilterActive('severity', 'Critical')}
              title="{critical} Critical — click to filter"
              on:click={() => toggleFilter('severity', 'Critical')}
              on:keydown={(e) => e.key === 'Enter' && toggleFilter('severity', 'Critical')}
              role="button" tabindex="0">{critical}</span>
          {/if}
          {#if elevated > 0}
            <span class="radar-sev-dot sev-elevated" class:active={isFilterActive('severity', 'Elevated')}
              title="{elevated} Elevated — click to filter"
              on:click={() => toggleFilter('severity', 'Elevated')}
              on:keydown={(e) => e.key === 'Enter' && toggleFilter('severity', 'Elevated')}
              role="button" tabindex="0">{elevated}</span>
          {/if}
          {#if observe > 0}
            <span class="radar-sev-dot sev-observe" class:active={isFilterActive('severity', 'Observe')}
              title="{observe} Observe — click to filter"
              on:click={() => toggleFilter('severity', 'Observe')}
              on:keydown={(e) => e.key === 'Enter' && toggleFilter('severity', 'Observe')}
              role="button" tabindex="0">{observe}</span>
          {/if}
        </span>
      {/if}

      {#if blocked > 0}
        <span class="radar-attn-badge attn-blocked" class:active={isFilterActive('status', 'blocked')}
          title="{blocked} blocked — click to filter"
          on:click={() => toggleFilter('status', 'blocked')}
          on:keydown={(e) => e.key === 'Enter' && toggleFilter('status', 'blocked')}
          role="button" tabindex="0">{blocked} blocked</span>
      {/if}
      {#if waiting > 0}
        <span class="radar-attn-badge attn-waiting" class:active={isFilterActive('status', 'waiting')}
          title="{waiting} waiting — click to filter"
          on:click={() => toggleFilter('status', 'waiting')}
          on:keydown={(e) => e.key === 'Enter' && toggleFilter('status', 'waiting')}
          role="button" tabindex="0">{waiting} waiting</span>
      {/if}
      {#if newCount > 0}
        <span class="radar-new-indicator" class:active={isFilterActive('new', 'new')}
          title="{newCount} new or updated — click to filter"
          on:click={() => toggleFilter('new', 'new')}
          on:keydown={(e) => e.key === 'Enter' && toggleFilter('new', 'new')}
          role="button" tabindex="0">{newCount} new</span>
      {/if}
      {#if inlineFilter}
        <span class="scanner-filter-clear" title="Clear filter"
          on:click={() => { inlineFilter = null; }}
          on:keydown={(e) => e.key === 'Enter' && (inlineFilter = null)}
          role="button" tabindex="0">&times;</span>
      {/if}
      {#if latestActivity > 0}
        <span class="radar-last-activity">{relativeTime(latestActivity) || ''}</span>
      {/if}
      {#if nextRunLabel}
        <span class="radar-next-run">{nextRunLabel}</span>
      {/if}
    </div>
    <div class="radar-section-header-actions">
      <button class="icon-btn" title="Add item to this scanner"
        on:click={() => dispatch('additem', { scannerId: scanner.id })}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/>
        </svg>
      </button>
      <button class="icon-btn scanner-run-now-btn" title="Run scan now"
        on:click={() => dispatch('scannerrun', { scannerId: scanner.id })}>&zap;</button>
      <button class="icon-btn" title="{enabled ? 'Pause scanner' : 'Resume scanner'}"
        on:click={() => dispatch('scannertoggle', { scannerId: scanner.id })}>
        {enabled ? '\u23f8' : '\u25b6'}
      </button>
      <button class="icon-btn" title="Scanner settings"
        on:click={() => dispatch('scannersettings', { scannerId: scanner.id })}>\u2699\ufe0f</button>
      <button class="icon-btn radar-section-collapse" class:collapsed
        title="{collapsed ? 'Expand' : 'Collapse'}"
        on:click={() => toggleSection(sourceId)}>\u25be</button>
    </div>
  </div>

  <!-- Items list -->
  <div class="radar-section-items" class:list--minimal={isMinimal} class:collapsed>
    {#if filteredItems.length}
      {#each filteredItems as item (item.id)}
        {#if isMinimal}
          <TrackerRow {item}
            on:severitychange={forwardEvent}
            on:statuschange={forwardEvent}
            on:popout={forwardEvent}
            on:markseen={forwardEvent}
            on:delete={forwardEvent}
            on:draftstep={forwardEvent}
            on:schedulechange={forwardEvent}
            on:promptchange={forwardEvent}
            on:runnow={forwardEvent} />
        {:else}
          <TrackerCard {item}
            on:severitychange={forwardEvent}
            on:statuschange={forwardEvent}
            on:popout={forwardEvent}
            on:markseen={forwardEvent}
            on:delete={forwardEvent}
            on:draftstep={forwardEvent}
            on:schedulechange={forwardEvent}
            on:promptchange={forwardEvent}
            on:movescanner={forwardEvent}
            on:runnow={forwardEvent} />
        {/if}
      {/each}
    {:else if inlineFilter && items.length > 0}
      <div class="empty inline-filter-empty">No items matching filter.</div>
    {:else}
      <div class="empty">No items from {scanner.name || 'this scanner'}.</div>
    {/if}
  </div>
</div>
