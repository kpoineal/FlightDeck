# Maverick — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Goal:** Refactor monolithic Electron app into modular, maintainable codebase

## Learnings
<!-- Append learnings below -->

### 2026-02-25 — Codebase Analysis & Refactoring Plan

**Architecture decisions:**
- No framework migration (stay vanilla JS) — app is small enough that a framework adds complexity without benefit
- No bundler yet — script tags with explicit load order are fine for ~20 modules. Reconsider at 30+
- Script concatenation order matters: theme → constants → utils → state → json-parser → prompts → models → renderers → events → app
- `state.js` must be the single source of truth — all modules reference the same mutable `state` object
- Data flows DOWN: models never import renderers, renderers never import events, `app.js` is composition root
- `renderAll` lives in `app.js` to break circular deps between renderers and KPI rendering

**Patterns observed:**
- Well-separated IPC contract (9 channels, all documented in refactoring plan)
- `preload.js` is clean — 8 exposed methods, no changes needed
- Duplicated code between main and renderer: `escapeHtml`, `normalizeExternalUrl` (slightly different implementations)
- Popout mode (`initPopoutMode`) duplicates ~220 lines of event handlers from `bindEvents` — priority refactor target
- CSS variables for light theme are defined 3 times (triplication) — reduce to 2

**Key file paths:**
- State object definition: `renderer.js` ~line 545
- IPC handlers: `main.js` lines 340-580
- JSON schema constants: `renderer.js` lines 102-210
- Event binding: `renderer.js` lines 4230-5100 (870 lines)
- Tracking renderer: `renderer.js` lines 3310-3600 (300+ lines)
- Popout mode: `renderer.js` lines 5100-5320

**User preferences:**
- User: the project owner
- Team root: c:\dev\scratch\FlightDeck1
- Decisions go to `.squad/decisions/inbox/` for scribe to merge

### 2026-03-02 — Demo Data Strategy Analysis

**Architecture decision:**
- Recommended **built-in demo mode** (Option 4) over three alternatives the user proposed (prompt redaction, blob scrubbing, static fake data).
- Critical insight: radar items are ephemeral (DEC-010, not persisted). Only intercepting `runWorkiqJson()` can populate the Radar tab offline. This makes Options 2/3 insufficient — they'd launch with an empty Radar tab.
- `runWorkiqJson()` in `renderer/json-parser.js` is the single chokepoint for all WorkIQ calls (10 call sites confirmed across app.js, monitor-engine.js, models/briefing.js, renderers/actions.js). Monkey-patching it in demo mode covers everything.
- Implementation: 3 pieces — `src/demo/fixture.json` (static data), `src/renderer/demo.js` (interceptor), `--demo` CLI flag in `main/index.js`.
- No production code paths modified; demo mode activates only with `?demo=1` query param.

**Key file paths:**
- `runWorkiqJson`: `renderer/json-parser.js` line 222
- WorkIQ call sites: `app.js` (4), `monitor-engine.js` (1), `models/briefing.js` (2), `renderers/actions.js` (2)
- Persisted state shape: `renderer/state.js` `savePersistentState()` line 108
- JSON schemas: `renderer/constants.js` lines 3-160

**Decision:** `.squad/decisions/inbox/maverick-demo-data-strategy.md`

### 2026-03-02 — Demo Mode Architecture (Implementation Learnings)

**Interceptor pattern validated:**
- Monkey-patching `runWorkiqJson()` at the single chokepoint in `renderer/json-parser.js` works cleanly — all 10 call sites covered without touching any of them.
- Keyword sniffing on prompt content ("radar", "meetings", "briefing", "monitor") is sufficient to route canned responses. No need for a formal dispatch table.
- The interceptor (`src/renderer/demo.js`) must load BEFORE `app.js` in the script tag order so `runWorkiqJson` is patched before any WorkIQ calls fire during `init()`.

**Fixture structure:**
- `fixture.json` has two top-level keys: `persisted` (seeded into localStorage as `flightdeck.persisted.v2`) and `responses` (keyed by prompt type for the interceptor).
- Fixture must include 5-6 tracking items across different states (active, overdue, completed) and 8-10 radar items with varied severity levels to showcase all UI features.

**DEC-010 ephemeral gap (critical insight):**
- Radar items are NOT persisted (removed in DEC-010). On a fresh launch without M365, the Radar tab (landing page) is empty.
- This single fact disqualifies Options 2 (blob scrubbing) and 3 (static fake data) — they cannot populate radar without live data or an interceptor.
- Future features that remove data from persistence will create similar demo gaps. Always check whether demo mode covers new ephemeral data.

