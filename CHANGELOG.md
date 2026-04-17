# Changelog

All notable changes to FlightDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-04-17

### Added — Svelte Migration

- **Full Svelte 5 renderer** — Complete port from vanilla JS to Svelte 5 with runes syntax (`$state`, `$derived`, `$props`), reactive stores, and component architecture.
- **27 Svelte components** — Modular UI: `RadarView`, `BriefingsView`, `HistoryView`, `TrackerCard`, `TrackerRow`, `ScannerSection`, `SummaryStrip`, `Topbar`, `SearchOverlay`, `ScannerSettingsModal`, `AddTaskModal`, `ScheduleControls`, `EditableField`, `ActivityTimeline`, `ConfirmModal`, `ConnectBanner`, `Toast`, and more.
- **Vite build pipeline** — `vite build` produces optimized `dist-renderer/` output with CSS code-splitting, Svelte runtime deduplication via `manualChunks`, and hot module replacement in dev mode.
- **Reactive store layer** — Centralized state management via Svelte writable/derived stores: `items`, `scanners`, `meetings`, `briefingsByMeetingId`, `history`, `kpis`, `filteredItems`, and UI state stores.

### Added — New Features

- **Demo mode** — `npm run demo` launches with realistic sample data and zero WorkIQ API calls. Separate `flightdeck.demo.v2` storage key — real data never touched. All dates auto-shift to current time so demos always look fresh.
- **Demo reseed** — `npm run demo:reseed` forces fresh fixture data on every launch, useful after fixture changes.
- **Automated screenshots** — `npm run screenshots` uses Playwright Electron support to capture 24 PNGs (12 views × 2 themes) for documentation. Captures Radar, Briefings, History, tracker card tabs (Activity/Overview/Monitor), scanner settings modal, add task modal, KPI strip, topbar.
- **Demo fixture dataset** — 9 tracked items across 3 scanners (Customer Escalations, Project Risks, Contract & Compliance), 4 upcoming meetings with briefing content, day briefing with priorities and time blocks, 12 history entries.
- **New vs Updated badge system** — Separated "New" (purple) and "Updated" (green) into distinct visual concepts across cards, rows, scanner filters, ticker, and Mission Control. Both badges show simultaneously when applicable.
- **Mission Control KPI strip** — 5 switchable KPI modes (Pulse, Mission Control, Heatmap, Momentum, Ticker). LATEST section with 3 most recent changes. NEXT MEETINGS section with cached meeting countdown.
- **Ticker tape** — Scrolling bar showing new discoveries, updates, and upcoming meetings with NEW/UPDATED badges. Click navigates to item with section expand + highlight animation.
- **Meeting caching** — Meetings persisted to store with `meetingsLastFetched` timestamp. Cached meetings load instantly if < 1 hour old and same calendar day.
- **Inline editable fields** — Click-to-edit for title, due date, owner, and done criteria directly on tracker cards.
- **Scanner config tooltips** — All 22 scanner form fields have descriptive hover tooltips.
- **In-progress filter** — Filter button added to scanner section headers.
- **Desktop notification navigation** — Notification click navigates to card with pulse + ring animation, without auto-marking as seen.

### Added — Color System

- **Semantic color tokens** — `--color-new` (purple `#bf5af2`) and `--color-updated` (green) in `tokens.css`, independent of `--color-success`/`--color-elevated`.
- **3 color conflicts resolved** — NEW vs In Progress (both were blue), Waiting vs Snoozed (both orange), Updated vs Complete (both green).

### Changed

- **Renderer architecture** — Migrated from vanilla JS DOM manipulation to Svelte 5 component architecture with reactive stores. All UI rendering is now declarative.
- **State persistence** — Moved from localStorage to `electron-store` via IPC bridge. Two stores: `flightdeck-data` (active) and `flightdeck-cold` (archived items >24hrs).
- **Build process** — All `dist` scripts chain `build:renderer` first. `dist-renderer/` included in electron-builder packaging. CI validates Svelte build.
- **Scanner defaults** — Removed unused "Group" field and webhook URL from config UI.
- **Default scan interval** — Updated scanner defaults.
- **Timestamp consistency** — Card pills, LATEST, and ticker all use same source (`lastChangedAt || discoveredAt`, not `lastRunAt`).

### Fixed

