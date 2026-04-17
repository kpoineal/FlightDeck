// ── FlightDeck state management ─────────────────────────────────────

const _popoutParams = new URLSearchParams(window.location.search);
const POPOUT_ITEM_ID = _popoutParams.get('popout') || null;
const IS_POPOUT = Boolean(POPOUT_ITEM_ID);

const elements = {
  commandInput: document.getElementById('commandInput'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  connectBanner: document.getElementById('connectBanner'),
  enableBtn: document.getElementById('enableBtn'),
  dashboardStatus: document.getElementById('dashboardStatus'),

  summCriticalCount: document.getElementById('summCriticalCount'),
  summElevatedCount: document.getElementById('summElevatedCount'),
  summObserveCount: document.getElementById('summObserveCount'),
  summBarCritical: document.getElementById('summBarCritical'),
  summBarElevated: document.getElementById('summBarElevated'),
  summBarMonitor: document.getElementById('summBarMonitor'),
  summTotal: document.getElementById('summTotal'),
  summBlocked: document.getElementById('summBlocked'),
  summNew: document.getElementById('summNew'),
  summComplete: document.getElementById('summComplete'),

  viewRadar: document.getElementById('viewRadar'),
  viewTracking: null, // Removed — unified into viewRadar
  viewBriefings: document.getElementById('viewBriefings'),
  viewHistory: document.getElementById('viewHistory'),

  radarList: document.getElementById('radarList'),
  toneSelect: document.getElementById('toneSelect'),

  promptEditorToggle: document.getElementById('promptEditorToggle'),
  promptEditorBody: document.getElementById('promptEditorBody'),
  radarPromptEditor: document.getElementById('radarPromptEditor'),
  promptEditorApply: document.getElementById('promptEditorApply'),
  promptEditorReset: document.getElementById('promptEditorReset'),
  promptEditorStatus: document.getElementById('promptEditorStatus'),

  briefingPromptEditorToggle: document.getElementById('briefingPromptEditorToggle'),
  briefingPromptEditorBody: document.getElementById('briefingPromptEditorBody'),
  briefingPromptEditor: document.getElementById('briefingPromptEditor'),
  briefingPromptEditorApply: document.getElementById('briefingPromptEditorApply'),
  briefingPromptEditorReset: document.getElementById('briefingPromptEditorReset'),
  briefingPromptEditorStatus: document.getElementById('briefingPromptEditorStatus'),

  briefingPane: document.getElementById('briefingPane'),
  trackingList: document.getElementById('radarList'), // Legacy alias — unified into radarList

  ledgerIOwe: document.getElementById('ledgerIOwe'),
  ledgerOthersOwe: document.getElementById('ledgerOthersOwe'),
  ledgerSilent: document.getElementById('ledgerSilent'),

  historyList: document.getElementById('historyList'),

  confirmModal: document.getElementById('confirmModal'),
  confirmSummary: document.getElementById('confirmSummary'),
  confirmTargets: document.getElementById('confirmTargets'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmApply: document.getElementById('confirmApply'),

  globalSearch: document.getElementById('globalSearch'),
  searchResults: document.getElementById('searchResults'),
  searchOverlay: document.getElementById('searchOverlay'),
  morningBanner: document.getElementById('morningBanner'),
};

const state = {
  connected: false,
  mode: 'Radar',
  loading: false,
  kpis: { critical: null, elevated: null, observe: null },
  items: [],
  // Legacy aliases — kept in sync by item.js mutations for backward compat
  radarItems: [],
  trackingItems: [],
  scanners: [],
  actions: [],
  evidence: [],
  selectedRadarItemId: null,
  ledger: {
    iOwe: [],
    othersOweMe: [],
    silentThreads: [],
  },
  briefing: null,
  meetings: [],
  meetingsLastFetched: 0,
  expandedBriefingMeetingIds: [],
  briefingsByMeetingId: {},
  briefingSeenAt: {},
  history: [],
  pendingConfirmAction: null,
  density: 'full',
  filter: 'all',
  collapsedSections: [],
  scannerFilters: {},  // Ephemeral per-scanner inline filters, NOT persisted
  // Legacy aliases for density
  trackingDensity: 'full',
  radarDensity: 'full',
  _loaded: false, // Guard: true only after loadPersistentState completes
};

async function savePersistentState() {
  // Guard against saving empty state before load completes
  if (!state._loaded) return;

  // Prune history before every save to prevent unbounded growth during long sessions
  pruneHistory();

  // Enforce evidence link cap on every item
  for (const item of state.items) {
    if (Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > MAX_EVIDENCE_LINKS_PER_ITEM) {
      item.evidenceLinks = item.evidenceLinks.slice(-MAX_EVIDENCE_LINKS_PER_ITEM);
    }
  }

  // ── Tiered storage eviction ─────────────────────────────────────
  // Move archived/complete items that have been in that state for 24+ hours
  // into cold storage so they don't consume renderer memory.
  const evictionCutoff = Date.now() - COLD_EVICTION_HOURS * 60 * 60 * 1000;
  const hotItems = [];
  const evictedItems = [];

  for (const item of state.items) {
    const isColdCandidate = item.lifecycleStatus === 'archived' || item.lifecycleStatus === 'complete';
    if (isColdCandidate) {
      const transitionedAt = item.lastChangedAt || item.lastRunAt || item.trackedAt || item.discoveredAt;
      const transitionTime = transitionedAt ? new Date(transitionedAt).getTime() : 0;
      if (Number.isFinite(transitionTime) && transitionTime < evictionCutoff) {
        evictedItems.push(item);
        continue;
      }
    }
    hotItems.push(item);
  }

  // If items were evicted, append to cold storage
  if (evictedItems.length) {
    try {
      const existingCold = await window.workiq.getColdItems() || [];
      const coldById = new Map(existingCold.map((c) => [c.id, c]));
      for (const item of evictedItems) {
        coldById.set(item.id, item);
      }
      await window.workiq.setColdItems([...coldById.values()]);
      state.items = hotItems;
      state.radarItems = state.items;
      state.trackingItems = state.items;
      console.log(`[flightdeck] Evicted ${evictedItems.length} item(s) to cold storage`);
    } catch (err) {
      console.warn('[flightdeck] cold storage eviction failed, keeping items hot', err.message);
    }
  }

  // Enforce global active items cap — evict oldest archived/complete first, then oldest overall
  if (state.items.length > MAX_ACTIVE_ITEMS) {
    // Sort: archived/complete items first (by discoveredAt ascending), then the rest
    const sortedForEviction = [...state.items].sort((a, b) => {
      const aIsOld = a.lifecycleStatus === 'archived' || a.lifecycleStatus === 'complete' ? 0 : 1;
      const bIsOld = b.lifecycleStatus === 'archived' || b.lifecycleStatus === 'complete' ? 0 : 1;
      if (aIsOld !== bIsOld) return aIsOld - bIsOld;
      const aTime = new Date(a.discoveredAt || 0).getTime() || 0;
      const bTime = new Date(b.discoveredAt || 0).getTime() || 0;
      return aTime - bTime;
    });
    const overflow = sortedForEviction.slice(0, state.items.length - MAX_ACTIVE_ITEMS);
    const overflowIds = new Set(overflow.map((i) => i.id));
    try {
      const existingCold = await window.workiq.getColdItems() || [];
      const coldById = new Map(existingCold.map((c) => [c.id, c]));
      for (const item of overflow) {
        coldById.set(item.id, item);
      }
      await window.workiq.setColdItems([...coldById.values()]);
      state.items = state.items.filter((i) => !overflowIds.has(i.id));
      state.radarItems = state.items;
      state.trackingItems = state.items;
      console.log(`[flightdeck] Cap overflow: evicted ${overflow.length} item(s) to cold storage`);
    } catch (err) {
      console.warn('[flightdeck] cap overflow eviction failed', err.message);
    }
  }

  const payload = {
    items: state.items,
    // Legacy key written for backward compat (tests + rollback safety)
    trackingItems: state.items,
    scanners: state.scanners,
    radarItems: state.items,
    briefingsByMeetingId: state.briefingsByMeetingId,
    briefingSeenAt: state.briefingSeenAt,
    meetings: state.meetings,
    meetingsLastFetched: state.meetingsLastFetched,
    history: state.history,
    connected: state.connected,
    density: state.density,
    filter: state.filter,
    collapsedSections: state.collapsedSections,
    // Legacy keys written for rollback safety
    trackingDensity: state.density,
    radarDensity: state.density,
  };

  // Demo mode writes to a separate key so real data is never overwritten
  const key = (typeof IS_DEMO !== 'undefined' && IS_DEMO) ? DEMO_STORAGE_KEY : STORAGE_KEY;

  try {
    await window.workiq.storeSet(key, payload);
  } catch (error) {
    console.warn('[flightdeck] persistence write failed', error.message);
  } finally {
    window.workiq.broadcastStateChanged();
  }
}

async function migrateLocalStorageToStore() {
  try {
    if (localStorage.getItem('flightdeck.migrated-to-store')) return;

    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('flightdeck.') || key === 'fd-theme') {
        try {
          data[key] = JSON.parse(localStorage.getItem(key));
        } catch (_) {
          data[key] = localStorage.getItem(key);
        }
      }
    }

    if (Object.keys(data).length) {
      await window.workiq.storeMigrateFromLocalStorage(data);
    }
    localStorage.setItem('flightdeck.migrated-to-store', 'true');
    console.log('[flightdeck] localStorage migrated to electron-store');
  } catch (error) {
    console.warn('[flightdeck] localStorage migration failed', error.message);
  }
}

