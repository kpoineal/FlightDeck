<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { stateDiagnostics as diagnostics } from './lib/state-diagnostics.js';
  import { get } from 'svelte/store';
  import { mode, connected, history as historyStore, isDemo, actionProposals } from './lib/stores.js';
  import { applyConnectionStatus, validateConnection, getConnectionGeneration } from './lib/connection.js';
  import {
    cancelScheduledPersistentStateSave,
    loadPersistentState,
    savePersistentState,
    seedDemoFixture,
    pruneStaleBriefings,
    subscribePersistentState,
    flushPersistentState,
  } from './lib/persistence.js';
  import { items, scanners, meetings, meetingsLastFetched, briefingsByMeetingId, briefingSeenAt,
    density, filter, collapsedSections, highlightedItemId } from './lib/stores.js';
  import { addHistory } from './lib/actions.js';
  import { resumeScannerEngine, startScannerEngine, stopScannerEngine } from './lib/scanner-engine.js';
  import { startMonitoringLoop, stopMonitoringLoop } from './lib/monitor-engine.js';
  import { cleanDisplayText, hashString, normalizeExternalUrl, nowIso } from './lib/utils.js';
  import { logInfo, persistLog, loadPersistedLog } from './lib/logger.js';
  import { TODAY_MEETINGS_PROMPT } from './lib/prompts.js';
  import { runWorkiqJson } from './lib/json-parser.js';
  import Topbar from './components/Topbar.svelte';
  import TodayView from './components/TodayView.svelte';
  import ActionQueue from './components/ActionQueue.svelte';
  import ConnectBanner from './components/ConnectBanner.svelte';
  import SummaryStrip from './components/SummaryStrip.svelte';
  import TickerTape from './components/status-bars/TickerTape.svelte';
  import RadarView from './components/RadarView.svelte';
  import BriefingsView from './components/BriefingsView.svelte';
  import HistoryView from './components/HistoryView.svelte';
  import SourceCollisions from './components/SourceCollisions.svelte';
  import PersistenceBanner from './components/PersistenceBanner.svelte';
  import Toast from './components/Toast.svelte';
  import ConfirmModal from './components/ConfirmModal.svelte';
  import ScannerSettingsModal from './components/ScannerSettingsModal.svelte';
  import AddTaskModal from './components/AddTaskModal.svelte';
  import { createActionProposal } from './lib/action-proposals.js';
  import { navigateToRadarItem } from './lib/radar-navigation.js';

  let version = $state('');
  let updateAvailable = $state(false);
  let updateText = $state('Update available');
  let updateUrl = $state('');
  let updateVersion = $state('');
  let confirmOpen = false;
  let confirmSummary = '';
  let confirmTargets = '';
  let pendingConfirmAction = null;

  // Theme init
  function initTheme() {
    const stored = localStorage.getItem('fd-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  async function fetchMeetings(force = false) {
    if (!get(connected) || get(isDemo)) return;
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

    const requestGeneration = getConnectionGeneration();
    try {
      const payload = await runWorkiqJson(
        TODAY_MEETINGS_PROMPT,
        (p) => p && Array.isArray(p.meetings),
        'meetings'
      );
      if (!get(connected) || requestGeneration !== getConnectionGeneration()) return;

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
            summary: cleanDisplayText(item.summary || ''),
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

  // Track the last day we checked to avoid redundant refreshes on repeated focus events
  let lastDayChecked = new Date().toDateString();

  function handleDayChangeCheck() {
    if (!$connected || get(isDemo)) return;
    resumeScannerEngine();
    const today = new Date().toDateString();
    if (today === lastDayChecked) {
      // Same day — still try to refresh if meetings are stale (>1 hour)
      fetchMeetings();
      return;
    }
    // Day changed — force refresh meetings and prune old briefings
    lastDayChecked = today;
    pruneStaleBriefings();
    fetchMeetings(true);
    addHistory('scan', 'New day detected — refreshing meetings');
  }

  onMount(async () => {
    const endMount = diagnostics.begin('app-mount');
    diagnostics.record('app-mount');
    initTheme();

    // Detect demo mode from query param (set by main process --demo flag)
    const params = new URLSearchParams(window.location.search);
    const demoMode = params.has('demo');
    const demoReseed = params.has('reseed');
    if (demoMode) {
      isDemo.set(true);
      await seedDemoFixture(demoReseed);
    }

    await loadPersistentState(demoMode);
    unsubscribers.push(subscribePersistentState(demoMode));
    if (window.workiq.onFlushState) {
      unsubscribers.push(window.workiq.onFlushState(() => flushPersistentState(demoMode)));
    }
    if (window.workiq.onConnectionStatus) {
      unsubscribers.push(window.workiq.onConnectionStatus(applyConnectionStatus));
    }
    unsubscribers.push(connected.subscribe(ready => {
      if (ready && !demoMode) {
        diagnostics.record('engines-start');
        startScannerEngine();
        startMonitoringLoop();
        void fetchMeetings();
      } else {
        stopScannerEngine();
        stopMonitoringLoop();
      }
    }));
    diagnostics.record('subscriptions-installed');
    if (diagnostics.enabled) {
      // Observe asynchronously, without inserting a new await in startup sequencing.
      const endTick = diagnostics.begin('svelte-tick');
      void tick().then(() => {
        endTick();
        const endFrame = diagnostics.begin('frame-opportunity');
        requestAnimationFrame(() => endFrame());
      });
    }
    const currentItems = get(items);
    const priorityItem = currentItems.find((item) => /meridian/i.test(item.title))
      || currentItems.find((item) => item.severity === 'Critical');
    if (demoReseed && priorityItem && get(actionProposals).length === 0) {
      actionProposals.set([createActionProposal(
        priorityItem,
        priorityItem.suggestedNextSteps?.[0] || `Prepare an update for ${priorityItem.title}`,
        { id: `proposal_${priorityItem.id}_seed` }
      )]);
    }
    void (async () => {
    const endLog = diagnostics.begin('log-load');
    await loadPersistedLog();
    endLog();
    logInfo('app', demoMode ? 'FlightDeck demo mode initialized' : 'FlightDeck Svelte app initialized');

    // Read version from workiq bridge
    if (window.workiq && typeof window.workiq.getAppVersion === 'function') {
      const endVersion = diagnostics.begin('version-load');
      try {
        version = await window.workiq.getAppVersion() || '';
      } catch (_) {}
      endVersion();
    }

    // Check for updates
    if (window.workiq && typeof window.workiq.checkForUpdates === 'function') {
      const endUpdate = diagnostics.begin('update-check');
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
      endUpdate();
    }

    })();

    // Listen for state changes from other windows
    if (window.workiq && typeof window.workiq.onStateChanged === 'function') {
      unsubscribers.push(window.workiq.onStateChanged(() => {
        diagnostics.record('state-sync');
        void loadPersistentState(demoMode);
      }));
    }

    // Listen for app resume (window focus, system wake) to refresh stale meetings
    if (window.workiq && typeof window.workiq.onAppResumed === 'function') {
      const unsubResume = window.workiq.onAppResumed(() => {
        handleDayChangeCheck();
      });
      unsubscribers.push(unsubResume);
    }

    // Also detect day change when tab/window regains visibility (backup for non-IPC cases)
    const handleVisibility = () => {
      if (!document.hidden) handleDayChangeCheck();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    unsubscribers.push(() => document.removeEventListener('visibilitychange', handleVisibility));

    // Listen for desktop notification clicks → navigate to item
    if (window.workiq && typeof window.workiq.onNotificationClicked === 'function') {
      const unsubNotification = window.workiq.onNotificationClicked((payload) => {
        const taskId = payload?.taskId;
        if (!taskId) return;
        void navigateToRadarItem(taskId);
      });
      unsubscribers.push(unsubNotification);
    }
    endMount({ outcome: 'ok' });
    diagnostics.record('startup-complete');
  });

  onDestroy(() => {
    cancelScheduledPersistentStateSave();
    stopScannerEngine();
    stopMonitoringLoop();
    persistLog();
    unsubscribers.forEach((unsub) => unsub());
  });

  async function handleEnable() {
    await validateConnection(true);
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
    <PersistenceBanner />
    {#if !$connected}
      <ConnectBanner onenable={handleEnable} />
    {/if}

    {#if $mode !== 'Today'}
      <SummaryStrip />
    {/if}

    {#if $mode === 'Radar'}
      <div class="ticker-bar">
        <TickerTape />
      </div>
    {/if}

    {#if $mode === 'Today'}
      <TodayView />
    {:else if $mode === 'Radar'}
      <RadarView />
    {:else if $mode === 'Briefings'}
      <BriefingsView onrefresh={() => fetchMeetings(true)} />
    {:else if $mode === 'History'}
      <HistoryView history={$historyStore} />
      <SourceCollisions />
    {/if}
  </main>
</div>

<ConfirmModal open={confirmOpen} summary={confirmSummary} targets={confirmTargets}
  onconfirm={() => { if (pendingConfirmAction) pendingConfirmAction(); confirmOpen = false; }}
  oncancel={() => { confirmOpen = false; }} />

<Toast />
<ActionQueue />

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
