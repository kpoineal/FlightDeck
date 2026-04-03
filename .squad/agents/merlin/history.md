# Merlin — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Goal:** Build test infrastructure and write tests to support safe refactoring of monolithic Electron app

## Learnings
<!-- Append learnings below -->

### 2026-04-03 — DEC-063: Radar/Scanner Unification Test Updates

**Context:** Removed the concept of a "default/undeletable" radar scanner. Radar becomes just another scanner. Source changes were made by Goose/Viper; this task updated all affected tests.

**Files modified (4 test files):**
- `test/renderer-delete-scanner.test.js` — Removed `isDefault` from all scanner fixtures. Replaced "returns false for default scanner" test with "deletes ANY scanner including formerly default" (DEC-063). Added `updateScanner()` test suite (4 tests) verifying id is immutable but all other fields are updatable.
- `test/renderer-scanner-engine.test.js` — Removed `isDefault: false` from 7 scanner fixtures in rescheduleOverdueScanners tests.
- `test/renderer-prompts.test.js` — Removed `promptCache.radarScan` from resetTestState. Removed `radar-scan.md` from IPC mock results. Updated `loadPromptFiles()` tests (IPC count 3→2, removed radar assertions). Replaced radar Apply/Reset handler tests with briefing-only equivalents. Added `buildScannerPrompt() — radar-like prompts` test suite (3 tests).
- `test/renderer-state.test.js` — Added `models/scanner.js` to loadRendererBundle (needed for `normalizeScannerDefinition` called by first-run seed). Added `readPromptFile` mock for seed path. Added `scanners = []` to resetState. Added 3 new test suites: isDefault migration (2 tests), first-run seed (5 tests), orphan items (1 test).

**Key findings:**
- Cold storage eviction pitfall: Adding `getColdItems`/`setColdItems` mocks to the state test caused completed/archived items without timestamps to be evicted during load (since `t=0 < coldCutoff`). Fix: omit these mocks so cold storage fails silently in tests (matching pre-existing behavior). If cold storage tests are needed later, test items must include valid timestamps.
- `_loaded` guard: `savePersistentState()` has `if (!state._loaded) return;`. Resetting `_loaded` in `resetState()` silently broke save tests. Fix: don't reset `_loaded` — it's managed by `loadPersistentState()`.
- `scanner.js` dependency: The first-run seed in `state.js` calls `normalizeScannerDefinition()` and `computeScannerNextRunAt()` from `scanner.js`. Test bundles that load `state.js` must now also load `models/scanner.js`.

**Test count:** 586 total (582 pass, 4 skipped), 119 suites. Net new: 15 tests, 4 suites added, ~10 tests rewritten, ~7 tests removed (radar prompt editor tests).

### 2026-02-25 — Phase 5 Part 1: Test Infrastructure + Main Process Unit Tests

**Test runner:** Node's built-in `node:test` + `node:assert/strict` — zero dependencies added. Run via `npm test`.

**Electron/node-pty mocking strategy:** Created `test/helpers/electron-mock.js` that intercepts `Module._resolveFilename` to redirect `require('electron')` and `require('node-pty')` to in-memory mocks. Must be required before any module under test. The mock objects are mutable, so tests can swap method implementations per-test (e.g., `electronMock.screen.getAllDisplays`).

**Node v25 quirk:** `node --test <directory>` does NOT work on Node 25 — it tries to `require()` the directory as a module. Had to use explicit file paths: `node --test test/main-utils.test.js test/main-window-state.test.js test/main-pty-bridge.test.js`. The `--test-path-pattern` flag also does not exist in v25.

**Coverage achieved (49 tests, 8 suites):**
- `main/utils.js` — `ts`, `normalizeExternalUrl`, `isSafeExternalUrl`, `escapeHtml`, `markdownToHtml` fully tested. `attachExternalNavigationGuards` skipped (needs Electron webContents mock).
- `main/window-state.js` — `isStateOnScreen` fully tested with single/multi-monitor and edge cases. `loadWindowState`/`saveWindowState` skipped (need fs + app.getPath integration; flagged for Part 2).
- `main/pty-bridge.js` — `stripAnsi` and `getNodeExecutable` fully tested with env var and fs mocking. `runWorkiqCommand` skipped (needs real PTY; flagged for Part 2).

**Testability observations:**
- `isStateOnScreen` calls `screen.getAllDisplays()` internally rather than accepting displays as a parameter. This couples it to Electron's screen API. A testability improvement would be to accept displays as an optional parameter.
- `getNodeExecutable` is testable by mocking `fs.existsSync` via `t.mock.method()` and manipulating `process.env`. The `t.after()` pattern cleanly restores env vars.
- `stripAnsi` exists in both `utils.js` and `pty-bridge.js` — the implementations are identical. This is documented as intentional (DEC-001) since they run in different processes.

