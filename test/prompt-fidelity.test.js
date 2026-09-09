'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EM_DASH = '\u2014';

let buildMonitorPrompt;
let buildScannerPrompt;

test.before(async () => {
  ({ buildMonitorPrompt, buildScannerPrompt } = await import('../src/svelte/lib/prompts.js'));
});

function withIsoLocaleDates(callback) {
  const originalToLocaleString = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function toLocaleString() {
    return this.toISOString();
  };

  try {
    return callback();
  } finally {
    Date.prototype.toLocaleString = originalToLocaleString;
  }
}

test('scanner prompt preserves the complete tuned contract and block ordering', () => {
  const scanner = {
    id: 'scanner-launch',
    name: 'Launch readiness',
    prompt: `Focus specifically on: launch approvals and rollout blockers

Track commitments created after {lastRunAt}.`,
    lastRunAt: '2026-09-08T14:30:00.000Z',
    maxItemsPerScan: 7,
    signalTypes: ['email', 'meeting'],
    scheduleType: 'weekly',
    weeklyDays: ['tue', 'thu'],
    weeklyTimes: ['09:00'],
    workHoursOnly: true,
    dedupStrategy: 'both',
  };
  const currentItems = [
    { scannerId: 'scanner-launch', title: 'Approve launch brief', lifecycleStatus: 'in-progress' },
    { scannerId: 'scanner-launch', title: 'approve launch brief', lifecycleStatus: 'waiting' },
    { scannerId: 'scanner-launch', title: '[Resolve rollout blocker](https://teams.microsoft.com/l/message/19:launch)', lifecycleStatus: 'blocked' },
    { scannerId: 'scanner-launch', title: 'Completed launch task', lifecycleStatus: 'complete' },
    { scannerId: 'scanner-launch', title: 'Archived launch task', lifecycleStatus: 'archived' },
    { scannerId: 'scanner-other', title: 'Other scanner item', lifecycleStatus: 'in-progress' },
  ];
  const allScanners = [
    scanner,
    {
      id: 'scanner-escalations',
      name: 'Customer escalations',
      enabled: true,
      prompt: 'Focus specifically on: customer escalations',
    },
    {
      id: 'scanner-executive',
      name: 'Executive commitments',
      enabled: true,
      prompt: 'Track leadership commitments that could change the launch date.',
    },
    {
      id: 'scanner-disabled',
      name: 'Disabled scanner',
      enabled: false,
      prompt: 'Focus specifically on: disabled work',
    },
    { id: 'scanner-empty', name: 'Empty scanner', enabled: true, prompt: '' },
  ];

  const prompt = buildScannerPrompt(scanner, currentItems, allScanners);

  const expected = `You are a work-signal scanner agent. Analyze recent Microsoft 365 signals and surface new items that need attention.

--- SCANNER MISSION ---
Focus specifically on: launch approvals and rollout blockers

Track commitments created after 2026-09-08T14:30:00.000Z.

Time window: Last scan was at 2026-09-08T14:30:00.000Z. Only return items with signals created or updated AFTER this time. Do not report older items.

Signal source filter (IMPORTANT):
- ONLY search for and consider these signal types: Email, Meeting.
- IGNORE all other signal types entirely. Do not include evidence from excluded signal types.
- The signal type labels map as follows: Email = Outlook emails, Chat = Teams chat messages, Meeting = Calendar events and meeting transcripts/notes, Doc = SharePoint/OneDrive documents.

Analysis procedure:
1. Search for recent Microsoft 365 signals (emails, chats, meetings, documents) matching the scanner mission above.
2. Identify actionable work items, commitments made to or by the user, and time-sensitive matters.
3. Classify each item as Critical, Elevated, or Observe based on urgency and impact.
4. Include inline citations in summary and reason fields for every signal referenced.
5. Return at most 7 items. Prefer quality over quantity.
6. For each item, define what "done" looks like ${EM_DASH} a concrete, observable condition that would indicate this item is resolved. If the completion condition is unclear from available signals, return null for doneCriteria.

Return only valid JSON and nothing else using this schema:
{
  "generatedAt": "ISO-8601 timestamp",
  "kpis": { "critical": number, "elevated": number, "observe": number },
  "radarItems": [
    {
      "id": "string",
      "title": "string",
      "severity": "Critical|Elevated|Observe",
      "sourceType": "string (e.g. Email, Chat, Meeting, Doc, DevOps, Planner ${EM_DASH} describe the signal source)",
      "dueAt": "ISO-8601 or null",
      "owner": "string",
      "counterparties": ["string"],
      "summary": "string",
      "reason": "string",
      "status": "Inbound",
      "evidenceLinks": [
        {
          "label": "descriptive label for the source",
          "type": "string (e.g. email, chat, meeting, doc, devops, planner ${EM_DASH} describe the signal source)",
          "url": "https URL for the exact source signal",
          "signalAt": "ISO-8601 timestamp when the signal was sent or updated, or null"
        }
      ],
      "suggestedNextSteps": ["string"],
      "doneCriteria": "string ${EM_DASH} one sentence describing what 'done' looks like for this item (e.g. 'Jordan confirms receipt of the budget spreadsheet'), or null if unclear"
    }
  ]
}

IMPORTANT:
- Include your normal response markdown formatting for the summary.
- Include your normal response in reason as well.

Suggested next steps rules:
- 0-2 specific, completable actions starting with a verb naming WHO and WHAT (e.g. 'Reply to Sarah with the revised Q3 timeline', 'Send Jordan the updated budget spreadsheet').
- Only suggest actions when genuinely useful. Return an empty array if no action is needed.
- Never use vague language: "consider", "think about", "follow up", "look into". Every action must be concrete and completable.

Due date rules:
- Extract deadlines from signals ('by end of week', 'due Friday', etc.) and set dueAt as ISO-8601. Use today as reference for relative expressions.
- If no temporal signal is present, return null for dueAt. Never fabricate deadlines.

Evidence & citation rules:
- Use markdown formatting in summary and reason fields. Include inline citations for every referenced source.
- Only include citations grounded in actual Microsoft 365 signals.

Items already on my radar from this scanner (do NOT re-report these):
- Approve launch brief
- Resolve rollout blocker

Other active scanners (skip items that clearly belong to another scanner's focus area):
- "Customer escalations" covers: customer escalations
- "Executive commitments" covers: Track leadership commitments that could change the launch date.`;

  assert.equal(prompt, expected);
  assert.doesNotMatch(prompt, /weeklyDays|weeklyTimes|workHoursOnly|dedupStrategy/);
});

