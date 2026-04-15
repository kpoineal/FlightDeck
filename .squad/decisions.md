# Decisions

> Team decisions that all agents must respect. Append-only — never edit past entries.

<!-- Scribe merges entries from .squad/decisions/inbox/ into this file -->

---

## DEC-001: FlightDeck Refactoring Plan

**Author:** Maverick (Lead) | **Date:** 2026-02-25 | **Status:** Proposed | **Requested by:** the project owner

**Summary:** Decompose the 3-file monolith (`renderer.js` 5,355 lines, `index.html` 2,145 lines, `main.js` 583 lines) into ~25 focused modules across 5 phases with zero breakage at each phase boundary. No framework, bundler, or TypeScript migration.

**Phases:**

| # | Phase | Agent | Depends On | Size |
|---|-------|-------|------------|------|
| 1 | CSS Extraction — inline CSS → 8 files in `styles/` | Goose | — | Small |
| 2 | Main Process Split — `main.js` → 5 modules in `main/` | Viper | — | Small |
| 3 | Renderer Foundation — extract non-rendering modules from `renderer.js` (~60% reduction) | Goose | Phase 1 | Medium-Large |
| 4 | Renderer UI Split — extract renderers, events, popout from remaining `renderer.js` | Goose | Phase 3 | Large |
| 5 | Test Infrastructure — unit/integration/smoke tests | Merlin | Phase 2+3 | Medium |

**Key decisions:**
- Phases 1+2 run in parallel; Phase 5 starts alongside Phase 2.
- Vanilla JS, script-tag loading (no bundler). ES modules deferred to future phase.
- `preload.js` and prompt files unchanged.
- Shared mutable `state` object remains a single instance in `state.js`.
- Popout event handler duplication (~220 lines) to be resolved in Phase 4 by extracting shared handlers.
- CSS variable triplication (light theme defined 3×) to be reduced in Phase 1.
- `escapeHtml` and `normalizeExternalUrl` duplication across processes documented as intentional.

**Source:** `.squad/decisions/inbox/maverick-refactoring-plan.md` (full plan)
---

## DEC-002: CSS Extraction (Phase 1)

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-25 | **Status:** Implemented

**Summary:** Extracted all inline CSS from `index.html` (~1,860 lines) into 8 external stylesheets under `styles/`. Zero-logic-change refactoring. CSP tightened from `style-src 'unsafe-inline'` to `style-src 'self'`.

**File structure:** `tokens.css → layout.css → components.css → radar.css → tracking.css → briefing.css → search.css → modal.css`

**Key decisions:**
- Light theme tokens: 2 copies kept (explicit + system-preference fallback).
- Responsive queries distributed to their respective CSS files.
- `.tracking-heading-row` stays in `tracking.css` per naming convention.
- `briefing.css` is a placeholder — briefing views use generic component styles.

**Impact:** `index.html` reduced from 2,145 → 296 lines. No markup or script changes.

**Source:** `.squad/decisions/inbox/goose-css-extraction.md`

---

## DEC-003: Main Process Decomposition (Phase 2)

**Author:** Viper (Backend Dev) | **Date:** 2026-02-25 | **Status:** Implemented

**Summary:** Split `main.js` (583 lines) into 5 modules under `main/`: `index.js`, `ipc-handlers.js`, `pty-bridge.js`, `window-state.js`, `utils.js`.

**Key patterns:**
- Getter pattern for `mainWindow`: IPC handlers receive `() => mainWindow` rather than a direct reference.
- `APP_ROOT` constant: `path.join(__dirname, '..')` for project-root paths.
- CommonJS throughout (`require()`/`module.exports`).

**Impact:** `package.json` main changed to `"main/index.js"`. Original `main.js` backed up as `main.js.bak`. Renderer code unchanged.

**Source:** `.squad/decisions/inbox/viper-main-split.md`

---

## DEC-004: Renderer Foundation Extraction (Phase 3)

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-25 | **Status:** Implemented

**Summary:** Extracted 11 non-rendering "foundation" modules from `renderer.js` (5,355 lines) into a `renderer/` directory, loaded via `<script>` tags before `renderer.js`.

**Modules extracted:**
1. `renderer/theme.js` — theme init IIFE + toggle
2. `renderer/constants.js` — JSON schemas, schedule/signal constants, storage keys
3. `renderer/utils.js` — text sanitization, URL normalization, date helpers
4. `renderer/json-parser.js` — JSON extraction + repair pipeline
5. `renderer/state.js` — DOM cache, state object, persistence
6. `renderer/prompts.js` — all prompt template builders
7. `renderer/models/tracking.js` — tracking item CRUD + scheduling
8. `renderer/models/radar.js` — radar payload processing + identity resolution
9. `renderer/models/briefing.js` — meeting/briefing alignment + generation
10. `renderer/monitor-engine.js` — background monitoring loop
11. `renderer/search.js` — fuzzy search + keyboard navigation

**Key decisions:**
- `renderer.js` reduced from 5,355 → 3,017 lines (43.7% reduction). All rendering, event binding, init, and popout code remains.
- No bundler — vanilla `<script>` tag loading with shared global scope. Functions resolved at call time.
- `index.html` grows from 1 script tag to 12 (11 foundation + 1 renderer).

**Source:** `.squad/decisions/inbox/goose-phase3-foundation.md`

---

## DEC-005: Test Infrastructure (Phase 5 Part 1)

**Author:** Merlin (Tester) | **Date:** 2026-02-25 | **Status:** Implemented

**Summary:** Established test infrastructure using Node's built-in test runner (`node:test` + `node:assert/strict`) with zero additional dependencies.

**Key decisions:**
- Node built-in `node:test` — no Jest, Mocha, or Vitest. Matches minimal-dependency philosophy.
- Module-level `Module._resolveFilename` interception to mock `electron` and `node-pty` at require time.
- Explicit file listing in `npm test` script. New test files must be added manually.
- Pure/unit-testable functions covered. Integration tests deferred to Phase 5 Part 2.

**Result:** 49 tests, 8 suites, all passing. Files: `test/helpers/electron-mock.js`, `test/main-utils.test.js`, `test/main-window-state.test.js`, `test/main-pty-bridge.test.js`.

**Source:** `.squad/decisions/inbox/merlin-test-infra.md`

---

## DEC-006: Links & Due Date Fixes

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-26 | **Status:** Implemented

**Summary:** Fixed broken deep-link filtering and due date handling across renderer utilities, models, and prompts.

**Key decisions:**
- `isDeepLink()` relaxed from rigid ~12-regex whitelist to permissive gate: any HTTPS URL with `pathname.length > 1` is accepted. `DEEP_LINK_PATTERNS` kept as automatic pass-through for known Microsoft domains.
- `applyLedgerPayload()` now detects `{label, type, url}` objects in `evidenceLinks` and normalizes directly, falling back to `extractExternalUrls()` for raw strings. `collectRadarSourceLinks()` handles both formats.
- Temporal inference instructions added to `prompts/radar-scan.md` and `renderer/prompts.js` — LLM resolves relative dates to ISO-8601 `dueAt` using today's date.
- Evidence link citation guidance added to `prompts/radar-scan.md` — LLM must populate `evidenceLinks` with real URLs, descriptive labels, types; fabrication prohibited.

**Source:** `.squad/decisions/inbox/goose-links-duedate-fixes.md`

---

## DEC-007: Renderer Test Strategy — vm Context for Vanilla JS

**Author:** Merlin (Tester) | **Date:** 2026-02-25 | **Status:** Implemented

**Summary:** Renderer modules are vanilla JS loaded via `<script>` tags (no `module.exports`). To unit-test them with Node's built-in test runner, `vm.runInContext` executes files in a sandboxed context with injected browser API mocks. Dependencies loaded in script-tag order.

**Key patterns:**
- `test/helpers/renderer-context.js` provides `createRendererContext()` and `loadFile()`.
- JS builtins explicitly injected into the vm context (Date, URL, JSON, Set, Map, etc.).
- Cross-realm comparisons require `assert.deepEqual` (non-strict) instead of `assert.deepStrictEqual` for arrays/objects.
- Model tests stub `state`, `savePersistentState`, and render functions as no-ops in `extraGlobals`.

**Result:** 182 new unit tests covering 5 renderer modules with zero production code changes. Total: 231 tests in ~170ms.

**Source:** `.squad/decisions/inbox/merlin-renderer-tests.md`

---

## DEC-008: Electron-store Migration (Future)

**Author:** the project owner (via Copilot) | **Date:** 2026-02-26 | **Status:** Proposed

**Summary:** Plan to migrate from `localStorage` to `electron-store` in the future. `localStorage` caps at ~5 MB in Chromium/Electron; after a few days of testing, storage is already at 6% of 5 MB — projects to hit the limit within months of regular use.

**Impact:** `renderer/state.js` save/load functions are the primary migration point. The modular structure from the refactoring makes this a clean swap.

**Source:** `.squad/decisions/inbox/copilot-directive-electron-store.md`

---

## DEC-009: localStorage Leak Fixes

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-26 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Fixed 3 localStorage leaks causing ~2% daily storage growth in long-running Electron sessions.

**Changes:**

1. **Legacy key cleanup** (`renderer/state.js`): After migrating data from `flightdeck.persisted.v1` to `v2`, the old key is now removed via `localStorage.removeItem()`. Previously it persisted forever alongside the new key.

2. **`briefingSeenAt` orphan pruning** (`renderer/models/briefing.js`): `reconcileMeetingScopedState()` now prunes `briefingSeenAt` entries whose meeting IDs no longer exist in either `briefingsByMeetingId` or the current meetings list. `pruneStaleBriefings()` already cleaned both maps for expired meetings (before today), so the two functions now complement each other — stale-by-date vs. stale-by-absence.

3. **History pruning on every save** (`renderer/state.js`): `pruneHistory()` is now called at the top of `savePersistentState()` before every write, not just on load. Added `HISTORY_MAX_ENTRIES = 500` constant (`renderer/constants.js`) as a hard cap to guard against explosive growth within a single day.

**Key decisions:**
- Entry cap of 500 chosen as reasonable upper bound for 30 days of activity at typical usage rates.
- `briefingSeenAt` pruning uses union of `briefingsByMeetingId` keys + current meeting IDs, so in-flight meetings that haven't been briefed yet retain their seen-at timestamps.
- No changes to `pruneStaleBriefings()` — it already handles the date-based cleanup correctly.

**Source:** `.squad/decisions/inbox/goose-localstorage-leaks.md`

---

## DEC-010: Stop Persisting Ephemeral Data & Tighten Caps

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-26 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Reduced localStorage payload size by removing ephemeral data (`radarItems`, `meetings`) from persistence and lowering history caps (`updateHistory` 50→20, `HISTORY_MAX_ENTRIES` 500→200).

**Changes:**

1. **`radarItems` removed from persistence** (`renderer/state.js`): Not saved or loaded. Scan results are fully replaced every cycle via `applyRadarPayload()` and re-fetched on connect. Stale results on restart are misleading.

2. **`meetings` removed from persistence** (`renderer/state.js`): Not saved or loaded. Meetings are fully replaced on refresh via `applyMeetingsPayload()`, filtered to future-only.

