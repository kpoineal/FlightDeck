# FlightDeck Prompt & Scanning System

> Technical deep-dive into how FlightDeck discovers, monitors, and surfaces work signals using AI prompts against Microsoft 365 data.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The Scanning Pipeline](#the-scanning-pipeline)
3. [Scan Types](#scan-types)
4. [Prompt Template System](#prompt-template-system)
5. [Dynamic Prompt Assembly](#dynamic-prompt-assembly)
6. [Deduplication](#deduplication)
7. [JSON Schema Output Shaping](#json-schema-output-shaping)
8. [Variable Injection](#variable-injection)
9. [AI Execution Path](#ai-execution-path)
10. [JSON Parsing & Repair](#json-parsing--repair)
11. [File Reference](#file-reference)

---

## Architecture Overview

FlightDeck is a personal work radar that continuously scans Microsoft 365 signals (email, Teams chat, meetings, documents) and surfaces actionable items. The prompt system is the brain — it constructs precise instructions that tell the AI what to look for, how to classify it, and what format to return.

The architecture has four layers:

```
┌─────────────────────────────────────────────────┐
│  Markdown Templates (src/prompts/*.md)          │  ← User-editable base instructions
├─────────────────────────────────────────────────┤
│  Prompt Builders (src/svelte/lib/prompts.js)    │  ← Dynamic assembly with context injection
├─────────────────────────────────────────────────┤
│  JSON Parser (src/svelte/lib/json-parser.js)    │  ← Response extraction & repair
├─────────────────────────────────────────────────┤
│  WorkIQ PTY Bridge (src/main/pty-bridge.js)     │  ← Electron ↔ AI execution via node-pty
└─────────────────────────────────────────────────┘
```

**Data flow for every scan:**

1. A background engine (scanner or monitor) determines a scan is due
2. A builder function assembles the full prompt from template + dynamic context + schema + dedup rules
3. The prompt is sent to WorkIQ via IPC → PTY bridge → `workiq ask -q "{prompt}"`
4. The raw AI response is parsed through a multi-strategy JSON extraction and repair pipeline
5. Validated results are normalized, deduped, and merged into the item store

---

## The Scanning Pipeline

### Scanner Engine (`src/svelte/lib/scanner-engine.js`)

The scanner engine runs on a **60-second tick** (`TICK_MS = 60_000`). On each tick:

1. **Guard check** — skip if not connected to WorkIQ or if a scan cycle is already in progress
2. **Find due scanners** — filter all scanners where `enabled === true` and `nextRunAt <= now`
3. **Execute sequentially** — each due scanner runs in order (serial, not parallel) to avoid overwhelming WorkIQ
4. **Error handling** — on failure, the scanner's `lastRunAt` and `nextRunAt` are updated so it retries on the next schedule, and the error is logged to history

```javascript
// src/svelte/lib/scanner-engine.js — core loop
async function checkDue() {
  if (!get(connected) || cycleInProgress) return;
  const due = get(scanners).filter(s => s.enabled && s.nextRunAt && new Date(s.nextRunAt).getTime() <= nowMs);
  for (const scanner of due) {
    await runScanner(scanner);
  }
}
```

### Scanner Execution (`runScanner()`)

Each scanner run follows this pipeline:

1. **Build prompt** — `buildScannerPrompt(scanner, currentItems, allScanners)` assembles the full prompt
2. **Call AI** — `runWorkiqJson(prompt, validator, 'scanner')` sends to WorkIQ and parses response
3. **Normalize items** — each returned `radarItem` is passed through `normalizeItem()` which sanitizes text, extracts inline citations, and sets defaults
4. **Cap results** — enforce `maxItemsPerScan` limit (default 10, max 25)
5. **Keyword filter** — exclude items matching any `excludeKeywords` strings
6. **Dedup** — remove items matching existing IDs, titles, or recent titles
7. **Auto-monitor** — if `autoMonitorNewItems` is enabled, automatically enable monitoring on new items that meet the severity threshold
8. **Merge** — prepend new items to the items store
9. **Notify** — show in-app toast and/or desktop notification based on `notificationMode`
10. **Update scanner metadata** — set `lastRunAt`, compute `nextRunAt`, update `itemCount`

### Monitor Engine (`src/svelte/lib/monitor-engine.js`)

The monitor engine runs on a **30-second tick** (`TICK_MS = 30_000`) and checks individual tracked items rather than running scanners. On each tick:

1. **Find due items** — items where `monitorEnabled === true`, `nextRunAt <= now`, and lifecycle is not `complete` or `archived`
2. **Execute checks** — for each due item, build and send a monitor prompt
3. **Process results** — if `hasNewInfo` is true, update the item's summary, status, severity, owner, and evidence links. If false, preserve the item unchanged.
4. **Auto-lifecycle** — automatically transition lifecycle status based on the AI's status response (e.g., "Complete" → `lifecycleStatus: 'complete'`, monitoring disabled)
5. **History tracking** — record status/severity changes in `updateHistory` for audit trail

### Missed Run Policies

Scanners support three policies for handling runs that were missed while the app was closed (`missedRunPolicy` on each scanner, defined in `src/svelte/lib/constants.js`):

| Policy | Behavior |
|--------|----------|
| `skip` | Reschedule to the next regular interval |
| `run-once` | Fire immediately on reopen, then resume schedule |
| `catch-up` | Fire up to 3 missed runs sequentially |

Handled by `rescheduleOverdueScanners()` at engine startup.

### Manual Triggers

Users can trigger scans manually:

- **"Run Now" button** on a scanner section header → calls `runScanner(scanner)` directly (`src/svelte/components/RadarView.svelte`)
- **"Check Now" on a tracked item** → calls `runItemCheck(item)` directly (`src/svelte/components/RadarView.svelte`)
- **Day briefing "Generate"** → calls `handleDayGenerate()` in `BriefingsView.svelte`
- **Meeting briefing "Generate"** → calls individual meeting briefing generation in `BriefingsView.svelte`

---

## Scan Types

FlightDeck has five distinct scan/prompt types, all flowing through the same prompt builder infrastructure:

### 1. Custom Scanners (Radar Scans)

**Purpose:** Continuously scan Microsoft 365 for work signals matching a user-defined focus area.

**Template:** `src/prompts/scanner-template.md` (default for new scanners) or `src/prompts/radar-scan.md` (seeded on first run)

**Builder:** `buildScannerPrompt()` in `src/svelte/lib/prompts.js`

**Schedule:** Configurable — interval (15m to 4h), weekly (specific days/times), or one-time

**Output:** Array of `radarItems` with severity, evidence, suggested next steps, done criteria

Every scanner is a first-class object with its own prompt, schedule, signal filters, and dedup settings. The original "Radar" scanner is just the first scanner, seeded from `radar-scan.md` on initial launch (`src/svelte/lib/persistence.js`).

### 2. Task Monitoring

**Purpose:** Track a specific known item for new developments, status changes, and completion.

**Builder:** `buildMonitorPrompt()` in `src/svelte/lib/prompts.js`

**Schedule:** Per-item, configurable like scanners

**Output:** Single JSON object with `hasNewInfo`, updated status/summary/severity, evidence links

**Auto-prompt generation:** When an item is first tracked, `buildDefaultMonitorPrompt()` in `src/svelte/lib/models/item.js` generates a monitoring prompt from the item's title, summary, reason, owner, counterparties, and done criteria.

### 3. Meeting Briefings

**Purpose:** Prepare the user for an upcoming meeting using grounded M365 context.

**Template:** `src/prompts/briefing.md`

**Builder:** `buildMeetingBriefingPrompt()` in `src/svelte/lib/prompts.js`

**Triggered:** On-demand when user clicks "Generate" on a meeting card

**Output:** Headline, key updates, decisions needed, risks, talk track, follow-ups, sources

### 4. Day Briefings

**Purpose:** Synthesize the user's entire workday into a morning summary.

**Template:** `src/prompts/day-briefing.md`

**Builder:** `buildDayBriefingPrompt()` in `src/svelte/lib/prompts.js`

**Triggered:** On-demand from the Briefings view

**Output:** Headline, top priorities, meetings requiring prep, at-risk items, suggested time blocks, follow-ups

### 5. Meeting List Fetch

**Purpose:** Retrieve today's upcoming meetings from M365.

**Prompt:** `TODAY_MEETINGS_PROMPT` constant in `src/svelte/lib/prompts.js`

**Output:** Array of meeting objects with id, title, times, organizer, join URL, summary

This is the simplest prompt — a static string with no dynamic injection.

---

## Prompt Template System

### Markdown Templates

Four markdown files live in `src/prompts/`:

| File | Used By | Variables | Purpose |
|------|---------|-----------|---------|
| `radar-scan.md` | Seeded as the first scanner's prompt on initial launch | `{lastRunAt}` | General-purpose M365 signal scanning with commitments ledger |
| `scanner-template.md` | Default prompt text for newly created scanners | `{lastRunAt}` | Skeleton with "Focus specifically on:" placeholder |
| `briefing.md` | `buildMeetingBriefingPrompt()` | None (context injected by builder) | Meeting preparation instructions with formatting constraints |
| `day-briefing.md` | `buildDayBriefingPrompt()` | None (context injected by builder) | Morning briefing instructions with formatting constraints |

### Template Loading

Templates are loaded from disk via Electron IPC:

1. **Renderer** calls `window.workiq.readPromptFile('briefing.md')`
2. **Preload** (`src/preload.js`) bridges to `ipcRenderer.invoke('read-prompt-file', filename)`
3. **Main process** (`src/main/ipc-handlers.js`) reads the file from `src/prompts/` with path sanitization:
   ```javascript
   const sanitized = path.basename(String(filename || ''));
   const promptPath = path.join(APP_ROOT, 'prompts', sanitized);
   const content = fs.readFileSync(promptPath, 'utf-8');
   ```
   The `path.basename()` call prevents directory traversal.

4. **Scanner prompts** are different — they're stored as the `.prompt` property on each scanner object in persistent state, not loaded from disk at runtime. The disk template is only read once (at scanner creation time or first-run seeding).

### Template Design Principles

All templates follow these patterns:
- **Formatting constraints** — explicit rules about JSON validity, UTF-8 text, no URL embedding in text fields, sources in a separate array
- **Anti-hallucination guardrails** — "If no context beyond the title is available, state that plainly"
- **Recency constraints** — "Only reference signals from the past 48 hours" or "since {lastRunAt}"
- **Citation grounding** — "Include inline citations for every referenced source"

---

## Dynamic Prompt Assembly

The builder functions in `src/svelte/lib/prompts.js` are where the real complexity lives. They take templates and enrich them with runtime context.

### `buildScannerPrompt(scanner, currentItems, allScanners)`

This is the most feature-rich builder. It assembles a prompt from seven distinct blocks:

```
┌────────────────────────────────────┐
│ 1. System identity preamble        │  "You are a work-signal scanner agent..."
├────────────────────────────────────┤
│ 2. Scanner mission (user prompt)   │  The user's custom focus instructions
├────────────────────────────────────┤
│ 3. Time window                     │  "Last scan was at {lastRunAt}"
├────────────────────────────────────┤
│ 4. Signal source filter            │  Restrict to email/chat/meeting/doc subsets
├────────────────────────────────────┤
│ 5. Analysis procedure              │  Step-by-step instructions for the AI
├────────────────────────────────────┤
│ 6. JSON schema + rules             │  Output format, due date rules, citation rules
├────────────────────────────────────┤
│ 7. Dedup blocks                    │  Same-scanner exclusion + cross-scanner awareness
└────────────────────────────────────┘
```

**Signal source filtering:** Each scanner can restrict which M365 signal types to search. If `scanner.signalTypes` is a subset of `['email', 'chat', 'meeting', 'doc']`, the prompt includes an explicit instruction block telling the AI to ignore other signal types. The mapping is documented inline: Email = Outlook emails, Chat = Teams chat messages, etc.

**Max items cap:** The prompt instructs the AI to return at most `scanner.maxItemsPerScan` items (default 10). This is enforced both in the prompt and post-response (the code also truncates to `maxItems`).

### `buildMonitorPrompt(item)`

Assembles a monitoring prompt from the tracked item's full context:

```
┌────────────────────────────────────┐
│ 1. System identity                 │  "You are a work-tracking monitor agent..."
├────────────────────────────────────┤
│ 2. Task context block              │  Title, severity, status, due date, owner, people
├────────────────────────────────────┤
│ 3. Monitoring context              │  Custom monitor prompt + previous summary + evidence
├────────────────────────────────────┤
│ 4. Done criteria evaluation        │  If set, explicit completion check instructions
├────────────────────────────────────┤
│ 5. Signal source filter            │  Per-item signal type restrictions
├────────────────────────────────────┤
│ 6. Previous summaries (anti-osc.)  │  Last 2 update summaries to prevent re-reporting
├────────────────────────────────────┤
│ 7. JSON schema + all rule blocks   │  hasNewInfo semantics, status definitions, etc.
└────────────────────────────────────┘
```

**Key design:** The monitor prompt is the most instruction-dense prompt in the system (~150 lines when fully assembled). It includes explicit `hasNewInfo` rules that prevent the AI from rephrasing old information as "new," and status definitions that map to lifecycle transitions.

### `buildMeetingBriefingPrompt(meeting, briefingTemplate)`

Simpler — concatenates the loaded `briefing.md` template with meeting details (title, start time, organizer, join URL) and the `BRIEFING_MEETING_JSON_SCHEMA`.

### `buildDayBriefingPrompt(currentItems, currentMeetings, currentKpis, dayBriefingTemplate)`

Injects three context blocks into the day briefing template:
- **Today's meetings** — formatted list with titles, times, organizers
- **Active tracked items** — filtered to exclude completed/archived, with severity and due dates
- **Current KPIs** — critical/elevated/observe counts

### `buildDefaultMonitorPrompt(item)` — `src/svelte/lib/models/item.js`

Auto-generates a monitoring prompt when an item is first tracked. Extracts the most useful fields from the item:

```javascript
// Assembled from non-empty fields:
// title, summary, reason, owner, counterparties, sourceType, doneCriteria
```

This is a "meta-prompt" — a prompt that generates the context for another prompt (the monitor prompt). The output of this function becomes the `monitorPrompt` field on the item, which `buildMonitorPrompt()` then uses as the "MONITORING CONTEXT" section.

---

## Deduplication

FlightDeck uses a **multi-layer dedup system** to prevent the AI from re-surfacing items the user has already seen. Dedup operates at three levels:

### Layer 1: Prompt-Level Exclusion (Same-Scanner)

`buildScannerPrompt()` includes a block listing existing items from the same scanner:

```
Items already on my radar from this scanner (do NOT re-report these):
- Project Alpha deadline discussion
- Budget review action items
- Team standup follow-ups
```

**Rules:**
- Only items belonging to the current scanner (`item.scannerId === scanner.id`)
- Excludes completed and archived items
- Capped at 20 items to avoid prompt bloat
- Case-insensitive title dedup within the list itself

### Layer 2: Cross-Scanner Domain Awareness

`buildCrossScannerDedupBlock()` adds awareness of what other scanners cover:

```
Other active scanners (skip items that clearly belong to another scanner's focus area):
- "Security Alerts" covers: security vulnerabilities, CVEs, and compliance issues
- "Hiring Pipeline" covers: interview scheduling, candidate feedback, offer approvals
```

**Design insight:** This uses *soft boundary framing* — "skip items that clearly belong to another scanner's focus area" rather than hard exclusion. This prevents false negatives when items legitimately span multiple domains.

**Rules:**
- Only enabled scanners with non-empty prompts
- Capped at 5 other scanners
- Topic extraction via `extractScannerTopic()`:
  1. First tries to find a "Focus specifically on:" line (the scanner template pattern)
  2. Falls back to the first meaningful line (>15 chars, not a heading/rule)
  3. Falls back to the scanner name
  4. Truncated to 80 characters

### Layer 3: Post-Response Dedup (Code-Level)

After the AI returns results, `runScanner()` applies code-level dedup:

1. **ID dedup** — skip items with IDs already in the store
2. **Title dedup (current items)** — skip items whose title matches any existing item in the same scanner (case-insensitive)
3. **Title dedup (recent titles)** — skip items matching the scanner's `recentTitles` array, which tracks titles seen in the last 24 hours. This prevents items from re-appearing if they were discovered, then deleted by the user, then re-discovered on the next scan.

```javascript
// src/svelte/lib/scanner-engine.js
const existingTitles = new Set(
  currentItems.filter(i => i.scannerId === scanner.id)
    .map(i => cleanDisplayText(i.title || '').toLowerCase())
);
for (const entry of recentTitles) {
  existingTitles.add(entry.title);
}
const unique = filtered.filter(
  i => !existingIds.has(i.id) && !existingTitles.has(cleanDisplayText(i.title).toLowerCase())
);
```

### Layer 4: Monitor Anti-Oscillation

For tracked items, `buildPreviousSummariesContext()` prevents the AI from re-reporting old information as new:

```
Previous update summaries (for de-duplication — do NOT re-report the same information described here as "new"):
  1. [2026-05-20T14:30:00Z] Sarah confirmed the budget revision is complete.
  2. [2026-05-19T10:15:00Z] Waiting on Jordan's review of the Q3 projections.
If the signals you find are already covered by these previous summaries, set hasNewInfo to false and return the current summary verbatim.
```

This includes the last 2 entries from `item.updateHistory`, providing the AI with enough context to distinguish genuinely new signals from previously captured ones.

---

## JSON Schema Output Shaping

Every prompt ends with a JSON schema that constrains the AI's output format. Schemas are defined as string constants in `src/svelte/lib/constants.js`.

### Scanner Output Schema (`RADAR_SCAN_JSON_SCHEMA`)

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "kpis": { "critical": "number", "elevated": "number", "observe": "number" },
  "radarItems": [
    {
      "id": "string",
      "title": "string",
      "severity": "Critical|Elevated|Observe",
      "sourceType": "string",
      "dueAt": "ISO-8601 or null",
      "owner": "string",
      "counterparties": ["string"],
      "summary": "string",
      "reason": "string",
      "status": "Inbound",
      "evidenceLinks": [{ "label": "string", "type": "string", "signalAt": "ISO-8601 or null" }],
      "suggestedNextSteps": ["string"],
      "doneCriteria": "string or null"
    }
  ]
}
```

### Monitor Output Schema (inline in `buildMonitorPrompt()`)

```json
{
  "hasNewInfo": "boolean",
  "status": "In Progress|Blocked|Waiting|Complete|No Update",
  "summary": "string",
  "reason": "string",
  "severity": "Critical|Elevated|Observe",
  "dueAt": "ISO-8601 or null",
  "owner": "string",
  "counterparties": ["string"],
  "evidenceLinks": [{ "label": "string", "type": "string", "signalAt": "ISO-8601 or null" }],
  "suggestedNextSteps": ["string"],
  "doneCriteria": "string or null",
  "completionConfidence": "high|medium|low|null"
}
```

### Briefing Output Schema (`BRIEFING_MEETING_JSON_SCHEMA`)

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string",
  "upcomingMeeting": { "id": "string", "title": "string", "startAt": "ISO-8601", "organizer": "string", "joinUrl": "URL or null" },
  "keyUpdates": ["string"],
  "decisionsNeeded": ["string"],
  "topRisks": ["string"],
  "talkTrack": ["string"],
  "todayFollowUps": ["string"],
  "sources": [{ "label": "string", "type": "meeting|message|doc", "url": "URL" }]
}
```

### Day Briefing Output Schema (`DAY_BRIEFING_JSON_SCHEMA`)

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string",
  "topPriorities": ["string"],
  "meetingsRequiringPrep": [{ "title": "string", "startAt": "ISO-8601", "whyPrepNeeded": "string" }],
  "atRiskItems": [{ "title": "string", "severity": "string", "risk": "string" }],
  "suggestedTimeBlocks": [{ "time": "string", "activity": "string", "rationale": "string" }],
  "todayFollowUps": ["string"],
  "sources": [{ "label": "string", "type": "string", "url": "URL" }]
}
```

### Schema Design Patterns

All schemas share several design principles:

- **Explicit field-level constraints** — e.g., `"string — brief one-sentence summary"` with examples
- **URL quarantine** — text fields must NOT contain URLs, links, or encoded identifiers. All URLs go exclusively in `sources` or `evidenceLinks` arrays. This prevents broken markdown rendering.
- **Suggested next steps discipline** — "0-2 specific, completable actions starting with a verb naming WHO and WHAT." Explicitly bans vague language: "consider", "think about", "follow up", "look into."
- **Due date extraction** — every schema includes rules for converting temporal language ("by end of week") to ISO-8601 dates, with explicit instructions never to fabricate deadlines
- **Severity tri-level** — Critical / Elevated / Observe used consistently across all scan types

---

## Variable Injection

### `{lastRunAt}` — Recency Window

The primary variable in scanner prompts. Replaced at build time in `buildScannerPrompt()`:

```javascript
const lastRunAt = scanner.lastRunAt || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
// ...
userPrompt.replace(/\{lastRunAt\}/g, lastRunAt)
```

If a scanner has never run, defaults to 14 days ago. This timestamp anchors the AI's search window — only signals created or updated after this time should be reported.

The template `scanner-template.md` and `radar-scan.md` both use `{lastRunAt}` as a placeholder:
```
Look for items with signals since {lastRunAt}.
```

### Meeting Context Injection

`buildMeetingBriefingPrompt()` appends meeting details after the template:

```
Meeting details:
- Title: {meeting.title}
- Start: {formatted start time}
- Organizer: {meeting.organizer}
- Join URL: {meeting.joinUrl}
```

### Day Briefing Context Injection

`buildDayBriefingPrompt()` injects three computed blocks:

1. **Today's meetings** — formatted from `currentMeetings` array
2. **Active tracked items** — filtered from `currentItems`, showing title, severity, status, due date
3. **Current KPIs** — critical/elevated/observe counts

### Monitor Context Injection

`buildMonitorPrompt()` injects the richest context of any prompt type:

- Task metadata (title, severity, status, due date, owner, counterparties)
- Custom monitoring prompt (`item.monitorPrompt`)
- Previous summary
- Previously known evidence links (with labels, types, URLs, signal timestamps)
- Done criteria (if set)
- Signal filter restrictions
- Previous update summaries (last 2 from `updateHistory`)

---

## AI Execution Path

### IPC Flow

```
Renderer Process                     Main Process
─────────────────                    ────────────
window.workiq.ask(prompt)
    │
    ▼
ipcRenderer.invoke('ask-workiq')  →  ipcMain.handle('ask-workiq')
                                         │
                                         ▼
                                     runWorkiqCommand(question)
                                         │
                                         ▼
                                     pty.spawn('workiq', ['ask', '-q', question])
                                         │
                                         ▼
                                     Collect output, strip ANSI
                                         │
                                         ▼
                                     { success: true, answer: "..." }
```

### WorkIQ PTY Bridge (`src/main/pty-bridge.js`)

The bridge resolves the WorkIQ executable (bundled `.exe`, global `.exe`, or `.js` via Node), spawns it via `node-pty` with a very wide terminal (`cols: 32000`) to prevent line-wrapping artifacts in long JSON responses, collects output, strips ANSI escape codes, and returns the raw text.

### Preload Bridge (`src/preload.js`)

Exposes a sanitized API to the renderer via `contextBridge.exposeInMainWorld('workiq', { ... })`. Key methods:
- `ask(question)` — send a prompt to WorkIQ
- `readPromptFile(filename)` — load a markdown template from `src/prompts/`

---

## JSON Parsing & Repair

The AI response is often not clean JSON — it may include markdown fencing, ANSI codes, smart quotes, or broken escaping. `src/svelte/lib/json-parser.js` handles this with a multi-strategy pipeline.

### `runWorkiqJson(prompt, validator, label)`

The top-level function that orchestrates the full cycle:

1. **Send prompt** — `window.workiq.ask(prompt)`
2. **EULA detection** — check if the response is actually a EULA acceptance prompt (not data)
3. **Parse** — `parseWorkiqJson(answer, validator)` attempts extraction
4. **Retry** — on parse failure, retry up to `maxRetries` times (default 1) with a delay
5. **Demo mode** — in demo mode, skips all WorkIQ calls and returns null

### JSON Extraction Strategies (`extractJsonFromText()`)

Three strategies tried in order:

1. **Direct parse** — if the text starts with `{` or `[`, try parsing the whole thing
2. **Fenced code blocks** — extract content from `` ```json ... ``` `` blocks
3. **Brace slicing** — find the first `{` and last `}` and try parsing that substring

### JSON Repair Pipeline (`parseJsonWithRepair()`)

Three repair passes, each progressively more aggressive:

1. **Normalize** — strip ANSI codes, fix smart quotes (`"` → `"`), remove control characters, strip trailing commas
2. **Collapse whitespace** — replace newlines and multi-spaces with single spaces
3. **Quote repair** (`sanitizeLikelyBrokenJson()`) — walk the string character by character, replacing unescaped interior double quotes with single quotes based on lookahead analysis

### Footnote Citation Injection (`injectFootnoteCitations()`)

WorkIQ sometimes returns citation URLs as markdown footnotes (`[1](url)`) outside the JSON block. After parsing, this function extracts those citations and injects them into `radarItems` that have empty `evidenceLinks` arrays.

---

## File Reference

### Prompt Templates
| File | Description |
|------|-------------|
| `src/prompts/radar-scan.md` | Default scanner prompt — general M365 signal scanning with commitments ledger |
| `src/prompts/scanner-template.md` | Skeleton for new custom scanners |
| `src/prompts/briefing.md` | Meeting briefing system prompt |
| `src/prompts/day-briefing.md` | Morning "My Day" briefing prompt |

### Prompt Builders & Constants
| File | Key Exports |
|------|-------------|
| `src/svelte/lib/prompts.js` | `buildScannerPrompt()`, `buildMonitorPrompt()`, `buildMeetingBriefingPrompt()`, `buildDayBriefingPrompt()`, `TODAY_MEETINGS_PROMPT` |
| `src/svelte/lib/constants.js` | `RADAR_SCAN_JSON_SCHEMA`, `BRIEFING_MEETING_JSON_SCHEMA`, `DAY_BRIEFING_JSON_SCHEMA`, `DEFAULT_SCANNER_PROMPT`, `ALL_SIGNAL_TYPES` |
| `src/svelte/lib/models/item.js` | `buildDefaultMonitorPrompt()`, `normalizeItem()` |

### Engines
| File | Description |
|------|-------------|
| `src/svelte/lib/scanner-engine.js` | Background scanner loop (60s tick), `runScanner()`, dedup, auto-monitor, notifications |
| `src/svelte/lib/monitor-engine.js` | Background monitor loop (30s tick), `runItemCheck()`, lifecycle transitions, update history |

### Infrastructure
| File | Description |
|------|-------------|
| `src/svelte/lib/json-parser.js` | `runWorkiqJson()`, JSON extraction/repair, EULA detection, footnote injection |
| `src/main/pty-bridge.js` | WorkIQ executable resolution, PTY spawn, ANSI stripping |
| `src/main/ipc-handlers.js` | IPC channel registration, prompt file reading (with path sanitization) |
| `src/preload.js` | `contextBridge` API: `ask()`, `readPromptFile()` |

### Scanner Model
| File | Description |
|------|-------------|
| `src/svelte/lib/models/scanner.js` | `normalizeScannerDefinition()`, `computeScannerNextRunAt()` — full scanner config normalization with defaults |

### UI Triggers
| File | Description |
|------|-------------|
| `src/svelte/components/RadarView.svelte` | Manual scan triggers, "Run Now" handler |
| `src/svelte/components/BriefingsView.svelte` | Briefing generation, template loading via `loadPromptTemplate()` |
