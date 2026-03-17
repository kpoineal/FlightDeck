// ── FlightDeck prompt construction ──────────────────────────────────

const promptCache = {
  radarScan: '',
  briefing: '',
  dayBriefing: '',
};

// ── Prompt persistence helpers ──────────────────────────────────────

function saveCustomPrompt(name, content) {
  try {
    window.workiq.storeSet(PROMPT_STORAGE_PREFIX + name, content);
  } catch (error) {
    console.warn('[flightdeck] prompt persistence write failed', error.message);
  }
}

async function loadCustomPrompt(name) {
  try {
    return await window.workiq.storeGet(PROMPT_STORAGE_PREFIX + name) ?? null;
  } catch (error) {
    console.warn('[flightdeck] prompt persistence read failed', error.message);
    return null;
  }
}

function clearCustomPrompt(name) {
  try {
    window.workiq.storeDelete(PROMPT_STORAGE_PREFIX + name);
  } catch (error) {
    console.warn('[flightdeck] prompt persistence clear failed', error.message);
  }
}

async function loadPromptFiles() {
  // Check electron-store for user-customised prompts first
  const savedRadar = await loadCustomPrompt('radarScan');
  const savedBriefing = await loadCustomPrompt('briefing');
  const savedDayBriefing = await loadCustomPrompt('dayBriefing');

  // Always read from disk so we have a fallback / can seed editors on first load
  const [radarResult, briefingResult, dayBriefingResult] = await Promise.all([
    window.workiq.readPromptFile('radar-scan.md'),
    window.workiq.readPromptFile('briefing.md'),
    window.workiq.readPromptFile('day-briefing.md'),
  ]);

  // Radar prompt — prefer stored custom version, fall back to disk
  if (savedRadar) {
    promptCache.radarScan = savedRadar;
  } else if (radarResult.success) {
    promptCache.radarScan = radarResult.content.trim();
  } else {
    console.error('Failed to load radar-scan.md:', radarResult.error);
  }

  // Briefing prompt
  if (savedBriefing) {
    promptCache.briefing = savedBriefing;
  } else if (briefingResult.success) {
    promptCache.briefing = briefingResult.content.trim();
  } else {
    console.error('Failed to load briefing.md:', briefingResult.error);
  }

  // Day briefing prompt
  if (savedDayBriefing) {
    promptCache.dayBriefing = savedDayBriefing;
  } else if (dayBriefingResult.success) {
    promptCache.dayBriefing = dayBriefingResult.content.trim();
  } else {
    console.error('Failed to load day-briefing.md:', dayBriefingResult.error);
  }

  // Seed the prompt editors with the active prompts
  if (elements.radarPromptEditor) {
    elements.radarPromptEditor.value = promptCache.radarScan;
  }
  if (elements.briefingPromptEditor) {
    elements.briefingPromptEditor.value = promptCache.briefing;
  }
}

function initPromptEditor() {
  // Radar prompt editor
  elements.promptEditorToggle.addEventListener('click', () => {
    const isExpanded = elements.promptEditorBody.classList.toggle('show');
    elements.promptEditorToggle.classList.toggle('expanded', isExpanded);
  });

  elements.promptEditorApply.addEventListener('click', () => {
    const edited = (elements.radarPromptEditor.value || '').trim();
    if (!edited) return;
    promptCache.radarScan = edited;
    saveCustomPrompt('radarScan', edited);
    showPromptEditorStatus(elements.promptEditorStatus, 'Prompt applied — next scan will use this version');
  });

  elements.promptEditorReset.addEventListener('click', async () => {
    clearCustomPrompt('radarScan');
    const result = await window.workiq.readPromptFile('radar-scan.md');
    if (result.success) {
      promptCache.radarScan = result.content.trim();
      elements.radarPromptEditor.value = promptCache.radarScan;
      showPromptEditorStatus(elements.promptEditorStatus, 'Reset to default');
    } else {
      showPromptEditorStatus(elements.promptEditorStatus, 'Failed to reload file');
    }
  });

  // Briefing prompt editor
  elements.briefingPromptEditorToggle.addEventListener('click', () => {
    const isExpanded = elements.briefingPromptEditorBody.classList.toggle('show');
    elements.briefingPromptEditorToggle.classList.toggle('expanded', isExpanded);
  });

  elements.briefingPromptEditorApply.addEventListener('click', () => {
    const edited = (elements.briefingPromptEditor.value || '').trim();
    if (!edited) return;
    promptCache.briefing = edited;
    saveCustomPrompt('briefing', edited);
    showPromptEditorStatus(elements.briefingPromptEditorStatus, 'Prompt applied — next briefing will use this version');
  });

  elements.briefingPromptEditorReset.addEventListener('click', async () => {
    clearCustomPrompt('briefing');
    const result = await window.workiq.readPromptFile('briefing.md');
    if (result.success) {
      promptCache.briefing = result.content.trim();
      elements.briefingPromptEditor.value = promptCache.briefing;
      showPromptEditorStatus(elements.briefingPromptEditorStatus, 'Reset to default');
    } else {
      showPromptEditorStatus(elements.briefingPromptEditorStatus, 'Failed to reload file');
    }
  });
}

