// ── FlightDeck constants ─────────────────────────────────────────────

const RADAR_SCAN_JSON_SCHEMA = `

Return only valid JSON and nothing else using this schema:
{
  "generatedAt": "ISO-8601 timestamp",
  "kpis": { "critical": number, "elevated": number, "observe": number },
  "radarItems": [
    {
      "id": "string",
      "title": "string",
      "severity": "Critical|Elevated|Observe",
      "sourceType": "Email|Chat|Meeting|Doc",
      "dueAt": "ISO-8601 or null",
      "owner": "string",
      "counterparties": ["string"],
      "summary": "string",
      "reason": "string",
      "status": "Inbound",
      "evidenceLinks": [
        {
          "label": "descriptive label for the source",
          "type": "email|chat|meeting|doc",
          "signalAt": "ISO-8601 timestamp when the email/chat/meeting/doc was sent or updated, or null"
        }
      ],
      "suggestedNextSteps": ["string"]
    }
  ]
}

IMPORTANT:
- Include your normal response markdown formatting for the summary.
- Include your normal response in reason as well.


Suggested next steps rules:
- For each radar item, suggest 0-2 specific, concrete next actions the user should take.
- Each should be a short phrase naming who and what (e.g. 'Reply to Sarah with the revised Q3 timeline', 'Escalate to VP Engineering before Friday deadline').
- Only suggest actions when genuinely useful. Return an empty array if no action is needed.
- Never suggest vague actions like 'follow up' without naming who or what specifically.`;

const BRIEFING_JSON_SCHEMA = `

Return only valid JSON and nothing else:
{
  "generatedAt": "ISO-8601 timestamp",
  "upcomingMeeting": {
    "title": "string",
    "startAt": "ISO-8601 timestamp or null",
    "organizer": "string",
    "joinUrl": "https URL or null"
  },
  "headline": "string",
  "keyUpdates": ["string"],
  "decisionsNeeded": ["string"],
  "topRisks": ["string"],
  "talkTrack": ["string"],
  "todayFollowUps": ["string"],
  "sources": [
    {
      "label": "string",
      "type": "meeting|message|doc",
      "url": "https URL"
    }
  ]
}`;

const BRIEFING_MEETING_JSON_SCHEMA = `

Use grounded Microsoft 365 context relevant to this meeting.

Return only valid JSON and nothing else:
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string",
  "upcomingMeeting": {
    "id": "string",
    "title": "string",
    "startAt": "ISO-8601 timestamp or null",
    "organizer": "string",
    "joinUrl": "https URL or null"
  },
  "keyUpdates": ["string"],
  "decisionsNeeded": ["string"],
  "topRisks": ["string"],
  "talkTrack": ["string"],
  "todayFollowUps": ["string"],
  "sources": [
    {
      "label": "string",
      "type": "meeting|message|doc",
      "url": "https URL"
    }
  ]
}`;

const DAY_BRIEFING_KEY = '__day_briefing__';

const DAY_BRIEFING_JSON_SCHEMA = `

Return only valid JSON and nothing else:
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string (e.g. 'Busy day ahead: 4 meetings, 2 Critical items')",
  "topPriorities": ["string — the 3-5 most important things today"],
  "meetingsRequiringPrep": [
    {
      "title": "string",
      "startAt": "ISO-8601 timestamp or null",
      "whyPrepNeeded": "string"
    }
  ],
  "atRiskItems": [
    {
      "title": "string",
      "severity": "Critical|Elevated|Observe",
      "risk": "string"
    }
  ],
  "suggestedTimeBlocks": [
    {
      "time": "string (e.g. '9:00 – 9:30 AM')",
      "activity": "string",
      "rationale": "string"
    }
  ],
  "todayFollowUps": ["string — concrete follow-ups to handle today"],
  "sources": [
    {
      "label": "string",
      "type": "meeting|message|doc",
      "url": "https URL"
    }
  ]
}`;

const MAX_TRACKED_EXCLUSIONS = 12;

const STORAGE_KEY = 'flightdeck.persisted.v2';
const LEGACY_STORAGE_KEY = 'flightdeck.persisted.v1';
const PROMPT_STORAGE_PREFIX = 'flightdeck.prompt.';
const MONITOR_TICK_MS = 30000;
const SCHEDULE_INTERVAL_OPTIONS = [
  { value: '15m', label: '15m', minutes: 15 },
  { value: '30m', label: '30m', minutes: 30 },
  { value: '1h', label: '1h', minutes: 60 },
  { value: '2h', label: '2h', minutes: 120 },
  { value: '4h', label: '4h', minutes: 240 },
];

const WEEKLY_DAY_OPTIONS = [
  { value: 'mon', label: 'Mon', jsDay: 1 },
  { value: 'tue', label: 'Tue', jsDay: 2 },
  { value: 'wed', label: 'Wed', jsDay: 3 },
  { value: 'thu', label: 'Thu', jsDay: 4 },
  { value: 'fri', label: 'Fri', jsDay: 5 },
  { value: 'sat', label: 'Sat', jsDay: 6 },
  { value: 'sun', label: 'Sun', jsDay: 0 },
];
const DEFAULT_WEEKLY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DEFAULT_WEEKLY_TIMES = ['08:00', '12:00'];
const WORK_HOURS_START_HOUR = 8;
const WORK_HOURS_END_HOUR = 17;

const LIFECYCLE_STATUSES = ['in-progress', 'blocked', 'waiting', 'complete', 'archived'];
const LIFECYCLE_LABELS = {
  'in-progress': 'In Progress',
  'blocked': 'Blocked',
  'waiting': 'Waiting',
  'complete': 'Complete',
  'archived': 'Archived',
};

const ALL_SIGNAL_TYPES = ['email', 'chat', 'meeting', 'doc'];
const SIGNAL_TYPE_OPTIONS = [
  { value: 'email', label: 'Email', icon: '✉️' },
  { value: 'chat', label: 'Chat', icon: '💬' },
  { value: 'meeting', label: 'Meetings', icon: '📅' },
  { value: 'doc', label: 'Documents', icon: '📄' },
];

const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const HISTORY_MAX_ENTRIES = 200;