3. **`updateHistory` cap reduced 50→20** (`renderer/monitor-engine.js`): Per-tracking-item update history capped at 20. Load-time trim added in `loadPersistentState()` so existing oversized histories shrink on first load.

4. **`HISTORY_MAX_ENTRIES` reduced 500→200** (`renderer/constants.js`): Global history cap lowered. 200 entries sufficient for a 30-day rolling window.

**Key decisions:**
- `briefingsByMeetingId` remains persisted — requires expensive LLM calls to regenerate.
- On startup without a connection, radar/meetings render empty then fill after `refreshAllData()` (~1-2s flash). Acceptable UX tradeoff.
- `reconcileMeetingScopedState()` still runs correctly — called inside `applyMeetingsPayload()` on refresh, not on load.

**Source:** `.squad/decisions/inbox/goose-ephemeral-persistence.md`
---

## DEC-011: Sleek Apple-Inspired UI Redesign

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-26 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Redesigned the UI to be sleek, modern, and Apple-inspired.

**Changes:**
- **Typography:** Switched to system fonts (SF Pro, -apple-system, BlinkMacSystemFont).
- **Translucency:** Added `backdrop-filter: blur(20px)` to topbar, panels, cards, and modals.
- **Shadows:** Softened shadows for a more subtle, floating effect.
- **Corners:** Increased border-radius across components (e.g., 12px/16px for cards, 8px for buttons).
- **Transitions:** Added smooth transitions and subtle scale effects on hover/active states.

**Key files:** `styles/tokens.css`, `styles/layout.css`, `styles/components.css`, `styles/radar.css`, `styles/tracking.css`, `styles/search.css`, `styles/modal.css`.

**Source:** `.squad/decisions/inbox/goose-sleek-ui.md`

---

## DEC-012: Light Mode Re-envisioning & Design System Overhaul

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-26 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Comprehensive CSS-only overhaul across all 8 style files to fix washed-out light mode and create an Apple-quality design system in both themes. Added 5 new semantic color tokens, replaced ~30 hardcoded colors with theme-adaptive `var()` and `color-mix()` references.

**Changes:**

1. **New semantic tokens** — `--color-critical`, `--color-elevated`, `--color-observe`, `--color-success`, `--shadow-hover` added to `:root` and both light theme blocks for theme-adaptive charts, KPI borders, legend dots, pill borders.

2. **Light mode overhaul** — warmer body (`#f5f5f7`), more opaque surfaces (0.88), confident borders (0.08–0.18), dual-layer card shadows, stronger modal overlay (0.35), warmer text (`#1d1d1f`), accessible briefed-green (`#248a3d`), increased blur (24px).

3. **Hardcoded color elimination** — ~30 hardcoded `rgba()`/hex values in `components.css`, `tracking.css` replaced with `var()`/`color-mix()` so severity colors, glows, and borders adapt per-theme.

4. **Both light blocks in sync** — `html[data-theme="light"]` and `@media (prefers-color-scheme: light)` blocks have identical token values.

**Key decisions:**
- `color-mix(in srgb, var(--color-critical) 50%, transparent)` preferred over per-element tokens — more maintainable, supported in Chromium 111+ / Electron 24+ (already required).
- All token changes centralized in `tokens.css`; component files only consume vars.
- No HTML or JS changes; all 259 tests pass unchanged.

**Key files:** `styles/tokens.css`, `styles/components.css`, `styles/layout.css`, `styles/radar.css`, `styles/tracking.css`, `styles/search.css`, `styles/modal.css`, `styles/briefing.css`.

**Source:** `.squad/decisions/inbox/goose-light-mode-reenvision.md`

---

## DEC-013: No Direct Pushes to Main

**Author:** the project owner (via Copilot) | **Date:** 2026-02-27 | **Status:** Active

**Summary:** No direct pushes to main. All changes must go through a PR and be merged. Main branch will have push protection enabled.

**Key decisions:**
- All code changes require a pull request — no direct pushes to `main`.
- Main branch push protection to be enabled at the repo level.

**Source:** `.squad/decisions/inbox/copilot-directive-no-direct-push-main.md`

---

## DEC-014: CSP Inline Style Violation Fixes

**Author:** Goose (Frontend Dev) | **Date:** 2026-02-27 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Eliminated all inline style CSP violations without weakening CSP (no `'unsafe-inline'`). Three patterns applied: `classList.toggle/add/remove` for boolean/one-way state, `style.setProperty('--custom-prop', value)` for truly dynamic values.

**Key CSS classes created:** `.d-none`, `.chevron--expanded`, `.list--minimal`, `.panel--full`, `.kpi-measurer`, `.popout-container`, `.viz-legend--briefing`.

**Changes:**
- `styles/components.css` — Modified 3 existing rules, added 16 new classes.
- `styles/tracking.css` — Added 1 auto-height custom property rule.
- `index.html` — Removed all 9 `style=` attributes.
- `renderer/state.js`, `renderer/popout.js`, `renderer/events.js`, `renderer/app.js` — Converted display/transform assignments.
- `renderer/renderers/kpi.js` — Converted 22 style assignments to `setProperty` + `classList`.
- `renderer/renderers/tracking.js` — Converted 11 style assignments.
- `renderer/renderers/radar.js` — Converted 1 style assignment.

**Key decisions:**
- CSP not weakened — no `'unsafe-inline'` added.
- `main/` and `preload.js` not modified.
- All 292 tests pass.

**Source:** `.squad/decisions/inbox/goose-csp-inline-fix.md`
---

## DEC-015: Day Briefing Feature (P0-3)

**Author:** Goose (Frontend Dev) + Merlin (Tester) | **Date:** 2026-02-27 | **Status:** Implemented | **Requested by:** the project owner (via Iceman roadmap P0-3)

**Summary:** Implemented "My Day" briefing that synthesizes all meetings, tracked items, and radar KPIs into a single morning summary. Users click "Generate My Day" from the Briefings tab to get a headline, top priorities, meetings requiring prep, at-risk items, suggested time blocks, and follow-ups.

**Key decisions:**
- New prompt template `prompts/day-briefing.md` loaded via `loadPromptFiles()` alongside existing prompts.
- Day briefing stored in `briefingsByMeetingId` under special key `DAY_BRIEFING_KEY = '__day_briefing__'`.
- `DAY_BRIEFING_JSON_SCHEMA` constant added to `renderer/constants.js` defining the JSON response schema.
- `buildDayBriefingPrompt()` in `renderer/prompts.js` assembles today's date, meetings, tracked items, and KPIs into the LLM prompt.
- `applyDayBriefingPayload()` normalizes and stores the day briefing response, sanitizing all text fields via `sanitizeBriefingText`.
- `getDayBriefing()` retrieves the cached day briefing.
- `generateDayBriefing()` orchestrates the async flow: status updates, history logging, WorkIQ call, apply payload, error handling.
- `pruneStaleBriefings()` extended to prune day briefings from previous days (based on `generatedAt` vs. today midnight).
- `reconcileMeetingScopedState()` preserves `DAY_BRIEFING_KEY` entry during meeting reconciliation — it is not a real meeting.
- `renderDayBriefingCard()` renders the day briefing card at the top of the Briefings tab with empty state and generated state variants.
- Event delegation wired via `[data-generate-day-briefing]` attribute in `events.js`.
- 30 tests across 6 suites in `test/renderer-day-briefing.test.js` (constants, prompt builder, apply payload, get/set, reconciliation, pruning).
- All 322 tests pass (66 suites, 0 failures).

**Key files:** `src/prompts/day-briefing.md`, `src/renderer/constants.js`, `src/renderer/prompts.js`, `src/renderer/models/briefing.js`, `src/renderer/renderers/briefing.js`, `src/renderer/events.js`, `src/renderer/state.js`, `test/renderer-day-briefing.test.js`.

**Source:** `.squad/decisions/inbox/iceman-feature-roadmap.md` (US-03)

---

## DEC-016: Release & CI Pipeline

**Author:** Jester (DevOps) | **Date:** 2026-02-27 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Created two GitHub Actions workflows for FlightDeck: a release workflow (`.github/workflows/release.yml`) and a CI workflow (`.github/workflows/ci.yml`).

**Release workflow:**
- Triggers on push to `main`, runs on `windows-latest` (required for `node-pty` native module rebuild).
- Reads version from `package.json`; skips if a GitHub Release for that version already exists.
- Builds MSI via `npm run dist` (electron-builder), creates git tag (`v{version}`) and GitHub Release with MSI attached.
- Tests run as a gate before the build step.

**CI workflow:**
- Triggers on PRs to `main` and pushes to `main`, runs on `windows-latest`.
- Runs the full test suite via `node --test test/*.test.js`.

**Key decisions:**
- Windows runner required — `node-pty` is a native module that must compile on the target platform.
- Version-gated releases — workflow checks if release for current `package.json` version already exists, avoiding duplicates.
- Tag creation in CI — git tags created by the workflow, ensuring tags correspond to actual releases.
- Separate from squad workflows — independent of existing `squad-release.yml` / `squad-ci.yml`.
- Added `version:patch` script to `package.json` (`npm version patch --no-git-tag-version`).

**Source:** `.squad/decisions/inbox/jester-release-pipeline.md`

---

## DEC-017: Built-in Demo Mode

**Author:** Maverick (Lead) | **Date:** 2026-03-02 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Implemented built-in demo mode (Option 4 of 4 evaluated) for PII-free screenshots and walkthroughs. Loads synthetic localStorage blob AND intercepts `runWorkiqJson()` to return canned responses. Zero M365 dependency.

**Key decisions:**
- Three components: `src/demo/fixture.json` (static data), `src/renderer/demo.js` (interceptor), `--demo` CLI flag in `main/index.js`.
- `runWorkiqJson()` is the single chokepoint for all WorkIQ calls (10 call sites). Monkey-patching it in demo mode covers everything.
- Radar items are ephemeral (DEC-010, not persisted). Only the interceptor can populate the Radar tab offline — this rules out blob-scrubbing and static-fake-data approaches.
- Interceptor sniffs prompt content for keywords ("radar", "meetings", "briefing", "monitor") to return appropriate canned responses.
- Synthetic data uses obviously-fake names (Alex Rivera, Jordan Chen, etc.) and `https://demo.flightdeck.app/` URL prefix.
- No production code paths modified — interceptor activates only with `?demo=1` query param.

**Key files:** `src/demo/fixture.json`, `src/renderer/demo.js`, `src/main/index.js`, `src/renderer/app.js`, `src/index.html`, `src/styles/layout.css`.

**Source:** `.squad/decisions/inbox/maverick-demo-data-strategy.md`

---

## DEC-018: App Version IPC Handler

**Author:** Viper (Backend Dev) | **Date:** 2026-03-02 | **Status:** Implemented

**Summary:** Exposed Electron app version via `ipcMain.handle` / `ipcRenderer.invoke` (async invoke pattern) for renderer display. Handler registered at top of `registerIpcHandlers`, consistent with all other IPC handlers in the codebase.

**Key decisions:**
- Used `handle`/`invoke` pattern (not `on`/`sendSync`) to keep API surface uniform and avoid blocking the renderer.
- Handler is synchronous internally (`app.getVersion()`) but wrapped in async pattern for consistency.

**Source:** `.squad/decisions/inbox/viper-app-version-ipc.md`

---

## DEC-019: Version Badge UI Placement

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-02 | **Status:** Implemented