function showPromptEditorStatus(statusElement, message) {
  statusElement.textContent = message;
  setTimeout(() => {
    statusElement.textContent = '';
  }, 4000);
}

const TODAY_MEETINGS_PROMPT = `List my upcoming meetings for today from Microsoft 365 context.

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

function normalizePromptLabel(value) {
  return cleanDisplayText(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTrackedExclusionLabels() {
  const labels = [];
  const seen = new Set();

  for (const item of state.trackingItems || []) {
    if (labels.length >= MAX_TRACKED_EXCLUSIONS) {
      break;
    }

    const title = normalizePromptLabel(item?.title);
    if (!title) continue;

    const summary = normalizePromptLabel(item?.summary || item?.reason || '');
    const label = summary ? `${title} — ${summary.slice(0, 120)}` : title;
    const dedupeKey = label.toLowerCase();

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    labels.push(label);
  }

  return labels;
}

function buildRadarScanPrompt() {
  const basePrompt = `${promptCache.radarScan}${RADAR_SCAN_JSON_SCHEMA}`;

  const exclusions = getTrackedExclusionLabels();
  if (!exclusions.length) {
    return basePrompt;
  }

  const exclusionLines = exclusions.map((label) => `- ${label}`).join('\n');
  return `${basePrompt}

De-duplication guidance:
- Exclude items that are substantially the same as currently tracked items.
- Prefer truly net-new work signals.

Exclude items like:
${exclusionLines}`;
}

function buildMeetingBriefingPrompt(meeting) {
  const startAt = meeting?.startAt ? safeDate(meeting.startAt, meeting.startAt) : 'Unknown time';
  const joinUrl = meeting?.joinUrl || 'No link';

  const meetingDetails = `

Meeting details:
- Title: ${meeting?.title || 'Untitled meeting'}
- Start: ${startAt}
- Organizer: ${meeting?.organizer || 'Unknown organizer'}
- Join URL: ${joinUrl}`;

  return `${promptCache.briefing}${meetingDetails}${BRIEFING_MEETING_JSON_SCHEMA}`;
}

function buildTaskMonitorPrompt(item) {
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

  const activeSignals = Array.isArray(item?.monitorSignals) && item.monitorSignals.length
    ? item.monitorSignals
    : ALL_SIGNAL_TYPES;
  const isFiltered = activeSignals.length < ALL_SIGNAL_TYPES.length;
  const signalFilterInstruction = isFiltered
    ? `\n\nSignal source filter (IMPORTANT):\n- ONLY search for and consider these signal types: ${activeSignals.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}.\n- IGNORE all other signal types entirely. Do not include evidence from excluded signal types.\n- The signal type labels map as follows: Email = Outlook emails, Chat = Teams chat messages, Meeting = Calendar events and meeting transcripts/notes, Doc = SharePoint/OneDrive documents.`
    : '';

  // Build previous summaries context from update history to prevent oscillation
  const previousSummaries = buildPreviousSummariesContext(item);

  return `You are a work-tracking monitor agent. Your job is to review the latest Microsoft 365 signals (emails, Teams chats, meetings, documents) and provide an updated status report for the task described below.

