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

### 2026-05-05 — Meeting summary field in TODAY_MEETINGS_PROMPT

Added a `summary` field to the meetings fetch prompt schema. Key prompt design choices:

- **Guidance placement:** Summary instructions go BEFORE the constraints block — positions them as a primary task, not an afterthought. Keeps the schema at the bottom as reference.
- **Signal enumeration:** Explicitly listed concrete signal sources (invite body, email threads, recurring patterns) to steer the model toward evidence-based summaries rather than title-parroting or hallucination.
- **Anti-hallucination guardrail:** "If no context beyond the title is available, state that plainly" — direct instruction with example phrasing. Positive framing ("state that plainly") outperforms negative framing ("do NOT make things up") for LLM compliance.
- **Schema nullability:** `"string or null"` keeps backward compatibility — the field is optional if the AI can't produce one.
- **Scope discipline:** This is a fetch prompt, not a briefing prompt. Summary guidance is 4 lines, not a paragraph. The heavy analysis stays in `buildMeetingBriefingPrompt()`.

**Downstream integration needed:** `App.svelte` line ~89 mapping currently drops the `summary` field. Goose needs to thread `item.summary` through the processed meeting object and display it in `MeetingCard.svelte` (likely in the subtitle area when no briefing exists).

### 2026-09-04 — Radar-to-inbox prompt fidelity audit

- Defensible pre-inbox baseline: `f2497e53117828515be111300312c7fadda735b2`, the sole parent of `ba086735bbe37b31c8e0ef5a28587c7e7e94c7d6` (`feat: establish FlightDeck 2.0 development baseline`). Its audited prompt surfaces are identical to v1.3.11 (`47bb04831a037074f1f81b52b4d2693dd346c6d9`), which contains the final dynamic temporal-boundary tuning.
- Scanner, monitor, meeting, and day prompt text/order stayed intact. The only existing scanner/monitor schema change was adding the missing exact-source `evidenceLinks[].url` field, aligning schemas with citation instructions and consumers.
- Inbox changed default surfacing from unread/new-first then severity to chronological activity; severity-first behavior survives only in the Priority projection.
- Scanner schema still emits `status: "Inbound"`, but 2.0 normalization maps unrecognized status to `lifecycleStatus: "unknown"` instead of the baseline `in-progress`. This is a prompt-to-state mismatch, not prompt-text drift.
- Proposal synthesis is a new bounded, read-only prompt path. Its context currently reads nonexistent `updatedAt`/`lastUpdatedAt` item fields and uses `slice(-6)` on newest-first update history, sending stale rather than recent updates.
- Orphaned metadata: scanner `generatedAt` and model `kpis` are ignored (local KPIs are derived); monitor `completionConfidence` is stored but not displayed; several synthesis rationale/safety fields are parsed but not shown for Teams proposals.
- Preserved pre-refactor contract debt: `crossScannerDedup` and `dedupStrategy` settings are persisted but ignored; the Radar seed asks for a commitments ledger absent from schema/state; result cap precedes keyword exclusion; parser validation checks only top-level shape rather than the full requested schema.
2026-09-08 | verdict: Yellow - No observed semantic drift in Batch 1 prompt/schema surfaces. Confirmed: no current uncommitted diff under src/prompts/**, src/svelte/lib/prompts.js, or src/svelte/lib/constants.js; baseline 47bb04831a037074f1f81b52b4d2693dd346c6d9 shows those surfaces unchanged except approved evidenceLinks[].url metadata additions; proposal context continues using canonical lastChangedAt and newest six history entries newest-first; Teams UI reads existing why/risk/reviewNote fields without inventing fields; tests pass for focused proposal/scanner/monitor coverage. Gap: missing dedicated prompt-only no-drift characterization test for scanner/monitor metadata semantics in a later prompt-only slice.
Evidence: git diff -- src/prompts src/svelte/lib/prompts.js src/svelte/lib/constants.js => no output; git diff 47bb048... -- src/prompts ... => no output; node --test test/proposal-synthesis.test.js test/scanner-exclusion.test.js test/mailbox-actions-monitor.test.js => passed/skip counts below; git diff --check -- src/svelte/lib/proposal-synthesis.js src/svelte/lib/stores.js src/svelte/lib/models/item.js src/svelte/components/RadarView.svelte src/svelte/components/TodayView.svelte test/proposal-synthesis.test.js test/mailbox.test.js test/main-ipc-handlers.test.js test/radar-selection-transition.test.js .squad/agents/charlie/history.md => no issues.
Files changed under .squad: .squad/agents/charlie/history.md
2026-09-08 - Evidence correction
- The previous line stating the baseline diff had no output was incorrect.
- Exact baseline path changes: A src/prompts/proposal-synthesis.md; M src/svelte/lib/constants.js; M src/svelte/lib/prompts.js.
- The baseline diff is not a scanner/monitor semantic drift: proposal-synthesis.md is the new post-baseline prompt surface, constants.js adds UNKNOWN_LIFECYCLE_STATUS and its label plus RADAR_SCAN_JSON_SCHEMA evidenceLinks[].url, and prompts.js adds monitor evidenceLinks[].url; these are unrelated downstream normalization and approved evidence URL metadata rather than scanner/monitor instruction wording or ordering changes.
- Yellow verdict remains unchanged.
- No decision inbox file is needed.
