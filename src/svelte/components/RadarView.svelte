<script>
  import { filteredItems, scanners, items, coldItems, density, filter } from '../lib/stores.js';
  import { setDensity, setFilter, addHistory } from '../lib/actions.js';
  import { sortBySeverity, groupItemsBySource, normalizeExternalUrl, cleanDisplayText, hashString, nowIso, normalizeSeverity } from '../lib/utils.js';
  import { normalizeItem, computeNextRunAt } from '../lib/models/item.js';
  import { normalizeScannerDefinition, computeScannerNextRunAt } from '../lib/models/scanner.js';
  import { savePersistentState } from '../lib/persistence.js';
  import { runScanner as runScannerEngine } from '../lib/scanner-engine.js';
  import { runItemCheck } from '../lib/monitor-engine.js';
  import ScannerSection from './ScannerSection.svelte';
  import AddTaskModal from './AddTaskModal.svelte';
  import ScannerSettingsModal from './ScannerSettingsModal.svelte';
  import { showToast } from './Toast.svelte';

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

    try {
      await runScannerEngine(scanner);
    } catch (err) {
      addHistory('failure', `Scanner ${scanner.name} failed: ${err.message}`);
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
    const item = $items.find(i => i.id === data.itemId);
    if (!item || item.scannerId === data.scannerId) return;
    const targetScanner = $scanners.find(s => s.id === data.scannerId);
    items.update(($items) => $items.map(i =>
      i.id === data.itemId ? { ...i, scannerId: data.scannerId } : i
    ));
    addHistory('action', `Moved "${item.title}" to ${targetScanner?.name || 'scanner'}`);
    showToast(`Moved to ${targetScanner?.name || 'scanner'}`, { icon: '📦' });
    savePersistentState();
  }

  async function handleRunNow(data) {
    const item = $items.find(i => i.id === data.itemId);
    if (!item) return;
    try {
      await runItemCheck(item);
      savePersistentState();
    } catch (err) {
      addHistory('failure', `Monitor check failed for ${item.title}: ${err.message}`);
    }
  }

  function handleFieldEdit(data) {
    items.update(($items) => $items.map(i => {
      if (i.id !== data.itemId) return i;
      if (data.field === 'dueAt') {
        return { ...i, dueAt: data.value || null };
      }
      return { ...i, [data.field]: data.value };
    }));
    savePersistentState();
  }

  function handleScannerSave(data) {
    if (settingsScanner) {
      scanners.update(($s) => $s.map(s => {
        if (s.id !== settingsScanner.id) return s;
        const updated = normalizeScannerDefinition({ ...s, ...data });
        updated.nextRunAt = updated.enabled ? computeScannerNextRunAt(updated) : null;
        return updated;
      }));
      addHistory('action', `Updated scanner: ${data.name || settingsScanner.name}`);
    } else {
      const newScanner = normalizeScannerDefinition({
        ...data,
        id: `scanner_${hashString(Date.now() + '_' + Math.random())}`,
        enabled: true,
      });
      newScanner.nextRunAt = computeScannerNextRunAt(newScanner);
      scanners.update(($s) => [...$s, newScanner]);
      addHistory('action', `Created scanner: ${data.name || 'Unnamed'}`);
    }
    savePersistentState();
    settingsOpen = false;
  }

  function handleScannerDelete(data) {
    const name = settingsScanner?.name || 'Scanner';
    scanners.update(($s) => $s.filter(s => s.id !== (data?.scannerId || settingsScanner?.id)));
    addHistory('action', `Deleted scanner: ${name}`);
    savePersistentState();
    settingsOpen = false;
  }

  function handleCreateTask(data) {
    const newItem = normalizeItem({
      ...data,
      id: `custom_${hashString(Date.now() + '_' + Math.random())}`,
      trackedAt: nowIso(),
      origin: 'custom',
      isNew: true,
      monitorEnabled: true,
    });
    newItem.nextRunAt = computeNextRunAt(newItem);
    items.update(($i) => [newItem, ...$i]);
    addHistory('action', `Added custom task: ${newItem.title}`);
    savePersistentState();
    addTaskOpen = false;
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

  // ── Auto-scroll while dragging near viewport edges ──────────────
  const EDGE_ZONE = 60;   // px from viewport edge to trigger scroll
  const SCROLL_SPEED = 12; // px per frame at full proximity
  let scrollRaf = null;
  let scrollDelta = 0;

  function handleDragOverScroll(e) {
    const y = e.clientY;
    const vh = window.innerHeight;

    if (y < EDGE_ZONE) {
      const intensity = 1 - y / EDGE_ZONE;
      scrollDelta = -SCROLL_SPEED * intensity;
      startAutoScroll();
    } else if (y > vh - EDGE_ZONE) {
      const intensity = 1 - (vh - y) / EDGE_ZONE;
      scrollDelta = SCROLL_SPEED * intensity;
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }

  function startAutoScroll() {
    if (scrollRaf) return;
    (function tick() {
      document.documentElement.scrollTop += scrollDelta;
      scrollRaf = requestAnimationFrame(tick);
    })();
  }

  function stopAutoScroll() {
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
  }

  function handleDragEndScroll() {
    stopAutoScroll();
  }

  $effect(() => {
    window.addEventListener('dragover', handleDragOverScroll);
    window.addEventListener('dragend', handleDragEndScroll);
    window.addEventListener('drop', handleDragEndScroll);
    return () => {
      window.removeEventListener('dragover', handleDragOverScroll);
      window.removeEventListener('dragend', handleDragEndScroll);
      window.removeEventListener('drop', handleDragEndScroll);
      stopAutoScroll();
    };
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
              onrunnow={handleRunNow}
              onfieldedit={handleFieldEdit} />
          {/each}
        {/if}
      </div>
    </article>
  </div>
</section>

<AddTaskModal open={addTaskOpen} scannerId={addTaskScannerId}
  oncreate={handleCreateTask}
  oncancel={() => { addTaskOpen = false; }} />

<ScannerSettingsModal open={settingsOpen} scanner={settingsScanner}
  onsave={handleScannerSave}
  onrunnow={() => { if (settingsScanner) handleScannerRun({ scannerId: settingsScanner.id }); }}
  ondelete={handleScannerDelete}
  onclose={() => { settingsOpen = false; }} />
