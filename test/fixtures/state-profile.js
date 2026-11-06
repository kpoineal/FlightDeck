const path = require('node:path');
const fs = require('node:fs');

const STORAGE_KEY = 'flightdeck.persisted.v2';
const DEMO_KEY = 'flightdeck.demo.v2';
const PRESETS = {
  small: { hot: 100, cold: 0, events: 0, text: 64 },
  large: { hot: 500, cold: 5000, events: 40, text: 1024 },
  xlarge: { hot: 500, cold: 20000, events: 40, text: 1024 },
};

function generateStateProfile({ size = 'small', connected = false, collisions = false } = {}) {
  if (!Object.hasOwn(PRESETS, size)) throw new Error('Unknown synthetic profile size');
  const preset = PRESETS[size];
  const at = '2026-11-05T12:00:00.000Z';
  function item(index, cold = false) {
    return {
      id: `${cold ? 'cold' : 'hot'}_${index}`,
      scannerId: `scanner_${Math.floor(index / 2) % 2}`,
      title: `Generated thread ${index}`,
      summary: 'Synthetic summary. '.repeat(Math.ceil(preset.text / 19)),
      sourceType: 'email',
      sourceProvider: 'outlook',
      sourceId: `generated_${collisions ? Math.floor(index / 4) : index}`,
      lifecycleStatus: cold ? 'archived' : 'in-progress',
      severity: 'Observe',
      trackedAt: at, discoveredAt: at, lastChangedAt: at,
      monitorEnabled: false, nextRunAt: null,
      updateHistory: Array.from({ length: preset.events }, (_, event) => ({
        id: `event_${index}_${event}`, kind: event % 2 ? 'action' : 'update',
        timestamp: at, summary: 'Generated history entry.', seen: true,
      })),
      evidenceLinks: [],
    };
  }
  const items = Array.from({ length: preset.hot }, (_, i) => item(i));
  const state = {
    items, trackingItems: items, radarItems: items, connected,
    scanners: [0, 1].map(i => ({
      id: `scanner_${i}`, name: `Generated scanner ${i}`, prompt: 'Offline generated prompt',
      enabled: false, scheduleType: 'interval', scheduleValue: '4h',
      excludedItemIds: [`excluded_${i}`], crossScannerDedup: i === 0,
    })),
    history: [], actionProposals: [], deletedItemIds: ['synthetic_tombstone'],
    meetings: [], meetingsLastFetched: 0, briefingsByMeetingId: {}, briefingSeenAt: {},
    density: 'full', filter: 'all', collapsedSections: [], scannerSortPrefs: {},
  };
  return { state, cold: Array.from({ length: preset.cold }, (_, i) => item(i, true)) };
}

function createGeneratedProfile(options) {
  const root = path.resolve(__dirname, '..', '..', 'test-results', 'state-reload');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'generated-profile-'));
  fs.writeFileSync(path.join(directory, '.generated-state-profile'), 'flightdeck-offline-v1');
  const legacy103 = options?.legacy103 === true;
  const fixture = legacy103 ? generateLegacy103Profile() : generateStateProfile(options);
  fs.writeFileSync(path.join(directory, 'flightdeck-data.json'), JSON.stringify({
    // electron-store/Conf use dot notation for these production keys.
    flightdeck: { persisted: { v2: fixture.state },
      ...(!legacy103 ? { demo: { v2: { ...fixture.state, connected: false } } } : {}) },
  }));
  if (!legacy103) fs.writeFileSync(path.join(directory, 'flightdeck-cold.json'), JSON.stringify({ items: fixture.cold }));
  return { directory, fixture };
}

function generateLegacy103Profile() {
  // f61ea51 src/renderer/state.js saved only these fields; there was no cold store.
  return {
    state: {
      trackingItems: [0, 1, 2].map(index => ({
        id: `legacy103_${index}`, title: `Generated 1.0.3 tracked item ${index}`,
        severity: 'Observe', sourceType: 'Signal', dueAt: null, owner: 'You',
        counterparties: [], summary: 'Synthetic legacy item', reason: '',
        status: 'Tracked', trackedAt: '2026-11-05T12:00:00.000Z',
        monitorPrompt: 'Offline synthetic monitor', evidenceLinks: [],
        monitorEnabled: false, workHoursOnly: false, monitorSignals: [],
        scheduleType: 'interval', scheduleValue: '30m', oneTimeAt: null,
        weeklyDays: ['mon'], weeklyTimes: ['09:00'], nextRunAt: null,
        lastRunAt: null, lastCheckSignature: null, lastNotifiedSignature: null,
        notifyEnabled: false, origin: 'custom', updateHistory: [],
        hasNewUpdate: false, suggestedNextSteps: [], archived: false,
      })),
      briefingsByMeetingId: {}, briefingSeenAt: {}, history: [], connected: false,
      trackingDensity: 'full', radarDensity: 'full',
    },
    cold: [],
  };
}

function assertGeneratedProfile(directory, rootOverride) {
  const resolved = path.resolve(directory || '.');
  const root = rootOverride || path.resolve(__dirname, '..', '..', 'test-results', 'state-reload');
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('generated-profile-')
    || fs.readFileSync(path.join(resolved, '.generated-state-profile'), 'utf8') !== 'flightdeck-offline-v1') {
    throw new Error('Refusing non-generated profile');
  }
  return resolved;
}

function removeGeneratedProfile(directory) {
  fs.rmSync(assertGeneratedProfile(directory), { recursive: true, maxRetries: 8, retryDelay: 100 });
}

module.exports = { STORAGE_KEY, DEMO_KEY, generateStateProfile, createGeneratedProfile, assertGeneratedProfile, removeGeneratedProfile };