**Summary:** Placed version badge inline inside the `.brand` div after "FLIGHTDECK" text. Uses fade-in transition (`opacity 0→1` via `.visible` class) to avoid flash while async version call resolves. Fire-and-forget fetch in `init()` — failure silently caught, badge stays hidden.

**Key decisions:**
- Badge in header brand area (natural home for app identity info), not footer or status bar.
- No fallback text — invisible is cleaner than wrong.
- Non-critical UI: silent failure acceptable.

**Source:** `.squad/decisions/inbox/goose-version-badge-ui.md`

---

## DEC-020: Maintainability & Redundancy Review Program Kickoff

**Author:** Maverick (Lead) | **Date:** 2026-03-03 | **Status:** Proposed | **Requested by:** the project owner

**Summary:** Launch a cross-agent maintainability and redundancy review program focused on reducing fragile coupling, duplication, and contract drift using small, safe PR slices.

**Priority order:**
- **NOW (Week 1):**
	1. Harden raw HTML trust boundaries in renderer paths.
	2. Stabilize cross-process contracts (IPC/query/event naming + payload ownership).
	3. Cut highest-friction duplication seam in tracking/popout behavior parity.
- **NEXT (Weeks 2-3):**
	4. Decouple renderer model-view responsibilities.
	5. Split concentrated IPC handler logic by domain.
	6. Unify sanitizer/URL normalization helpers across processes.
- **LATER (Weeks 4+):**
	7. Reduce script-order/global coupling.
	8. Consolidate duplicated PTY flow logic and implicit conventions.
	9. Expand orchestration coverage across main/preload/renderer boundaries.

**Execution tickets (kickoff set):**
1. **Ticket 1 — Contract Catalog & Constantization Baseline** (Owner: Viper)
2. **Ticket 2 — Raw HTML Trust-Path Guardrail** (Owner: Viper)
3. **Ticket 3 — Tracking/Popout Shared Renderer Primitive** (Owner: Goose)
4. **Ticket 4 — Main IPC Handler Domain Split (First Slice)** (Owner: Viper)
5. **Ticket 5 — Orchestration Coverage Parity Slice** (Owner: Merlin)

**Required review gate for every ticket:**
- Scope integrity (single-concern, small PR slice)
- Contract safety (canonical constants, explicit payload ownership)
- Duplication reduction in scope
- Boundary hygiene (no responsibility mixing)
- Security/sanitization consistency
- Merlin test sign-off for contract/timer/interaction coverage
- Rollback readiness
- Maverick lead decision (Approve/Reject with reassign/escalate disposition)

**Recommended start sequence:** Ticket 1 -> Ticket 2 -> Ticket 3, with Ticket 5 running in parallel after baseline hardening.

**Source:** `.squad/decisions/inbox/maverick-maintainability-kickoff.md`

---

## DEC-021: T1/T2 Backend Kickoff Slice — IPC Contract Constants + Markdown Raw HTML Guardrail

**Author:** Viper (Backend Dev) | **Date:** 2026-03-03 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Implemented kickoff tickets T1 and T2 as a minimal-risk backend slice by centralizing IPC channel constants and removing unsafe raw HTML passthrough in markdown preview IPC handling.

**Key decisions:**
- Added shared IPC contract catalog (`src/shared/ipc-contract.js`) and used canonical constants in both `src/main/ipc-handlers.js` and `src/preload.js`.
- Kept channel string values behaviorally compatible while eliminating duplicated literals.
- In `open-markdown-window`, ignored renderer-provided `rawHtml` and always rendered preview content from markdown conversion.
- Added targeted coverage in `test/main-ipc-handlers.test.js` for constant usage/registration and `rawHtml` guardrail behavior.

**Validation:** `npm test` passed (296 passed, 0 failed).

**Source:** `.squad/decisions/inbox/viper-t1-t2-implementation.md`

---

## DEC-022: Reviewer Gate Approval — T1/T2 Backend Kickoff Slice

**Author:** Merlin (Tester/Reviewer) | **Date:** 2026-03-03 | **Status:** Approved | **Requested by:** the project owner

**Summary:** Completed reviewer gate for Ticket 1 (IPC contract constantization) and Ticket 2 (markdown preview raw HTML trust-path guardrail). Review outcome: **APPROVE**.

**Checklist outcome:**
- Contract safety: PASS (canonical channel catalog used consistently across `handle`/`on`/`invoke`/`send`/listener wiring).
- Security boundary: PASS (`rawHtml` payload ignored; preview generated from markdown conversion path only).
- Regression coverage: PASS (focused tests prove constant usage and `rawHtml` non-rendering with markdown behavior intact).
- Scope control: PASS (changes limited to contract stability + trust-boundary hardening).

**Non-blocking follow-up:** Add a parity test for tracker-state fanout behavior across main window and popouts excluding sender.

**Source:** `.squad/decisions/inbox/merlin-t1-t2-review.md`

---

## DEC-023: Reviewer Gate Approval — Ticket 4 Slice 1 IPC Domain Split

**Author:** Merlin (Tester/Reviewer) | **Date:** 2026-03-03 | **Status:** Approved | **Requested by:** the project owner

**Summary:** Completed reviewer gate for Ticket 4 Slice 1 (IPC domain split). Review outcome: **APPROVE**.

**Checklist outcome:**
- Behavior-preserving split: PASS (tracker popout + tracker-state channels preserved; composition root remains in `registerIpcHandlers()`).
- Scope control: PASS (extraction limited to tracker popout lifecycle + tracker state fanout domain).
- Regression coverage: PASS (focused tests cover registration, lifecycle cleanup, sender exclusion, sibling fanout, destroyed-window exclusion).
- Risk posture: LOW (structural extraction with stable channel names and preserved behavior).

**Non-blocking follow-up:** Add a narrow fanout test for the case where main window is destroyed and no active popouts exist.

**Source:** `.squad/decisions/inbox/merlin-ticket4-slice1-review.md`

---

## DEC-024: Ticket 3 Slice 1 — Tracking/Popout Shared History Renderer Primitive

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-03 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Implemented Ticket 3 as a small, safe frontend slice by extracting one shared renderer primitive for tracking/popout history markup, reducing duplication while preserving existing behavior and UX.

**Scope:**
- Added `buildTrackerHistoryMarkup(item, emptyText?)` in `src/renderer/renderers/tracking.js`.
- Replaced duplicated history markup generation in:
	- tracking minimal row detail path
	- tracking card path
	- popout path (`src/renderer/popout.js`)
- No backend/main-process changes.
- No contract/event/channel changes.

**Behavior safety decisions:**
- Preserved existing empty-state messages by call site:
	- Minimal row detail: `No history yet.`
	- Card/popout: `No history yet — updates appear here after meaningful changes.`
- Preserved markup shape/classes (`tracker-history-entry`, `history-ts`, `history-change`, `history-summary`, inline source list, suggestions).

**Validation:**
- Added focused test file `test/renderer-tracking-renderers.test.js` for the new primitive.
- Updated `package.json` `scripts.test` explicit file list to include the new test.
- `npm test` passed: 302 passed, 0 failed.

**Rationale:**
- This targets the highest-friction duplication seam between tracking and popout with minimal blast radius.
- Shared primitive improves parity safety for future updates to history row markup.

**Source:** `.squad/decisions/inbox/goose-ticket3-slice1.md`

---

## DEC-025: Reviewer Gate Approval — Ticket 3 Slice 1 Tracking/Popout Shared History Primitive

**Author:** Merlin (Tester/Reviewer) | **Date:** 2026-03-03 | **Status:** Approved | **Requested by:** the project owner

**Summary:** Completed reviewer gate for Ticket 3 Slice 1 (tracking/popout duplication seam). Review outcome: **APPROVE**.

**Checklist outcome:**
- Behavior parity: PASS (history markup structure/classes preserved; per-view empty-state copy preserved, including minimal-row `No history yet.` and card/popout detailed empty text).
- Scope control: PASS (single cohesive frontend seam via `buildTrackerHistoryMarkup(item, emptyText?)`; no backend/IPC/event-contract changes).
- Test quality/coverage: PASS (focused tests cover default/custom empty states and populated history rendering with unseen class, links, and suggestions).
- Regression risk: LOW (refactor-only extraction of duplicated markup; full suite passes at 302/302).

**Validation:**
- `node --test test/renderer-tracking-renderers.test.js` passed.
- `npm test` passed (302 passed, 0 failed).

**Non-blocking follow-up:** add one renderer integration test that exercises `renderPopoutMode()` history output to complement primitive-level unit tests.

**Source:** `.squad/decisions/inbox/merlin-ticket3-slice1-review.md`

---

## DEC-026: Branch Merge Hold Directive

**Author:** the project owner (via Copilot) | **Date:** 2026-03-03 | **Status:** Active

**Summary:** Do not merge the current branch until the project owner provides explicit approval.

**Key decisions:**
- Branch merge is blocked pending explicit user authorization.
- Directive remains in force across this maintainability review round.

**Source:** `.squad/decisions/inbox/copilot-directive-2026-03-03T22-20-00Z.md`

---

## DEC-027: Ticket 5 Orchestration Coverage + Follow-ups Completion

**Author:** Merlin (Tester) | **Date:** 2026-03-03 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Completed Ticket 5 orchestration coverage parity slice and both non-blocking follow-up tests with test-only changes.

**Key decisions:**
- Added preload invalid-callback guard coverage for `onStateChanged` and `onNotificationClicked`.
- Added desktop notification orchestration test for click relay + main window focus behavior.
- Added tracker-state fanout no-op coverage when main window is destroyed and no popouts exist.
- Added renderer integration coverage for `renderPopoutMode()` history output path.
- Updated explicit `npm test` file list in `package.json` for test parity.

**Validation:**
- Targeted tests passed: `node --test test/main-ipc-tracker-popout.test.js test/main-ipc-handlers.test.js test/renderer-popout.test.js`.
- Full suite passed: `npm test` (306 passed, 0 failed).

**Source:** `.squad/decisions/inbox/merlin-ticket5-and-followups.md`

---

## DEC-028: Lead Gate Approval — Ticket 5 + Follow-ups

**Author:** Maverick (Lead Reviewer) | **Date:** 2026-03-03 | **Status:** Approved | **Requested by:** the project owner

**Summary:** Lead review gate for Ticket 5 and its follow-ups completed with outcome **APPROVE**.

**Checklist outcome:**
- Scope integrity: PASS (test-focused, no unnecessary production edits).
- Coverage intent: PASS (Ticket 5 orchestration + both follow-up tests completed).
- Risk posture: LOW (targeted and full test runs passing).
- Branch safety directive: ENFORCED (explicit approval required before merge).

**Source:** `.squad/decisions/inbox/maverick-ticket5-review.md`

---

## DEC-029: Dual-Source Evidence Link Extraction — SUPPLEMENT Architecture

**Author:** Maverick (Lead), with supporting analysis from Goose (Frontend) and Viper (Backend) | **Date:** 2026-03-05 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Extract inline markdown citations (`[label](url)`) from AI-generated `summary`/`reason` fields as supplementary evidence links, merged with the structured `evidenceLinks` array. The AI inconsistently populates `evidenceLinks` but naturally embeds inline citations — the SUPPLEMENT approach captures both sources.