- **Version display** — Shows FlightDeck version (from `package.json`) instead of Electron version in topbar.
- **Svelte runtime deduplication** — `manualChunks` config prevents `effect_orphan` errors from multiple Svelte instances.
- **Immutable store updates** — Svelte detects item changes correctly.
- **Case-insensitive status/severity comparison** — Prevents false transitions in update history.
- **Monitor engine** — Only records actual status/severity changes, not false positives.
- **Scanner inline filter** — Auto-clears when zero results remain. Event propagation stopped on filter buttons.
- **Highlight animation** — Prevented double-glow on notification click.
- **Demo fixture statuses** — Uses valid lifecycle values (Waiting, Blocked, Complete) instead of made-up statuses.

### Removed

- **Legacy vanilla JS renderer** — Deleted `src/renderer/` (14 files, 5,801 lines) and 13 associated test files + test helper (6,487 lines). Total: 12,288 lines of dead code removed.
- **localStorage for app state** — All app state now persists via electron-store. Only `fd-theme` (theme preference) remains in localStorage.

### Documentation

- **README.md** — Rewritten from scratch for Svelte 5 + Vite + electron-store stack. Correct project structure, screenshots, demo mode docs.
- **CONTRIBUTING.md** — Rewritten with Svelte 5 runes, Vite build process, correct file paths, branch → PR → merge workflow.
- **architecture.md** — Rewritten with Svelte component hierarchy, reactive stores, persistence bridge, scanner/monitor engines, 6 Mermaid diagrams.
- **user-guide.md** — Added Demo Mode section with `npm run demo`, `demo:reseed`, and `screenshots` commands.

### Tests

- 33 new tests for New vs Updated badge separation.
- Updated persistence tests for meeting caching.
- Updated popout test for Svelte renderer path.
- Fixed test script to reference only existing test files after legacy cleanup.

## [1.1.0] - 2026-04-13

### Added

