<script>
  import { onMount, onDestroy } from 'svelte';
  import { mode, connected, history as historyStore } from './lib/stores.js';
  import { loadPersistentState, savePersistentState } from './lib/persistence.js';
  import { items, scanners, meetings, briefingsByMeetingId, briefingSeenAt,
    density, filter, collapsedSections } from './lib/stores.js';
  import { addHistory } from './lib/actions.js';
  import { startScannerEngine, stopScannerEngine } from './lib/scanner-engine.js';
  import { startMonitoringLoop, stopMonitoringLoop } from './lib/monitor-engine.js';
  import { cleanDisplayText, hashString, normalizeExternalUrl, nowIso } from './lib/utils.js';
  import { logInfo, persistLog, loadPersistedLog } from './lib/logger.js';
  import { TODAY_MEETINGS_PROMPT } from './lib/prompts.js';
  import { runWorkiqJson } from './lib/json-parser.js';
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

  let version = $state('');
  let updateAvailable = $state(false);
  let updateText = $state('Update available');
  let updateUrl = $state('');
  let updateVersion = $state('');
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

  async function fetchMeetings() {
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;
    try {
      const payload = await runWorkiqJson(
        TODAY_MEETINGS_PROMPT,
        (p) => p && Array.isArray(p.meetings),
        'meetings'
      );

      const raw = Array.isArray(payload?.meetings) ? payload.meetings : [];
      const now = Date.now();
      const processed = raw
        .map((item) => {
          const startAt = item.startAt || null;
          const startTime = startAt ? new Date(startAt).getTime() : Number.NaN;
          const title = cleanDisplayText(item.title || 'Untitled meeting');
          const organizer = cleanDisplayText(item.organizer || 'Unknown organizer');
          const seed = [title.toLowerCase(), organizer.toLowerCase(), String(startAt), String(item.endAt || '')].join('|');
          const id = cleanDisplayText(item.id || '').trim() || `meeting_${hashString(seed)}`;
          return {
            id,
            title,
            startAt,
            endAt: item.endAt || null,
            organizer,
            joinUrl: normalizeExternalUrl(item.joinUrl || ''),
            startTime,
          };
        })
        .filter((item) => Number.isFinite(item.startTime) && item.startTime >= now)
        .sort((a, b) => a.startTime - b.startTime);

      meetings.set(processed);
      addHistory('scan', `Loaded ${processed.length} upcoming meeting(s)`);
      savePersistentState();
    } catch (err) {
      console.warn('[flightdeck] meetings fetch failed', err.message);
    }
  }

  // Store subscriptions for auto-save
  const unsubscribers = [];

  onMount(async () => {
    initTheme();
    await loadPersistentState();
    await loadPersistedLog();
    logInfo('app', 'FlightDeck Svelte app initialized');

    // Read version from workiq bridge
    if (window.workiq && typeof window.workiq.getAppVersion === 'function') {
      try {
        version = await window.workiq.getAppVersion() || '';
      } catch (_) {}
    }

    // Check for updates
    if (window.workiq && typeof window.workiq.checkForUpdates === 'function') {
      try {
        const update = await window.workiq.checkForUpdates();
        if (update && update.available) {
          const dismissed = await window.workiq.storeGet('dismissed-update-version');
          if (dismissed !== update.latestVersion) {
            updateAvailable = true;
            updateText = `v${update.latestVersion} available`;
            updateUrl = update.releaseUrl || '';
            updateVersion = update.latestVersion;
          }
        }
      } catch (_) {}
    }

    // Start background engines and fetch meetings if connected
    if (window.workiq && typeof window.workiq.ask === 'function') {
      const isConnected = $connected;
      if (isConnected) {
        startScannerEngine();
        startMonitoringLoop();
        fetchMeetings();
      }
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
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    stopScannerEngine();
    stopMonitoringLoop();
    persistLog();
    unsubscribers.forEach((unsub) => unsub());
  });

  function handleEnable() {
    if (window.workiq && typeof window.workiq.enable === 'function') {
      window.workiq.enable();
    }
    connected.set(true);
    startScannerEngine();
    startMonitoringLoop();
    fetchMeetings();
  }
</script>

<Topbar {version} {updateAvailable} {updateText} {updateUrl}
  onupdatedismiss={() => {
    if (updateVersion && window.workiq) {
      window.workiq.storeSet('dismissed-update-version', updateVersion);
    }
  }} />

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