**Approach chosen:** SUPPLEMENT (extract inline + keep structured array) over Replace (drop structured array) and Keep current (structured only).

**Key decisions:**
- **Order of operations (critical):** Extract inline citations from raw text BEFORE `cleanDisplayText()` strips markdown links. Then normalize structured `evidenceLinks`. Then merge/dedup by URL. Then clean display text.
- **Structured links have priority:** When the same URL appears in both structured `evidenceLinks` and inline text, the structured version wins (preserves `signalAt` metadata and typed labels).
- **New utility `extractInlineCitations(text)`:** Located in `src/renderer/utils.js` alongside existing URL-processing family. Reuses `normalizeExternalUrl`, `isHallucinatedUrl`, `isGenericUrl`, `isDeepLink`, `inferSignalTypeFromUrl`, `compactLinkLabel`. Returns `Array<{label, type, url}>` (no `signalAt` — not available from inline text).
- **Three integration points:** `applyRadarPayload()` (primary), `normalizeTrackingItem()` (secondary), `monitorTaskItem()` (secondary). Ledger entries deferred.
- **Prompt relaxation:** Removed "Do NOT embed citation links" prohibition. Structured `evidenceLinks` remain the preferred/requested format.
- **No renderer changes:** All renderers already consume `item.evidenceLinks`. Extracted inline links flow through naturally.
- **`cleanDisplayText()` unchanged:** Still strips markdown links for display — correct behavior since extraction happens before cleaning.
- **JSON parsing safe:** All markdown link characters (`[`, `]`, `(`, `)`) are legal in JSON strings. `sanitizeLikelyBrokenJson()`, `normalizeJsonCandidate()`, `parseJsonWithRepair()` all unaffected.
- **Three-layer citation defense:** Structured `evidenceLinks` (primary), inline extraction (new supplement), footnote injection via `extractFootnoteCitations()` (existing fallback for text outside JSON).

**Sources:** `.squad/decisions/inbox/maverick-link-extraction-arch.md`, `.squad/decisions/inbox/goose-link-extraction-frontend.md`, `.squad/decisions/inbox/viper-link-extraction-parsing.md`

---

## DEC-030: Inline Citation Extraction — Implementation

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-05 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Implemented the dual-source evidence extraction architecture (DEC-029). Inline markdown citations in AI-generated `summary`/`reason` fields are now extracted before `cleanDisplayText()` strips them, and merged into `evidenceLinks` with URL-based deduplication.

**Changes:**
1. **`src/renderer/utils.js`** — Added `extractInlineCitations(text)` near `extractExternalUrls()`. Reuses existing validators. Returns `Array<{label, type, url}>`, deduplicates by normalized URL.
2. **`src/renderer/models/radar.js`** — `applyRadarPayload()` extracts inline citations from raw `item.summary`/`item.reason` BEFORE `cleanDisplayText()`. Structured `evidenceLinks` take priority, inline links fill gaps via `seenUrls` Set dedup.
3. **`src/renderer/models/tracking.js`** — `normalizeTrackingItem()` applies same extract-before-clean pattern. Inline links merged after structured `.map(normalizeEvidenceLink)` links.
4. **`src/renderer/monitor-engine.js`** — `monitorTaskItem()` extracts inline links from `payload.summary`/`payload.reason`, appends to `curatedLinks` with `seenUrls` dedup.
5. **`src/renderer/constants.js`** — Changed from "Do NOT embed citation links" to permissive language.
6. **`src/renderer/prompts.js`** — Same prompt relaxation in monitoring prompt.

**Validation:** All 338 tests pass (0 failures). 15 new tests added by Merlin (11 utils + 4 radar model).

**Source:** `.squad/decisions/inbox/goose-inline-impl.md`

---

## DEC-031: Preload Sandbox Fix — Inline IPC Constants

**Author:** Viper (Backend Dev) | **Date:** 2026-03-03 | **Status:** Implemented

**Summary:** Fixed preload load failure caused by `require('./shared/ipc-contract')` failing in Electron's sandboxed preload context. Inlined IPC channel string constants directly in `src/preload.js`.

**Key decisions:**
- Removed local `require('./shared/ipc-contract')` from preload — module resolution unreliable in sandboxed context.
- Inlined `IPC_CHANNELS` with unchanged channel string values.
- All exposed `window.workiq` methods/listeners and invoke/send/on wiring unchanged.
- Minimal, focused change limited to preload startup path.

**Validation:** Targeted IPC tests passed (9/9). Full suite passed (306/306 at time of fix).

**Impact:** Preload now initializes without module resolution failure, preventing false WorkIQ-unavailable state in renderer.

**Source:** `.squad/decisions/inbox/viper-preload-sandbox-fix.md`

---

## DEC-032: Persistent Prompt Storage via localStorage

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-06 | **Status:** Implemented

**Summary:** User-edited radar, briefing, and day-briefing prompts are now persisted to localStorage under the `flightdeck.prompt.<name>` key prefix. On app reload, `loadPromptFiles()` checks localStorage first; if a custom prompt exists it is used instead of the on-disk default. The "Reset to Default" button clears the localStorage entry and reloads from disk.

**Key decisions:**
- Storage key prefix: `PROMPT_STORAGE_PREFIX = 'flightdeck.prompt.'` in `constants.js`, following the existing `STORAGE_KEY = 'flightdeck.persisted.v2'` naming convention.
- Three helper functions (`saveCustomPrompt`, `loadCustomPrompt`, `clearCustomPrompt`) with try/catch safety, matching `savePersistentState`/`loadPersistentState` patterns in `state.js`.
- Disk reads still happen on every load (for fallback and future reset), but localStorage takes priority when populated.
- Day-briefing prompt is included in persistence even though it has no editor yet — if future code sets `promptCache.dayBriefing` and calls `saveCustomPrompt('dayBriefing', ...)`, it will survive reloads.
- Button labels changed from "Reset to File" → "Reset to Default"; status messages changed from "Reset to file version" → "Reset to default".

**Files changed:** `src/renderer/constants.js`, `src/renderer/prompts.js`, `src/index.html`

**Source:** `.squad/decisions/inbox/goose-persistent-prompts.md`

---

## DEC-033: Triple-Reinforce Inline Citation Instructions in Monitor & Radar Prompts

**Author:** Maverick (Lead) | **Date:** 2026-03-09 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Reinforced inline citation instructions using three placement zones (pre-schema priming, schema field hints, post-schema rules) in both the task monitor prompt and radar scan prompt. The extraction pipeline depends on `[label](url)` inline citations in `summary`/`reason` fields, but a single vague instruction was being deprioritized by the LLM.

**Key decisions:**
- Three-zone reinforcement: prominent `CITATION FORMAT (CRITICAL)` block before schema, "MUST contain [label](url) inline citations" in schema field descriptions, and rewritten post-schema evidence link rules with good/bad examples.
- Applied to both `buildTaskMonitorPrompt()` in `renderer/prompts.js` and `RADAR_SCAN_JSON_SCHEMA` in `renderer/constants.js` + `prompts/radar-scan.md`.
- No `url` field added back to `evidenceLinks` schema (leads to hallucination — prior decision).
- No extraction pipeline code changes — existing `extractInlineCitations()` → `adoptStructuredLabels()` flow works correctly when citations are produced.
- No URL validation changes (`isGenericUrl`, `isHallucinatedUrl`, `isDeepLink` unchanged).

**Files modified:** `src/renderer/prompts.js`, `src/renderer/constants.js`, `src/prompts/radar-scan.md`

**Source:** `.squad/decisions/inbox/maverick-evidence-link-prompt.md`

---

## DEC-034: What to Build Next — March 2026 Feature Roadmap

**Author:** Iceman (Product Owner) | **Date:** 2026-03-09 | **Status:** Proposed | **Requested by:** the project owner

**Summary:** Comprehensive roadmap analysis of original P0/P1/P2 features vs. current state. 4 of 15 features shipped, plus significant infrastructure. Top 5 recommended next features ranked by effort and ROI.

**Current scorecard:** P0: 2/5 done (Action Drafts, Day Briefing), 1 partial (Command Bar), 2 open (Electron-store, Notifications). P1: 2/5 done (Persistent Prompts, Demo Mode), 3 open. P2: 0/5 done, 2 partial.

**Top 5 recommended (in order):**
1. **Activate Command Bar (P0-4)** — Code is 90% built, flip `commandInput` from `type="hidden"` to `type="text"`. Effort: XS.
2. **Electron-store Migration (P0-2)** — localStorage ceiling risk. Effort: M.
3. **In-App Notification Center (P0-5)** — Desktop notifications fire-and-forget, need in-app tray. Effort: M.
4. **Trend Analytics (P1-2)** — `updateHistory[]` data exists, needs visualization. Effort: M-L.
5. **Stale Item Detection (P1-3)** — Badge + auto-archive for dormant items. Effort: S.

**User stories included** for Rank 1 (Command Bar): US-CMD-01 (activation + UX), US-CMD-02 (demo mode support).

**Source:** `.squad/decisions/inbox/iceman-next-features-march.md`

---

## DEC-035: Tracker Popout Visual Overhaul Direction

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-10 | **Status:** Proposed → Implemented | **Requested by:** the project owner

**Summary:** 12 specific visual improvement recommendations for the tracker popout window, covering spacing, typography, information architecture, monitoring controls, history scanability, and design cohesion with the Apple-inspired system.

**Key design directions:**
- Monitoring controls collapsed by default behind a disclosure toggle.
- Signal filter buttons use monochrome icon-only style instead of colorful labeled pills.
- History entries use two-line scannable format (timestamp + summary).
- Left panel padding increased to 20–24px with section dividers.
- Action bar (Mark Seen / Delete) moved to header row.
- People rendered as chips instead of comma-separated text.

**Impact:** All changes are CSS + popout HTML template only — no state, model, or IPC changes. Test suite unaffected (429/429 pass). Scoped to `.tracker-card--popout` / `.popout-*` classes.

**Files modified:** `src/styles/tracking.css`, `src/renderer/popout.js`

**Source:** `.squad/decisions/inbox/goose-popout-ui-review.md`

---

## DEC-036: Popout Monitoring Section Uses Shared Toggle Pattern

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-10 | **Status:** Implemented

**Summary:** The popout's Monitoring controls section now uses the same `tracker-section-toggle` + `tracker-section-panel` pattern (with `handleSectionToggleClick`) already used by People, Links, and History sections. The panel is collapsed by default — unlike People and Links which start expanded.

**Key decisions:**
- Toggle button shows a one-line summary (`Every 30m · 4 signals` or `Scheduled · 3 signals` or `Disabled`) so users see monitoring status at a glance without expanding.
- New data attribute pair (`data-monitoring-toggle-id` / `data-monitoring-panel-id`) follows existing convention.
- Collapsed-by-default is intentional — monitoring controls are configuration, not content.

**Impact:** `src/renderer/popout.js` — template + click handler. `src/styles/tracking.css` — `.popout-monitor-summary` styling. Main window tracking cards not affected.

**Source:** `.squad/decisions/inbox/goose-popout-impl.md`

---

## DEC-037: OneDrive Context File IPC Channels

**Author:** Viper (Backend Dev) | **Date:** 2026-03-06 | **Status:** Implemented

