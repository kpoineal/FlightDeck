<script>
  import { filteredItems, scanners, density, filter } from '../lib/stores.js';
  import { setDensity, setFilter } from '../lib/actions.js';
  import { sortBySeverity, groupItemsBySource } from '../lib/utils.js';
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
              onpopout={handlePopout} />
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