### 2026-02-25 — Phase 5 Part 2: Renderer Foundation Module Unit Tests

**Challenge solved:** Renderer modules are vanilla JS files loaded via `<script>` tags — they define globals, not `module.exports`. Node's `vm.runInContext` was used to execute them in a sandboxed context with injected browser API mocks.

**Test helper:** Created `test/helpers/renderer-context.js` which:
- Creates a `vm.createContext` pre-populated with JS builtins (Date, URL, Math, JSON, Set, Map, etc. — vm contexts start empty)
- Provides minimal browser-API mocks: `window`, `document.getElementById`, `localStorage`, `alert`
- Exposes `loadFile(ctx, relPath)` to execute vanilla JS files in the sandboxed context
- Dependencies are loaded in script-tag order (constants → utils → model) since they rely on global scope chaining

**Cross-realm gotcha (Node vm module):** `assert.deepStrictEqual` fails when comparing arrays/objects across vm realms — a `[]` created inside the vm is not reference-equal to `[]` from the test's own realm. Workaround: use `assert.deepEqual` (non-strict) via `require('node:assert')` for cross-realm array comparisons, or compare `.length` and individual elements with `assert.equal`.

**Text normalization gotcha:** `cleanDisplayText` calls `normalizeSpacingArtifacts`, which inserts spaces between letters and digits (e.g., "Q3" → "Q 3"). Tests must account for this when asserting on text that passes through these functions.

**Coverage achieved (182 new tests across 5 files, 231 total with Phase 5.1):**
- `renderer/utils.js` — `escapeHtml`, `normalizeExternalUrl`, `isGenericUrl`, `isHallucinatedUrl`, `isDeepLink`, `hashString`, `safeDate`, `relativeTime`, `normalizeSpacingArtifacts`, `cleanDisplayText`, `sanitizeBriefingText`, `compactLinkLabel`, `normalizeSeverity`, `extractExternalUrls`, `toIsoOrNull`, `nowIso`
- `renderer/json-parser.js` — `parseCandidates`, `normalizeJsonCandidate`, `parseJsonWithRepair`, `sanitizeLikelyBrokenJson`, `parseWorkiqJson`
- `renderer/models/tracking.js` — `intervalValueToMinutes`, `computeNextRunAt`, `computeNextWeeklyRun`, `trackingItemSignature`, `normalizeTrackingItem`, `buildDefaultMonitorPrompt`, `unseenHistoryCount`
- `renderer/models/radar.js` — `radarItemIdentitySeed`, `resolveRadarItemId`, `isInboundStatus`, `mapLedgerEntryToRadarItem`, `applyLedgerPayload`
- `renderer/models/briefing.js` — `briefingAlignmentScore`, `isBriefingAlignedWithMeeting`, `classifyBriefingSeverity`, `meetingIdentitySeed`, `resolveMeetingId`, `buildFallbackBriefingSources`, `isBriefingUnseen`

### 2026-03-26 — PII Scrub: renderer-utils.test.js

Replaced real customer/person names in test fixtures with generic data:
- Real person + company names → "Weekly sync message on datacenter migration" (lines ~756-758)
- Company-specific thread name → "Datacenter migration thread" (lines ~790-794)
- Company name in embedded citation label → "Contoso" (line ~859)
- Updated camelCase-split comment to reflect that "Contoso" has no camelCase behavior (line ~865)
All 481 tests pass after changes. No test logic was altered — only string literals and one comment.

**Functions skipped (require heavy DOM or async window.workiq):**
- `renderMarkdownLinks` — produces HTML, testable but lower ROI vs. pure logic
- `runWorkiqJson` — async, calls `window.workiq.ask`; `parseWorkiqJson` (its core) is tested
- `applyRadarPayload`, `applyBriefingPayload`, `applyMeetingsPayload` — heavy state mutations with multiple downstream calls; good candidates for integration tests
- `reconcileMeetingScopedState` — depends on full state graph
- `updateTrackingSchedule`, `setTrackingEnabled`, `upsertTrackingItemFromRadar`, `removeTrackingItem`, `dismissRadarItem` — mutate `state` + call `savePersistentState`/render functions

### 2026-02-26 — localStorage Leak Fix Validation (30 tests)

**Test file:** `test/renderer-state.test.js` — covers `renderer/state.js` persistence functions and `renderer/models/briefing.js` reconciliation.