async function loadPersistentState() {
  try {
    // One-time migration from localStorage to electron-store
    await migrateLocalStorageToStore();

    // Demo mode reads from a separate key so real data is never touched
    const useDemo = typeof IS_DEMO !== 'undefined' && IS_DEMO;
    let parsed = await window.workiq.storeGet(useDemo ? DEMO_STORAGE_KEY : STORAGE_KEY) ?? null;
    let usedLegacyKey = false;
    if (!parsed && !useDemo) {
      parsed = await window.workiq.storeGet(LEGACY_STORAGE_KEY) ?? null;
      usedLegacyKey = Boolean(parsed);
    }
    // When the store is empty (fresh install or data loss), treat as empty
    // object so seed scanner creation and _loaded flag are still reached.
    if (!parsed) {
      parsed = {};
    }

    // Migrate away from legacy v1 key so old data doesn't persist alongside v2
    if (usedLegacyKey) {
      await window.workiq.storeDelete(LEGACY_STORAGE_KEY);
    }

    // ── Migration: unified items model ──────────────────────────────
    if (Array.isArray(parsed.items)) {
      // New format — load directly
      state.items = parsed.items.map((entry) => normalizeItem(entry));
    } else {
      // Old format — migrate from separate radarItems + trackingItems
      const trackingById = new Map();
      const migratedItems = [];

      // Tracking items first (they have richer monitoring data)
      if (Array.isArray(parsed.trackingItems)) {
        for (const entry of parsed.trackingItems) {
          const normalized = normalizeItem(entry);
          trackingById.set(normalized.id, true);
          migratedItems.push(normalized);
        }
      }

      // Radar items that aren't already covered by tracking
      if (Array.isArray(parsed.radarItems)) {
        for (const entry of parsed.radarItems) {
          if (trackingById.has(entry.id)) continue;
          migratedItems.push(normalizeItem(entry));
        }
      }

      state.items = migratedItems;
    }

    // Trim existing oversized update histories
    for (const item of state.items) {
      if (Array.isArray(item.updateHistory) && item.updateHistory.length > 20) {
        item.updateHistory = item.updateHistory.slice(0, 20);
      }
      // Enforce evidence link cap on load
      if (Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > MAX_EVIDENCE_LINKS_PER_ITEM) {
        item.evidenceLinks = item.evidenceLinks.slice(-MAX_EVIDENCE_LINKS_PER_ITEM);
      }
      // Clear stale "new" flags on completed/archived items and ensure monitoring is stopped
      // (handles items whose lifecycle was reconciled to 'complete' by normalizeItem on load)
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') {
        item.hasNewUpdate = false;
        item.isNew = false;
        item.monitorEnabled = false;
        item.nextRunAt = null;
        if (!item.completedAt && item.lifecycleStatus === 'complete') {
          item.completedAt = item.lastChangedAt || new Date().toISOString();
        }
        if (Array.isArray(item.updateHistory)) {
          item.updateHistory.forEach((e) => { e.seen = true; });
        }
      }
    }

    // Keep legacy aliases in sync
    state.radarItems = state.items;
    state.trackingItems = state.items;

    state.briefingsByMeetingId = parsed.briefingsByMeetingId && typeof parsed.briefingsByMeetingId === 'object'
      ? parsed.briefingsByMeetingId
      : {};
    state.briefingSeenAt = parsed.briefingSeenAt && typeof parsed.briefingSeenAt === 'object'
      ? parsed.briefingSeenAt
      : {};

    // Restore cached meetings (filter to future meetings only)
    if (Array.isArray(parsed.meetings) && parsed.meetings.length) {
      const now = Date.now();
      state.meetings = parsed.meetings.filter(
        (m) => m.startTime && Number.isFinite(m.startTime) && m.startTime >= now
      );
    }
    if (typeof parsed.meetingsLastFetched === 'number') {
      state.meetingsLastFetched = parsed.meetingsLastFetched;
    }

    state.scanners = Array.isArray(parsed.scanners)
      ? parsed.scanners.map((entry) => normalizeScannerDefinition(entry))
      : [];

    // Migration: strip legacy isDefault flag from any scanner (DEC-063)
    for (const scanner of state.scanners) {
      if ('isDefault' in scanner) delete scanner.isDefault;
    }

    // Phase 4: First-run seed scanner — when no scanners exist, create a
    // default "Radar" scanner seeded with the radar-scan.md prompt.
    if (!state.scanners.length && typeof normalizeScannerDefinition === 'function') {
      let radarPrompt = DEFAULT_SCANNER_PROMPT;
      try {
        const result = await window.workiq.readPromptFile('radar-scan.md');
        if (result.success && result.content) radarPrompt = result.content.trim();
      } catch (_) {}
      const seed = normalizeScannerDefinition({
        id: `scanner_${hashString(`${Date.now()}_${Math.random()}`)}`,
        name: 'Radar',
        prompt: radarPrompt,
        enabled: true,
        scheduleType: 'interval',
        scheduleValue: '4h',
      });
      seed.nextRunAt = typeof computeScannerNextRunAt === 'function'
        ? computeScannerNextRunAt(seed) : null;
      state.scanners.push(seed);
    }

    state.history = Array.isArray(parsed.history) ? parsed.history : [];
    state.density = parsed.density === 'minimal' ? 'minimal'
      : (parsed.trackingDensity === 'minimal' ? 'minimal' : 'full');
    // Keep legacy density aliases in sync
    state.trackingDensity = state.density;
    state.radarDensity = state.density;
    const rawFilter = parsed.filter || parsed.trackingFilter || 'all';
    state.filter = (rawFilter === 'all' || rawFilter === 'archived') ? rawFilter : 'all';
    state.collapsedSections = Array.isArray(parsed.collapsedSections) ? parsed.collapsedSections : [];
    if (parsed.connected === true) {
      state.connected = true;
      if (elements.connectBanner) elements.connectBanner.classList.add('d-none');
    }

    pruneHistory();
    pruneStaleBriefings();
    autoArchiveCompletedItems();

    // ── Cold storage migration ───────────────────────────────────
    // On first load after tiered storage is deployed, move existing
    // archived/complete items that are 24+ hours old into cold storage.
    try {
      const coldCutoff = Date.now() - COLD_EVICTION_HOURS * 60 * 60 * 1000;
      const migrateToCode = [];
      const keepHot = [];
      for (const item of state.items) {
        const isCold = item.lifecycleStatus === 'archived' || item.lifecycleStatus === 'complete';
        if (isCold) {
          const ts = item.lastChangedAt || item.lastRunAt || item.trackedAt || item.discoveredAt;
          const t = ts ? new Date(ts).getTime() : 0;
          if (Number.isFinite(t) && t < coldCutoff) {
            migrateToCode.push(item);
            continue;
          }
        }
        keepHot.push(item);
      }
      if (migrateToCode.length) {
        const existingCold = await window.workiq.getColdItems() || [];
        const coldById = new Map(existingCold.map((c) => [c.id, c]));
        for (const item of migrateToCode) {
          coldById.set(item.id, item);
        }
        await window.workiq.setColdItems([...coldById.values()]);
        state.items = keepHot;
        state.radarItems = state.items;
        state.trackingItems = state.items;
        console.log(`[flightdeck] Migrated ${migrateToCode.length} item(s) to cold storage on load`);
      }
    } catch (coldErr) {
      console.warn('[flightdeck] cold storage migration on load failed', coldErr.message);
    }

    // Mark state as loaded — savePersistentState is now safe to write
    state._loaded = true;
  } catch (error) {
    // Even on error, allow saves so the app isn't permanently frozen
    state._loaded = true;
    console.warn('[flightdeck] persistence read failed', error.message);
  }
}

