// ── FlightDeck demo mode ─────────────────────────────────────────────
// Activated by ?demo=1 query parameter. Seeds state with synthetic data
// and skips all WorkIQ calls. Zero impact on production code paths.

const _demoParams = new URLSearchParams(window.location.search);
const IS_DEMO = _demoParams.get('demo') === '1' || window.location.search.includes('demo=1');

let _demoFixture = null;

async function loadDemoFixture() {
  if (!IS_DEMO) return;

  try {
    const response = await fetch('demo/fixture.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    _demoFixture = await response.json();
    console.log('[flightdeck:demo] Fixture loaded');
  } catch (error) {
    console.error('[flightdeck:demo] Failed to load fixture:', error.message);
    _demoFixture = null;
  }
}

const DEMO_STORAGE_KEY = 'flightdeck.demo.v2';

/**
 * Seed the DEMO store key with persisted demo data.
 * Never touches the real flightdeck.persisted.v2 key.
 */
async function seedDemoState() {
  if (!IS_DEMO || !_demoFixture?.persisted) return;

  try {
    await window.workiq.storeSet(DEMO_STORAGE_KEY, _demoFixture.persisted);
    console.log('[flightdeck:demo] Persisted state seeded (demo key)');
  } catch (error) {
    console.warn('[flightdeck:demo] Failed to seed state:', error.message);
  }
}

/**
 * Populate ephemeral state (radar items, meetings, ledger) that
 * normally comes from WorkIQ but isn't persisted to the store.
 * Call AFTER loadPersistentState() so tracking items are already loaded.
 */
function applyDemoEphemeralState() {
  if (!IS_DEMO || !_demoFixture?.responses) return;

  // ── Radar items (direct state write — bypasses URL validation that
  //    would strip our demo.flightdeck.app links) ──
  const radar = _demoFixture.responses.radar;
  state.kpis = {
    critical: Number(radar.kpis?.critical || 0),
    elevated: Number(radar.kpis?.elevated || 0),
    observe: Number(radar.kpis?.observe || 0),
  };

  state.radarItems = (radar.radarItems || []).map((item) => ({
    id: item.id || `demo_${Math.random().toString(16).slice(2, 8)}`,
    title: item.title || 'Untitled item',
    severity: normalizeSeverity(item.severity),
    sourceType: item.sourceType || 'Signal',
    dueAt: item.dueAt || null,
    owner: item.owner || 'You',
    counterparties: Array.isArray(item.counterparties) ? item.counterparties : [],
    summary: item.summary || '',
    reason: item.reason || '',
    status: item.status || 'Inbound',
    evidenceLinks: Array.isArray(item.evidenceLinks)
      ? item.evidenceLinks.filter((e) => e && e.url)
      : [],
    suggestedNextSteps: Array.isArray(item.suggestedNextSteps)
      ? item.suggestedNextSteps.slice(0, 2)
      : [],
  }));

  state.selectedRadarItemId = state.radarItems.length ? state.radarItems[0].id : null;

  // ── Ledger ──
  const normLedger = (arr, prefix) => (arr || []).map((entry, i) => ({
    id: entry.id || `${prefix}_${i + 1}`,
    title: entry.title || 'Untitled',
    counterparties: Array.isArray(entry.counterparties) ? entry.counterparties : [],
    dueAt: entry.dueAt || null,
    lastSignalAt: entry.lastSignalAt || null,
    daysSilent: Number(entry.daysSilent || 0),
    evidenceLinks: Array.isArray(entry.evidenceLinks) ? entry.evidenceLinks : [],
    suggestedFollowUp: entry.suggestedFollowUp || '',
  }));

  state.ledger = {
    iOwe: normLedger(radar.iOwe, 'iowe'),
    othersOweMe: normLedger(radar.othersOweMe, 'others'),
    silentThreads: normLedger(radar.silentThreads, 'silent'),
  };

  // ── Meetings (rewrite times so they're always "upcoming") ──
  const now = Date.now();
  const offsets = [2, 3.5, 5, 7]; // hours from now
  const meetings = (_demoFixture.responses.meetings?.meetings || []).map((meeting, i) => {
    const offsetMs = (offsets[i] || (i + 2)) * 60 * 60 * 1000;
    const start = new Date(now + offsetMs);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      id: meeting.id,
      title: meeting.title || 'Untitled meeting',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      organizer: meeting.organizer || 'Unknown organizer',
      joinUrl: meeting.joinUrl || null,
      startTime: start.getTime(),
    };
  }).sort((a, b) => a.startTime - b.startTime);

  state.meetings = meetings;

  // ── Briefings — reconcile meeting IDs so they match the rewritten meetings ──
  // The fixture has briefings keyed by the same meeting IDs,
  // so they'll align automatically after reconcileMeetingScopedState.
  reconcileMeetingScopedState(state.meetings);

  // Mark as connected, hide banner
  state.connected = true;
  const connectBanner = document.getElementById('connectBanner');
  if (connectBanner) connectBanner.classList.add('d-none');

  console.log('[flightdeck:demo] Ephemeral state applied — radar:', state.radarItems.length,
    'meetings:', state.meetings.length, 'ledger iOwe:', state.ledger.iOwe.length);
}