### 2026-02-26 — Sleek Apple-Inspired UI Redesign
- **Update:** Goose redesigned the UI to be sleek, modern, and Apple-inspired (DEC-011).
- **Impact:** CSS files in `styles/` updated with system fonts, translucency, softened shadows, and rounded corners.

### 2026-03-03 — Maintainability & Redundancy Review Kickoff (Program Plan)

**Kickoff objective:**
- Launch a structured, cross-agent program to reduce duplication and fragile coupling without feature work.
- Enforce small, low-risk PR slices with explicit acceptance gates.

**Unified risk framing used for prioritization:**
- `Critical`: defects/security risk or architecture that blocks safe iteration (e.g., raw HTML trust path, concentrated IPC surface).
- `High`: frequent-change code with duplication/coupling likely to regress (tracking/popout duplication, script-order globals, PTY flow duplication).
- `Medium`: maintainability friction with bounded user impact (stringly-typed contracts, duplicated helper logic).

**Execution approach chosen:**
- Start with contract and safety boundaries first (shared IPC/query constants + raw HTML trust-path hardening) before larger refactors.
- Defer larger renderer decomposition until shared contracts and review gates are active.
- Require Merlin-owned contract/timer/interaction tests for each risk-reduction slice touching orchestration.

### 2026-03-17 — Logging Architecture Proposal

**Architecture decision:**
- Recommended `electron-log` v5 over winston (overkill), pino (no Electron awareness), and custom fs.appendFile (re-invents rotation).
- New module: `src/main/logger.js` — sits at bottom of dependency tree, zero internal imports. Configures electron-log and exports `log`, `logError`, `logIpc`.
- `utils.js` delegates its `log`/`logError` to logger.js — zero breaking changes for existing callers.
- IPC logging via decorator pattern: `handleWithLogging(channel, handler)` wraps all 14 `ipcMain.handle` registrations in `ipc-handlers.js`. Avoids modifying individual handler bodies.
- Whitelist-only redaction: `summarizeArgs(channel, args)` and `summarizeResult(channel, result)` extract only safe metadata per channel. Raw M365 content (questions, answers, store values, external URLs) never reaches the log.
- Log location: `app.getPath('userData')/logs/` → `%APPDATA%/FlightDeck/logs/` on Windows.
- Rotation: 1 MB max, 2-file rotation (main.log + main.old.log). No remote shipping.

**Key integration points:**
- `ipc-handlers.js` — decorator wraps all 14 handlers (channel name + arg/result shape only)
- `pty-bridge.js` — spawn/exit/timing events (already has log calls that will auto-redirect to file)
- `store.js` — log set/delete key names only (never values)
- `index.js` — app lifecycle (version, window state, quit transitions)
- `ipc/tracker-popout.js` — popout open/close events

**Delegation:** All implementation assigned to Viper (4 sequential PR slices). Tests assigned to Merlin.

**User preferences:**
- User wants to see inputs/outputs in a log file — specifically the IPC traffic shapes and PTY process lifecycle, not raw M365 content.

**Decision:** `.squad/decisions/inbox/maverick-logging-architecture.md`

**Coordination rules for this program:**
- Goose owns renderer duplication/coupling slices.
- Viper owns main-process, IPC, preload-boundary, and sanitizer normalization slices.
- Merlin owns test expansion and CI/local parity checks.
- Maverick review gate required before merge; rejected work must specify reassign vs escalate.

**Artifacts produced:**
- Decision draft: `.squad/decisions/inbox/maverick-maintainability-kickoff.md`
- Identity focus updated: `.squad/identity/now.md`

### 2026-03-03 — Cross-Agent Kickoff Alignment (DEC-020)

- Kickoff decision draft was merged into canonical decisions as DEC-020.
- Program sequencing and gate criteria were adopted for execution slices across Goose, Viper, and Merlin owners.
- Lead review responsibility remains explicit: approve/reject with required reassign/escalate disposition on rejects.

### 2026-03-03 — Lead Gate Review: Ticket 5 Orchestration Coverage + Follow-ups

**Requested by:** the project owner

**Disposition:** APPROVE (test-scope maintainability slice complete).

**Gate findings:**
- Scope integrity: PASS for Merlin-owned remainder (`test/main-ipc-handlers.test.js`, `test/main-ipc-tracker-popout.test.js`, `test/renderer-popout.test.js`, plus explicit test script update in `package.json`); no new production behavior edits were required for this remaining slice.
- Coverage intent: PASS — Ticket 5 orchestration coverage and both non-blocking follow-ups are now represented with executable tests.
- Risk posture: LOW for manual handoff — changes are test-focused and full suite remains green (`npm test`: 306/306).
- Branch safety: merge remains blocked per user directive until explicit approval from the project owner.

