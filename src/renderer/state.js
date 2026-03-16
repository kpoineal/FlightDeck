// ── FlightDeck state management ─────────────────────────────────────

const _popoutParams = new URLSearchParams(window.location.search);
const POPOUT_ITEM_ID = _popoutParams.get('popout') || null;
const IS_POPOUT = Boolean(POPOUT_ITEM_ID);

const elements = {
  commandInput: document.getElementById('commandInput'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  connectBanner: document.getElementById('connectBanner'),
  enableBtn: document.getElementById('enableBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  dashboardStatus: document.getElementById('dashboardStatus'),
  dashboardUpdatedAt: document.getElementById('dashboardUpdatedAt'),

  kpiCritical: document.getElementById('kpiCritical'),
  kpiElevated: document.getElementById('kpiElevated'),
  kpiMonitor: document.getElementById('kpiMonitor'),
  kpiScopeLabel: document.getElementById('kpiScopeLabel'),
  severityBarCritical: document.getElementById('severityBarCritical'),
  severityBarElevated: document.getElementById('severityBarElevated'),
  severityBarMonitor: document.getElementById('severityBarMonitor'),
  chartCriticalCount: document.getElementById('chartCriticalCount'),
  chartElevatedCount: document.getElementById('chartElevatedCount'),
  chartMonitorCount: document.getElementById('chartMonitorCount'),
  chartTotalItems: document.getElementById('chartTotalItems'),
  severityDonut: document.getElementById('severityDonut'),
  severityInsight: document.getElementById('severityInsight'),

  viewRadar: document.getElementById('viewRadar'),
  viewTracking: document.getElementById('viewTracking'),
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
  trackingList: document.getElementById('trackingList'),
  customTaskTitle: document.getElementById('customTaskTitle'),
  customTaskContext: document.getElementById('customTaskContext'),
  customTaskSeverity: document.getElementById('customTaskSeverity'),
  customTaskScheduleType: document.getElementById('customTaskScheduleType'),
  customTaskScheduleValue: document.getElementById('customTaskScheduleValue'),
  customTaskOneTimeAt: document.getElementById('customTaskOneTimeAt'),
  customTaskNotify: document.getElementById('customTaskNotify'),
  createTaskBtn: document.getElementById('createTaskBtn'),

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
  storageSize: document.getElementById('storageSize'),
};

const state = {
  connected: false,
  mode: 'Radar',
  loading: false,
  kpis: { critical: null, elevated: null, observe: null },
  radarItems: [],
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
  expandedBriefingMeetingIds: [],
  trackingItems: [],
  briefingsByMeetingId: {},
  briefingSeenAt: {},
  history: [],
  pendingConfirmAction: null,
  trackingDensity: 'full',
  radarDensity: 'full',
};

async function savePersistentState() {
  // Prune history before every save to prevent unbounded growth during long sessions
  pruneHistory();

  const payload = {
    trackingItems: state.trackingItems,
    briefingsByMeetingId: state.briefingsByMeetingId,
    briefingSeenAt: state.briefingSeenAt,
    history: state.history,
    connected: state.connected,
    trackingDensity: state.trackingDensity,
    radarDensity: state.radarDensity,
  };

  // Demo mode writes to a separate key so real data is never overwritten
  const key = (typeof IS_DEMO !== 'undefined' && IS_DEMO) ? DEMO_STORAGE_KEY : STORAGE_KEY;

  try {
    await window.workiq.storeSet(key, payload);
    window.workiq.broadcastStateChanged();
    updateStorageSize();
  } catch (error) {
    console.warn('[flightdeck] persistence write failed', error.message);
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
    if (!parsed) return;

    // Migrate away from legacy v1 key so old data doesn't persist alongside v2
    if (usedLegacyKey) {
      await window.workiq.storeDelete(LEGACY_STORAGE_KEY);
    }

    state.trackingItems = Array.isArray(parsed.trackingItems)
      ? parsed.trackingItems.map((entry) => normalizeTrackingItem(entry))
      : [];

    // Trim existing oversized update histories
    for (const item of state.trackingItems) {
      if (Array.isArray(item.updateHistory) && item.updateHistory.length > 20) {
        item.updateHistory = item.updateHistory.slice(0, 20);
      }
    }
    state.briefingsByMeetingId = parsed.briefingsByMeetingId && typeof parsed.briefingsByMeetingId === 'object'
      ? parsed.briefingsByMeetingId
      : {};
    state.briefingSeenAt = parsed.briefingSeenAt && typeof parsed.briefingSeenAt === 'object'
      ? parsed.briefingSeenAt
      : {};
    state.history = Array.isArray(parsed.history) ? parsed.history : [];
    state.trackingDensity = parsed.trackingDensity === 'minimal' ? 'minimal' : 'full';
    state.radarDensity = parsed.radarDensity === 'minimal' ? 'minimal' : 'full';
    if (parsed.connected === true) {
      state.connected = true;
      if (elements.connectBanner) elements.connectBanner.classList.add('d-none');
    }

    pruneHistory();
    pruneStaleBriefings();
  } catch (error) {
    console.warn('[flightdeck] persistence read failed', error.message);
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

// ── Storage size indicator ──────────────────────────────────────────
async function updateStorageSize() {
  if (!elements.storageSize) return;
  try {
    const { bytes, formatted } = await window.workiq.storeGetSize();
    elements.storageSize.textContent = formatted;
    elements.storageSize.title = `Store: ${formatted}`;
    elements.storageSize.classList.remove('warn');
  } catch (e) {
    elements.storageSize.textContent = '';
  }
}
