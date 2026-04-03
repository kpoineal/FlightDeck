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

### 2026-04-03 — Phase 2: Prompt builder & scanner-engine unification (DEC-063)

Unified the prompt system so all scanners (including the former "default radar") flow through the same code path.

**Changes to `src/renderer/prompts.js`:**
- Removed `buildRadarScanPrompt()` — was a thin wrapper around `promptCache.radarScan` + schema + dedup. All scanners now use `buildScannerPrompt(scanner)` which already handled everything the radar builder did, plus signal filtering, cross-scanner dedup, and structured prompt composition.
- Removed `promptCache.radarScan` property and all loading/saving/clearing of the `radarScan` custom prompt.
- Removed `loadPromptFiles()` loading of `radar-scan.md` into prompt cache. The radar prompt template now lives as the scanner's `.prompt` field (set at creation time by Goose's model layer).
- Removed the legacy radar prompt editor event bindings from `initPromptEditor()` (that UI was already removed; this cleans up dead code).
- Removed `RADAR_SCANNER_ID` reference (constant being deleted by Goose).

**Changes to `src/renderer/scanner-engine.js`:**
- Removed the `if (scanner.isDefault)` branch from `runScanner()`. All scanners now follow the single path: `buildScannerPrompt()` → LLM → normalize → maxItemsPerScan cap → keyword filter → dedup → auto-monitor → append.
- Removed references to `buildRadarScanPrompt` and `applyRadarPayload`.

**Key architecture decision — upsert vs append:**
- `applyRadarPayload()` did full upsert: existing items got their content refreshed while preserving monitoring state.
- The scanner path does dedup-then-append: items matching existing evidence/titles are filtered out; existing items stay untouched.
- Chose dedup-then-append for all scanners. The dedup pipeline achieves the same "no duplicates" goal more predictably, and existing items preserve their user edits. If we ever want "content refresh" behavior, it can be added as a scanner option later.

**Test impact:** 8 test failures in `renderer-prompts.test.js` (6) and `renderer-delete-scanner.test.js` (2) — all reference removed radar-specific functions/behavior. Merlin owns test updates.
