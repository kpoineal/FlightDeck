// ── FlightDeck prompt construction (ES module) ─────────────────────
import { cleanDisplayText, safeDate } from './utils.js';
import {
  ALL_SIGNAL_TYPES,
  RADAR_SCAN_JSON_SCHEMA,
  BRIEFING_MEETING_JSON_SCHEMA,
  DAY_BRIEFING_JSON_SCHEMA,
} from './constants.js';

// ── Helpers ─────────────────────────────────────────────────────────

function normalizePromptLabel(value) {
  return cleanDisplayText(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractScannerTopic(prompt, fallbackName) {
  const text = (prompt || '').replace(/\{lastRunAt\}/g, '').trim();

  const focusMatch = text.match(/focus\s+(?:specifically\s+)?on[:：]\s*(.+)/i);
  if (focusMatch) {
    const focus = focusMatch[1].trim();
    return focus.length > 80 ? focus.slice(0, 77) + '...' : focus;
  }

  const firstLine = text
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 15 && !/^#|^-|^Return|^Rules|^Look for items/i.test(l));

  if (firstLine) {
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
  }

  return fallbackName;
}

function buildCrossScannerDedupBlock(currentScannerId, allScanners) {
  const others = (allScanners || [])
    .filter((s) => s.id !== currentScannerId && s.enabled && s.prompt);

  if (!others.length) return '';

  const lines = others.slice(0, 5).map((s) => {
    const topic = extractScannerTopic(s.prompt, s.name);
    return `- "${s.name}" covers: ${topic}`;
  });

  return `\n\nOther active scanners (skip items that clearly belong to another scanner's focus area):\n${lines.join('\n')}`;
}

/**
 * Build previous-summaries context to prevent LLM oscillation.
 */
function buildPreviousSummariesContext(item) {
  const history = Array.isArray(item?.updateHistory) ? item.updateHistory : [];
  if (!history.length) return '';

  const recent = history.slice(0, 2);
  const lines = recent.map((entry, i) => {
    const timestamp = safeDate(entry.timestamp, 'Unknown time');
    const summary = cleanDisplayText(entry.summary || '').trim();
    return `  ${i + 1}. [${timestamp}] ${summary}`;
  });

  return `\nPrevious update summaries (for de-duplication — do NOT re-report the same information described here as "new"):\n${lines.join('\n')}\nIf the signals you find are already covered by these previous summaries, set hasNewInfo to false and return the current summary verbatim.\n`;
}

// ── Scanner prompt ──────────────────────────────────────────────────

export const TODAY_MEETINGS_PROMPT = `List my upcoming meetings for today from Microsoft 365 context.

Constraints:
- Include only meetings starting later today in my local timezone.
- Keep response focused and concise.
- Return strict valid JSON only.

Schema:
{
  "generatedAt": "ISO-8601 timestamp",
  "meetings": [
    {
      "id": "string",
      "title": "string",
      "startAt": "ISO-8601 timestamp",
      "endAt": "ISO-8601 timestamp or null",
      "organizer": "string",
      "joinUrl": "https URL or null"
    }
  ]
}`;

/**
 * Build the full scanner prompt with analysis procedure, signal filtering,
 * dedup list, cross-scanner awareness, JSON schema, and all rule blocks.
 *
 * @param {object} scanner - Scanner config
 * @param {Array} currentItems - All current radar items
 * @param {Array} allScanners - All scanners for cross-scanner dedup
 */
export function buildScannerPrompt(scanner, currentItems, allScanners) {
  const userPrompt = scanner.prompt || '';
  const lastRunAt = scanner.lastRunAt || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const maxItems = scanner.maxItemsPerScan || 10;

  // Signal type filtering
  const signalTypes = Array.isArray(scanner.signalTypes) && scanner.signalTypes.length
    ? scanner.signalTypes
    : ALL_SIGNAL_TYPES;
  const isFiltered = signalTypes.length < ALL_SIGNAL_TYPES.length;
  const signalFilterBlock = isFiltered
    ? `\n\nSignal source filter (IMPORTANT):\n- ONLY search for and consider these signal types: ${signalTypes.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}.\n- IGNORE all other signal types entirely. Do not include evidence from excluded signal types.\n- The signal type labels map as follows: Email = Outlook emails, Chat = Teams chat messages, Meeting = Calendar events and meeting transcripts/notes, Doc = SharePoint/OneDrive documents.`
    : '';

  // Consolidated dedup list — one block, no duplicates
  const existingTitles = new Set();
  const dedupLines = [];
  for (const item of currentItems || []) {
    if (item.scannerId !== scanner.id) continue;
    if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
    const title = cleanDisplayText(item.title || '');
    if (!title || existingTitles.has(title.toLowerCase())) continue;
    existingTitles.add(title.toLowerCase());
    dedupLines.push(`- ${title}`);
    if (dedupLines.length >= 20) break;
  }
  const dedupBlock = dedupLines.length
    ? `\n\nItems already on my radar from this scanner (do NOT re-report these):\n${dedupLines.join('\n')}`
    : '';

  // Cross-scanner domain awareness
  const crossScannerBlock = buildCrossScannerDedupBlock(scanner.id, allScanners);

  // Assemble the full prompt with clear structure
  return `You are a work-signal scanner agent. Analyze recent Microsoft 365 signals and surface new items that need attention.

--- SCANNER MISSION ---
${userPrompt.replace(/\{lastRunAt\}/g, lastRunAt)}

Time window: Last scan was at ${lastRunAt}. Only return items with signals created or updated AFTER this time. Do not report older items.${signalFilterBlock}

Analysis procedure:
1. Search for recent Microsoft 365 signals (emails, chats, meetings, documents) matching the scanner mission above.
2. Identify actionable work items, commitments made to or by the user, and time-sensitive matters.
3. Classify each item as Critical, Elevated, or Observe based on urgency and impact.
4. Include inline citations in summary and reason fields for every signal referenced.
5. Return at most ${maxItems} items. Prefer quality over quantity.
6. For each item, define what "done" looks like — a concrete, observable condition that would indicate this item is resolved. If the completion condition is unclear from available signals, return null for doneCriteria.

${RADAR_SCAN_JSON_SCHEMA}

Due date rules:
- Extract deadlines from signals ('by end of week', 'due Friday', etc.) and set dueAt as ISO-8601. Use today as reference for relative expressions.
- If no temporal signal is present, return null for dueAt. Never fabricate deadlines.

Evidence & citation rules:
- Use markdown formatting in summary and reason fields. Include inline citations for every referenced source.
- Only include citations grounded in actual Microsoft 365 signals.${dedupBlock}${crossScannerBlock}`;
}

// ── Monitor prompt ──────────────────────────────────────────────────

/**
 * Build the full task-monitor prompt with done criteria evaluation,
 * signal type mapping, hasNewInfo rules, status definitions, and all rule blocks.
 *
 * @param {object} item - The tracked item to monitor
 */
export function buildMonitorPrompt(item) {
  const title = item?.title || 'Tracked task';
  const context = item?.monitorPrompt || item?.summary || item?.reason || 'No extra context provided';
  const owner = item?.owner || 'Unknown';
  const people = Array.isArray(item?.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'None listed';
  const dueInfo = item?.dueAt ? `Due: ${item.dueAt}` : 'No due date set';
  const severity = item?.severity || 'Observe';
  const lastStatus = item?.status || 'Unknown';
  const lastSummary = item?.summary || '';
  const lastCheckTime = item?.lastRunAt || item?.trackedAt || null;
  const lastCheckInfo = lastCheckTime
    ? `Last checked: ${lastCheckTime}`
    : 'This is the first monitoring check';
  const existingLinks = Array.isArray(item?.evidenceLinks) && item.evidenceLinks.length
    ? item.evidenceLinks.map((e) => `  - [${e.type}] ${e.label}: ${e.url}${e.signalAt ? ` (signalAt: ${e.signalAt})` : ''}`).join('\n')
    : null;

  const doneCriteriaBlock = item?.doneCriteria
    ? `\n\n--- DONE CRITERIA ---\n${item.doneCriteria}\nEvaluate whether signals indicate this done criteria has been met. If met, set status to "Complete".`
    : '';

  const activeSignals = Array.isArray(item?.monitorSignals) && item.monitorSignals.length
    ? item.monitorSignals
    : ALL_SIGNAL_TYPES;
  const isFiltered = activeSignals.length < ALL_SIGNAL_TYPES.length;
  const signalFilterInstruction = isFiltered
    ? `\n\nSignal source filter (IMPORTANT):\n- ONLY search for and consider these signal types: ${activeSignals.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}.\n- IGNORE all other signal types entirely. Do not include evidence from excluded signal types.\n- The signal type labels map as follows: Email = Outlook emails, Chat = Teams chat messages, Meeting = Calendar events and meeting transcripts/notes, Doc = SharePoint/OneDrive documents.`
    : '';

  // Build previous summaries context from update history to prevent oscillation
  const previousSummaries = buildPreviousSummariesContext(item);

  return `You are a work-tracking monitor agent. Review the latest Microsoft 365 signals and provide an updated status report for the task below.

Task to monitor:
- Title: ${title}
- Severity: ${severity}
- Status: ${lastStatus}
- ${dueInfo}
- Owner: ${owner}
- People: ${people}
- ${lastCheckInfo}

--- MONITORING CONTEXT ---
${context}${lastSummary ? `\n\nPrevious summary: ${lastSummary}` : ''}${existingLinks ? `\n\nPreviously known evidence:\n${existingLinks}` : ''}${doneCriteriaBlock}${signalFilterInstruction}
${previousSummaries}
Analysis procedure:
1. Search for recent signals (emails, chats, meetings, documents) related to this task.
2. Identify new developments, blockers, decisions, ownership changes, or timeline shifts since the last check.
3. Assess whether severity should change and update the summary to reflect current state.
4. List all people currently involved based on recent signals.
5. Include inline markdown [label](url) citations in summary and reason fields for every signal referenced — this is how evidence links are extracted.

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
      "type": "string (e.g. email, chat, meeting, doc, devops, planner, etc. — use your best judgment to describe the signal source)",
      "signalAt": "ISO-8601 timestamp when the signal was sent/written/updated, or null"
    }
  ],
  "suggestedNextSteps": ["string"],
  "doneCriteria": "string — observable completion condition for this item, or null if unchanged/unknown",
  "completionConfidence": "high|medium|low|null — confidence that this item is complete (high = explicit closure signal, medium = likely resolved, low = possibly done)"
}

Due date rules:
- Extract deadlines from signals ('by end of week', 'due Friday', etc.) and set dueAt as ISO-8601. Use today as reference for relative expressions.
- Preserve existing dueAt if no new deadline found. Never fabricate deadlines.

Evidence & citation rules:
- Use markdown formatting in summary and reason fields. Preserve relevant previously known evidence links; add new ones from new signals.
- Only include citations grounded in actual Microsoft 365 signals.

IMPORTANT — hasNewInfo rules:
- true ONLY if genuinely new signals exist that were created or modified AFTER the last check time above. Pre-existing signals are NOT new — they are already in the previous summary.
- false if no new signals or no substantive new information since last check.
- When false: return previous summary and status EXACTLY as provided — copy verbatim. Do NOT rephrase or add phrases like "since the last check." Any rewording when false is an error.
- Consistency: if summary mentions "new" signals or "since the last check," hasNewInfo MUST be true. Never pair hasNewInfo: true with status: "No Update".

Status rules:
- "In Progress" — active work, normal signal activity.
- "Blocked" — stalled on a dependency, missing response, or unresolved issue.
- "Waiting" — ball is in someone else's court (response, approval, deliverable).
- "Complete" — the item's done criteria have been met (see DONE CRITERIA above), OR clear evidence of resolution (confirmation email, explicit closure). When marking Complete, set completionConfidence to reflect your certainty.
- "No Update" — no new signals found. Only use with hasNewInfo: false.

Suggested next steps rules:
- 0-2 specific, completable actions starting with a verb naming WHO and WHAT (e.g. 'Reply to Sarah with the revised Q3 timeline').
- Empty array when hasNewInfo is false. No vague language ("consider", "follow up", "look into") — every action must be concrete.`;
}

// ── Briefing prompts ────────────────────────────────────────────────

/**
 * Build a meeting-briefing prompt.
 *
 * @param {object} meeting - Meeting object
 * @param {string} briefingTemplate - The loaded briefing.md template text
 */
export function buildMeetingBriefingPrompt(meeting, briefingTemplate) {
  const template = briefingTemplate || 'You are preparing me for an upcoming meeting using grounded Microsoft 365 context.';
  const startAt = meeting?.startAt ? safeDate(meeting.startAt, meeting.startAt) : 'Unknown time';
  const joinUrl = meeting?.joinUrl || 'No link';

  const meetingDetails = `

Meeting details:
- Title: ${meeting?.title || 'Untitled meeting'}
- Start: ${startAt}
- Organizer: ${meeting?.organizer || 'Unknown organizer'}
- Join URL: ${joinUrl}`;

  return `${template}${meetingDetails}${BRIEFING_MEETING_JSON_SCHEMA}`;
}

/**
 * Build a day-briefing prompt.
 *
 * @param {Array} currentItems - Active tracked items
 * @param {Array} currentMeetings - Today's meetings
 * @param {object} currentKpis - Current KPI counts
 * @param {string} dayBriefingTemplate - The loaded day-briefing.md template text
 */
export function buildDayBriefingPrompt(currentItems, currentMeetings, currentKpis, dayBriefingTemplate) {
  const template = dayBriefingTemplate || 'You are preparing a "My Day" morning briefing that synthesizes my full workday from grounded Microsoft 365 context.';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const meetings = (currentMeetings || []).map((m) => {
    const startAt = m.startAt ? safeDate(m.startAt, m.startAt) : 'Unknown time';
    return `- ${m.title || 'Untitled'} at ${startAt} (organizer: ${m.organizer || 'Unknown'})`;
  });
  const meetingsBlock = meetings.length
    ? `Today's meetings:\n${meetings.join('\n')}`
    : 'No meetings scheduled today — light day.';

  const tracked = (currentItems || [])
    .filter((i) => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived')
    .map((item) => {
      const dueInfo = item.dueAt ? `due ${item.dueAt}` : 'no due date';
      return `- ${item.title || 'Untitled'} [${item.severity || 'Observe'}] (${item.status || 'Unknown'}, ${dueInfo})`;
    });
  const trackedBlock = tracked.length
    ? `Active tracked items:\n${tracked.join('\n')}`
    : 'No active tracked items.';

  const kpis = currentKpis || {};
  const kpiBlock = (kpis.critical != null || kpis.elevated != null || kpis.observe != null)
    ? `Current radar KPIs: Critical=${kpis.critical ?? 0}, Elevated=${kpis.elevated ?? 0}, Observe=${kpis.observe ?? 0}`
    : 'No radar KPIs available yet.';

  return `${template}

Today's date: ${today}

${meetingsBlock}

${trackedBlock}

${kpiBlock}${DAY_BRIEFING_JSON_SCHEMA}`;
}