**Summary:** Added two IPC channels (`write-context-file`, `get-context-file-path`) to write a `context.md` file to the user's corporate OneDrive (`%OneDriveCommercial%\FlightInfo\context.md`) so external tools can read FlightDeck state as ambient context.

**Key decisions:**
- `OneDriveCommercial` env var used (corporate/M365-linked OneDrive, not personal `OneDrive`).
- `FlightInfo/` subdirectory provides clean namespace under OneDrive root.
- Structured return values (`{ success, path }` / `{ success, error }`) follow established IPC handler pattern.
- `mkdirSync({ recursive: true })` before every write — safe and idempotent.
- `null` return on missing env var for `GET_CONTEXT_FILE_PATH` (easier to gate on than catching errors).

**Files changed:** `src/shared/ipc-contract.js`, `src/main/ipc-handlers.js`, `src/preload.js`.

**Validation:** 430/430 tests pass.

**Source:** `.squad/decisions/inbox/viper-context-file-ipc.md`

---

## DEC-038: OneDrive Context File Frontend Integration

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-12 | **Status:** Implemented

**Summary:** Frontend integration for OneDrive context file sync. Five sub-decisions covering radar merge strategy, module-level path cache, fire-and-forget sync pattern, script tag positioning, and test state resets.

**Key decisions:**
- **Radar merge replaces replace-all:** `applyRadarPayload()` now preserves existing items and only appends truly new IDs, so cards don't disappear between scans.
- **Module-level path cache:** `_contextFilePath` cached by `initContextFilePath()` at startup; synchronous accessor for use in prompt construction.
- **Fire-and-forget sync:** All `syncContextFile()` call sites are non-awaited. Failures are non-critical (context file is advisory).
- **Script tag position:** `context-file.js` loaded after `state.js` and before `prompts.js`.
- **Test resets:** `beforeEach` added to radar tests to clear merge-accumulating state.

**Source:** `.squad/decisions/inbox/goose-context-file-frontend.md`

---

## DEC-039: OneDrive Context File Tests

**Author:** Merlin (Tester) | **Date:** 2026-03-12 | **Status:** Proposed

**Summary:** Test coverage for OneDrive context file feature. Two new test files (17 tests total) plus 4 new radar merge tests in existing file. 451 tests total, 450 passing, 1 intentional TDD red.

**Key decisions:**
- `test/renderer-models-context-file.test.js` (11 tests) — fresh vm context per test due to module-level mutable state.
- `test/main-ipc-context-file.test.js` (6 tests) — real `os.tmpdir()` for filesystem writes, env var save/restore.
- Radar merge behavior tests (4 tests) in `renderer-models-radar.test.js` — 1 intentional failure documenting dismissed-item tracking gap.
- Convention established: fresh context per test for modules with module-level mutable state; real fs with tmpdir for IPC handler tests.

**Source:** `.squad/decisions/inbox/merlin-context-file-tests.md`

---

## DEC-040: Dismissed Radar Items No Longer Reappear

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-12 | **Status:** Implemented

**Summary:** Fixed dismissed radar items reappearing on next scan. Added `state.seenRadarIds` Set in `applyRadarPayload()` that tracks every item ID ever appended, so dismissed items (removed from `radarItems`) are still filtered out on subsequent scans.

**Key decisions:**
- Used `seenRadarIds` (ever-seen) over `dismissedRadarIds` — works regardless of how removal happened (direct mutation or `dismissRadarItem()`).
- `seenRadarIds` is in-memory only (not persisted). Dismissed items could reappear after app restart — restart-persistence is a separate concern.
- Set grows unboundedly but with negligible memory pressure (~15 char IDs).

**Validation:** 451/451 tests pass. Previously failing TDD red now passes.

**Source:** `.squad/decisions/inbox/goose-dismissed-radar-fix.md`

---

## DEC-041: Revert Lifecycle Model & Bulk Selection

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-10 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Removed Phase 3 lifecycle state machine and bulk selection features while preserving Phase 1 (origin indicators) and Phase 2 (visual polish). The lifecycle model added complexity that wasn't essential to the core tracking workflow.

**Removed:** `LIFECYCLE_STATES` enum, lifecycle transition logic, filter tabs, bulk actions bar, 8 lifecycle/bulk functions, related state fields, DOM elements, and CSS.

**Preserved:** Origin pills (custom/imported badges), typography hierarchy, spacing, `has-new-update` badges, mark-as-seen functionality.

**Validation:** 369 tests pass after removal.

**Source:** `.squad/decisions/inbox/goose-lifecycle-revert.md`

---

## DEC-042: Tracking Item Inline Editing

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-12 | **Status:** Implemented

**Summary:** Click-to-edit inline editing for title, due date, and owner fields on tracked items. Editable fields show dashed underline on hover; clicking activates input mode. Save on blur/Enter, cancel on Escape.

**Key decisions:**
- Model: `updateTrackingItemField(itemId, field, value)` in `models/tracking.js` — single-field update + persist.
- View: `.editable-field` spans with `.edit-field-btn` pencil icon in both card and row views.
- Events: delegation on `elements.trackingList` via `activateInlineEdit(span, field, itemId)`.
- Input types: text for title/owner, native date picker for due date.
- No undo mechanism yet — edits save immediately.
- Popout window excluded (separate concern).

**Validation:** 430 tests pass.

**Source:** `.squad/decisions/inbox/goose-inline-editing.md`

---

## DEC-043: Remove Origin Tags from Tracking Cards

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-12 | **Status:** Implemented | **Requested by:** the project owner

**Summary:** Removed origin tags (Custom/Imported badges) from tracking card headers — unnecessary clutter. Removed origin badge rendering, `ORIGIN_LABELS` constant, and `.origin-pill` CSS styles. The `origin` field remains in tracking item data for potential future use.

**Source:** `.squad/decisions/inbox/goose-remove-origin-tags.md`

---

## DEC-044: README Professional Rewrite

**Author:** Iceman (Product Owner) | **Date:** 2026-03-16 | **Status:** Implemented | **Requested by:** Kyle Poineal

**Summary:** Rewrote README.md from functional-but-rough project doc into polished professional open-source README. Updated `package.json` description to "Air traffic control for your Microsoft 365 workload."

**Key decisions:**
- Centered logo + shield badges header (License, Node 18+, Electron 35+, build status, Changelog).
- Elevator pitch over verbose Problem/Solution sections.
- GitHub markdown features: callout blocks, collapsible `<details>`, clean tables, anchor-linked TOC.
- Electron version corrected from "33+" to "35+" to match `package.json`.
- Contributing section added linking to CONTRIBUTING.md.

**Source:** `.squad/decisions/inbox/iceman-readme-polish.md`

---

## DEC-045: Logging Architecture — electron-log with Decorator Pattern

**Author:** Maverick (Lead) | **Date:** 2026-03-17 | **Status:** Proposed | **Requested by:** Kyle Poineal

**Summary:** Proposed logging architecture for FlightDeck using `electron-log` with a thin `src/main/logger.js` wrapper module. Replaces console-only logging with persistent file output at `{userData}/logs/`. Introduces `handleWithLogging` decorator for IPC handlers and whitelist-only PII redaction.

**Key decisions:**
- **Library:** electron-log v5 chosen over winston (overkill), custom fs.appendFile (maintenance burden), pino (no Electron awareness). ~15KB, auto-detects `userData/logs/`, handles file rotation.
- **Architecture:** New `logger.js` at bottom of dependency tree (zero internal imports). Exports `log`/`logError`/`logIpc`. `utils.js` delegates to logger for backward compat.
- **IPC logging:** `handleWithLogging(channel, handler)` decorator wraps `ipcMain.handle` with `summarizeArgs`/`summarizeResult` per channel. Handler bodies untouched.
- **Redaction (whitelist-only):** Log channel names, lengths, exit codes, PIDs, timing. NEVER log raw prompts/responses, store values, external URLs, notification body text, markdown preview content.
- **Log format:** `[timestamp] [level] [scope] channel → direction { summary }` with `[ipc]`, `[pty]`, `[app]` scope tags.
- **Rotation:** 1 MB max (electron-log default), `main.log` + `main.old.log` (~2 MB max disk). No remote shipping.
- **Implementation plan:** 4 sequential PRs (Viper) + 1 parallel test PR (Merlin).

**Source:** `.squad/decisions/inbox/maverick-logging-architecture.md`

---

## DEC-046: Logging Integration Point Catalog

**Author:** Viper (Backend Dev) | **Date:** 2026-03-17 | **Status:** Assessment | **Requested by:** Kyle Poineal

**Summary:** Full catalog of all backend I/O points for structured logging. 16 IPC channels, 2 PTY spawn sites, 3 file I/O paths, external process spawns, and existing logging state assessed.

**Key findings:**
- **6 PII-sensitive channels:** ASK_WORKIQ, OPEN_MARKDOWN_WINDOW, SHOW_DESKTOP_NOTIFICATION, STORE_GET, STORE_SET/GET_ALL/MIGRATE (persisted state contains names, email subjects, task descriptions).
- **PTY concern:** `process.env` spread into PTY spawn could leak env vars. PTY bridge currently logs full raw WorkIQ output to console — must be redacted in file logger.
- **Existing logging:** `console.log`/`console.error` only, no file output, no log levels, no structured format. Lost when app closes.
- **3-tier sensitivity classification:** High (never log content), Medium (log with care), Safe (log freely). Aligns with Maverick's whitelist-only redaction approach (DEC-045).

**Source:** `.squad/decisions/inbox/viper-logging-integration-points.md`

---

## DEC-047: Always-Visible Updated Timestamp Bar on Tracker Cards

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-17 | **Status:** Implemented | **Requested by:** Kyle Poineal

**Summary:** The "Updated:" timestamp bar on tracker cards/rows now shows whenever `item.lastRunAt` exists, regardless of seen/unseen state. Previously it only appeared when `hasNew` was true.

**Key decisions:**
- Green (`.tracker-updated-at--new`) for unseen items — keeps existing success color + pulse animation.
- Neutral (`.tracker-updated-at`) for seen items — muted text, subtle background, card-border left stripe, no animation.
- Moved above the title in card view so it's the first thing visible inside `card-body`.
- Added to popout view which previously had no Updated bar at all.

**Files changed:** `src/styles/tracking.css`, `src/renderer/renderers/tracking.js`, `src/renderer/popout.js`

**Source:** `.squad/decisions/inbox/goose-updated-bar-always-visible.md`

---

## DEC-048: Repository Protection Plan

**Author:** Jester (DevOps) + Maverick (Lead) | **Date:** 2026-03-18 | **Status:** Phase 1 Implemented, Phase 2-3 Proposed | **Requested by:** Kyle Poineal

**Summary:** Comprehensive repo protection strategy for FlightDeck as an open source project. Phased approach based on threat model analysis.

**Phase 1 (Implemented):**
- LICENSE file (MIT) added.
- SECURITY.md with vulnerability reporting via GitHub Security Advisories.
- `node-pty` pinned to exact version `1.1.0` (removed `^` — critical native module).

**Phase 2 (Recommended):** `npm audit --audit-level=high` in CI, Dependabot, CODEOWNERS, 1 review on PRs, PR/issue templates, protected tags, secret scanning.