const AUTO_ARCHIVE_DAYS = 7;

function autoArchiveCompletedItems() {
  const cutoff = Date.now() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const item of state.items) {
    if (item.lifecycleStatus !== 'complete') continue;
    // Use lastChangedAt or the most recent history entry timestamp to determine when it was completed
    const completedAt = item.lastChangedAt
      || (Array.isArray(item.updateHistory) && item.updateHistory.length ? item.updateHistory[0].timestamp : null)
      || item.lastRunAt || item.trackedAt;
    if (!completedAt) continue;
    const completedTime = new Date(completedAt).getTime();
    if (Number.isFinite(completedTime) && completedTime < cutoff) {
      item.lifecycleStatus = 'archived';
      item.monitorEnabled = false;
      item.nextRunAt = null;
      changed = true;
    }
  }
  if (changed && state._loaded) {
    savePersistentState();
  }
}

function pruneHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  state.history = state.history.filter((entry) => {
    const entryTime = entry.at ? new Date(entry.at).getTime() : 0;
    return Number.isFinite(entryTime) && entryTime > cutoff;
  });

  // Hard cap as belt-and-suspenders guard against explosive growth within a single day
  if (state.history.length > HISTORY_MAX_ENTRIES) {
    state.history = state.history.slice(-HISTORY_MAX_ENTRIES);
  }
}

function pruneStaleBriefings() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();

  for (const [meetingId, briefing] of Object.entries(state.briefingsByMeetingId)) {
    // Day briefing: prune if generatedAt is from a previous day
    if (meetingId === DAY_BRIEFING_KEY) {
      const generatedAt = briefing?.generatedAt
        ? new Date(briefing.generatedAt).getTime()
        : null;
      if (generatedAt && Number.isFinite(generatedAt) && generatedAt < cutoff) {
        delete state.briefingsByMeetingId[meetingId];
        delete state.briefingSeenAt[meetingId];
      }
      continue;
    }

    // Meeting briefings: prune if meeting startAt is from a previous day
    const meetingStart = briefing?.upcomingMeeting?.startAt
      ? new Date(briefing.upcomingMeeting.startAt).getTime()
      : null;
    if (meetingStart && Number.isFinite(meetingStart) && meetingStart < cutoff) {
      delete state.briefingsByMeetingId[meetingId];
      delete state.briefingSeenAt[meetingId];
    }
  }
}

// Storage size indicator removed — storageSize element no longer in the UI
