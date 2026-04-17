<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { mode, connected, history as historyStore, isDemo } from './lib/stores.js';
  import { loadPersistentState, savePersistentState, seedDemoFixture } from './lib/persistence.js';
  import { items, scanners, meetings, meetingsLastFetched, briefingsByMeetingId, briefingSeenAt,
    density, filter, collapsedSections, highlightedItemId } from './lib/stores.js';
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
  import TickerTape from './components/status-bars/TickerTape.svelte';
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
    saveTimer = setTimeout(() => savePersistentState(get(isDemo)), 500);
  }

  async function fetchMeetings(force = false) {
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;

    // Use cached meetings if fetched recently (within 1 hour and same calendar day)
    if (!force) {
      const lastFetch = get(meetingsLastFetched);
      const cached = get(meetings);
      if (lastFetch && cached.length) {
        const age = Date.now() - lastFetch;
        const sameDay = new Date(lastFetch).toDateString() === new Date().toDateString();
        if (age < 3_600_000 && sameDay) return;
      }
    }

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
      meetingsLastFetched.set(Date.now());
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

    // Detect demo mode from query param (set by main process --demo flag)
    const demoMode = new URLSearchParams(window.location.search).has('demo');
    if (demoMode) {
      isDemo.set(true);
      await seedDemoFixture();
    }

    await loadPersistentState(demoMode);
    await loadPersistedLog();
    logInfo('app', demoMode ? 'FlightDeck demo mode initialized' : 'FlightDeck Svelte app initialized');

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

    // Start background engines and fetch meetings if connected (skip in demo mode)
    if (!demoMode && window.workiq && typeof window.workiq.ask === 'function') {
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

    // Listen for desktop notification clicks → navigate to item
    if (window.workiq && typeof window.workiq.onNotificationClicked === 'function') {
      const unsubNotification = window.workiq.onNotificationClicked((payload) => {
        const taskId = payload?.taskId;
        if (!taskId) return;

        // Find which scanner section contains this item
        const currentItems = get(items);
        const targetItem = currentItems.find(i => i.id === taskId);

        // Reset filter so target item is visible
        filter.set('all');
        mode.set('Radar');

        // Expand the scanner section containing this item (collapse others)
        if (targetItem && targetItem.scannerId) {
          const sectionId = `scanner-${targetItem.scannerId}`;
          // Keep only other sections collapsed — expand the target
          collapsedSections.update($cs => {
            const withoutTarget = $cs.filter(id => id !== sectionId);
            // Collapse all OTHER sections for accordion effect
            const allSectionIds = get(scanners).map(s => `scanner-${s.id}`);
            return allSectionIds.filter(id => id !== sectionId);
          });
        }

        // Highlight the target item (components react to this)
        // Use a small delay to let the DOM update after section expansion
        setTimeout(() => {
          highlightedItemId.set(taskId);
          setTimeout(() => highlightedItemId.set(null), 4000);
        }, 100);
      });
      unsubscribers.push(unsubNotification);
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
      <div class="ticker-bar">
        <TickerTape />
      </div>
    {/if}

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

<style>
  .ticker-bar {
    background: linear-gradient(135deg, var(--bg-surface) 0%, color-mix(in srgb, var(--accent) 4%, var(--bg-surface)) 100%);
    backdrop-filter: blur(var(--blur-radius));
    -webkit-backdrop-filter: blur(var(--blur-radius));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 4px 20px;
    box-shadow: var(--shadow-card);
  }
</style>
