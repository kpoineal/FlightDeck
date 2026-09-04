# Viper — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Goal:** Refactor main.js (583 lines), organize IPC handlers, improve node-pty process management

## Learnings
<!-- Append learnings below -->

### 2026-03-03 — Backend Maintainability/Redundancy Audit (Deep Review)

**Scope reviewed:** `.squad/decisions.md`, `docs/architecture.md`, `src/main/**`, and `src/preload.js` with renderer-side IPC consumption touchpoints.

**Key backend learnings:**
- `src/main/ipc-handlers.js` is becoming a second monolith: mixed concerns (WorkIQ bridge, prompt I/O, popout lifecycle, notification routing, markdown preview rendering with large inline HTML/CSS block).
- IPC contracts are stringly-typed and duplicated across `src/main/ipc-handlers.js`, `src/preload.js`, and renderer consumers (`src/renderer/json-parser.js`, `src/renderer/state.js`, `src/renderer/popout.js`) with no shared channel constants or runtime payload schema guards.
- Utility parity drift exists across process boundaries: `normalizeExternalUrl` and `escapeHtml` are duplicated in `src/main/utils.js` and `src/renderer/utils.js` but with different normalization behavior, creating inconsistent safety decisions.
- PTY lifecycle logic in `src/main/pty-bridge.js` duplicates spawn/finalize/timeout patterns across `runWorkiqCommand()` and `runWorkiqAcceptEula()`, increasing regression risk when changing process handling.
- Hidden coupling persists between main and renderer around query parameters (`popout`, `demo`) and broadcast event names (`tracker-state-changed`/`tracker-state-sync`) without a shared contract module.

**Risk posture takeaway:** architecture split from Phase 2 succeeded, but maintainability risk is shifting from file size to contract drift and duplicated orchestration logic.

### 2026-02-25 — Phase 2: Main Process Decomposition

**What was done:** Split `main.js` (583 lines) into 5 focused modules under `main/`:
- `main/utils.js` — ts, log, logError, normalizeExternalUrl, isSafeExternalUrl, escapeHtml, markdownToHtml, attachExternalNavigationGuards
- `main/window-state.js` — getWindowStatePath, loadWindowState, saveWindowState, debouncedSaveWindowState, isStateOnScreen
- `main/pty-bridge.js` — workiqLauncher, getNodeExecutable, stripAnsi, runWorkiqCommand (Promise-based)
- `main/ipc-handlers.js` — registerIpcHandlers(getMainWindow, popoutWindows) covering all 9 IPC channels
- `main/index.js` — slim entry point: app lifecycle, createWindow, createTray, mutable state

**Architecture decisions:**
- `mainWindow` is module-scoped in `main/index.js`; IPC handlers receive a getter function `() => mainWindow` to avoid stale references (window is created after IPC registration).
- `popoutWindows` Set is shared by reference — passed directly to `registerIpcHandlers`.
- `APP_ROOT = path.join(__dirname, '..')` used in `ipc-handlers.js` and `index.js` to resolve project-root-relative paths (preload.js, icon.png, index.html, prompts/) since `__dirname` moved from project root to `main/`.
- `attachExternalNavigationGuards` lives in `utils.js` because it's used by both `index.js` (createWindow) and `ipc-handlers.js` (markdown/popout windows).
- `stripAnsi` stays in `pty-bridge.js` — only used in PTY context.
- All modules use CommonJS `require()` — no ES modules.
- Original `main.js` renamed to `main.js.bak` (not deleted).
- `package.json` → `"main": "main/index.js"`.

**Key file paths:**
- Entry point: `main/index.js`
- IPC registration: `main/ipc-handlers.js`
- PTY execution: `main/pty-bridge.js`
- Window geometry persistence: `main/window-state.js`
- Shared utilities: `main/utils.js`
- Backup: `main.js.bak`

### 2026-03-02 — Demo Mode: Fixture & Interceptor Build