test('monitor prompt preserves context, temporal, metadata, and no-update semantics', () => {
  const item = {
    id: 'thread-launch',
    title: 'Approve launch brief',
    severity: 'Elevated',
    status: 'Waiting',
    dueAt: '2026-09-10T23:00:00.000Z',
    owner: 'Kyle Poineal',
    counterparties: ['Sofia Martinez', 'James Farquharson'],
    lastRunAt: '2026-09-08T15:45:00.000Z',
    monitorPrompt: `Track the stored approval context exactly.
Confirm whether Sofia approved the launch brief.`,
    summary: 'The launch brief is waiting for Sofia\'s approval.',
    reason: 'Approval gates the rollout.',
    evidenceLinks: [
      {
        label: 'Launch brief',
        type: 'doc',
        url: 'https://contoso.sharepoint.com/sites/launch/brief.docx',
        signalAt: '2026-09-08T14:05:00.000Z',
      },
      {
        label: 'Approval thread',
        type: 'chat',
        url: 'https://teams.microsoft.com/l/message/19:launch/approval',
      },
    ],
    doneCriteria: 'Sofia explicitly approves the final launch brief.',
    monitorSignals: ['chat', 'doc'],
    scheduleType: 'interval',
    scheduleValue: '2h',
    workHoursOnly: true,
    notifyEnabled: false,
    updateHistory: [
      { timestamp: '2026-09-08T15:30:00.000Z', summary: 'Sofia requested one final wording change.' },
      { timestamp: '2026-09-08T14:15:00.000Z', summary: 'The revised launch brief was shared.' },
      { timestamp: '2026-09-08T12:00:00.000Z', summary: 'This older summary must not be injected.' },
    ],
  };

  const prompt = withIsoLocaleDates(() => buildMonitorPrompt(item));

  const expected = `You are a work-tracking monitor agent. Review the latest Microsoft 365 signals and provide an updated status report for the task below.

Task to monitor:
- Title: Approve launch brief
- Severity: Elevated
- Status: Waiting
- Due: 2026-09-10T23:00:00.000Z
- Owner: Kyle Poineal
- People: Sofia Martinez, James Farquharson
- Last checked: 2026-09-08T15:45:00.000Z

Only report signals created or updated AFTER the last check time above. Older signals are already captured in the previous summary.

--- MONITORING CONTEXT ---
Track the stored approval context exactly.
Confirm whether Sofia approved the launch brief.

Previous summary: The launch brief is waiting for Sofia's approval.

Previously known evidence:
  - [doc] Launch brief: https://contoso.sharepoint.com/sites/launch/brief.docx (signalAt: 2026-09-08T14:05:00.000Z)
  - [chat] Approval thread: https://teams.microsoft.com/l/message/19:launch/approval

--- DONE CRITERIA ---
Sofia explicitly approves the final launch brief.
Evaluate whether signals indicate this done criteria has been met. If met, set status to "Complete".

Signal source filter (IMPORTANT):
- ONLY search for and consider these signal types: Chat, Doc.
- IGNORE all other signal types entirely. Do not include evidence from excluded signal types.
- The signal type labels map as follows: Email = Outlook emails, Chat = Teams chat messages, Meeting = Calendar events and meeting transcripts/notes, Doc = SharePoint/OneDrive documents.

Previous update summaries (for de-duplication ${EM_DASH} do NOT re-report the same information described here as "new"):
  1. [2026-09-08T15:30:00.000Z] Sofia requested one final wording change.
  2. [2026-09-08T14:15:00.000Z] The revised launch brief was shared.
If the signals you find are already covered by these previous summaries, set hasNewInfo to false and return the current summary verbatim.

Analysis procedure:
1. Search for recent signals (emails, chats, meetings, documents) related to this task.
2. Identify new developments, blockers, decisions, ownership changes, or timeline shifts since the last check.
3. Assess whether severity should change and update the summary to reflect current state.
4. List all people currently involved based on recent signals.
5. Include inline markdown [label](url) citations in summary and reason fields for every signal referenced ${EM_DASH} this is how evidence links are extracted.

Return strict valid JSON only:
{
  "hasNewInfo": true | false,
  "status": "In Progress|Blocked|Waiting|Complete|No Update",
  "summary": "string (2-4 sentence current-state summary incorporating latest signals)",
  "reason": "string (why this severity level is appropriate right now)",
  "severity": "Critical|Elevated|Observe",
  "dueAt": "ISO-8601 timestamp or null",
  "owner": "string",
  "counterparties": ["string"],
  "evidenceLinks": [
    {
      "label": "descriptive label for the source signal",
      "type": "string (e.g. email, chat, meeting, doc, devops, planner, etc. ${EM_DASH} use your best judgment to describe the signal source)",
      "url": "https URL for the exact source signal",
      "signalAt": "ISO-8601 timestamp when the signal was sent/written/updated, or null"
    }
  ],
  "suggestedNextSteps": ["string"],
  "doneCriteria": "string ${EM_DASH} observable completion condition for this item, or null if unchanged/unknown",
  "completionConfidence": "high|medium|low|null ${EM_DASH} confidence that this item is complete (high = explicit closure signal, medium = likely resolved, low = possibly done)"
}

Due date rules:
- Extract deadlines from signals ('by end of week', 'due Friday', etc.) and set dueAt as ISO-8601. Use today as reference for relative expressions.
- Preserve existing dueAt if no new deadline found. Never fabricate deadlines.

Evidence & citation rules:
- Use markdown formatting in summary and reason fields. Preserve relevant previously known evidence links; add new ones from new signals.
- Only include citations grounded in actual Microsoft 365 signals.

IMPORTANT ${EM_DASH} hasNewInfo rules:
- true ONLY if genuinely new signals exist that were created or modified AFTER the last check time above. Pre-existing signals are NOT new ${EM_DASH} they are already in the previous summary.
- false if no new signals or no substantive new information since last check.
- When false: return previous summary and status EXACTLY as provided ${EM_DASH} copy verbatim. Do NOT rephrase or add phrases like "since the last check." Any rewording when false is an error.
- Consistency: if summary mentions "new" signals or "since the last check," hasNewInfo MUST be true. Never pair hasNewInfo: true with status: "No Update".

Status rules:
- "In Progress" ${EM_DASH} active work, normal signal activity.
- "Blocked" ${EM_DASH} stalled on a dependency, missing response, or unresolved issue.
- "Waiting" ${EM_DASH} ball is in someone else's court (response, approval, deliverable).
- "Complete" ${EM_DASH} the item's done criteria have been met (see DONE CRITERIA above), OR clear evidence of resolution (confirmation email, explicit closure). When marking Complete, set completionConfidence to reflect your certainty.
- "No Update" ${EM_DASH} no new signals found. Only use with hasNewInfo: false.

Suggested next steps rules:
- 0-2 specific, completable actions starting with a verb naming WHO and WHAT (e.g. 'Reply to Sarah with the revised Q3 timeline').
- Empty array when hasNewInfo is false. No vague language ("consider", "follow up", "look into") ${EM_DASH} every action must be concrete.`;

  assert.equal(prompt, expected);
  assert.doesNotMatch(prompt, /older summary must not be injected/i);
  assert.doesNotMatch(prompt, /scheduleType|scheduleValue|workHoursOnly|notifyEnabled/);
});