**Bundled loading technique:** `state.js` declares top-level `const` variables (`state`, `elements`, `POPOUT_ITEM_ID`, etc.) which are script-scoped in Node's vm module and NOT accessible as context properties. Previous tests worked around this by providing `state` as an extraGlobal and never loading `state.js`. For this test file, we needed the real `loadPersistentState`/`savePersistentState`/`pruneHistory`/`pruneStaleBriefings` functions AND access to the `state` object they mutate. Solution: concatenate all dependency files into a single script string, replace `const`/`let` with `var` so declarations become context properties, and run as one `vm.runInContext` call. This simulates browser `<script>` tag scope sharing.

**Extra context globals needed for state.js:** `URLSearchParams` (used at top level for popout params), `window.workiq.broadcastStateChanged` (called by `savePersistentState`).

**Goose's fixes verified (all 3 already applied):**
1. **Fix 1 — Legacy key cleanup:** `loadPersistentState()` now tracks `usedLegacyKey` flag and calls `localStorage.removeItem(LEGACY_STORAGE_KEY)` after migration. Note: only fires when legacy was actually used as fallback; when v2 exists, legacy key is left alone (design choice, not a gap).
2. **Fix 2 — briefingSeenAt orphan cleanup:** `reconcileMeetingScopedState()` now prunes `briefingSeenAt` keys that don't match any active meeting or retained briefing.
3. **Fix 3 — History pruning on save:** `savePersistentState()` calls `pruneHistory()` before serializing. `pruneHistory()` also enforces `HISTORY_MAX_ENTRIES = 500` cap via `slice(-500)` (keeps most recent in append order).

**Key constants:** `STORAGE_KEY = 'flightdeck.persisted.v2'`, `LEGACY_STORAGE_KEY = 'flightdeck.persisted.v1'`, `HISTORY_MAX_AGE_MS = 30 days`, `HISTORY_MAX_ENTRIES = 500`. All in `renderer/constants.js`.

**Coverage (30 tests, 9 suites):**
- `loadPersistentState` — v2 loading, legacy fallback, malformed JSON, type coercion defaults (7 tests)
- Legacy key cleanup — migration removal, no-removal when v2 present (2 tests)
- `pruneHistory` — time-based pruning, boundary, invalid timestamps, empty (4 tests)
- History pruning on save — old entries pruned during save (1 test)
- History max cap — 500-entry cap, preserves most recent (2 tests)
- `pruneStaleBriefings` — stale removal, fresh preservation, no-startAt, seenAt cleanup, mixed (5 tests)
- `briefingSeenAt` orphan cleanup — missing meetings, orphan seenAt keys, valid retention, reassignment (4 tests)
- `savePersistentState` — write, round-trip, briefing field persistence (3 tests)
- Cleanup on load — history pruning, stale briefing pruning during load (2 tests)

### 2026-02-26 — localStorage Reduction Test Updates (4 new tests, existing tests updated)

**Context:** Goose lowered `HISTORY_MAX_ENTRIES` from 500 → 200, removed `radarItems`/`meetings` from persist/load, lowered `updateHistory` cap from 50 → 20 (with trim on load via `normalizeTrackingItem`), and lowered monitor-engine history cap to 20.

**Test changes in `test/renderer-state.test.js`:**
- **Existing tests updated:** All `loadPersistentState` and legacy-key tests that previously verified loading via `radarItems` now use `trackingItems`, `connected`, or `trackingDensity` instead — these fields are still persisted. The "defaults arrays to empty" test was narrowed to only cover `trackingItems` and `history` (the fields still subject to `Array.isArray` coercion on load).
- **History cap tests updated:** Changed from 500-entry cap to 200-entry cap assertions. Adjusted generated entry counts (600 → still 600, but entry indices updated for 200-entry slice).
- **New: "does NOT restore radarItems or meetings from persisted data"** — puts both in the payload, verifies `state.radarItems` and `state.meetings` stay `[]` after `loadPersistentState()`.
- **New: "trims oversized updateHistory to 20 on load"** — stores a tracking item with 50 history entries, verifies ≤20 after load.
- **New: "does NOT include radarItems or meetings in saved payload"** — sets both on state, calls `savePersistentState()`, verifies `parsed.radarItems === undefined` and `parsed.meetings === undefined`.
- **savePersistentState "persists state" test** — already updated to verify radarItems/meetings are absent from the payload.

**No monitor-engine cap test existed** (no test file for `monitor-engine.js`). The cap in production code was already changed from 50 → 20.

**Final suite result:** 292 tests, 60 suites, 0 failures.
### 2026-02-27 — Day Briefing Feature Tests (30 tests, 6 suites)

**Test file:** `test/renderer-day-briefing.test.js` — covers all Day Briefing model logic, prompt building, state integration, and pruning.

