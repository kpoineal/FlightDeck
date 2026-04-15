<script>
  import { filteredItems, scanners, items, coldItems, density, filter, loading } from '../lib/stores.js';
  import { setDensity, setFilter, addHistory } from '../lib/actions.js';
  import { sortBySeverity, groupItemsBySource, normalizeExternalUrl, cleanDisplayText, hashString, nowIso, normalizeSeverity } from '../lib/utils.js';
  import { normalizeItem, computeNextRunAt } from '../lib/models/item.js';
  import { computeScannerNextRunAt } from '../lib/models/scanner.js';
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

  async function handleScannerRun(data) {
    const scanner = $scanners.find(s => s.id === data.scannerId);
    if (!scanner) return;
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;

    loading.set(true);
    addHistory('scan', `Running scanner: ${scanner.name}`);

    try {
      const prompt = scanner.prompt || 'Scan for new work items';
      const raw = await window.workiq.ask(prompt);
      // Try to parse JSON from the response
      let payload;
      try {
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw;
        payload = JSON.parse(jsonStr);
      } catch (_) {
        addHistory('failure', `Scanner ${scanner.name}: could not parse response`);
        return;
      }

      if (payload && Array.isArray(payload.radarItems)) {
        const newItems = payload.radarItems.map(item => normalizeItem({
          ...item,
          id: item.id || `radar_${hashString(cleanDisplayText(item.title || '') + nowIso())}`,
          status: item.status || 'Inbound',
          scannerId: scanner.id,
          isNew: true,
        }));

        // Dedup against existing items
        const currentItems = $items;
        const existingIds = new Set(currentItems.map(i => i.id));
        const existingTitles = new Set(currentItems.filter(i => i.scannerId === scanner.id).map(i => cleanDisplayText(i.title || '').toLowerCase()));
        const unique = newItems.filter(i => !existingIds.has(i.id) && !existingTitles.has(cleanDisplayText(i.title || '').toLowerCase()));

        if (unique.length) {
          items.update($i => [...unique, ...$i]);
        }

        // Update scanner lastRunAt and nextRunAt
        scanners.update($s => $s.map(s =>
          s.id === scanner.id ? { ...s, lastRunAt: nowIso(), nextRunAt: computeScannerNextRunAt({ ...s, lastRunAt: nowIso() }) } : s
        ));

        addHistory('scan', `Scanner ${scanner.name}: found ${unique.length} new item(s)`);
      }
      savePersistentState();
    } catch (err) {
      addHistory('failure', `Scanner ${scanner.name} failed: ${err.message}`);
    } finally {
      loading.set(false);
    }
  }

  function handleScannerToggle(data) {
    scanners.update($s => $s.map(s => {
      if (s.id !== data.scannerId) return s;
      const enabled = !s.enabled;
      return { ...s, enabled, nextRunAt: enabled ? computeScannerNextRunAt(s) : null };
    }));
    savePersistentState();
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
  // NOTE: Svelte writable stores require a new array/object reference to
  // trigger subscriber notifications. Returning the same array won't update
  // derived stores or child component props. We use .map() to produce a
  // new array with a cloned item when modifying item properties.

  function handleSeverityChange(data) {
    items.update(($items) => $items.map(i =>
      i.id === data.itemId ? { ...i, severity: data.value } : i
    ));
    savePersistentState();
  }

  function handleStatusChange(data) {
    items.update(($items) => $items.map(i => {
      if (i.id !== data.itemId) return i;
      const updated = { ...i, lifecycleStatus: data.value, lastChangedAt: new Date().toISOString() };
      if (data.value === 'complete' && !updated.completedAt) {
        updated.completedAt = new Date().toISOString();
      }
      if (data.value === 'complete' || data.value === 'archived') {
        updated.monitorEnabled = false;
        updated.nextRunAt = null;
      }
      return updated;
    }));
    savePersistentState();
  }

  function handleMarkSeen(data) {
    items.update(($items) => $items.map(i => {
      if (i.id !== data.itemId) return i;
      const updated = { ...i, hasNewUpdate: false, isNew: false };
      if (Array.isArray(updated.updateHistory)) {
        updated.updateHistory = updated.updateHistory.map(e => ({ ...e, seen: true }));
      }
      return updated;
    }));
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
    items.update(($items) => $items.map(i =>
      i.id === data.itemId ? { ...i, [data.field]: data.value } : i
    ));
    savePersistentState();
  }

  function handlePromptChange(data) {
    items.update(($items) => $items.map(i =>
      i.id === data.itemId ? { ...i, monitorPrompt: data.value } : i
    ));
    savePersistentState();
  }

  function handleMoveScanner(data) {
    items.update(($items) => $items.map(i =>
      i.id === data.itemId ? { ...i, scannerId: data.scannerId } : i
    ));
    savePersistentState();
  }

  function handleRunNow(data) {
    const currentItems = $items;
    const item = currentItems.find(i => i.id === data.itemId);
    if (item && item.monitorPrompt && window.workiq && typeof window.workiq.ask === 'function') {
      window.workiq.ask(item.monitorPrompt);
    }
  }

  // Cold storage fetch for archived filter
  $effect(() => {
    if ($filter === 'archived' && window.workiq && typeof window.workiq.getColdItems === 'function') {
      window.workiq.getColdItems().then((result) => {
        if (Array.isArray(result) && result.length) {
          coldItems.set(result);
        }
      }).catch(() => {});
    } else {
      coldItems.set([]);
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
