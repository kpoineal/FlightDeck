// ── FlightDeck prompt construction ──────────────────────────────────

const promptCache = {
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
  const savedBriefing = await loadCustomPrompt('briefing');
  const savedDayBriefing = await loadCustomPrompt('dayBriefing');

  // Always read from disk so we have a fallback / can seed editors on first load
  const [briefingResult, dayBriefingResult] = await Promise.all([
    window.workiq.readPromptFile('briefing.md'),
    window.workiq.readPromptFile('day-briefing.md'),
  ]);

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
  if (elements.briefingPromptEditor) {
    elements.briefingPromptEditor.value = promptCache.briefing;
  }
}

function initPromptEditor() {
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

function getScannerExclusionLabels(scannerId) {
  const labels = [];
  const seen = new Set();
  const limit = MAX_TRACKED_EXCLUSIONS;

  for (const item of state.items || []) {
    if (labels.length >= limit) break;
    if (item.scannerId !== scannerId) continue;
    if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
    const title = normalizePromptLabel(item?.title);
    if (!title) continue;
    const dedupeKey = title.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    labels.push(title);
  }

  return labels;
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

function buildCrossScannerDedupBlock(currentScannerId) {
  const others = (state.scanners || [])
    .filter((s) => s.id !== currentScannerId && s.enabled && s.prompt);

  if (!others.length) return '';

  const lines = others.slice(0, 5).map((s) => {
    const topic = extractScannerTopic(s.prompt, s.name);
    return `- "${s.name}" covers: ${topic}`;
  });

  return `\n\nOther active scanners (skip items that clearly belong to another scanner's focus area):\n${lines.join('\n')}`;
}

function buildScannerPrompt(scanner) {
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
  for (const item of state.items || []) {
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
  const crossScannerBlock = buildCrossScannerDedupBlock(scanner.id);

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

${RADAR_SCAN_JSON_SCHEMA}

Due date rules:
- Extract deadlines from signals ('by end of week', 'due Friday', etc.) and set dueAt as ISO-8601. Use today as reference for relative expressions.
- If no temporal signal is present, return null for dueAt. Never fabricate deadlines.

Evidence & citation rules:
- Use markdown formatting in summary and reason fields. Include inline citations for every referenced source.
- Only include citations grounded in actual Microsoft 365 signals.${dedupBlock}${crossScannerBlock}`;
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
${context}${lastSummary ? `\n\nPrevious summary: ${lastSummary}` : ''}${existingLinks ? `\n\nPreviously known evidence:\n${existingLinks}` : ''}${signalFilterInstruction}
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
  "suggestedNextSteps": ["string"]
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
- "Complete" — clear evidence of resolution (confirmation email, explicit closure).
- "No Update" — no new signals found. Only use with hasNewInfo: false.

Suggested next steps rules:
- 0-2 specific, completable actions starting with a verb naming WHO and WHAT (e.g. 'Reply to Sarah with the revised Q3 timeline').
- Empty array when hasNewInfo is false. No vague language ("consider", "follow up", "look into") — every action must be concrete.`;
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