**Phase 3 (Nice-to-Have):** CodeQL/code scanning, linter in CI, DCO/CLA, signed commits.

**Key threat model finding:** `node-pty` is #1 threat vector — native C++ module that spawns shells. All 430 tests pass after Phase 1 changes.

**Source:** `.squad/decisions/inbox/jester-repo-protection-plan.md`, `.squad/decisions/inbox/jester-repo-protection-implemented.md`

---

## DEC-049: FlightDeck Versioning Strategy

**Author:** Kyle Poineal + Jester (DevOps) | **Date:** 2026-03-18 | **Status:** Active

**Summary:** Two-channel versioning for FlightDeck releases.

**Channels:**
- **Release** (stable): `X.Y.0` — minor version bumped manually via `npm version minor`. Tagged `vX.Y.0`. Built by `release.yml`. GitHub Release marked as Latest.
- **Incremental** (pre-release): `X.Y.{run_number}` — patch auto-set to `github.run_number` in CI. Tagged `vX.Y.N`. Built by `incremental.yml` on schedule (weekday 6AM UTC) or manual dispatch. GitHub Release marked as Pre-release.

**Key decisions:**
- `package.json` version is source of truth for major.minor only. Patch versions are ephemeral, set in CI.
- Incremental releases auto-cleanup after 14 days.
- Both channels code-signed via Azure Trusted Signing.
- MSI-compatible (3-part numeric versions throughout).

**Source:** `.squad/decisions/inbox/jester-versioning-strategy.md`

---

## DEC-050: Branch Protection Guide for `main`

**Author:** Maverick (Lead) | **Date:** 2026-03-18 | **Status:** Reference | **Requested by:** Kyle Poineal

**Summary:** Step-by-step guide to enable branch protection on `main` via GitHub Settings, enforcing DEC-013 at the platform level.

**Key settings:** Require PR before merging (1 approval, dismiss stale), require status checks (`CI / test`), require branches to be up to date, require linear history, no force pushes, no deletions. Optional bypass for repo admin for emergency hotfixes.

**Source:** `.squad/decisions/inbox/maverick-branch-protection-guide.md`

---

## DEC-051: Feature Review — Sparkline, Multiple Scanners, Todos

**Author:** Iceman (Product Owner) | **Date:** 2026-03-19 | **Status:** Proposal — awaiting Kyle's prioritization | **Requested by:** Kyle Poineal

**Summary:** Product analysis of three proposed features with value assessment, risk analysis, and strategic fit.

**Priority recommendations:**
| Priority | Feature | Rationale |
|----------|---------|-----------|
| **P0** | Sparkline/Timeline | Lowest effort, highest signal-to-noise improvement, data already exists, no state model changes |
| **P1** | Multiple Radar Scanners | High value but significant architecture investment — state model, prompt system, UX all change |
| **P2** | Todo Functionality | Moderate value, high scope creep risk — scope as "tracking completion" not "todo app" |

**Key insights:**
- Sparkline: `updateHistory[]` data already exists. Pure rendering problem (SVG or canvas). Perfect strategic fit.
- Multiple Scanners: Transforms FlightDeck from single-lens to multi-lens work radar. Persistent cards blur Radar/Tracking boundary — design clarity needed.
- Todos: Tracking system is 80% there. Frame as "Tracking Item Completion" — add `completed` state, quick-add, filter. Do NOT build projects, subtasks, or recurring todos in v1.

**Source:** `.squad/decisions/inbox/iceman-feature-review.md`

---

## DEC-052: Feature Feasibility Assessment — Architecture Analysis

**Author:** Maverick (Lead) | **Date:** 2026-03-19 | **Status:** Assessment — pending Kyle's prioritization | **Requested by:** Kyle Poineal

**Summary:** Technical architecture feasibility for three proposed features against the post-refactoring codebase.

**Verdicts:**
- **Multiple Scanners:** HIGH value, MEDIUM complexity. Touches ~7 files. `state.radarItems` → `state.scanners[]`. New `Scanner` model + CRUD. N× WorkIQ calls per refresh. IPC unchanged if renderer-managed.
- **Todos:** LOW-MEDIUM complexity. Tracking system is 80% of a todo system. Add `completed`/`completedAt` fields, quick-add input, completion filter. Keep in Tracking tab — do NOT create separate Todo tab.
- **Sparkline:** LOW-MEDIUM complexity. Data exists in `updateHistory[]` (timestamps + severity). New `buildSparklineHtml(item)` in tracking renderer. Pure SVG, no library. Minimum threshold: show when `updateHistory.length >= 3`.

**Cross-feature dependencies:** All three are independent. Refactoring (DEC-001, DEC-004) significantly helps — modular files vs. monolith.

**Priority divergence from Iceman:** Maverick recommends Todo → Sparkline → Scanners (by complexity). Iceman recommends Sparkline → Scanners → Todos (by strategic value).

**Source:** `.squad/decisions/inbox/maverick-feature-feasibility.md`

---

## DEC-053: Tasks Feature — Technical Architecture Proposal

**Author:** Maverick (Lead) | **Date:** 2026-03-20 | **Status:** Proposed (brainstorm — no code) | **Requested by:** Kyle Poineal

**Summary:** Architecture proposal for a Tasks feature — user-committable actions derived from AI suggestions or manually created.

**Key decisions:**
- Separate `state.tasks = []` top-level array (NOT embedded in trackingItems). Independent lifecycle from trackers.
- Task shape: `id`, `title`, `trackerId` (FK, nullable), `sourceStepText`, `dedupKey`, `status` (open|done|dismissed), `origin` (suggested|manual), `notes`. No severity, no dueAt.
- 3-state lifecycle only (open → done, open → dismissed). No FSM complexity per DEC-041 lesson.
- Deduplication via normalized keyword fingerprint: lowercase → strip stopwords → sort tokens → FNV-1a hash.
- `suggestedNextSteps` remain ephemeral hints. Tasks are commitments — different data, different lifecycle.

**Source:** `.squad/decisions/inbox/maverick-tasks-architecture.md`

---

## DEC-054: LLM-Driven Tasks — Product Specification

**Author:** Iceman (Product Owner) | **Date:** 2026-03-20 | **Status:** Proposal — awaiting approval | **Requested by:** Kyle Poineal

**Summary:** Product spec for opt-in AI-powered task creation during scans and monitor updates.

**Key decisions:**
- LLM returns a separate `tasks` array (NOT derived from `suggestedNextSteps`). Each task has `title`, `trackerId`, `reason`, `confidence`.
- Global opt-in toggle (`state.aiTasksEnabled`, default OFF). No per-tracker toggle.
- Guardrails: max 3 tasks/radar scan, max 2 tasks/monitor update, dedup against open tasks, confidence threshold medium+.
- Tasks appear directly with `origin: 'ai'` badge — no confirmation dialog. Dismiss = one click.
- Coexists with manual promotion flow (`[+ Task]` buttons on suggestedNextSteps).

**Source:** `.squad/decisions/inbox/iceman-llm-tasks-product-spec.md`

---

## DEC-055: Multi-Scanner Radar — Feature Specification

**Author:** Iceman (Product Owner) | **Date:** 2026-03-24 | **Status:** Proposed — Feature Specification | **Requested by:** Kyle Poineal

**Summary:** Radar becomes multi-prompt with persistent inbox. Users define N scanners, each with custom prompt, schedule, and exclusion list. All scanners feed into existing radar view.

**Key decisions:**
- Scanner 0 = existing broad radar scan (always present, long cadence). User scanners 1..N = focused, frequent checks.
- Radar becomes inbox — items persist until Track (→ tracker card) or Dismiss (→ per-scanner exclusion list).
- Per-scanner exclusions: dismissing from one scanner doesn't affect others.
- Schedule reuses `computeNextRunAt()` from tracking. `{lastRunAt}` placeholder in prompt for time anchoring.
- Scanner config shape: `id`, `name`, `prompt`, `enabled`, `scheduleType`, `weeklyDays`, `weeklyTimes`, `excludedItemIds`, `lastRunAt`, `nextRunAt`, `maxInboxItems`.
- 3-layer dedup: prompt-level (existing titles fed back), engine-level (evidence URL matching), UI-level (dismiss list).

**Source:** `.squad/decisions/inbox/iceman-multi-scanner-spec.md`

---

## DEC-056: Multi-Scanner Radar Backend Implementation

**Author:** Viper (Backend Dev) | **Date:** 2026-03-24 | **Status:** Implemented | **Requested by:** Kyle Poineal

**Summary:** Full backend/model layer for multi-scanner radar per DEC-055.

**Key decisions:**
- `state.radarItems` now persisted (breaking change from DEC-010). Required for scanner inbox persistence.
- Schedule reuse: `computeScannerNextRunAt()` wraps `computeNextRunAt()` via adapter object.
- Scanner results append to `state.radarItems` (inbox accumulation). Existing `applyRadarPayload()` still replaces (backward compat for Scanner 0).
- `scannerId` tag on every scanner-produced radar item for UI grouping.
- Two-layer dedup: prompt-level (feed existing titles back) + engine-level (evidence URL matching).
- `normalizeRadarItemFromScanner` mirrors `applyRadarPayload` mapping including inline citation extraction.

**Files:** `src/renderer/models/scanner.js`, `src/renderer/scanner-engine.js`, `src/prompts/scanner-template.md` (created). `src/renderer/constants.js`, `src/renderer/state.js`, `src/renderer/prompts.js`, `src/renderer/models/radar.js` (modified).

**Source:** `.squad/decisions/inbox/viper-multi-scanner-backend.md`

---

## DEC-057: Monitor Badge Visibility Enhancement

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-24 | **Status:** Implemented

**Summary:** Upgraded `.monitor-badge` from a bare floating icon (opacity 0.6) to a frosted-glass pill with translucent blue background, border, soft glow, and full opacity. z-index bumped to 2 to layer above "NEW" badge.

**Why:** Monitor indicator was too hard to see alongside the green "NEW" badge pill. New style uses accent-blue tones consistent with existing pill design language.

**Source:** `.squad/decisions/inbox/goose-monitor-badge-visibility.md`

---

## DEC-058: Monitor Prompt Restructuring

**Author:** Charlie (Prompt Engineer) | **Date:** 2026-03-25 | **Status:** Implemented | **Requested by:** Kyle Poineal

**Summary:** Restructured `buildTaskMonitorPrompt()` to reduce token waste and elevate monitoring context visibility.

**Key changes:**
- User's monitoring instructions moved from buried metadata bullet to dedicated `--- MONITORING CONTEXT ---` section.
- Procedure steps renamed from "Monitoring instructions:" to "Analysis procedure:" to fix label collision.
- Consolidated overlapping content (8→5 procedure steps). ~25% token reduction.
- Tightened rule sections: due date (5→2), evidence (3→2), hasNewInfo (6→4), next steps (4→2).

**Impact:** 481 tests pass. No schema, function signature, or external API changes.

**Source:** `.squad/decisions/inbox/charlie-monitor-prompt-opt.md`

---

## DEC-059: Move to Scanner — Data Model Convention

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-26 | **Status:** Implemented

**Summary:** Items can be moved between Radar and Scanners from the card Monitor tab. `item.scannerId` is single source of truth: `null` = Radar, non-null = scanner ID.