**Bundled loading reuse:** Used the same concatenated-bundle technique from `renderer-state.test.js` — load `constants.js → utils.js → json-parser.js → state.js → prompts.js → models/briefing.js` as a single `vm.runInContext` call with `const`/`let` → `var` replacement. Required extra context globals: `URLSearchParams`, `window.workiq.broadcastStateChanged`, and stubs for `renderBriefingsMode`, `setStatus`, `addHistory`, `setDraftButtonLoading`, `runWorkiqJson`, `buildMeetingBriefingPrompt`.

**Prompt cache seeding:** `promptCache.dayBriefing` must be seeded manually in tests since `loadPromptFiles()` is async and calls `window.workiq.readPromptFile`. Tests set `ctx.promptCache.dayBriefing = 'You are a day-briefing assistant.'` in `resetState()`.

**Coverage (30 tests, 6 suites):**
- **Day Briefing Constants** (2) — `DAY_BRIEFING_KEY` equals `'__day_briefing__'`, `DAY_BRIEFING_JSON_SCHEMA` is non-empty string.
- **`buildDayBriefingPrompt()`** (7) — template content inclusion, meetings context injection, tracking items context injection, KPI data formatting (`Critical=N`), empty meetings fallback ("No meetings scheduled today"), empty tracking fallback ("No active tracked items"), null KPIs fallback ("No radar KPIs available").
- **`applyDayBriefingPayload()`** (13) — stores under `DAY_BRIEFING_KEY`, sanitizes headline (strips markdown links and bold), handles missing arrays for 5 fields (topPriorities, meetingsRequiringPrep, atRiskItems, suggestedTimeBlocks, todayFollowUps), normalizes meetingsRequiringPrep entries, normalizes atRiskItems entries, calls `savePersistentState()`, uses default headline when missing, preserves `generatedAt`, filters sources to valid URLs only.
- **`getDayBriefing()`** (2) — returns briefing when exists, returns null when absent.
- **`reconcileMeetingScopedState()` with day briefing** (2) — preserves `__day_briefing__` during empty reconciliation, preserves during meeting list changes (mtg_1 removed, mtg_2 added).
- **`pruneStaleBriefings()` with day briefing** (4) — keeps today's briefing, prunes yesterday's (also cleans `briefingSeenAt`), prunes two-day-old, preserves fresh day briefing alongside stale meeting briefing.

**Cross-realm assertion pattern:** Used `looseAssert.deepEqual` (from `require('node:assert')`) for array comparisons across vm realm boundaries, same pattern as all previous renderer test files.

**Final suite result:** 322 tests, 66 suites, 0 failures.

### 2026-03-03 — Maintainability Audit (Testability + Regression Risk)

**Coverage shape today:** Core pure-logic modules are strong (`main/utils`, `main/window-state` geometry, `main/pty-bridge` helpers, `renderer/utils`, `renderer/json-parser`, `renderer/models/*`, and day-briefing/state model flows). Runtime orchestration layers remain weakly covered: `main/index.js`, `main/ipc-handlers.js`, `preload.js`, `renderer/app.js`, `renderer/events.js`, `renderer/popout.js`, `renderer/search.js`, `renderer/theme.js`, `renderer/monitor-engine.js`, and all `renderer/renderers/*` UI rendering modules.

**Highest regression pressure points identified:**
- IPC contract drift across preload/main/renderer (`get-app-version`, `tracker-state-sync`, notification payloads) has no integration coverage.
- Scheduler + monitor loop behavior (`runDueMonitoringChecks`, interval lifecycle, notification gating, update history capping) is critical and largely untested.
- Event-delegation heavy files (`events.js`, `popout.js`) have broad DOM branching with minimal automated protection.
- `npm test` omits `test/renderer-state.test.js` even though CI includes it via glob; local and CI confidence differ.

**Next test priorities (recommended):**
1. IPC integration harness (mock `ipcMain`/`ipcRenderer`) covering happy/error paths and payload shape parity.
2. Monitor-engine deterministic tests using fake timers + stubs for `runWorkiqJson`, notifications, and persistence.
3. Renderer smoke suites for command/refresh mode switches and delegated interactions in main + popout views.

### 2026-03-03 — Cross-Agent Kickoff Alignment (DEC-020)

- Testability audit findings were consolidated into DEC-020 maintainability program kickoff.
- Assigned execution owner for Ticket 5 (orchestration coverage parity slice).
- Merlin sign-off is required in DEC-020 review gates for contract/timer/interaction behavior coverage on maintainability tickets.

### 2026-03-03 — T1/T2 Reviewer Gate (Contract constants + rawHtml guardrail)

**Gate request:** Review T1/T2 implementation by Viper for contract safety, security, regression coverage, and scope control.