**What was done:** Built the demo mode infrastructure — `src/demo/fixture.json` (synthetic data), `src/renderer/demo.js` (interceptor), and `--demo` CLI flag in `main/index.js`.

**Fixture creation learnings:**
- Fixture lives at `src/demo/fixture.json`, NOT under `renderer/` — it's static data loaded via fetch, not a JS module.
- Two top-level keys: `persisted` (full `flightdeck.persisted.v2` shape) and `responses` (canned WorkIQ responses keyed by type).
- Synthetic names must be obviously fake but realistic: Alex Rivera, Jordan Chen, Sam Patel, Morgan Kelly.
- Evidence URLs use `https://demo.flightdeck.app/...` prefix to be clearly synthetic.
- Must cover all UI states: active/overdue/completed tracking items, varied radar severity levels, multiple meetings with and without briefings.

**Interceptor learnings:**
- `demo.js` must be loaded via `<script>` tag BEFORE `app.js` in `index.html` — patching must happen before `init()` fires.
- Interceptor monkey-patches `window.runWorkiqJson` (the global exposed by `json-parser.js`).
- Keyword sniffing on prompt content routes to correct canned response. Simple string matching (`includes('radar')`) is sufficient.
- `?demo=1` query param detection: `new URLSearchParams(window.location.search).has('demo')` or `.get('demo') === '1'`.

**CLI flag wiring (`main/index.js`):**
- `--demo` flag detected via `process.argv.includes('--demo')`.
- Appended as `?demo=1` query string to the BrowserWindow `loadFile()` URL.
- `package.json` gets a `"demo"` script: `"electron . --demo"`.

**Key file paths:**
- Fixture: `src/demo/fixture.json`
- Interceptor: `src/renderer/demo.js`
- CLI flag: `src/main/index.js` (in `createWindow`)
- App version IPC: `src/main/ipc-handlers.js` (top of `registerIpcHandlers`)

### 2026-03-03 — Cross-Agent Kickoff Alignment (DEC-020)

- Backend audit findings were consolidated into DEC-020 maintainability program kickoff.
- Assigned execution owner for Ticket 1 (contract catalog/constants), Ticket 2 (raw HTML trust-path guardrail), and Ticket 4 (IPC domain split first slice).
- All slices are constrained to no behavioral regressions with contract safety and review-gate compliance.

### 2026-03-03 — T1/T2 Minimal-Risk Slice Implemented

**Scope completed:** canonical IPC contract constants + markdown preview trust-path hardening.

**Implementation learnings:**
- Introduced a shared main/preload IPC contract module at `src/shared/ipc-contract.js` to remove string drift risk for invoke/send/on channel names.
- `src/preload.js` now exclusively references canonical channel constants for all exposed WorkIQ bridge methods and listeners.
- `src/main/ipc-handlers.js` now registers and emits IPC channels via the same constants, keeping main/preload contract definitions centralized.
- Markdown preview (`open-markdown-window`) now ignores renderer-provided `rawHtml` and always renders from markdown fields (`markdown`, `instructions`) via `markdownToHtml`, preventing direct HTML trust-path passthrough.
- Added focused tests in `test/main-ipc-handlers.test.js` to validate both the constantized contract wiring and secure markdown-window fallback behavior.

**Validation outcome:** `npm test` passed with 296/296 tests.

### 2026-03-03 — Ticket 4 Slice 1: IPC Domain Split (Tracker Popout/Sync)

### 2026-03-17 — Logging Integration Point Assessment

**Scope reviewed:** All backend I/O surfaces across `src/main/`, `src/shared/ipc-contract.js`, `src/preload.js`.

