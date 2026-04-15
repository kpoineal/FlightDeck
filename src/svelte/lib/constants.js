// ── FlightDeck constants (ES module) ─────────────────────────────────

export const STORAGE_KEY = 'flightdeck.persisted.v2';
export const LEGACY_STORAGE_KEY = 'flightdeck.persisted.v1';
export const DEMO_STORAGE_KEY = 'flightdeck.demo.v2';

export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const HISTORY_MAX_ENTRIES = 200;

export const MAX_EVIDENCE_LINKS_PER_ITEM = 20;
export const MAX_ACTIVE_ITEMS = 500;
export const COLD_EVICTION_HOURS = 24;

export const AUTO_ARCHIVE_DAYS = 7;

export const DAY_BRIEFING_KEY = '__day_briefing__';

export const SCHEDULE_INTERVAL_OPTIONS = [
  { value: '15m', label: '15m', minutes: 15 },
  { value: '30m', label: '30m', minutes: 30 },
  { value: '1h', label: '1h', minutes: 60 },
  { value: '2h', label: '2h', minutes: 120 },
  { value: '4h', label: '4h', minutes: 240 },
];

export const WEEKLY_DAY_OPTIONS = [
  { value: 'mon', label: 'Mon', jsDay: 1 },
  { value: 'tue', label: 'Tue', jsDay: 2 },
  { value: 'wed', label: 'Wed', jsDay: 3 },
  { value: 'thu', label: 'Thu', jsDay: 4 },
  { value: 'fri', label: 'Fri', jsDay: 5 },
  { value: 'sat', label: 'Sat', jsDay: 6 },
  { value: 'sun', label: 'Sun', jsDay: 0 },
];
export const DEFAULT_WEEKLY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const DEFAULT_WEEKLY_TIMES = ['08:00', '12:00'];
export const WORK_HOURS_START_HOUR = 8;
export const WORK_HOURS_END_HOUR = 17;

export const LIFECYCLE_STATUSES = ['in-progress', 'blocked', 'waiting', 'snoozed', 'complete', 'archived'];

export const ALL_SIGNAL_TYPES = ['email', 'chat', 'meeting', 'doc'];

export const SEVERITY_THRESHOLD_OPTIONS = [
  { value: 'all', label: 'All severities' },
  { value: 'Critical', label: 'Critical only' },
  { value: 'Elevated', label: 'Elevated & above' },
];

export const MISSED_RUN_POLICY_OPTIONS = [
  { value: 'skip', label: 'Skip missed' },
  { value: 'run-once', label: 'Run once on reopen' },
  { value: 'catch-up', label: 'Catch up (max 3)' },
];

export const DEDUP_STRATEGY_OPTIONS = [
  { value: 'evidence-url', label: 'Evidence URLs' },
  { value: 'title-similarity', label: 'Title similarity' },
  { value: 'both', label: 'URLs + title' },
];

export const DEFAULT_SCANNER_PROMPT = `Focus specifically on: [describe what to look for]

Look for items with signals since {lastRunAt}.

Rules:
- Only include items that are actionable or require attention.
- Include any commitments made to me or made by me, inferred or otherwise.
- Include inline citations for every referenced source.
- Prioritize current, time-sensitive work.`;

export const LIFECYCLE_LABELS = {
  'in-progress': 'In Progress',
  'blocked': 'Blocked',
  'waiting': 'Waiting',
  'snoozed': 'Snoozed',
  'complete': 'Complete',
  'archived': 'Archived',
};

export const NOTIFICATION_MODE_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'critical-only', label: 'Critical only' },
  { value: 'silent', label: 'Silent' },
];

export const SIGNAL_TYPE_OPTIONS = [
  { value: 'email', label: 'Email', icon: '\u2709\ufe0f' },
  { value: 'chat', label: 'Chat', icon: '\uD83D\uDCAC' },
  { value: 'meeting', label: 'Meetings', icon: '\uD83D\uDCC5' },
  { value: 'doc', label: 'Documents', icon: '\uD83D\uDCC4' },
];
