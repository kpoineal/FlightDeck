# Iceman — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Description:** FlightDeck scans Microsoft 365 signals (email, Teams, meetings, documents) to surface what needs attention, classified by priority. It tracks individual items over time with automated monitoring that checks for new activity on a schedule.

## Learnings

### 2026-02-27 — Value Stream Analysis & Feature Roadmap

**Architecture patterns observed:**
- Vanilla JS, no bundler, `<script>` tag loading in dependency order. All renderer modules share global scope.
- Single mutable `state` object in `state.js` is the source of truth. All modules read/write from it.
- PTY bridge (`main/pty-bridge.js`) spawns `node-pty` → WorkIQ CLI. 5-minute hard timeout. ANSI stripping. Single-request model (no streaming).
- IPC via `contextBridge` in `preload.js`. Channels: `ask-workiq`, `read-prompt-file`, `open-markdown-window`, `open-tracker-popout`, `open-external`, `show-desktop-notification`, `tracker-state-changed`, `tracker-state-sync`, `notification-clicked`.
- Prompt templates are markdown files in `src/prompts/` loaded at init. JSON schemas appended in `constants.js`. User can edit prompts in-app via textarea editors.
- State persisted in localStorage under `flightdeck.persisted.v2`. DEC-008 proposes electron-store migration due to 5MB ceiling.

**Key file paths:**
- App entry: `src/renderer/app.js` (init, tab routing, refresh flows)
- State: `src/renderer/state.js` (save/load, DOM cache, pruning)
- Constants: `src/renderer/constants.js` (JSON schemas, schedule options, storage keys)
- Monitor engine: `src/renderer/monitor-engine.js` (30s tick, change detection, notifications)
- Models: `src/renderer/models/radar.js`, `tracking.js`, `briefing.js`
- Prompts: `src/renderer/prompts.js` (prompt builders), `src/prompts/radar-scan.md`, `src/prompts/briefing.md`
- IPC: `src/main/ipc-handlers.js`, PTY: `src/main/pty-bridge.js`
- HTML shell: `src/index.html` (321 lines, 20 script tags)

**Existing but unused code:**
- `buildActionDraftPrompt()` in `prompts.js` generates email draft prompts but is never called from the UI. This is the foundation for the P0 "Inline Action Drafts" feature.
- `parseIntent()` in `app.js` handles a command bar with intent parsing, but the command input is `type="hidden"` — effectively disabled in the UI.

**User preferences (the project owner):**
- Favors sleek, Apple-inspired UI (DEC-011, DEC-012).
- Wants localStorage leak fixes and storage efficiency (DEC-009, DEC-010).
- Prefers no-framework, no-bundler approach (DEC-001).
- Wants electron-store migration for storage scalability (DEC-008).

**Value streams ranked:**
1. Signal triage (Radar) — highest value, replaces hours of manual scanning.
2. Persistent monitoring (Tracking) — differentiator vs. one-shot dashboards.
3. Meeting prep (Briefings) — saves 10-20 min per meeting.
4. Audit trail (History) — accountability and debugging.