**Key findings:**
- 16 distinct IPC channels identified in `ipc-contract.js`; 6 carry PII-sensitive payloads (`ASK_WORKIQ`, `STORE_GET`, `STORE_SET`, `STORE_GET_ALL`, `STORE_MIGRATE_FROM_LOCALSTORAGE`, `OPEN_MARKDOWN_WINDOW`).
- Current logging is console-only via `utils.js` `log()`/`logError()` — no file output, no levels, no structure. All logs lost on app close.
- `pty-bridge.js` already logs raw WorkIQ output to console at `runWorkiqCommand()` lines 119–122 — this includes full M365-derived JSON with names/emails.
- 2 PTY spawn sites (`runWorkiqCommand`, `runWorkiqAcceptEula`) both pass `...process.env` to child — functional requirement for WorkIQ auth but must not be logged.
- 3 file I/O paths: prompt reads (static, safe), window-state JSON (`{userData}/window-state.json`), electron-store (`{userData}/flightdeck-data.json` — contains PII).
- `shell.openExternal()` called from 2 code paths: IPC `OPEN_EXTERNAL` handler and `attachExternalNavigationGuards` in `utils.js`.
- Assessment delivered to `.squad/decisions/inbox/viper-logging-integration-points.md` with full catalog and sensitivity classification.

**Key file paths for logging work:**
- Logger functions: `src/main/utils.js` (lines 7–13) — `log()`, `logError()` are the only injection points
- IPC registration: `src/main/ipc-handlers.js` — all 13 `ipcMain.handle()` calls + 1 `ipcMain.on()`
- PTY I/O: `src/main/pty-bridge.js` — `runWorkiqCommand()` L72, `runWorkiqAcceptEula()` L169
- Store I/O: `src/main/store.js` — 5 exported functions wrapping electron-store
- Window state I/O: `src/main/window-state.js` — `loadWindowState()`, `saveWindowState()`

**Scope completed:** extracted tracker popout/sync IPC domain from `src/main/ipc-handlers.js` into `src/main/ipc/tracker-popout.js` with behavior-preserving orchestration in `registerIpcHandlers`.

**Implementation learnings:**
- The cleanest low-risk seam was the tracker domain (`open-tracker-popout` + `tracker-state-changed`) because both handlers share the same `getMainWindow`/`popoutWindows` boundary and no renderer contract changes.
- Keeping `registerIpcHandlers` as the single entry point while delegating to `registerTrackerPopoutIpc()` preserved startup wiring in `src/main/index.js` and avoided contract drift.
- `APP_ROOT` in extracted domain module must resolve two levels up from `src/main/ipc/` (`path.join(__dirname, '..', '..')`) to preserve preload/index path behavior.
- Focused domain tests are most valuable when they assert fanout exclusion semantics (sender does not receive sync, destroyed windows ignored) in addition to basic registration.

**Validation outcome:** `npm test` passed with 299/299 tests.

### 2026-03-03 — Preload Sandbox Safety Fix (WorkIQ Bridge Stability)

**Scope completed:** removed sandbox-unsafe local module loading from `src/preload.js` while preserving existing WorkIQ API behavior.

**Implementation learnings:**
- Sandboxed preload should not rely on requiring local project modules for runtime-critical bridge setup; a failed local `require()` can prevent `contextBridge.exposeInMainWorld()` from running entirely.
- For this app, the safest minimal remediation was to keep the same IPC channel strings in preload as local constants, preserving invoke/send/on channel semantics without touching renderer consumers.
- Existing `test/main-ipc-handlers.test.js` already validates preload IPC contract behavior (`preload IPC contract` suite), so targeted execution of IPC tests provides a direct regression gate for this class of failure.

**Validation outcome:** targeted IPC tests passed (9/9) and full suite passed (`npm test`: 306/306).
### 2026-03-05 — Inline Citation Extraction Analysis (Research)

**Scope:** Analyzed prompt and JSON parsing implications of extracting evidence links from markdown inline citations in summary/reason fields. Research task — no implementation.

