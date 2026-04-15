<script>
  import { onMount, onDestroy } from 'svelte';
  import { mode, connected, history as historyStore } from './lib/stores.js';
  import { loadPersistentState, savePersistentState } from './lib/persistence.js';
  import { items, scanners, meetings, briefingsByMeetingId, briefingSeenAt,
    density, filter, collapsedSections } from './lib/stores.js';
  import Topbar from './components/Topbar.svelte';
  import ConnectBanner from './components/ConnectBanner.svelte';
  import SummaryStrip from './components/SummaryStrip.svelte';
  import RadarView from './components/RadarView.svelte';
  import BriefingsView from './components/BriefingsView.svelte';
  import HistoryView from './components/HistoryView.svelte';
  import Toast from './components/Toast.svelte';
  import ConfirmModal from './components/ConfirmModal.svelte';
  import ScannerSettingsModal from './components/ScannerSettingsModal.svelte';
  import AddTaskModal from './components/AddTaskModal.svelte';

  let version = '';
  let updateAvailable = false;
  let updateText = 'Update available';
  let updateUrl = '';
  let confirmOpen = false;
  let confirmSummary = '';
  let confirmTargets = '';
  let pendingConfirmAction = null;
  let saveTimer = null;

  // Theme init
  function initTheme() {
    const stored = localStorage.getItem('fd-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }

  function debouncedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePersistentState(), 500);
  }

  // Store subscriptions for auto-save
  const unsubscribers = [];

  onMount(async () => {
    initTheme();
    await loadPersistentState();

    // Read version from workiq bridge
    if (window.workiq && typeof window.workiq.getVersion === 'function') {
      try {
        version = await window.workiq.getVersion() || '';
      } catch (_) {}
    }

    // Auto-save on store changes
    unsubscribers.push(items.subscribe(debouncedSave));
    unsubscribers.push(scanners.subscribe(debouncedSave));
    unsubscribers.push(density.subscribe(debouncedSave));
    unsubscribers.push(filter.subscribe(debouncedSave));
    unsubscribers.push(collapsedSections.subscribe(debouncedSave));
    unsubscribers.push(briefingsByMeetingId.subscribe(debouncedSave));
    unsubscribers.push(briefingSeenAt.subscribe(debouncedSave));

    // Listen for state changes from other windows
    if (window.workiq && typeof window.workiq.onStateChanged === 'function') {
      window.workiq.onStateChanged(() => {
        loadPersistentState();
      });
    }

    // Listen for update notifications
    if (window.workiq && typeof window.workiq.onUpdateAvailable === 'function') {
      window.workiq.onUpdateAvailable((info) => {
        updateAvailable = true;
        if (info && info.text) updateText = info.text;
        if (info && info.url) updateUrl = info.url;
      });
    }
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    unsubscribers.forEach((unsub) => unsub());
  });

  function handleEnable() {
    if (window.workiq && typeof window.workiq.enable === 'function') {
      window.workiq.enable();
    }
    connected.set(true);
  }
</script>

<Topbar {version} {updateAvailable} {updateText} {updateUrl} />

<div class="app-shell">
  <main class="main">
    {#if !$connected}
      <ConnectBanner onenable={handleEnable} />
    {/if}

    <SummaryStrip />

    {#if $mode === 'Radar'}
      <RadarView />
    {:else if $mode === 'Briefings'}
      <BriefingsView />
    {:else if $mode === 'History'}
      <HistoryView history={$historyStore} />
    {/if}
  </main>
</div>

<ConfirmModal open={confirmOpen} summary={confirmSummary} targets={confirmTargets}
  onconfirm={() => { if (pendingConfirmAction) pendingConfirmAction(); confirmOpen = false; }}
  oncancel={() => { confirmOpen = false; }} />

<Toast />
