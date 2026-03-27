# Charlie — History

## Project Context

- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** Kyle Poineal
- **Joined:** 2026-03-25

## Prompt Landscape (Day 1)

FlightDeck has ~13 distinct prompt surfaces:

### Markdown Templates (user-editable via UI)
- `src/prompts/radar-scan.md` — radar scan instructions (static, no variables)
- `src/prompts/briefing.md` — meeting briefing system prompt
- `src/prompts/day-briefing.md` — "My Day" morning briefing
- `src/prompts/scanner-template.md` — default for new scanners (uses `{lastRunAt}`)

### Builder Functions (`src/renderer/prompts.js`)
- `buildRadarScanPrompt()` — combines template + schema + dedup exclusions
- `buildScannerPrompt(scanner)` — per-scanner with multi-layer dedup
- `buildMeetingBriefingPrompt(meeting)` — meeting context + template + schema
- `buildTaskMonitorPrompt(item)` — largest prompt (~150 lines of logic), deeply detailed monitoring instructions
- `buildDayBriefingPrompt()` — synthesizes meetings + tracked + KPIs
- `buildActionDraftPrompt()` — outreach draft from suggested actions
- `buildSuggestionDraftPrompt()` — outreach draft from next steps
- `TODAY_MEETINGS_PROMPT` — simple meeting list fetch

### JSON Schema Constants (`src/renderer/constants.js`)
- `RADAR_SCAN_JSON_SCHEMA`, `BRIEFING_JSON_SCHEMA`, `BRIEFING_MEETING_JSON_SCHEMA`, `DAY_BRIEFING_JSON_SCHEMA`, `DEFAULT_SCANNER_PROMPT`

### Fragments in Other Files
- `src/renderer/models/tracking.js` — `buildDefaultMonitorPrompt()` for auto-generating monitor prompts

## Learnings

### 2026-03-26 — Ported to unified-radar-tracker branch

Charlie and prompt work originally created on `feature/multi-scanner-radar` branch.
Ported to `feature/unified-radar-tracker` which uses a unified `items` model (vs separate radarItems/trackingItems arrays).
Charter and history carry forward; prompt optimization work re-applied to this branch's codebase.

### 2026-03-26 — Cross-scanner dedup prompt design

Designed a cross-scanner dedup block for `buildScannerPrompt()` to prevent duplicate cards when scanners' focus areas overlap.

**Key design choices:**
- Soft boundary framing ("skip items that clearly belong to another scanner's focus") beats hard exclusion — avoids false negatives on legitimately multi-domain items.
- Extract focus topic from "Focus specifically on:" line in each scanner's prompt (≤80 chars). Falls back to first meaningful line, then scanner name.
- Cap at 5 other scanners × ~100 chars = ~500 chars max. Zero overhead for single-scanner setups.
- Only include enabled scanners with non-empty prompts.
- Layered dedup order: exact title match → same-scanner exclusion labels → cross-scanner domain exclusion (most specific → least).

**Prompt engineering insight:** For LLM exclusion instructions, "skip items that clearly belong to X" outperforms "do NOT report items about X" — the positive-scope framing gives the model a classification basis rather than a negation to track. Soft boundaries ("clearly belong to") are more robust than hard exclusions when domains overlap.

**Decision:** `.squad/decisions/inbox/charlie-cross-scanner-dedup.md`