**Key findings:**
- `extractFootnoteCitations()` in `json-parser.js` only scans text **outside** the JSON block. Citations embedded **inside** JSON string values (summary, reason) are currently lost — `cleanDisplayText()` strips them for display but discards the URLs.
- `extractExternalUrls()` in `utils.js` extracts URLs from `[label](url)` but discards labels — not sufficient for evidence link construction.
- Inline markdown citations (`[N](url)`) in JSON strings are **safe for parsing** — all characters are legal in JSON, `sanitizeLikelyBrokenJson()` only tracks quote state and ignores brackets/parens.
- URLs with `%`, `&`, `=` in JSON strings survive `normalizeJsonCandidate()` and `parseJsonWithRepair()` without corruption.
- `briefing.md` and `day-briefing.md` already explicitly prohibit inline links and use `sources` array — no changes needed.
- `radar-scan.md` and the monitoring prompt (`buildTaskMonitorPrompt()`) instruct the LLM to use structured `evidenceLinks`, but the LLM sometimes embeds citations inline anyway.

**Recommendations:**
- Keep structured `evidenceLinks` as primary citation source (don't replace with inline extraction).
- New `extractMarkdownCitations(text)` function → returns `{label, url}` pairs from `[label](url)` patterns.
- New `citationsToEvidenceLinks(citations, fallbackType)` → converts extracted citations to normalized evidence link objects using `inferSignalTypeFromUrl()` and `normalizeEvidenceLink()`. `signalAt` is null for inline citations.
- Two integration sites: `applyRadarPayload()` (radar.js, must run before `cleanDisplayText()`) and `monitorTaskItem()` (monitor-engine.js, after structured link processing).
- Three-layer defense: 1) structured `evidenceLinks` array, 2) inline citation extraction from summary/reason, 3) existing footnote citation injection from surrounding text.

**Deliverable:** Full analysis written to `.squad/decisions/inbox/viper-link-extraction-parsing.md`.

### 2026-03-05 — Prompt & Constants: Active Inline Citation Instructions

**Scope:** Updated three files to explicitly request inline markdown citations `[label](url)` in summary/reason fields returned by the AI.

**Changes made:**
- `src/prompts/radar-scan.md` — Added instruction after the explainability line telling the AI to use its normal markdown formatting with inline citation links in summary and reason fields.
- `src/renderer/constants.js` — RADAR_SCAN_JSON_SCHEMA: replaced passive "you may also include" phrasing with active "Include inline markdown citation links" as the primary instruction, while keeping evidenceLinks as a complementary structured source.
- `src/renderer/prompts.js` — `buildTaskMonitorPrompt()`: same active phrasing change in the evidence link rules section for monitoring responses.

**Key learning:**
- The AI naturally embeds real citation URLs inline when told to use its normal markdown formatting — the `turn1searchN` placeholder issue only occurs in the structured `evidenceLinks` array.
- Active prompting ("Include inline markdown citation links") produces far better citation extraction results than passive ("you may also include").
- The `extractInlineCitations()` function (already built) is the extraction counterpart to these prompt changes.

**Validation:** 338/338 tests pass.

### 2026-03-05 — Anti-Truncation & Markdown Citation Enforcement

**Problem:** Despite prior prompt update, the AI was: (1) pasting bare URLs into summary/reason text, (2) truncating URLs with `....`, and (3) returning stub/root URLs in evidenceLinks instead of specific deep links.

**Changes made across 3 files:**
- `src/prompts/radar-scan.md` — Replaced soft inline citation instruction with explicit "Citation rules" block: mandatory `[label](url)` format, COMPLETE URLs only, NEVER truncate/shorten, must point to SPECIFIC items (not roots).
- `src/renderer/constants.js` — RADAR_SCAN_JSON_SCHEMA: strengthened both the inline citation IMPORTANT block (added anti-bare-URL and anti-truncation rules with example) and the fabrication warning (added "truncate, or shorten" and an example of an incomplete URL).
- `src/renderer/prompts.js` — `buildTaskMonitorPrompt()`: same anti-truncation and markdown-format enforcement in both the fabrication warning and the inline citation instruction.