**Findings:**
- IPC channel constantization is behavior-preserving: all migrated channel keys match prior string values and are consumed consistently across main + preload paths.
- Raw HTML trust path is neutralized: markdown preview ignores renderer-supplied `rawHtml` and always renders from markdown/instructions transform path.
- Regression tests are targeted and meaningful: added tests verify preload/main canonical channel wiring and explicitly assert unsafe `rawHtml` content does not appear in preview output while markdown output still renders.
- Scope remained controlled to T1/T2 slice (contract module, two runtime files, electron mock extension, and focused test/script updates).

**Reviewer decision:** APPROVE with minor non-blocking follow-up to add one narrow test for tracker-state broadcast fanout channel emission parity.

### 2026-03-03 — Ticket 4 Slice 1 Reviewer Gate (IPC domain split)

**Gate request:** Review Viper's Ticket 4 slice 1 extraction of tracker popout/sync IPC behavior from `src/main/ipc-handlers.js` into `src/main/ipc/tracker-popout.js`.

**Review checklist outcome:**
- Behavior-preserving split: PASS — channel names and fanout semantics are unchanged (`open-tracker-popout`, `tracker-state-changed`, `tracker-state-sync`), and wiring remains via `registerIpcHandlers()`.
- Scope control: PASS — extraction stayed within one cohesive domain (tracker popout creation + tracker sync broadcast), with no cross-domain handler movement.
- Test quality/coverage: PASS — `test/main-ipc-tracker-popout.test.js` verifies registration, popout lifecycle cleanup, and sender/destroyed-window fanout exclusions; focused regression run passed.
- Regression risk: LOW — isolated module extraction with explicit tests and unchanged IPC contract constants reduces handler concentration without changing renderer-facing API.

**Reviewer decision:** APPROVE.

**Non-blocking follow-up:** add one narrow test asserting no fanout sends occur when main window is destroyed and there are no active popouts.

### 2026-03-03 — Ticket 3 Slice 1 Reviewer Gate (Tracking/Popout duplication seam)

**Gate request:** Review Goose's Ticket 3 slice 1 extraction of shared history markup across tracking and popout render paths.

**Review checklist outcome:**
- Behavior parity: PASS — existing empty-state copy is preserved by call site (`"No history yet."` in minimal row detail; detailed text in card/popout), and rendered history structure/classes remain unchanged.
- Scope control: PASS — extraction is a single cohesive frontend seam (`buildTrackerHistoryMarkup`) reused by tracking minimal/card and popout paths; no backend/IPC/event-contract changes.
- Test quality/coverage: PASS — focused unit tests cover default/custom empty states and populated-history rendering (unseen class, links, suggestions); test file is included in explicit `npm test` script list.
- Regression risk: LOW — refactor centralizes duplicated markup with no interaction wiring changes and full suite passes (`302/302`).

**Reviewer decision:** APPROVE.

**Non-blocking follow-up:** add one renderer-level integration test that exercises `renderPopoutMode()` history output to complement primitive-level unit coverage.

### 2026-03-03 — Ticket 5 Orchestration Coverage Parity + Follow-up Tests

**Requested by:** the project owner

**Scope completed (test-only):**
- Added the Ticket 4 non-blocking edge-case regression in `test/main-ipc-tracker-popout.test.js`:
	- verifies `tracker-state-changed` fanout does **not** send anything when the main window is destroyed and no popouts are active.
- Added Ticket 5 orchestration coverage in `test/main-ipc-handlers.test.js`:
	- preload guardrail test for invalid callback subscribers (`onStateChanged`, `onNotificationClicked`) returning no-op unsubscribe functions without registering listeners.
	- main notification orchestration test validating `show-desktop-notification` creates a notification and relays `notification-clicked` payload to main window (`show`, `focus`, `webContents.send`).
- Added renderer integration test `test/renderer-popout.test.js`:
	- exercises `renderPopoutMode()` and asserts history rendering path includes unseen class, change text, summary region, inline links, and suggested-next-steps markup.

**Execution notes:**
- Because renderer files are script-scoped globals (no module exports), popout integration test uses vm context + targeted global stubs (`CSS.escape`, `autoSizeSeveritySelects`, minimal `document`) and loads files in dependency order (`constants` → `utils` → `models/tracking` → `renderers/tracking` → `popout`).
- `severityClass` is supplied as a focused test stub to avoid loading unrelated renderer surface area while still exercising popout render composition.

**Validation:**
- Targeted run passed:
	- `node --test test/main-ipc-tracker-popout.test.js test/main-ipc-handlers.test.js test/renderer-popout.test.js`
- Full suite passed after updating explicit `npm test` list:
	- `npm test` → **306 passed, 0 failed**.