Task to monitor:
- Title: ${title}
- Current severity: ${severity}
- Last known status: ${lastStatus}
- ${dueInfo}
- Owner: ${owner}
- Key people involved: ${people}
- ${lastCheckInfo}
- Monitoring instructions: ${context}${lastSummary ? `\n- Previous summary: ${lastSummary}` : ''}${existingLinks ? `\n- Previously known evidence links:\n${existingLinks}` : ''}${signalFilterInstruction}
${previousSummaries}
Monitoring instructions:
1. Search for the most recent signals (emails, chats, meetings, documents) related to this task.
2. Identify any new developments, blockers, decisions, ownership changes, or timeline shifts since the last check.
3. ONLY consider signals that were sent, received, or modified AFTER the last check time shown above. Signals from before that time are already accounted for in the previous summary and must NOT be treated as new information.
4. Assess whether severity should change (Critical = blocking or overdue, Elevated = needs attention soon, Observe = on track).
5. Update the summary to reflect the current state, not just repeat old information.
6. List all people currently involved based on recent signals.
7. If no new signals are found since the last check time, indicate that no updates were detected but preserve the last known state.
8. You MUST include inline markdown citations in the summary and reason fields using [label](url) syntax for every source signal you reference. This is how the application extracts evidence links — without inline citations, no links will appear.

Return strict valid JSON only:
{
  "hasNewInfo": true | false,
  "status": "string (e.g. In Progress, Blocked, Waiting on Response, Resolved, No Update)",
  "summary": "string (2-4 sentence current-state summary incorporating latest signals)",
  "reason": "string (why this severity level is appropriate right now)",
  "severity": "Critical|Elevated|Observe",
  "dueAt": "ISO-8601 timestamp or null",
  "owner": "string",
  "counterparties": ["string"],
  "evidenceLinks": [
    {
      "label": "descriptive label for the source signal",
      "type": "email|chat|meeting|doc",
      "signalAt": "ISO-8601 timestamp when the signal was sent/written/updated, or null"
    }
  ],
  "suggestedNextSteps": ["string"]
}

Due date rules:
- If the source signals mention deadlines, due dates, or temporal expectations ('by end of week', 'due Friday', 'need this by March 1'), update dueAt with the concrete ISO-8601 date.
- Use today's date as a reference for relative time expressions.
- If a previously null dueAt should now have a value based on new signals, set it.
- If no deadline signal is found and dueAt was already set, preserve the existing value.
- Never fabricate deadlines — only set dueAt when grounded in actual signals.

Evidence link and citation rules:
- You MUST use inline markdown citations in summary and reason using [label](url) syntax for every referenced source. For example: 'Alex sent a [status update](https://outlook.office.com/...) confirming the timeline.'
- The summary and reason fields are the primary way evidence links are extracted. If you do not include [label](url) citations inline, the user will see no source links.
- Include your normal response markdown formatting for the summary and reason fields.
- Review previously known evidence links listed above. Preserve any that remain relevant. Add new ones from new signals.
- Only include URLs that are real and grounded in actual Microsoft 365 signals. If a signal has no URL, still describe it but omit the link for that specific signal.

IMPORTANT — hasNewInfo rules:
- Set hasNewInfo to true ONLY if you found genuinely new signals (new emails, chats, meetings, or documents) that were created or modified AFTER the last check time shown above.
- Signals that existed before the last check time are NOT new, even if they are relevant to this task. They are already reflected in the previous summary.
- Set hasNewInfo to false if you found no new signals since the last check, or the signals contain no substantive new information.
- When hasNewInfo is false, you MUST return the previous summary and status EXACTLY as provided above — copy them verbatim. Do NOT rephrase, reword, or add language like "since the last check" or "a new email." Any rewording when hasNewInfo is false is an error.
- Consistency check: if your summary mentions "new" signals, "since the last check," or "a new email/chat/meeting," then hasNewInfo MUST be true. Never describe new activity while setting hasNewInfo to false.
- "No Update" as a status means nothing new was found. Never pair hasNewInfo: true with status: "No Update".