- **Version update notification** — Checks GitHub Releases API and notifies when a new version is available (#68).
- **Auto-completion** — Added auto-completion support (#55).
- **Unified radar & tracker** — Combined radar and tracker into a single cohesive view (#34, #52).
- **Scanner UX improvements** — Enhanced scanner filter accordion, status pills, and new-item counts (#38, #50, #58, #59).
- **Sparkline POC** — Multi-scanner sparkline visualizations for trend insight (#29, #30).
- **Tiered storage** — Support for tiered storage backends.
- **Cross-platform workiq** — workiq integration works across Windows, macOS, and Linux (#41).
- **Dependabot** — Automated dependency updates for npm and GitHub Actions (#15).
- **PR & issue templates** — Standardized contribution workflows (#16).

### Fixed

- **Windows taskbar identity** — Corrected icon and app identity in dev and packaged modes (#60, #61, #62, #66).
- **macOS packaging** — Fixed DMG publishing and packaged app issues (#42, #46, #47).
- **Dashboard UI** — Redesigned dashboard layout and fixed visual issues (#53, #54).
- **Radar UX cleanup** — Fixed duplicate radar dropdown and other radar polish (#39, #44).
- **Scanner paused dimming** — Cards no longer dim when scanner is paused.
- **Startup status copy** — Neutralized unavailable status copy on startup (#67).

### Changed

- **Default scan interval** — Changed default scanner interval to 4 hours (#40).
- **Pinned action SHAs** — All GitHub Actions pinned to full commit SHAs for supply-chain security (#48).
- **Dependency bumps** — electron 41.0.3, electron-store 11.0.2, @microsoft/workiq 0.4.0, actions/checkout v6, actions/setup-node v6, azure/login v3, azure/trusted-signing-action v1.1.0.

## [1.0.4] - 2026-03-18

### Added

- **File logging** — Console logs now write to `userData/logs` for easier debugging.
- **Apache 2.0 License** — Added LICENSE file for open source distribution.
- **Security policy** — Added SECURITY.md with Electron-specific vulnerability reporting scope.
- **CODEOWNERS** — Require owner review on security-critical paths (main process, preload, dependencies).
- **Code signing** — Azure Trusted Signing integrated into release workflow (Authenticode-signed MSI).
- **Incremental builds** — Automated weekday builds with auto-versioning via `github.run_number`.
- **Winget workflows** — Publishing pipelines for `FlightDeck.FlightDeck` (stable) and `FlightDeck.FlightDeck.Preview` (incremental).

### Fixed

- **Notification click on Windows** — Fixed notification click handler and backfill `lastChangedAt` for tracking items.
- **Updated timestamp accuracy** — Decoupled "Updated" display timestamp from last-checked time.
- **Tracker inline citations** — Strengthened citation rendering and replaced `alert()` with toast notifications.

### Changed

- **Pinned node-pty** — Locked to exact version 1.1.0 to prevent unaudited minor bumps.
- **Branding** — Styled FLIGHTDECK title with blue DECK accent, updated tagline.
- **README** — License badge updated from TBD to Apache 2.0.

## [1.0.3] - 2026-03-06

### Fixed

- **EULA detection & auto-reconnect** — When WorkIQ returns EULA acceptance text instead of data (e.g. after MSI reinstall), FlightDeck now automatically resets the connection state and re-shows the "Enable WorkIQ" button so the user can re-accept the EULA without manual localStorage clearing.

## [1.0.2] - 2026-03-02

### Added

- **Auto-accept EULA** — Clicking "Enable WorkIQ" now automatically runs `workiq accept-eula` before the health check, with auto-confirmation of Y/N prompts.
- **Native WorkIQ exe resolution** — Prefers the bundled `workiq.exe` (no Node.js dependency) over `workiq.js`, with architecture-aware detection (x64/arm64).
- **DevTools diagnostics** — Enable WorkIQ flow logs detailed diagnostics to the browser console: WorkIQ mode, launcher path, executable, args, exit code, PTY output chunks, and pass/fail markers.
- **Demo mode isolation** — Demo mode uses a separate localStorage key to protect real data (#9).
- **Draft generation** — Generate drafts from suggestions with popout two-panel layout and preview redesign (#7).
- **Version badge** — App version indicator displayed in the header bar.

### Fixed

- **Duplicate summary in history** — Hide duplicate summary text in change history entries (#15).
- **Suggested next steps persistence** — Persist `suggestedNextSteps` after mark-seen (#11).
- **Minimize behavior** — Minimize to taskbar instead of system tray (#10).
- **History timestamps** — Fix history timestamp/severity bugs, add task creation toast & glow.
- **Screenshot references** — Correct swapped radar/tracking and briefings/history screenshot references.

### Changed

- Tag-based releases — no MSI built on every PR merge (#6).
- Improved error messaging when WorkIQ returns no output (suggests signing in via terminal).

### Docs

- Added user guide with screenshots and First Launch walkthrough.
- Added hero section with Scan/Track/Brief workflow to README.
- Added What's New section with version history to README.

## [1.0.1] - 2026-02-27

### Fixed

- Unpack WorkIQ binaries from asar so they can execute in packaged builds.
- Use static badge for download link (shields.io cannot access private repos).

## [1.0.0] - 2026-02-27

### Added

- **Radar view** — AI-prioritized inbound M365 signals (Critical / Elevated / Observe) with evidence links and suggested next steps.
- **Tracking view** — User-created monitored tasks with configurable schedules (interval, weekly, one-time), severity levels, signal-type filters, and desktop notifications on substantive changes.
- **Briefings view** — One-click AI meeting prep with headline, key updates, decisions needed, risks, talk track, follow-ups, and source links. Results cached per meeting.
- **History view** — Chronological audit trail of all scans, updates, and detected changes (auto-pruned to 200 entries / 30 days).
- **Global search** (`Ctrl+K`) across radar items, tracked tasks, and briefings.
- **KPI dashboard** — Critical / Elevated / Observe counts, severity-mix bar chart, and total-load donut chart.
- **System tray integration** — App minimizes to tray; monitors schedules and delivers desktop notifications in the background.
- **Pop-out windows** — Open any tracked item in its own window with real-time state synchronization.
- **Light / dark theme** toggle.
- **Editable radar prompt** — In-app prompt editor panel for customizing the WorkIQ scan prompt.
- **WorkIQ CLI integration** via `node-pty` pseudo-terminal bridge with ANSI stripping and 5-minute timeout.
- **Window state persistence** — Remembers position, size, and maximized state across restarts.
- **State persistence** — `localStorage`-backed storage with automatic migration (v1 → v2) and stale-data pruning.
- **Content Security Policy** — `default-src 'self'` with context isolation enabled.
- **Test suite** — 9 test files using the Node.js built-in test runner covering main-process utilities, renderer models, JSON parser, and state management.