### 2026-03-05 — Inline Citation Extraction Tests (15 new tests)

**Requested by:** the project owner

**Scope:** Unit tests for the new `extractInlineCitations()` function in `renderer/utils.js` and the updated `applyRadarPayload()` inline citation extraction behavior in `models/radar.js`.

**Tests added to `test/renderer-utils.test.js` (11 tests, 1 suite):**
- `extractInlineCitations()` — returns empty array for null/undefined/empty, extracts numeric footnote citation (`[1](sharepoint-url)` → label '1', type 'doc'), extracts descriptive label citation (`[status report](loop-url)` → label 'status report', type 'doc'), extracts multiple citations from one text, deduplicates by URL (first match wins), skips non-HTTPS URLs (http rejected by `isDeepLink`, ftp rejected by `normalizeExternalUrl`), skips generic URLs (calendar root, Teams root), skips hallucinated URLs (turn1search, placeholder patterns), infers signal type from URL (doc/meeting/email/chat), returns empty array for plain text, handles URLs with special characters (%7B, &, = in SharePoint-style URLs).

**Tests added to `test/renderer-models-radar.test.js` (4 tests, 1 suite):**
- `applyRadarPayload() inline citation extraction` — extracts inline citations from summary before cleaning (evidenceLinks populated, summary clean), structured evidenceLinks take priority over inline duplicates (dedup, signalAt preserved), merges structured and inline links from different URLs (both present), extracts from both summary and reason fields (both citations captured, both fields cleaned).

**Key observations:**
- `extractInlineCitations()` was already implemented by Goose at time of test authoring — all tests passed immediately.
- `applyRadarPayload()` inline extraction ordering (extract before `cleanDisplayText`) is critical and verified by asserting both clean display text AND populated evidenceLinks from the same raw input.
- No package.json changes needed — both test files were already in the explicit `npm test` file list.

**Validation:** Full suite passed: `npm test` → **338 passed, 0 failed**.

### 2026-03-06 — Persistent Prompt Storage Tests (17 tests, 6 suites)

**Requested by:** the project owner

**Scope:** Unit tests for the persistent prompt storage feature being implemented by Goose in `renderer/prompts.js` and `renderer/constants.js`. Tests written ahead of full implementation to validate expected behavior once Goose's `loadPromptFiles()` modification lands.

**Test file:** `test/renderer-prompts.test.js`

### 2026-03-31 — Cross-Platform pty-bridge Tests (8 new tests, 4 skipped)

**Requested by:** Kyle Poineal

**Scope:** Added cross-platform test coverage for `getNodeExecutable()` in `test/main-pty-bridge.test.js`, preparing for Viper's cross-platform pty-bridge changes.

**Changes to test file:**
- Restructured `getNodeExecutable()` tests into `win32 — .exe resolution` and `darwin / linux — cross-platform resolution` sub-describes.
- Added `saveAndClearEnv()` helper for cleaner env var save/restore across tests.
- Existing 4 Windows tests preserved and wrapped in `win32` describe block.
- **2 new win32 tests:** priority ordering (npm_node_execpath > NODE), process.execPath as last-resort .exe candidate.
- **4 skipped darwin/linux tests:** accept non-.exe npm_node_execpath, NODE env var, and process.execPath on darwin/linux. Skipped with `{ skip: 'Requires cross-platform getNodeExecutable (Viper PR)' }` — will auto-enable when Viper's code drops the .exe requirement on non-Windows.
- **2 passing darwin/linux fallback tests:** `'node'` fallback on darwin and linux when nothing exists — passes with current code because the fallback path is platform-agnostic.
- Added notes block about module-level workiq resolution (runs at require time, needs integration test approach).

**Platform mocking technique:** `Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })` with `t.after()` restore using saved property descriptor. Works because `process.platform` is a configurable property in Node.js.

**Result:** 22 tests, 4 suites — 18 pass, 4 skipped, 0 failures.

**Loading technique:** Uses the same bundled loading approach as `renderer-state.test.js` — concatenates `constants.js` + `prompts.js` with `const`/`let` → `var` replacement. Provides mock DOM elements with `addEventListener` + async `_trigger('click')` to exercise `initPromptEditor()` handlers. `window.workiq.readPromptFile` is mocked with call tracking and configurable per-file results.

**Mock element pattern:** Created `createMockElement()` factory producing objects with `value`, `textContent`, `classList.toggle`, and `addEventListener`/`_trigger` for programmatic event dispatch. The `_trigger` method awaits async handlers (needed for Reset which calls IPC). All elements are created once in `before()` and property-reset in `beforeEach()` — no re-registration of `initPromptEditor` listeners needed.