**Top gaps identified:**
- No actionability (can't draft replies or take action from FlightDeck).
- No cross-item intelligence (items analyzed in isolation).
- No time-based analytics (no trend visibility).
- Storage ceiling (localStorage 5MB).
- No notification center (desktop notifications are fire-and-forget).
- No day-level briefing (only meeting-scoped).

**Feature roadmap delivered:** `.squad/decisions/inbox/iceman-feature-roadmap.md` — 15 features across P0/P1/P2, 5 detailed user stories for P0 features, recommended execution order across 5 phases.

### 2026-03-09 — Updated Roadmap & "What to Build Next" Analysis

**Roadmap cross-reference completed:**
- P0-1 (Inline Action Drafts): DONE — `buildActionDraftPrompt()`, `buildSuggestionDraftPrompt()` fully wired in `renderers/actions.js` with "Create Draft" and "Draft ↗" buttons.
- P0-2 (Electron-store Migration): Still OPEN — DEC-008 unchanged, localStorage still in use, 5 MB ceiling risk.
- P0-3 (Day Briefing): DONE — DEC-015, full implementation with 30 tests.
- P0-4 (Command Bar): Code 90% built, `commandInput` hidden. `parseIntent()` handles 7 intents. Needs type="text" flip and UX polish.
- P0-5 (Notification Center): Still OPEN — fire-and-forget desktop notifications only.
- P1-4 (Persistent Prompts): DONE — DEC-032, localStorage-based prompt persistence.
- P1-5 (Demo Mode): DONE — DEC-017, CLI flag, fixture, interceptor.
- All P1-1/P1-2/P1-3 and P2 features remain OPEN.

**New capabilities since last analysis:**
- Three-layer evidence link extraction (DEC-029/030): structured → inline → footnote pipeline.
- IPC contract catalog in `src/shared/ipc-contract.js` (DEC-021).
- Shared renderer primitives reduce tracking/popout duplication (DEC-024).
- Full CSP hardening — no `unsafe-inline` (DEC-014).
- 338+ tests across all layers.

**Top-5 recommended next features:**
1. Command Bar activation (XS effort — code already exists)
2. Electron-store migration (M effort — storage ceiling imminent)
3. In-app Notification Center (M effort — IPC relay ready)
4. Trend Analytics on tracked items (M-L effort — data exists, needs visualization)
5. Stale Item Detection + auto-archive (S effort — timestamp data available)

**Key files for next phase:**
- Command bar: `src/index.html` (line 23, hidden input), `src/renderer/app.js` (parseIntent, handleCommandSubmit)
- Electron-store: `src/renderer/state.js` (savePersistentState/loadPersistentState), `src/renderer/constants.js` (STORAGE_KEY)
- Notifications: `src/main/ipc-handlers.js`, `src/preload.js` (onNotificationClicked)
- Trends: `src/renderer/models/tracking.js` (updateHistory arrays), `src/renderer/renderers/tracking.js`
- Stale detection: `src/renderer/monitor-engine.js` (lastRunAt), `src/renderer/models/tracking.js`

**Updated analysis delivered:** `.squad/decisions/inbox/iceman-next-features-march.md`

### 2026-03-16 — README.md Professional Rewrite

**What changed:**
- Rewrote README.md from scrappy POC doc to polished open-source README.
- Added centered logo (`src/icon.png`) + tagline + shield badges (License, Node.js, Electron, Build, Changelog).
- Added proper Table of Contents with anchor links.
- Replaced verbose Problem/Solution section with a punchy one-paragraph elevator pitch at the top.
- Reorganized sections to follow best-in-class open-source README structure: logo→badges→pitch→screenshot→TOC→features→quickstart→build→architecture→testing→security→contributing→license.
- Converted feature table to use emoji icons for scannability.
- Used GitHub callout blocks (`> [!WARNING]`, `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`) throughout.
- Wrapped project structure and test coverage in collapsible `<details>` sections.
- Wrapped custom tracker creation steps in collapsible section.
- Added dedicated Contributing section linking to CONTRIBUTING.md.
- Monitoring engine schedule types now in a clean table instead of bullet list.
- Configuration section now uses a table instead of bullets.
- Updated Tech Stack Electron version from 33+ to 35+ (matching actual `package.json`).
- Updated `package.json` description from "Simple POC to call workiq CLI from Electron" to "Air traffic control for your Microsoft 365 workload".
- Removed standalone "What's New" section — Changelog badge in header handles this.
- Removed standalone "Screenshots" section — screenshots now inline with feature descriptions.

### 2026-03-19 — Feature Review: Multi-Scanner, Todos, Sparklines

**User request:** Kyle asked for product analysis on three feature ideas:
1. Multiple radar scanners with per-scanner exclusion payloads and persistent cards
2. Todo functionality
3. Sparkline/timeline visualization for tracker history

**Key architecture insights for feature planning:**
- Exclusion system is in `prompts.js` — `getTrackedExclusionLabels()` builds exclusion list from `state.trackingItems`, capped at `MAX_TRACKED_EXCLUSIONS` (12). Single global exclusion payload today.
- `buildRadarScanPrompt()` appends exclusions to the base prompt. Multi-scanner would need N instances of this.
- `state.radarItems` is a flat array — multi-scanner requires restructuring to `scanners[].radarItems` or similar.
- `updateHistory[]` on tracking items already has timestamps, severity, summaries, and change descriptions — perfect data source for sparklines. No new data collection needed.
- Custom tracking items (created via `createCustomTrackingItem()` in `renderers/tracking.js`) already function as lightweight todos — they have title, context, severity, schedule, and monitoring.
- State persistence migrated to electron-store (`main/store.js`). No more localStorage 5MB ceiling.

**Priority recommendation delivered:**
1. P0: Sparkline/Timeline (lowest effort, data exists, highest glanceability improvement)
2. P1: Multiple Radar Scanners (high value, significant architecture change)
3. P2: Todo Functionality (scope as "tracking completion" not "todo app" to avoid gravity well)

**Decisions captured:** `.squad/decisions/inbox/iceman-feature-review.md`

**User preferences observed:**
- Kyle thinks in terms of "persistent cards" — items that survive across scans, not ephemeral signal lists
- Interested in visual density of information (sparklines = glanceable temporal patterns)
- Gravitates toward making FlightDeck a "stay here" app rather than a "check and leave" app
- All existing content topics preserved: SmartScreen warnings, Enable WorkIQ flow, mermaid diagram, screenshots, monitoring engine, state persistence, security, project tree, prerequisites, tech stack.

**Decisions:**
- Kept "License TBD" text but also added a grey shield badge for it.
- Folded "What's New" into a Changelog badge rather than a standalone section — the CONTRIBUTING.md and CHANGELOG.md links are more useful.
- Separated "Build from Source" and "Quick Start (MSI)" into distinct sections for clarity.
- Added test files that were missing from the old coverage table (ipc-handlers, tracker-popout, day-briefing, tracking-renderers, popout, prompts).

### 2026-03-19 — Cross-Agent: Maverick Feature Feasibility Assessment

**Context:** Maverick delivered architecture feasibility in parallel with Iceman's product analysis. Key technical findings:
- Multiple Scanners: MEDIUM complexity. ~7 files touched. `state.radarItems` → `state.scanners[]`. New `Scanner` model. N× WorkIQ calls per refresh.
- Todos: LOW-MEDIUM complexity. Tracking system is 80% there — add `completed`/`completedAt` fields, quick-add input, completion filter.
- Sparkline: LOW-MEDIUM complexity. Data exists in `updateHistory[]`. New `buildSparklineHtml(item)` — pure SVG.
- **Priority divergence:** Maverick recommends Todo → Sparkline → Scanners (by complexity). Iceman recommends Sparkline → Scanners → Todos (by strategic value). Both agree sparkline should ship first.
- Decisions captured: DEC-051 (Iceman product analysis), DEC-052 (Maverick feasibility).

### 2026-03-27 — Scanner Collapsed View UX Redesign Analysis

**User request:** Kyle shared screenshots of the radar view and asked how to make it more functional, informative, and modern. Core complaint: collapsed scanner sections "don't tell me a whole lot."

**Key UX problems identified:**
1. Collapsed headers are information-dead zones — only show icon + name + count
2. KPI section creates ~250px of dead scroll above actionable scanner content
3. No per-scanner severity breakdown — all scanners look the same when collapsed
4. No scanner health/status signals (last run, new items, blocked counts)
5. Uniform visual weight across scanners regardless of urgency
6. Admin buttons (pause, settings) take header real estate from operational data

**6 proposals delivered (prioritized):**
- P0: Rich collapsed headers with inline severity mini-bar + micro-counts + blocked/new badges + last-scan time
- P0: Severity-tinted scanner headers (left-border color by highest severity)
- P1: Compact collapsible KPI strip (250px → 44px, saves scroll)
- P1: Smart scanner sorting by urgency score (critical×3 + blocked×2 + new×1)
- P1: Peek expansion (progressive disclosure — top 3 items without full expand)
- P2: Overflow menu for infrequent admin actions (⏸ ⚙️ → ⋯ menu)

**6 user stories with acceptance criteria delivered.** Execution phases: (1) Rich headers + tinting, (2) Compact KPIs + smart sort, (3) Overflow menu + peek.

**Key files for implementation:**
- Header rendering: `src/renderer/renderers/radar.js` — `buildSectionHeader()` (line 117)
- Header CSS: `src/styles/radar.css` — `.radar-section-header*` classes
- KPI section: `src/index.html` (lines 75-120), `src/renderer/renderers/kpi.js`
- Scanner grouping/sorting: `src/renderer/renderers/radar.js` — `groupItemsBySource()`, `renderRadarList()`
- Severity helpers: `src/renderer/renderers/kpi.js` — `countSeverityFromItems()`, `severityClass()`

**Competitive benchmarks referenced:** PagerDuty service tiles, Linear project rows, GitHub Projects columns, AWS CloudWatch alarm states, Grafana dashboard panels.

**Decisions captured:** `.squad/decisions/inbox/iceman-scanner-ux.md`

### 2026-03-27 — Interactive Scanner Pills Product Analysis

**User request:** Kyle proposed making the scanner header pills (severity dots, attention badges, "new" indicator) clickable to filter within that scanner. Asked for full product thinking.

**Key product decisions made:**
- **Per-scanner inline filter model** — each scanner gets its own ephemeral filter state, independent of the global filter bar. Not an intersection model; single-active-filter per scanner.
- **Click behavior:** Click pill → expand scanner + show only matching items. Click again → toggle off. Click different pill → switch filter. No multi-select (that's command bar territory).
- **Global filter interaction:** Changing the global filter clears all inline scanner filters. Global always wins on change — clean slate principle.
- **State:** `state.scannerFilters[sourceId] = { type, value }` — not persisted. Ephemeral per-session. Cleared on new scan data arrival.
- **Event architecture:** Pill click handlers intercept before the existing header-collapse handler in `events.js`. Clicks on pills filter; clicks elsewhere on header still collapse/expand. Current delegation pattern already supports this insertion.

**Additional features recommended:**
- "Mark all as seen" per scanner (clears `isNew`/`hasNewUpdate` for scanner items)
- Pill hover states with cursor:pointer + scale transition
- Active pill visual: solid fill, scale(1.05), outline ring, small × clear button
- Filter indicator on scanner header when inline filter is active

**Deferred:**
- Cross-scanner filtering (global filter bar's job)
- Multi-select / intersection pills (command bar)
- Keyboard nav for pills (accessibility pass later)
- Smart context-sensitive sort on filter activation

**5 user stories delivered** with acceptance criteria: US-1 (severity pills), US-2 (status badges), US-3 (new indicator), US-4 (mark all seen), US-5 (global-clears-inline).

**Key implementation notes for agents:**
- `applyFilter()` in `renderers/radar.js` runs once globally. Inline filters need per-section application inside the `renderRadarList()` loop after global filter.
- Pill CSS selectors: `.radar-sev-dot`, `.radar-attn-badge`, `.radar-new-indicator` — add `--active` modifier classes.
- Data attributes for severity: `.sev-critical`, `.sev-elevated`, `.sev-observe`. For status: `.attn-blocked`, `.attn-waiting`.

**Decisions captured:** `.squad/decisions/inbox/iceman-interactive-pills.md`

<!-- Append learnings here as they are discovered -->