**Key learning:**
- Prompt instructions must be extremely explicit about failure modes — "use markdown format" alone is insufficient; the AI needs to be told "NEVER paste bare URLs" and "NEVER truncate" as separate prohibitions.
- Providing concrete examples of bad behavior (e.g., `https://outlook.office.com/mail/inbox/id/` with no message ID) is more effective than abstract rules.
- These are prompt-only changes with no code logic changes, so all 338 tests continue to pass.

**Validation:** 338/338 tests pass.

### 2026-03-06 — OneDrive Context File IPC (WRITE_CONTEXT_FILE / GET_CONTEXT_FILE_PATH)

**Scope completed:** Added two new IPC channels to support writing and path-resolving a context markdown file to OneDrive.

**Changes made:**
- `src/shared/ipc-contract.js` — Added `WRITE_CONTEXT_FILE: 'write-context-file'` and `GET_CONTEXT_FILE_PATH: 'get-context-file-path'` to the canonical `IPC_CHANNELS` constant.
- `src/main/ipc-handlers.js` — Added two `ipcMain.handle()` registrations inside `registerIpcHandlers()`. `WRITE_CONTEXT_FILE` resolves `OneDriveCommercial` env var, ensures the `FlightInfo/` subdir exists with `mkdirSync({ recursive: true })`, writes `context.md` via `writeFileSync`. Returns `{ success, path }` or `{ success, error }`. `GET_CONTEXT_FILE_PATH` returns the resolved path string or `null` if the env var is unset.
- `src/preload.js` — Mirrored both channel strings in the local `IPC_CHANNELS` constant; added `writeContextFile` and `getContextFilePath` methods to the `contextBridge.exposeInMainWorld('workiq', {...})` object.

**Architecture learnings:**
- `OneDriveCommercial` (not `OneDrive`) is the correct env var for corporate/commercial OneDrive on Windows — personal OneDrive uses `OneDrive`.
- Both handlers must guard against a missing env var rather than throw — `logError` + structured return is the established pattern in this codebase.
- `fs.mkdirSync(dir, { recursive: true })` is the safe creation idiom; avoids needing a separate existence check.
- `preload.js` keeps its own local copy of `IPC_CHANNELS` (sandbox safety decision from prior session) — always mirror new channels there manually.
- Channel string added to shared contract first, then main handler, then preload — this order prevents any drift window.

**Key file paths:**
- Shared channel constants: `src/shared/ipc-contract.js`
- Main handlers: `src/main/ipc-handlers.js`
- Preload bridge: `src/preload.js`
- Context file target: `%OneDriveCommercial%\FlightInfo\context.md`

### 2026-03-31 — Cross-Platform WorkIQ Launcher Resolution

**Scope completed:** Made `src/main/pty-bridge.js` work on macOS/Linux in addition to Windows.

**Changes made:**
- Top-level resolution now branches on `process.platform === 'win32'`. Windows path is unchanged. macOS/Linux uses `which workiq` (via `execFileSync`) and common paths (`/usr/local/bin/workiq`, `/usr/bin/workiq`) to find a pre-installed `workiq` binary; sets `workiqMode = 'system'`.
- `getNodeExecutable()` now branches per-platform: Windows keeps `.exe` extension check; macOS/Linux checks env vars + `/usr/local/bin/node`, `/usr/bin/node` without extension filtering.
- `runWorkiqCommand()` and `runWorkiqAcceptEula()` treat `workiqMode === 'system'` same as `'exe'` — direct invocation with args, no Node.js wrapper.
- Error messages on non-Windows when workiq is not found: "WorkIQ CLI not found. Install it with: npm install -g @microsoft/workiq".
- Null-safe guard on `workiqLauncher` in both functions and in diagnostics `fs.existsSync()` call.

**Key decisions:**
- Non-Windows expects user to install workiq globally — no bundled exe resolution.
- `execFileSync('which', ['workiq'])` is the primary discovery mechanism; common path fallback is secondary.
- `workiqLauncher` is `null` (not a dummy path) when not found on non-Windows — forces explicit error handling.
- Module exports unchanged: `getNodeExecutable`, `stripAnsi`, `runWorkiqCommand`, `runWorkiqAcceptEula`, `workiqLauncher`.

