<script>
  import { density, collapsedSections } from '../lib/stores.js';
  import { relativeTime, sortBySeverity } from '../lib/utils.js';
  import { toggleSection } from '../lib/actions.js';
  import TrackerCard from './TrackerCard.svelte';
  import TrackerRow from './TrackerRow.svelte';

  let { scanner, items = [], onadditem, onscannerrun, onscannertoggle, onscannersettings, onpopout, onseveritychange, onstatuschange, onmarkseen, ondelete, ondraftstep, onschedulechange, onpromptchange, onmovescanner, onrunnow } = $props();

  let sourceId = $derived(`scanner-${scanner.id}`);
  let collapsed = $derived($collapsedSections.includes(sourceId));
  let enabled = $derived(scanner.enabled !== false);
  let isMinimal = $derived($density === 'minimal');
  let sorted = $derived(sortBySeverity(items, true));

  // Inline filter state
  let inlineFilter = $state(null);

  let critical = $derived(items.filter(i => i.severity === 'Critical').length);
  let elevated = $derived(items.filter(i => i.severity === 'Elevated').length);
  let observe = $derived(items.filter(i => i.severity !== 'Critical' && i.severity !== 'Elevated').length);
  let blocked = $derived(items.filter(i => i.lifecycleStatus === 'blocked').length);
  let waiting = $derived(items.filter(i => i.lifecycleStatus === 'waiting').length);
  let newCount = $derived(items.filter(i =>
    (i.isNew || i.hasNewUpdate) &&
    i.lifecycleStatus !== 'complete' &&
    i.lifecycleStatus !== 'archived' &&
    i.lifecycleStatus !== 'snoozed'
  ).length);

  let latestActivity = $derived(items.reduce((max, i) => {
    const ts = new Date(i.lastChangedAt || i.lastRunAt || 0).getTime();
    return ts > max ? ts : max;
  }, 0));

  let nextRunLabel = $derived.by(() => {
    if (!scanner || !scanner.nextRunAt || !enabled) return '';
    const ms = new Date(scanner.nextRunAt).getTime() - Date.now();
    if (ms <= 0) return '\u23f1 due';
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `\u23f1 ${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `\u23f1 ${hrs}h ${mins % 60}m`;
  });

  let highestSev = $derived(critical > 0 ? 'critical' : elevated > 0 ? 'elevated' : items.length > 0 ? 'observe' : '');
  let sevBorderClass = $derived(highestSev ? `sev-border-${highestSev}` : '');

  let filteredItems = $derived.by(() => {
    if (!inlineFilter) return sorted;
    if (inlineFilter.type === 'severity') return sorted.filter(i => i.severity === inlineFilter.value);
    if (inlineFilter.type === 'status') return sorted.filter(i => i.lifecycleStatus === inlineFilter.value);
    if (inlineFilter.type === 'new') return sorted.filter(i => i.isNew === true || i.hasNewUpdate === true);
    return sorted;
  });

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
</script>

<div class="radar-section" class:disabled={!enabled}>
  <!-- Section header -->
  <div class="radar-section-header {sevBorderClass}" class:disabled={!enabled}
    on:click={() => toggleSection(sourceId)}
    on:keydown={(e) => e.key === 'Enter' && toggleSection(sourceId)}
    role="button" tabindex="0">
    <div class="radar-section-header-left">
      <span class="radar-section-icon">🔍</span>
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="radar-section-header-actions" on:click|stopPropagation>
      <button class="icon-btn" title="Add item to this scanner"
        on:click={() => onadditem?.({ scannerId: scanner.id })}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/>
        </svg>
      </button>
      <button class="icon-btn scanner-run-now-btn" title="Run scan now"
        on:click={() => onscannerrun?.({ scannerId: scanner.id })}>⚡</button>
      <button class="icon-btn" title="{enabled ? 'Pause scanner' : 'Resume scanner'}"
        on:click={() => onscannertoggle?.({ scannerId: scanner.id })}>
        {enabled ? '⏸' : '▶'}
      </button>
      <button class="icon-btn" title="Scanner settings"
        on:click={() => onscannersettings?.({ scannerId: scanner.id })}>⚙️</button>
      <button class="icon-btn radar-section-collapse" class:collapsed
        title="{collapsed ? 'Expand' : 'Collapse'}"
        on:click={() => toggleSection(sourceId)}>▾</button>
    </div>
  </div>

  <!-- Items list -->
  <div class="radar-section-items" class:list--minimal={isMinimal} class:collapsed>
    {#if filteredItems.length}
      {#each filteredItems as item (item.id)}
        {#if isMinimal}
          <TrackerRow {item}
            onseveritychange={onseveritychange}
            onstatuschange={onstatuschange}
            onpopout={onpopout}
            onmarkseen={onmarkseen}
            ondelete={ondelete}
            ondraftstep={ondraftstep}
            onschedulechange={onschedulechange}
            onpromptchange={onpromptchange}
            onrunnow={onrunnow} />
        {:else}
          <TrackerCard {item}
            onseveritychange={onseveritychange}
            onstatuschange={onstatuschange}
            onpopout={onpopout}
            onmarkseen={onmarkseen}
            ondelete={ondelete}
            ondraftstep={ondraftstep}
            onschedulechange={onschedulechange}
            onpromptchange={onpromptchange}
            onmovescanner={onmovescanner}
            onrunnow={onrunnow} />
        {/if}
      {/each}
    {:else if inlineFilter && items.length > 0}
      <div class="empty inline-filter-empty">No items matching filter.</div>
    {:else}
      <div class="empty">No items from {scanner.name || 'this scanner'}.</div>
    {/if}
  </div>
</div>
