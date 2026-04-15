<script>
  import { filteredItems, scanners, items, density, filter } from '../lib/stores.js';
  import { setDensity, setFilter, addHistory } from '../lib/actions.js';
  import { sortBySeverity, groupItemsBySource } from '../lib/utils.js';
  import { savePersistentState } from '../lib/persistence.js';
  import ScannerSection from './ScannerSection.svelte';
  import AddTaskModal from './AddTaskModal.svelte';
  import ScannerSettingsModal from './ScannerSettingsModal.svelte';

  let sorted = $derived(sortBySeverity($filteredItems, true));
  let groups = $derived(groupItemsBySource(sorted, $scanners));
  let isMinimal = $derived($density === 'minimal');
  let emptyMsg = $derived($filter === 'all'
    ? 'No items yet. Click Refresh to scan or add a custom monitored task above.'
    : 'No items matching the current filter.');

  let addTaskOpen = $state(false);
  let addTaskScannerId = $state(null);
  let settingsOpen = $state(false);
  let settingsScanner = $state(null);

  function handleAddItem(data) {
    addTaskScannerId = data.scannerId;
    addTaskOpen = true;
  }

  function handleScannerSettings(data) {
    const s = $scanners.find(sc => sc.id === data.scannerId) || null;
    settingsScanner = s;
    settingsOpen = true;
  }

  function handleScannerRun(data) {
    if (window.workiq && typeof window.workiq.runScanner === 'function') {
      window.workiq.runScanner(data.scannerId);
    }
  }

  function handleScannerToggle(data) {
    if (window.workiq && typeof window.workiq.toggleScanner === 'function') {
      window.workiq.toggleScanner(data.scannerId);
    }
  }

  function handlePopout(data) {
    if (window.workiq && typeof window.workiq.openTrackerPopout === 'function') {
      window.workiq.openTrackerPopout(data.itemId);
    }
  }

  function handleAddScanner() {
    settingsScanner = null;
    settingsOpen = true;
  }

  // ── Item interaction handlers ────────────────────────────────────
  function handleSeverityChange(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) item.severity = data.value;
      return $items;
    });
    savePersistentState();
  }

  function handleStatusChange(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) {
        item.lifecycleStatus = data.value;
        item.lastChangedAt = new Date().toISOString();
        if (data.value === 'complete' && !item.completedAt) {
          item.completedAt = new Date().toISOString();
        }
        if (data.value === 'complete' || data.value === 'archived') {
          item.monitorEnabled = false;
          item.nextRunAt = null;
        }
      }
      return $items;
    });
    savePersistentState();
  }

  function handleMarkSeen(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) {
        item.hasNewUpdate = false;
        item.isNew = false;
        if (Array.isArray(item.updateHistory)) {
          item.updateHistory.forEach(e => { e.seen = true; });
        }
      }
      return $items;
    });
    savePersistentState();
  }

  function handleDelete(data) {
    items.update(($items) => $items.filter(i => i.id !== data.itemId));
    addHistory('action', 'Deleted item');
    savePersistentState();
  }

  function handleDraftStep(data) {
    // Draft action — call WorkIQ to generate a draft
    if (window.workiq && typeof window.workiq.ask === 'function') {
      window.workiq.ask(`Draft a response for: ${data.suggestion}`);
    }
  }

  function handleScheduleChange(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) item[data.field] = data.value;
      return $items;
    });
    savePersistentState();
  }

  function handlePromptChange(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) item.monitorPrompt = data.value;
      return $items;
    });
    savePersistentState();
  }

  function handleMoveScanner(data) {
    items.update(($items) => {
      const item = $items.find(i => i.id === data.itemId);
      if (item) item.scannerId = data.scannerId;
      return $items;
    });
    savePersistentState();
  }

  function handleRunNow(data) {
    if (window.workiq && typeof window.workiq.ask === 'function') {
      const item = $items.find(i => i.id === data.itemId);
      if (item && item.monitorPrompt) {
        window.workiq.ask(item.monitorPrompt);
      }
    }
  }

  // Cold storage fetch for archived filter
  $effect(() => {
    if ($filter === 'archived' && window.workiq && typeof window.workiq.getColdItems === 'function') {
      window.workiq.getColdItems().catch(() => {});
    }
  });
</script>

<section class="mode-view active">
  <div class="cockpit-grid">
    <article class="panel">
      <div class="tracking-heading-row">
        <h2>Radar</h2>
        <button class="add-scanner-btn" title="Add scanner" on:click={handleAddScanner}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/>
          </svg>
          Scanner
        </button>
        <div class="tracking-header-controls">
          <div class="filter-bar">
            <button class="filter-btn" class:active={$filter === 'all'}
              on:click={() => setFilter('all')}>All</button>
            <button class="filter-btn" class:active={$filter === 'archived'}
              on:click={() => setFilter('archived')}>Archived</button>
          </div>
          <button class="density-toggle" class:is-minimal={isMinimal}
            title={isMinimal ? 'Switch to card view' : 'Switch to list view'}
            on:click={() => setDensity(isMinimal ? 'full' : 'minimal')}>
            <svg class="density-icon-list" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="1" y1="3" x2="15" y2="3"/><line x1="1" y1="8" x2="15" y2="8"/><line x1="1" y1="13" x2="15" y2="13"/>
            </svg>
            <svg class="density-icon-grid" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
              <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="panel-sub">Prioritized signals from email, Teams, meetings, docs</div>

      <div class="list">
        {#if groups.length === 0 && sorted.length === 0}
          <div class="empty">{emptyMsg}</div>
        {:else}
          {#each groups as group (group.scanner.id)}
            <ScannerSection scanner={group.scanner} items={group.items}
              onadditem={handleAddItem}
              onscannerrun={handleScannerRun}
              onscannertoggle={handleScannerToggle}
              onscannersettings={handleScannerSettings}
              onpopout={handlePopout}
              onseveritychange={handleSeverityChange}
              onstatuschange={handleStatusChange}
              onmarkseen={handleMarkSeen}
              ondelete={handleDelete}
              ondraftstep={handleDraftStep}
              onschedulechange={handleScheduleChange}
              onpromptchange={handlePromptChange}
              onmovescanner={handleMoveScanner}
              onrunnow={handleRunNow} />
          {/each}
        {/if}
      </div>
    </article>
  </div>
</section>

<AddTaskModal open={addTaskOpen} scannerId={addTaskScannerId}
  oncreate={(data) => { addTaskOpen = false; }}
  oncancel={() => { addTaskOpen = false; }} />

<ScannerSettingsModal open={settingsOpen} scanner={settingsScanner}
  onsave={(data) => { settingsOpen = false; }}
  onrunnow={() => { if (settingsScanner) handleScannerRun({ scannerId: settingsScanner.id }); }}
  ondelete={(data) => { settingsOpen = false; }}
  onclose={() => { settingsOpen = false; }} />