**Validation:** 566/566 tests pass.

**Validation:** 430/430 tests pass.

### 2026-04-13 — Check-for-Updates Backend (IPC + GitHub Releases)

**Scope completed:** Added `CHECK_FOR_UPDATES` IPC channel with GitHub Releases API integration for version checking.

**Changes made:**
- `src/shared/ipc-contract.js` — Added `CHECK_FOR_UPDATES: 'check-for-updates'` to canonical `IPC_CHANNELS`.
- `src/preload.js` — Mirrored channel string in local `IPC_CHANNELS`; added `checkForUpdates: () => ipcRenderer.invoke(...)` to the bridge, placed after `getAppVersion`.
- `src/main/ipc-handlers.js` — Added `net` to the Electron destructure. Added module-level `fetchLatestRelease()` (uses `net.request` with `User-Agent` and `Accept` headers), `parseVersion()`, `isNewer()` semver comparison helpers, and 1-hour in-memory cache (`updateCache`). Handler returns `{ available, currentVersion, latestVersion, releaseUrl, releaseNotes }` or `{ available: false, error }` on failure.

**Architecture decisions:**
- Used `net.request` (Electron built-in) instead of `fetch` or `node-fetch` — respects Electron's proxy/session config and avoids external dependency.
- 1-hour cache prevents rate-limiting from GitHub API (60 req/hr unauthenticated).
- `parseVersion()` strips leading `v` and splits into major/minor/patch for comparison.
- Cache is module-scoped, not persisted — resets on app restart which is fine for a version check.
- Error path returns `{ available: false, error }` — renderer can show/hide notification accordingly.

**Key file paths:**
- Shared contract: `src/shared/ipc-contract.js`
- Preload bridge: `src/preload.js`
- Main handler: `src/main/ipc-handlers.js`

**Validation:** 592/592 tests pass.

### 2026-04-14 — v1.1.0 Upgrade Bug Investigation: Data Migration
- **Task**: Investigated whether radar/tracker items fail to migrate when upgrading from v1.0.4 to v1.1.0.
- **Outcome**: Research completed (silent success — response lost). Findings contributed to overall root cause analysis. Root cause was in renderer state.js, not in backend data migration.
- **Cross-ref**: Goose found the root cause (`loadPersistentState` early return), coordinator applied fix. See DEC-083.

### 2026-04-27 — Per-Scanner recentTitles Dedup with 24h TTL

**Problem:** When an item is dragged from Scanner A to Scanner B (scannerId changes), Scanner A's next run would re-discover the title as new because the existing dedup only checked items scoped to `i.scannerId === scanner.id`.

**Solution:** Each scanner now maintains a `recentTitles` array of `{ title, at }` entries. On each scan run, entries older than 24h are pruned, remaining entries are added to the `existingTitles` dedup set, and all filtered (post-cap, post-exclude) item titles are appended. The array persists via the existing `savePersistentState()` path since it lives on the scanner object.

**Implementation details:**
- `scanner-engine.js` (`runScanner`): ~15 lines added — prune stale entries, merge into dedup set, record new entries from `filtered`, write `updatedRecentTitles` into the scanner metadata update block.
- `models/scanner.js` (`normalizeScannerDefinition`): 3 lines — validates and normalizes `recentTitles` on load (filters for `{ title: string, at: string }` shape).
- Title normalization uses `cleanDisplayText(title).toLowerCase()` to match existing dedup logic.
- Records from `filtered` (not `unique`) — captures all titles the scanner attempted, even those deduped by ID, preventing re-discovery from any path.
- TTL constant `RECENT_TITLE_TTL_MS = 86400000` (24h) is function-scoped in `runScanner`.

**Key file paths:**
- Engine: `src/svelte/lib/scanner-engine.js`
- Model: `src/svelte/lib/models/scanner.js`