**Coverage (17 tests, 6 suites):**
- `saveCustomPrompt()` — stores under correct key, empty string saves without error (2 tests)
- `loadCustomPrompt()` — returns saved value, returns null when absent (2 tests)
- `clearCustomPrompt()` — removes stored value (1 test)
- `loadPromptFiles()` — localStorage priority over IPC, IPC fallback, mixed sources, editor seeding (4 tests)
- `Apply handler` — radar + briefing save to both promptCache and localStorage, empty value guarded (3 tests)
- `Reset handler` — radar + briefing clear localStorage and reload from disk, editor updated, "Reset to default" status message (5 tests)

**Current pass/fail:** 15 pass, 2 fail. The 2 failing tests (`loadPromptFiles` localStorage priority and mixed-source) fail because Goose has not yet modified `loadPromptFiles()` to check localStorage before IPC. All helper functions (`saveCustomPrompt`, `loadCustomPrompt`, `clearCustomPrompt`), Apply handlers, and Reset handlers are already implemented — those 15 tests pass immediately.

**Package.json update:** Added `test/renderer-prompts.test.js` AND previously-missing `test/renderer-state.test.js` to the explicit `npm test` file list.

**Full suite result:** 421 tests, 90 suites — 419 pass, 2 expected failures pending Goose's `loadPromptFiles` change.

### 2026-03-10 — Popout UI Redesign Baseline Validation

- **Context:** Goose implemented 12 visual improvements to the tracker popout window (CSS in `tracking.css`, JS in `popout.js`). All changes scoped to `.tracker-card--popout` / `.popout-*`.
- **Baseline confirmed:** Ran full test suite before and after changes — 429 tests pass, 0 failures.
- **No test modifications needed:** Changes are purely visual (CSS + popout HTML template). No model, state, IPC, or event contract changes.
- **Existing coverage:** `test/renderer-popout.test.js` integration test for `renderPopoutMode()` continues to pass — history rendering path unchanged by popout visual overhaul.

### 2026-03-12 — OneDrive Context File Feature Tests (21 new tests across 3 files)

**Requested by:** the project owner / Feature: `feature/onedrive-context-file`

**Scope:** Tests for two new source files (`src/renderer/models/context-file.js`, new IPC handlers in `src/main/ipc-handlers.js`) and radar merge behavior added to `src/renderer/models/radar.js`.

**Baseline investigation:** Goose had already modified several test files on the branch — adding `syncContextFile: () => {}` as a no-op stub in both `renderer-models-radar.test.js` and `renderer-models-tracking.test.js`, and adding `beforeEach(() => { ctx.state.radarItems = []; })` blocks to isolate the merge-accumulating `applyRadarPayload` tests. Pre-existing 430-test baseline was clean on the feature branch (5 earlier "failures" visible in full-suite run were actually from the previous branch commit — the feature-branch run is all-green once these stubs are in place).

**New file 1: `test/renderer-models-context-file.test.js` (11 tests, 3 suites):**
- `initContextFilePath()` — caches returned path, handles null gracefully, handles IPC rejection gracefully.
- `syncContextFile()` — calls `writeContextFile` with string content, includes `## Currently Tracking` section, includes `## On Radar` section, handles `writeContextFile` rejection gracefully, caches `result.path` when returned.
- Content format — tracking items use `- **{title}** — …` format, radar items use `- **{title}** — …` format, empty arrays render as `*(none)*`.

**Context-file loading pattern:** `context-file.js` has zero renderer-utility dependencies (no constants/utils chain needed). Each test creates a **fresh context** via `makeCtx()` because `_contextFilePath` is module-level state and cannot be reset without reloading. `window.workiq` is assigned to `ctx.window.workiq` after `createRendererContext()` but before `loadFile()` — this works because the vm context's `window` is the same mutable object reference.

**New file 2: `test/main-ipc-context-file.test.js` (6 tests, 1 suite):**
- `WRITE_CONTEXT_FILE` — returns `{ success: true, path }` when `OneDriveCommercial` is set, returns `{ success: false, error }` when not set, creates `FlightInfo/` directory, writes correct content to `context.md`.
- `GET_CONTEXT_FILE_PATH` — returns correct path when env var is set, returns `null` when not set.
- Uses real `fs` operations against a per-test `os.tmpdir()` subfolder. `process.env.OneDriveCommercial` is saved/restored in `beforeEach`/`afterEach` with `delete` for the undefined case. `require.cache` is cleared for `ipc-handlers.js` on each test (same pattern as existing `main-ipc-handlers.test.js`).