**Key decisions:**
- `moveItemToScanner()` eagerly adjusts `scanner.itemCount` on source and target for immediate UI consistency (scanner-engine recomputes on next cycle).
- UI: "Source" dropdown at top of Monitor tab panel listing Radar + all scanners.
- `groupItemsBySource()` in `renderers/radar.js` partitions by `scannerId` — no rendering logic changes needed.

**Source:** `.squad/decisions/inbox/goose-move-to-scanner.md`

---

## DEC-060: PII Scrub — Test Fixtures

**Author:** Merlin (Tester) | **Date:** 2026-03-26 | **Status:** Implemented

**Summary:** Replaced real person/company names in `test/renderer-utils.test.js` with generic test data (Contoso, datacenter migration, weekly sync). All test logic preserved; 481 tests pass.

**Why:** Test files are committed to source control and must never contain real customer names, employee names, or client identifiers.

**Source:** `.squad/decisions/inbox/merlin-pii-scrub.md`

---

## DEC-061: Unified Radar + Tracker Consolidation

**Author:** Project Owner (via Copilot) | **Date:** 2026-03-26 | **Status:** Directive — captured for team memory

**Summary:** Merge Radar and Tracking into a single unified pane with one card type (tracking-quality cards). Scanner results render as full cards with monitoring OFF by default. No separate Tracking pane.

**Key decisions:**
- Filter bar replaces mode switching: All | Monitored | New | Due Today | Blocked | Archived.
- Items grouped by scanner, with null-scanner items under "Radar" section.
- Migration: merge `state.radarItems` + `state.trackingItems` into `state.items`, deduplicate by ID (prefer tracking version).
- Existing tracked items appear under Radar heading — zero visual disruption for current users.

**Source:** `.squad/decisions/inbox/coordinator-unified-radar-tracker.md`

---

## DEC-062: Incremental DOM Patching for Monitor Refresh

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-26 | **Status:** Implemented

**Summary:** Monitor engine refresh cycles now use targeted single-item DOM patching instead of full `innerHTML` rebuilds. Full re-renders reserved for structural changes only.

**Key decisions:**
- New `patchSingleItem(itemId)` in `renderers/radar.js` — replaces only the changed item's DOM node, preserving all other DOM state (scroll, expanded panels, active tabs).
- Monitor engine calls `patchSingleItem(item.id)` + `renderKpis()` per item instead of `renderTrackingMode()`.
- `.no-transition` CSS class suppresses transition/animation replay during both incremental patches and full rebuilds.
- `renderRadarList()` adds `.no-transition` during full innerHTML rebuilds and removes after `requestAnimationFrame`.

**Impact:** Background monitor refreshes invisible to user unless data changed. 446 tests pass.

**Source:** `.squad/decisions/inbox/goose-fix-screen-flicker.md`

---

## DEC-063: Unify Radar as "Just Another Scanner"

**Author:** Maverick (Lead) | **Date:** 2026-04-02 | **Status:** Proposed | **Requested by:** Kyle

**Summary:** Radar is currently a protected, undeletable first-class construct enforced by seven reinforcing mechanisms: hardcoded `RADAR_SCANNER_ID` constant, `isDefault` flag with delete/update guards, auto-recreation on load (`ensureDefaultRadarScanner`), UI suppression of delete button, event handler guards, separate prompt pipeline (`buildRadarScanPrompt` / `promptCache.radarScan`), and rendering special-casing (icon, sort order, orphan assignment). Kyle wants radar to be "just another scanner" — deletable, editable, governed by the same rules as user-created scanners.

**Proposed four-phase plan:**

| Phase | Scope | Key Changes |
|-------|-------|-------------|
| 1 — Remove undeletable default | `models/scanner.js`, `state.js`, `constants.js` | Remove `isDefault` guard from `deleteScanner()`/`updateScanner()`, remove `ensureDefaultRadarScanner()`/`getDefaultRadarScanner()`, remove `RADAR_SCANNER_ID`, handle orphaned items |
| 2 — Unify execution path | `scanner-engine.js`, `prompts.js` | Remove `if (scanner.isDefault)` branch — all scanners use `buildScannerPrompt()`. Radar prompt content becomes default pre-filled `.prompt` field |
| 3 — Unify UI | `renderers/radar.js`, `events.js` | Remove all `isDefaultRadar` conditionals, always show delete/edit, remove special prompt reset, unify icons |
| 4 — First-run seed | `state.js` or `app.js` | On first launch, create "Radar" scanner with radar-scan.md prompt pre-filled, but fully deletable/editable |

**Risks:** Orphaned items (items whose `scannerId` points to deleted scanner) need a fallback strategy — either "Unassigned" section or re-assign on deletion confirmation.

**Source:** `.squad/decisions/inbox/maverick-radar-unification.md`

---

## DEC-064: Architecture Docs Updated to Reflect Current Codebase

**Author:** Maverick (Lead) | **Date:** 2026-04-14 | **Status:** Implemented

**Summary:** Updated `docs/architecture.md` and `docs/architecture-diagrams.md` to accurately document the current modular structure. Key additions: scanner system, electron-store persistence, shared IPC contract, unified item model, expanded IPC channel table (20 channels), demo mode, test architecture, styles breakdown, prompt templates catalog.

**Why:** Docs still described the pre-refactor monolithic structure (single renderer.js, localStorage, 9 IPC channels). Developers and agents reading these docs would get an inaccurate picture.

**Source:** `.squad/decisions/inbox/maverick-docs-update.md`

---

## DEC-065: User Guide & README Updated to Scanner-Unified Architecture

**Author:** Goose (Frontend Dev) | **Date:** 2026-04-14 | **Status:** Implemented

**Summary:** Updated `docs/user-guide.md` and `README.md` to accurately reflect the current application: 3 tabs (Radar/Briefings/History), scanner-grouped Radar view, lifecycle statuses, version notifications, and inline filtering. Removed all references to the old separate Tracking tab, donut chart KPIs, and gear icon theme toggle.

**Why:** Documentation was stale — still described 4 tabs, a separate Tracking view, and outdated UI elements. Users and contributors would be confused.

**Source:** `.squad/decisions/inbox/goose-docs-update.md`

---

## DEC-066: No PII Directive (Reinforced)

**Author:** Kyle Poineal (via Copilot) | **Date:** 2026-03-26, reinforced 2026-04-13 | **Status:** Active

**Summary:** Never include any PII or customer/company-identifying information in code, prompts, test fixtures, or documentation. Before any push, PR, or merge, ensure outgoing changes are scrubbed.

**Source:** `.squad/decisions/inbox/copilot-directive-no-pii.md`, `.squad/decisions/inbox/copilot-directive-2026-04-13T10-03-36Z.md`

---

## DEC-067: Scanner Collapsed View UX Redesign

**Author:** Iceman (Product Owner) + Goose (Frontend Dev) | **Date:** 2026-03-27 | **Status:** Implemented

**Summary:** Collapsed scanner headers now surface severity micro-counts, blocked/waiting attention badges, new-item indicators, severity-tinted left borders, and relative last-activity timestamps. Solves six identified problems: information-dead collapsed headers, no severity breakdown per scanner, no status/health signals, uniform visual weight regardless of urgency.

**Key decisions:**
- Computed inside `buildSectionHeader()` from the items array with zero extra DOM operations.
- At-a-glance visibility into scanner state while keeping collapsed view compact (single row).
- Preserves existing header layout (icon + name + count + action buttons) while adding diagnostic data.

**Files:** `src/renderer/renderers/radar.js`, `src/styles/radar.css`

**Source:** `.squad/decisions/inbox/iceman-scanner-ux.md`, `.squad/decisions/inbox/goose-scanner-headers.md`

---

## DEC-068: Interactive Scanner Header Pills

**Author:** Iceman (Product Owner) + Goose (Frontend Dev) | **Date:** 2026-03-27 | **Status:** Implemented

**Summary:** Per-scanner inline filtering via clickable header pills (severity dots, attention badges, "N new" indicator). Single-active toggle model — clicking a pill filters that scanner's items; clicking again clears.

**Key decisions:**
- `state.scannerFilters` is ephemeral (NOT persisted) — session-only.
- Pills carry `data-scanner-filter` and `data-scanner-source-id` attributes — generic handler.
- Pill click handler placed BEFORE header collapse handler with `stopPropagation()`.
- Header pill counts always reflect full (unfiltered) item set.
- Collapsing a scanner clears its inline filter. Global filter changes clear inline filters.
- Active pill visual: solid fill + ring outline + slight scale + clear button (×).

**Files:** `state.js`, `renderers/radar.js`, `events.js`, `styles/radar.css`. All 549 tests pass.

**Source:** `.squad/decisions/inbox/iceman-interactive-pills.md`, `.squad/decisions/inbox/goose-interactive-pills.md`

---

## DEC-069: Add Task UX Options for Scanner-Grouped Radar

**Author:** Iceman (Product Owner) + Goose (Frontend Dev) | **Date:** 2026-03-27 | **Status:** Proposal

**Summary:** Product analysis and technical feasibility of 5 UX patterns for adding items in scanner-grouped Radar: (1) per-scanner "+" button, (2) inline quick-add row, (3) gear menu with "Add Item", (4) floating modal, (5) command bar. Per-scanner "+" button recommended as lowest effort (~15 lines template + ~10 lines event handler), still needs a form target (modal or inline).

**Source:** `.squad/decisions/inbox/iceman-add-task-ux.md`, `.squad/decisions/inbox/goose-add-task-ux-patterns.md`

---

## DEC-070: Cross-Scanner Dedup Prompt Block

**Author:** Charlie (Prompt Engineer) | **Date:** 2026-03-26 | **Status:** Proposed