**Validation performed:**
- `node --test test/main-ipc-tracker-popout.test.js test/main-ipc-handlers.test.js test/renderer-popout.test.js` (pass)
- `npm test` (pass, 306/306)

### 2026-03-05 — Evidence Link Extraction Architecture Review

**Context:** the user observed that the WorkIQ AI naturally embeds inline citation links `[1](https://sharepoint.com/...)` in summary/reason text fields, and these are often the REAL source URLs from search results. Meanwhile, the structured `evidenceLinks` array is inconsistently populated. The current `cleanDisplayText()` strips these inline links, permanently discarding the URLs.

**Architectural decision: SUPPLEMENT, not REPLACE.**
- Extract inline citations from raw `summary`/`reason` text BEFORE `cleanDisplayText()` strips them.
- Keep the structured `evidenceLinks` array as a parallel source with metadata (`type`, `signalAt`).
- Merge both sources with URL-based dedup; structured links take priority (more metadata).
- New function `extractInlineCitations()` in `utils.js` — thin composition of existing `normalizeExternalUrl`, `isHallucinatedUrl`, `isDeepLink`, `inferSignalTypeFromUrl`.

**Order-of-operations insight (critical):**
- Extract inline links → THEN clean display text. This is the key architectural constraint. The raw text must be mined before sanitization discards URLs.

**Prompt change: remove prohibition, keep schema.**
- Delete the "Do NOT embed citation links in summary/reason" instruction from `RADAR_SCAN_JSON_SCHEMA` in `constants.js`.
- Keep the `evidenceLinks` schema and existing prompt instructions in `radar-scan.md`.
- This stops fighting the AI's natural citation behavior while still requesting structured data.

**Integration points:** `applyRadarPayload()` (primary), `monitorTaskItem()` (secondary), `applyLedgerPayload()` (tertiary/deferred).

**No changes needed:** `cleanDisplayText()` behavior, `collectRadarSourceLinks()` aggregation, renderer code, evidence link shape, persistence.

**Decision written to:** `.squad/decisions/inbox/maverick-link-extraction-arch.md`

### 2026-03-09 — Evidence Link Prompt Reinforcement

**Problem:** Tracker item updates rarely produce evidence links because the inline citation instruction was a single vague line buried in post-schema rules. When the LLM skipped it, no URLs survived the pipeline (evidenceLinks schema deliberately has no url field — DEC-006 design).

**Root cause:** The prompt relied on one line ("Include inline citations for every referenced source") after the JSON schema. No examples, no pre-schema priming, no schema field hints. The LLM's attention on that instruction was low.

**Changes made (prompt-only, no code changes):**

1. **Pre-schema CITATION FORMAT block** (`buildTaskMonitorPrompt()` in `renderer/prompts.js`, between monitoring instructions and JSON schema):
   - CRITICAL heading, explicit `[label](url)` format requirement, good/bad examples, explanation that the pipeline depends on inline citations.

2. **Schema field descriptions** (both `prompts.js` monitor schema and `constants.js` radar schema):
   - `summary` and `reason` field descriptions now say "MUST contain [label](url) inline citations for each signal referenced".

3. **Evidence link rules section** (`buildTaskMonitorPrompt()` post-schema):
   - Rewritten to explain WHY inline citations are the only URL capture path, with good/bad examples and instruction to re-cite preserved links.

4. **Radar scan schema** (`RADAR_SCAN_JSON_SCHEMA` in `constants.js`):
   - Replaced generic "Include your normal response markdown formatting" with explicit citation-format block including examples.

5. **Radar scan prose** (`prompts/radar-scan.md`):
   - Replaced vague "Include inline citations for every referenced source" with explicit CITATION FORMAT instruction with example.

**Design principle:** Triple-reinforce critical instructions — before schema (prime attention), inside schema (field-level), after schema (rules section). Each reinforcement uses the exact `[label](url)` notation so the LLM has no ambiguity about format.

**Key file paths:**
- Monitor prompt: `src/renderer/prompts.js` line ~233 (`buildTaskMonitorPrompt`)
- Radar schema: `src/renderer/constants.js` line ~3 (`RADAR_SCAN_JSON_SCHEMA`)
- Radar prose: `src/prompts/radar-scan.md`
- Extraction pipeline: `src/renderer/utils.js` (`extractInlineCitations`, `extractBareUrlCitations`, `adoptStructuredLabels`)
- Pipeline orchestration: `src/renderer/monitor-engine.js` lines 70-110

**Decision written to:** `.squad/decisions/inbox/maverick-evidence-link-prompt.md`