**Radar merge behavior block added to `test/renderer-models-radar.test.js` (4 tests, 1 suite):**
- Tests 1-3 (existing items persist / new items added / no duplicate IDs) — all **pass** immediately, confirming merge logic at lines 90-92 of `radar.js` is correct.
- Test 4 (dismissed items do NOT reappear) — **intentional TDD red**. Current `applyRadarPayload` only checks `existingIds` from `state.radarItems` at call time; when an item is dismissed (removed from `state.radarItems`), its ID is no longer in `existingIds`, so the next scan re-adds it. Fix requires dismissed-ID tracking (e.g., a `_dismissedIds` Set persisted to state) — the test documents this gap and will pass once implemented.

**package.json `scripts.test` updated** — added `test/main-ipc-context-file.test.js` and `test/renderer-models-context-file.test.js` to the explicit file list.

**Final suite result:** 451 tests, 97 suites — **450 pass, 1 intentional fail** (dismissed-item reappearance test, awaiting implementation).

### 2026-03-17 — Cross-Agent Context: Logging Test Assignment (from Maverick DEC-045)

**Upcoming work:** Step 5 of the logging implementation plan (DEC-045) is assigned to Merlin. Tests should verify:
- `logIpc` is called with correct summary shape (channel name + safe metadata, no raw content)
- Redaction enforcement: no raw WorkIQ question/answer text, store values, or external URLs appear in log output
- `handleWithLogging` decorator calls handler correctly and logs in/out/error transitions
- Tests can start after Step 1 (Viper creates `src/main/logger.js`)

**Key context from Viper's catalog (DEC-046):**
- 6 PII-sensitive IPC channels must be verified as redacted: `ASK_WORKIQ`, `OPEN_MARKDOWN_WINDOW`, `SHOW_DESKTOP_NOTIFICATION`, `STORE_GET`, `STORE_SET`/`GET_ALL`/`MIGRATE`
- PTY bridge currently logs raw WorkIQ output to console — new logger must not propagate this to file

### 2026-03-19 — runWorkiqJson Retry Logic Tests (8 new tests)

**Test file:** `test/renderer-json-parser.test.js` — added `describe('runWorkiqJson() retry logic')` section.

**Context:** Goose added retry support to `runWorkiqJson()` for malformed JSON responses. The function now accepts `{ maxRetries, retryDelayMs, onRetry }` options. On JSON parse failure it retries up to `maxRetries` times (default 1). EULA errors and `result.success === false` still throw immediately without retry.

**Test setup pattern:** Same as existing EULA tests — `createRendererContext` with mocked `state`, `elements`, `savePersistentState`, and `window.workiq.ask`. All retry tests use `retryDelayMs: 0` to avoid real delays.

**Key gotcha — `_parseFailureCounts` is inaccessible:** The `const _parseFailureCounts = {}` declaration in `json-parser.js` is not exposed as a vm context property (known `const`/`let` limitation). Verified the counter behavior indirectly by capturing `console.warn` output and asserting on the `parse failure #N` messages. Used a regex filter `/parse failure #\d+/` to distinguish from the "retry ... after parse failure" announcement that also contains "parse failure".

**Coverage (8 tests):**
1. Succeeds on first attempt without retrying (callCount === 1)
2. Retries on parse failure, succeeds on second attempt
3. Throws user-friendly error after all retries exhausted (`"Scan returned an unexpected response..."`)
4. EULA error throws immediately — no retry (callCount === 1 despite maxRetries: 3)
5. `result.success === false` throws immediately — no retry (callCount === 1)
6. `onRetry` callback invoked with correct `(attempt, maxRetries)` args
7. `maxRetries: 0` means single attempt only
8. Parse failure count logged correctly per label via console.warn

**Final suite result:** 438 tests, 93 suites, 0 failures.

### 2026-03-26 — moveItemToScanner Tests (8 tests, 1 suite)

**Test file:** `test/renderer-move-item.test.js` — covers `moveItemToScanner(itemId, targetScannerId)` for the new "Move to Scanner" feature.

**Pattern used:** Standard `createRendererContext` + `loadFile` approach (same as `renderer-models-tracking.test.js`). State is seeded in `beforeEach` with 3 items (1 Radar, 2 on scanner-A) and 2 scanners (scanner-A with itemCount=2, scanner-B with itemCount=0). `savePersistentState` is mocked via a call-tracking array.

**Coverage (8 tests):**
1. Move item from Radar to Scanner — scannerId updated from null to target
2. Move item from Scanner to Radar — scannerId set to null when targetScannerId is null
3. Move item from Scanner A to Scanner B — scannerId changes correctly
4. Scanner itemCount updates — source decremented, target incremented
5. No crash when moving from Radar (no source scanner to decrement)
6. No crash when moving to Radar (no target scanner to increment)
7. Returns null for non-existent item
8. savePersistentState called after successful move