**Summary:** Add a cross-scanner topic block to `buildScannerPrompt()` telling the AI about other active scanners' focus areas to prevent duplicate cards when scanner domains overlap. Block appended to prompt: `Other active scanners (skip items that clearly belong to another scanner's focus area):` with per-scanner lines. Topic extraction via regex for "Focus specifically on: ..." or fallback to first meaningful line. Capped at 5 other scanners.

**Source:** `.squad/decisions/inbox/charlie-cross-scanner-dedup.md`

---

## DEC-071: DEC-063 Phase 2 — Prompt & Scanner-Engine Unification

**Author:** Charlie (Prompt Engineer) | **Date:** 2026-04-03 | **Status:** Implemented

**Summary:** Removed all radar-specific prompt and execution paths. Every scanner — including the former "default radar" — now flows through `buildScannerPrompt()` and `runScanner()` with full post-processing.

**Key decisions:**
- Dedup-then-append over upsert for all scanners. Simpler, preserves user edits.
- `promptCache.radarScan` eliminated — radar prompt lives as scanner's `.prompt` field.
- Legacy prompt editor bindings removed (DOM already removed in prior PR).

**Files:** `src/renderer/prompts.js`, `src/renderer/scanner-engine.js`

**Source:** `.squad/decisions/inbox/charlie-prompt-unification.md`

---

## DEC-072: Radar Exclusions Bug Fix & New Badge on Completed Items

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-31 | **Status:** Implemented

**Summary:** Two fixes: (1) `buildRadarScanPrompt()` used wrong item scope for exclusions — changed to use `getScannerExclusionLabels(scannerId)` consistently. Removed dead `getTrackedExclusionLabels()`. (2) "New" badge persisted on completed/archived items — `setItemLifecycleStatus()` now clears `hasNewUpdate`, `isNew`, and marks history as seen on completion/archival.

**Files:** `src/renderer/prompts.js`, `src/renderer/scanner-engine.js`, `src/renderer/models/item.js`. All 549 tests pass.

**Source:** `.squad/decisions/inbox/goose-radar-exclusions-and-new-badge.md`

---

## DEC-073: Tiered Hot/Cold Storage

**Author:** Slider (Performance Engineer) | **Date:** 2026-03-30 | **Status:** Implemented | **Requested by:** Kyle

**Summary:** Implemented tiered hot/cold storage to prevent OOM crash after 48h unattended operation. Hard caps: `MAX_EVIDENCE_LINKS_PER_ITEM = 20`, `MAX_ACTIVE_ITEMS = 500`. Cold storage via separate `electron-store` instance (`flightdeck-cold`). Eviction runs during save: archived/complete items 24+ hours old → cold storage. Cold items NOT loaded at startup.

**Key decisions:**
- `pruneHistory()` now runs on every `addHistory()` call (trims before insert).
- New IPC channels: `STORE_GET_COLD_ITEMS`, `STORE_SET_COLD_ITEMS` with preload bridge.
- Global cap overflow eviction sorts by lifecycle status then age.
- Automatic migration on first load — zero data loss.

**Files:** `constants.js`, `store.js`, `ipc-handlers.js`, `ipc-contract.js`, `preload.js`, `state.js`, `app.js`, `monitor-engine.js`, `models/item.js`. 549 tests pass.

**Source:** `.squad/decisions/inbox/slider-tiered-storage.md`

---

## DEC-074: Cross-Platform Build & WorkIQ Resolution

**Author:** Jester (DevOps) + Viper (Backend Dev) | **Date:** 2026-03-31 | **Status:** Implemented

**Summary:** Added macOS (DMG + zip) and Linux (AppImage + deb) build targets. `pty-bridge.js` now supports macOS/Linux — workiq expected in PATH via `which workiq` + common path fallback. `workiqMode` gains `'system'` value. Windows behavior fully preserved.

**Source:** `.squad/decisions/inbox/jester-cross-platform-build.md`, `.squad/decisions/inbox/viper-cross-platform-pty.md`

---

## DEC-075: Windows Taskbar Icon — Runtime Fix

**Author:** Viper (Backend Dev) | **Date:** 2026-04-02 / 2026-04-07 | **Status:** Implemented

**Summary:** Fixed Windows taskbar showing default Electron icon. All BrowserWindows (main, popout, markdown preview) now receive FlightDeck icon via shared helper in `utils.js`. Removed duplicate `app.setAppUserModelId('FlightDeck')` that overrode correct reverse-domain ID. Packaging fix (ICO asset) separated as Jester-owned.

**Files:** `src/main/utils.js`, `src/main/index.js`, `src/main/ipc/tracker-popout.js`, `src/main/ipc-handlers.js`

**Source:** `.squad/decisions/inbox/viper-taskbar-icon.md`, `.squad/decisions/inbox/viper-taskbar-icon-fix.md`

---

## DEC-076: Windows Icon Packaging — Build Resource

**Author:** Jester (DevOps) + Viper (Backend Dev) | **Date:** 2026-04-07 | **Status:** Proposed

**Summary:** Windows packaging must use `build/icon.ico` (real ICO container) instead of `src/icon.png`. `.gitignore` updated to allow `build/icon.ico`. `src/icon.ico` excluded (contains PNG data with ICO extension). PR scope: `.gitignore`, `package.json`, `build/icon.ico`, plus runtime files from DEC-075.

**Source:** `.squad/decisions/inbox/jester-taskbar-icon.md`, `.squad/decisions/inbox/jester-icon-pr.md`, `.squad/decisions/inbox/viper-icon-file-set.md`

---

## DEC-077: Dev-Only Windows Taskbar Identity Restoration

**Author:** Viper (Backend Dev) | **Date:** 2026-04-13 | **Status:** Implemented

**Summary:** Restored legacy `FlightDeck` AppUserModelId only when `app.isPackaged === false` (dev mode), keeping packaged builds on `com.flightdeck.app`. Shared helper ensures `setAppUserModelId` and `win.setAppDetails` stay aligned.

**Source:** `.squad/decisions/inbox/viper-dev-taskbar-identity.md`

---

## DEC-078: Version Check & Update Notification

**Author:** Viper (Backend Dev) + Goose (Frontend Dev) | **Date:** 2026-04-13 | **Status:** Implemented

**Summary:** Backend: `CHECK_FOR_UPDATES` IPC channel queries GitHub Releases API via `net.request` with 1-hour cache. Returns `{ available, currentVersion, latestVersion, releaseUrl, releaseNotes }`. Frontend: green dot beside version badge with hover tooltip (version, release link, dismiss). Dismiss stores version via `storeSet`. Skipped in demo mode.

**Key decisions:**
- `net.request` over `fetch` — respects Electron proxy, no external dep.
- 1-hour cache prevents GitHub API rate-limiting.
- Non-intrusive: dot + tooltip, no modal/banner.

**Source:** `.squad/decisions/inbox/viper-version-check-backend.md`, `.squad/decisions/inbox/goose-update-notification-ui.md`

---

## DEC-079: Scanner Header New Count & Sort Fix

**Author:** Goose (Frontend Dev) | **Date:** 2026-04-07 | **Status:** Implemented

**Summary:** Fixed stale scanner-row "new" counts and sort order after incremental monitor updates. Added `patchSectionHeader(scannerId)` and `repositionItemInSection(itemId)` called after every `patchSingleItem()`. Added snoozed exclusion to new-count formula to match KPI bar.

**Files:** `src/renderer/renderers/radar.js`

**Source:** `.squad/decisions/inbox/goose-new-count-fix.md`

---

## DEC-080: Demo Mode — Full Isolation Guards

**Author:** Goose (Frontend Dev) + Viper (Backend Dev) | **Date:** 2026-04-14 | **Status:** Implemented

**Summary:** Three-point demo isolation: (1) `runWorkiqJson()` blocks all real WorkIQ/M365 calls with early-return throw. (2) `savePersistentState()`/`loadPersistentState()` skip cold-storage eviction/migration. (3) Popout windows inherit `?demo=1`. All functions calling WorkIQ have `IS_DEMO` guards with user-visible toast messages. Action buttons dimmed via `body.demo-mode` CSS. Fixture.json updated to unified store format.

**Source:** `.squad/decisions/inbox/goose-demo-disable.md`, `.squad/decisions/inbox/viper-demo-guards.md`

---

## DEC-081: Release Plan & Scope Review

**Author:** Jester (DevOps) + Maverick (Lead) | **Date:** 2026-04-13 | **Status:** Proposed

**Summary:** Release branch `fix/windows-runtime-identity-startup-reconnect` blocked until diff scrubbed of company-identifying text. Releasable scope: `src/main/index.js`, `src/main/utils.js`, `test/main-utils.test.js`. Exclude: `src/renderer/app.js` (unrelated reconnect change with product-identifying text), `.squad/` artifacts.

**Source:** `.squad/decisions/inbox/jester-release-plan.md`, `.squad/decisions/inbox/maverick-release-scope-review.md`

---

## DEC-082: Neutral Startup Fallback Copy

**Author:** Goose (Frontend Dev) | **Date:** 2026-04-13 | **Status:** Implemented

**Summary:** Changed non-reconnect status text in `src/renderer/app.js` from product-specific message to neutral `Service unavailable`. Keeps startup reconnect behavior while removing company-identifying language from outgoing changes.

**Source:** `.squad/decisions/inbox/goose-startup-reconnect-copy.md`

---

## DEC-083: loadPersistentState Empty Store Fix

**Author:** Coordinator | **Date:** 2026-04-14 | **Status:** Implemented

**Summary:** Fixed `loadPersistentState()` in `state.js` where `if (!parsed) return;` returned early when the store was empty, skipping seed scanner creation and the `_loaded` flag. Replaced with `parsed = {}` fallback so seed scanner creation and `_loaded` always execute. Users upgrading from v1.0.4 to v1.1.0 saw no default scanner on initial load.

**Files:** `src/renderer/state.js`, `test/renderer-state.test.js`. 589 tests pass (0 fail, 4 skipped).

---

## DEC-084: Svelte Migration Assessment — Not Yet

**Author:** Maverick (Lead) + Goose (Frontend Dev) | **Date:** 2026-04-15 | **Status:** Assessment | **Requested by:** Kyle

**Summary:** Full architecture-level assessment of migrating FlightDeck from vanilla JS to Svelte. Recommendation: **do not migrate yet**. The post-refactoring modular architecture (25 focused files, clear separation) already delivers most maintainability benefits. The recommended next step is ES modules + Vite (vanilla mode) at ~20% of Svelte migration cost, which also makes a future Svelte migration easier.

**Overall LOE:** XL (full renderer layer rewrite)

**LOE breakdown:**
- Build tooling (Vite + Svelte + Electron): S
- Component conversion (renderers → .svelte): L (~2,800 lines of HTML-string renderers)
- State management (mutable → Svelte stores): M-L (highest-risk area, touches every module)
- Styling (CSS → scoped styles): S-M (3,600 lines, mostly mechanical)
- IPC integration: S (`window.workiq` works as-is)
- Event migration: M (events.js 1,113L eliminated, logic absorbed into components)
- Models/logic (non-rendering): S (stay as-is)
- Testing migration: L (5,350 lines rewritten for Vitest + @testing-library/svelte)

**What stays unchanged:** `src/main/` (6 files), `src/preload.js`, `src/shared/ipc-contract.js`, `src/prompts/`, `src/demo/fixture.json`.

**What changes completely:** All 7 renderer files (~2,800L), `events.js` (eliminated), `state.js` → Svelte stores, `app.js` → App.svelte, `popout.js` → Popout.svelte, `search.js` → SearchOverlay.svelte, `index.html` → Vite entry, all 9 CSS files → component `<style>` blocks, all 18 test files rewritten.

**Key risks:**
1. Electron + Vite CSP — Vite dev server injects inline scripts; needs CSP relaxation in dev or `electron-vite`.
2. State migration — shared mutable `state` object referenced by every module; converting to Svelte stores is highest-risk.
3. Testing cliff — `vm.runInContext` testing pattern is vanilla-JS-specific; all 5,350 test lines rewritten from scratch.
4. innerHTML → `{@html}` — existing `escapeHtml()` discipline must be maintained.
5. Demo mode interceptor — monkey-patching needs DI pattern in module system.
6. Popout window — needs separate entry point or conditional root component.

**Recommended next step:** ES modules + Vite (no framework) — convert 22 `<script>` tags to `import`/`export`, add Vite as dev server + bundler. Gains: HMR, tree-shaking, proper dependency graph. Cost: ~20% of full Svelte migration.

**Revisit Svelte when:** (a) app adds significant new UI complexity, (b) manual DOM updates become dominant bug source, (c) team is ready for full testing rewrite.

**Component inventory (Goose):** ~35-40 Svelte components needed. All 22 JS modules and 9 CSS files mapped. Svelte confirmed as strong architectural fit.

**Source:** `.squad/decisions/inbox/maverick-svelte-assessment.md`