Suggested next steps rules:
- Suggest 0-2 specific, concrete next actions the user should take based on the latest signals.
- Each should be a short phrase naming who and what (e.g. 'Reply to Sarah with the revised Q3 timeline', 'Escalate to VP Engineering before Friday deadline').
- Only suggest actions when genuinely useful and new. When hasNewInfo is false, return an empty array.
- Never suggest vague actions like 'follow up' without naming who or what specifically.`;
}

function buildDayBriefingPrompt() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const meetings = (state.meetings || []).map((m) => {
    const startAt = m.startAt ? safeDate(m.startAt, m.startAt) : 'Unknown time';
    return `- ${m.title || 'Untitled'} at ${startAt} (organizer: ${m.organizer || 'Unknown'})`;
  });
  const meetingsBlock = meetings.length
    ? `Today's meetings:\n${meetings.join('\n')}`
    : 'No meetings scheduled today — light day.';

  const tracked = (state.trackingItems || []).map((item) => {
    const dueInfo = item.dueAt ? `due ${item.dueAt}` : 'no due date';
    return `- ${item.title || 'Untitled'} [${item.severity || 'Observe'}] (${item.status || 'Unknown'}, ${dueInfo})`;
  });
  const trackedBlock = tracked.length
    ? `Active tracked items:\n${tracked.join('\n')}`
    : 'No active tracked items.';

  const kpis = state.kpis || {};
  const kpiBlock = (kpis.critical != null || kpis.elevated != null || kpis.observe != null)
    ? `Current radar KPIs: Critical=${kpis.critical ?? 0}, Elevated=${kpis.elevated ?? 0}, Observe=${kpis.observe ?? 0}`
    : 'No radar KPIs available yet.';

  return `${promptCache.dayBriefing}

Today's date: ${today}

${meetingsBlock}

${trackedBlock}

${kpiBlock}${DAY_BRIEFING_JSON_SCHEMA}`;
}

function buildActionDraftPrompt(selected, action, tone, evidenceItems) {
  const evidenceText = evidenceItems.length
    ? evidenceItems
      .map((item, index) => `- Evidence ${index + 1}: ${item.sourceLabel || 'source'} | ${item.snippet || ''}`)
      .join('\n')
    : '- No explicit evidence snippets available.';

  return `Create a professional, copy-paste-ready outreach draft for this recommended action using grounded Microsoft 365 context.

Return strict valid JSON only and nothing else.

Output constraints:
- Do not include links, URLs, markdown, footnotes, citations, or bracketed references.
- Keep the writing concise, executive, and send-ready.
- Use complete sentences and clean formatting.
- Avoid placeholders like [Name], [Date], etc.
- Keep body to 90-160 words.

Context:
- Radar item title: ${selected.title}
- Severity: ${selected.severity}
- Summary: ${selected.summary || selected.reason || 'N/A'}
- Action label: ${action.label}
- Action type: ${action.actionType}
- Risk level: ${action.risk?.level || 'low'}
- Counterparties: ${(selected.counterparties || []).join(', ') || 'N/A'}

Evidence:
${evidenceText}

Return JSON schema:
{
  "subject": "string",
  "body": "string",
  "nextStepAsk": "string",
  "suggestedRecipients": ["string"]
}`;
}

function buildSuggestionDraftPrompt(item, suggestionText, tone, evidenceItems) {
  const evidenceText = evidenceItems.length
    ? evidenceItems
      .map((e, index) => `- Evidence ${index + 1}: ${e.sourceLabel || 'source'} | ${e.snippet || ''}`)
      .join('\n')
    : '- No explicit evidence snippets available.';

  return `Create a professional, copy-paste-ready outreach draft based on the suggested next step below. Use grounded Microsoft 365 context.

Return strict valid JSON only and nothing else.

Output constraints:
- Do not include links, URLs, markdown, footnotes, citations, or bracketed references.
- Keep the writing concise, executive, and send-ready.
- Use complete sentences and clean formatting.
- Avoid placeholders like [Name], [Date], etc.
- Keep body to 90-160 words.
- Tone: ${tone}

Suggested next step: ${suggestionText}

Context:
- Tracked item title: ${item.title}
- Severity: ${item.severity}
- Summary: ${item.summary || item.reason || 'N/A'}
- Owner: ${item.owner || 'Unknown'}
- Counterparties: ${(item.counterparties || []).join(', ') || 'N/A'}
- Status: ${item.status || 'Unknown'}
- Due: ${item.dueAt || 'No due date'}

Evidence:
${evidenceText}

Return JSON schema:
{
  "subject": "string",
  "body": "string",
  "nextStepAsk": "string",
  "suggestedRecipients": ["string"]
}`;
}
