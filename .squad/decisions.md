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