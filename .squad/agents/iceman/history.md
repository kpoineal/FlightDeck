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
- All existing content topics preserved: SmartScreen warnings, Enable WorkIQ flow, mermaid diagram, screenshots, monitoring engine, state persistence, security, project tree, prerequisites, tech stack.

**Decisions:**
- Kept "License TBD" text but also added a grey shield badge for it.
- Folded "What's New" into a Changelog badge rather than a standalone section — the CONTRIBUTING.md and CHANGELOG.md links are more useful.
- Separated "Build from Source" and "Quick Start (MSI)" into distinct sections for clarity.
- Added test files that were missing from the old coverage table (ipc-handlers, tracker-popout, day-briefing, tracking-renderers, popout, prompts).

<!-- Append learnings here as they are discovered -->
