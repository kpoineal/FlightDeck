# FlightDeck Architecture

This document describes the internal architecture of FlightDeck for developers working on the codebase.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                     │
│                                                                 │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────────┐  │
│  │  index.js   │  │ ipc-handlers.js│  │   pty-bridge.js      │  │
│  │  App life-  │  │ Route IPC msgs │  │   node-pty → WorkIQ  │  │
│  │  cycle,     │  │ from renderer  │  │   CLI execution      │  │
│  │  window,    │◄─┤ to bridge/     │──┤   ANSI stripping     │  │
│  │  tray       │  │ store/system   │  │   5-min timeout      │  │
│  └─────────────┘  └────────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────────┐  │
│  │  store.js   │  │ window-state.js│  │ ipc/                 │  │
│  │  electron-  │  │ Persist/restore│  │  tracker-popout.js   │  │
│  │  store      │  │ bounds to JSON │  │  Pop-out window mgmt │  │
│  │  data+cold  │  └────────────────┘  └──────────────────────┘  │
│  └─────────────┘                                                │
│                   ┌────────────────┐                            │
│                   │  utils.js      │                            │
│                   │  Logging, URL  │                            │
│                   │  safety, HTML, │                            │
│                   │  markdown      │                            │
│                   └────────────────┘                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
               shared/ipc-contract.js
               (channel name constants)
                         │
                    contextBridge
                    (preload.js)
                    window.workiq
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                     Electron Renderer Process                   │
│                                                                 │
│  ┌─────────┐  ┌───────────┐  ┌─────────────────┐               │
│  │  app.js │  │ events.js │  │ monitor-engine.js│               │
│  │  Init & │  │ DOM event │  │ 30s tick, task   │               │
│  │  tab    │  │ wiring    │  │ item monitoring  │               │
│  │  routing│  │           │  │                  │               │
│  └─────────┘  └───────────┘  └─────────────────┘               │
│                                                                 │
│  ┌───────────────────┐  ┌──────────────┐                        │
│  │ scanner-engine.js │  │  demo.js     │                        │
│  │ Multi-scanner     │  │  ?demo=1     │                        │
│  │ scheduling &      │  │  fixture mode│                        │
│  │ execution engine  │  │              │                        │
│  └───────────────────┘  └──────────────┘                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     models/                              │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐              │    │
│  │  │ item.js  │  │scanner.js│  │briefing.js│              │    │
│  │  │ Unified  │  │ Scanner  │  │ Cache &   │              │    │
│  │  │ item:    │  │ defn,    │  │ normalize │              │    │
│  │  │ schedule,│  │ normalize│  │ meeting   │              │    │
│  │  │ change   │  │ & CRUD   │  │ data      │              │    │
│  │  │ detect   │  ├──────────┤  └───────────┘              │    │
│  │  ├──────────┤  │radar.js  │                              │    │
│  │  │tracking  │  │ Normalize│                              │    │
│  │  │.js       │  │ payload  │                              │    │
│  │  └──────────┘  └──────────┘                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   renderers/                             │    │
│  │  actions.js  briefing.js  history.js  scanner.js         │    │
│  │  kpi.js      radar.js     tracking.js                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  state.js ── electron-store (flightdeck-data + flightdeck-cold) │
│  json-parser.js ── extract JSON from LLM fenced blocks         │
│  search.js ── global search (Ctrl+K)                            │
│  theme.js ── light/dark toggle (system-aware)                   │
│  popout.js ── pop-out window with resizable panels              │
│  prompts.js ── prompt editor, persisted via electron-store      │
│  constants.js ── JSON schemas & prompt suffixes                 │
│  utils.js ── escapeHtml, URL normalization, display helpers     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Main Process

### App Lifecycle (`main/index.js`)

- Creates the main `BrowserWindow` with context isolation and CSP.
- Restores saved window state (position, size, maximized).
- Creates a system tray icon with "Open" and "Quit" menu items.
- Minimizing or closing the window **hides it to the tray** — the app stays alive for background monitoring.
- `window-all-closed` is intentionally a no-op.
- Only tray menu "Quit" or `app.quit()` terminates the process.

### IPC Handlers (`main/ipc-handlers.js`)

All renderer↔main communication flows through named IPC channels defined in `shared/ipc-contract.js` and exposed via `preload.js`. The pop-out window IPC is extracted into `main/ipc/tracker-popout.js`.

| Channel | Direction | Purpose |
|---|---|---|
| `get-app-version` | Renderer → Main | Return the app version string |
| `check-for-updates` | Renderer → Main | Check GitHub Releases for a newer version |
| `ask-workiq` | Renderer → Main | Execute a WorkIQ CLI query via PTY bridge |
| `accept-workiq-eula` | Renderer → Main | Run WorkIQ EULA acceptance via PTY |
| `read-prompt-file` | Renderer → Main | Load a markdown prompt template from `prompts/` |
| `open-markdown-window` | Renderer → Main | Open rendered markdown in a new window |
| `open-tracker-popout` | Renderer → Main | Pop out a tracking item into its own window |
| `open-external` | Renderer → Main | Open a URL in the system browser (with validation) |
| `show-desktop-notification` | Renderer → Main | Display an OS-level notification |
| `store-get` | Renderer → Main | Read a key from electron-store |
| `store-set` | Renderer → Main | Write a key/value to electron-store |
| `store-delete` | Renderer → Main | Delete a key from electron-store |
| `store-get-all` | Renderer → Main | Return all store contents |
| `store-get-size` | Renderer → Main | Return file size of the store on disk |
| `store-migrate-from-localstorage` | Renderer → Main | One-time migration from localStorage to electron-store |
| `store-get-cold-items` | Renderer → Main | Read archived items from cold storage |
| `store-set-cold-items` | Renderer → Main | Write archived items to cold storage |
| `tracker-state-changed` | Renderer → Main (broadcast) | Notify all windows that shared state changed |
| `tracker-state-sync` | Main → Renderer | Tell a window to reload state (response to above) |
| `notification-clicked` | Main → Renderer | Forward notification click to renderer for navigation |

### PTY Bridge (`main/pty-bridge.js`)

- Locates the WorkIQ launcher at `%APPDATA%/npm/node_modules/@microsoft/workiq/bin/workiq.js`.
- Spawns a `node-pty` pseudo-terminal: `node workiq.js ask -q "<prompt>"`.
- Collects output, strips ANSI escape sequences, and filters prompt lines.
- Enforces a **5-minute hard timeout** — kills the PTY process if it hangs.
- Returns cleaned text to the IPC handler.

### Window State (`main/window-state.js`)

- Saves `{ bounds: { x, y, width, height }, isMaximized }` to `<userData>/window-state.json`.
- Debounced (500 ms) on resize/move events to avoid excessive writes.
- On startup, restores position only if saved bounds are visible on a connected display.

### Persistent Store (`main/store.js`)

- Wraps `electron-store` to provide key/value persistence backed by a JSON file on disk.
- **Data store** (`flightdeck-data`) — primary state: tracking items, scanners, briefings, history, user preferences, custom prompts.
- **Cold store** (`flightdeck-cold`) — archived/completed items moved out of the active data store to keep it lean.
- Exposed to the renderer through IPC channels (`store-get`, `store-set`, `store-delete`, `store-get-all`, `store-get-size`, `store-get-cold-items`, `store-set-cold-items`).
- Replaces the earlier `localStorage`-only approach — existing installs auto-migrate via `store-migrate-from-localstorage`.

### Shared IPC Contract (`shared/ipc-contract.js`)

- Single source of truth for all IPC channel name strings.
- Imported by both `main/ipc-handlers.js` and `preload.js` to eliminate string duplication and typo bugs.
- Defines the `IPC_CHANNELS` object with 20 named constants.

---

## Renderer Process

### Initialization (`renderer/app.js`)

- Bootstraps the app: loads persisted state from electron-store, wires events, starts both monitor and scanner engines.
- Manages tab routing between Radar, Briefings, and History views.
- Provides shared utilities: `addHistory()`, `setStatus()`, `showToast()`, WorkIQ reconnect detection.

### State Management (`renderer/state.js`)

- In-memory `state` object hydrated on startup from `electron-store` (via `window.workiq.storeGet()`).
- Stores: tracking items, scanners, radar items, briefings by meeting ID, briefing-seen-at timestamps, history entries, actions, scanner filters, collapsed sections, connected flag, density preferences.
- Automatic migration from `localStorage` → `electron-store` for existing installs.
- History pruning: max **200 entries** and **30 days** on every save.
- Stale briefings (for past meetings) pruned on load.
- Storage size shown in the toolbar.

### Monitor Engine (`renderer/monitor-engine.js`)

Core scheduling loop:

1. A `setInterval` ticks every **30 seconds** (`MONITOR_TICK_MS`).
2. On each tick, iterates all tracking items and checks if any are "due" based on their schedule type.
3. Schedule types:
   - **Interval** — fires every N minutes (15 min – 4 hours).
   - **Weekly** — fires on selected days at a specific time.
   - **One-time** — fires once, then sets `enabled: false`.
4. For each due item, builds a prompt that includes the last **2 update summaries** for de-duplication.
5. Calls `workiq.ask()` via IPC, parses the JSON response.
6. Runs **change detection**: computes field-level hashes (status, severity, summary, evidence links) and compares before/after.
7. Only **substantive changes** trigger the "New Update" badge and desktop notifications. Link-only changes are logged but don't alert.

### Scanner Engine (`renderer/scanner-engine.js`)

A second scheduling loop for user-defined **scanners** — saved prompt-based scans that run on their own schedules:

1. Scanners are independent scan definitions with their own name, prompt, schedule, and configuration.
2. On each tick, iterates all enabled scanners and checks if any are due based on their schedule type (interval, weekly, one-time).
3. For due scanners, builds a prompt from the scanner's custom prompt text and executes via WorkIQ.
4. Handles **missed-run policies**: `skip` (reschedule forward), `run-once` (fire immediately on next tick), or `catch-up` (replay up to 3 missed runs).
5. Supports **run-on-startup** scanners that fire immediately when the app starts.
6. Cross-scanner deduplication prevents the same item from appearing in multiple scanner results.
7. New items discovered by a scanner can be auto-monitored based on configurable severity thresholds.

### Demo Mode (`renderer/demo.js`)

- Activated by `?demo=1` query parameter.
- Loads synthetic data from `demo/fixture.json`.
- Seeds a separate demo store key (`flightdeck.demo.v2`) — never touches real user data.
- Applies ephemeral state (radar items, meetings, ledger) after persistent state loads.
- Zero impact on production code paths.

### Models

Pure data-processing modules with no DOM dependencies:

- **`models/item.js`** — Unified item model that consolidates radar + tracking into a single shape. Every item has all tracking fields; monitoring defaults to OFF for freshly discovered items. Handles schedule computation (`computeNextRunAt`), work-hours windowing, and weekly schedule logic.
- **`models/scanner.js`** — Scanner definition model. Normalizes scanner configs (name, prompt, schedule, notification mode, signal type filters, dedup strategy, auto-archive, retention, exclude keywords, etc.). Provides `createScanner()` and `normalizeScannerDefinition()`.
- **`models/radar.js`** — Normalizes and validates incoming radar scan payloads. Extracts KPI counts.
- **`models/tracking.js`** — Legacy tracking normalization and change-detection signatures.
- **`models/briefing.js`** — Normalizes briefing responses, manages the per-meeting cache (with stable meeting ID resolution), handles daily pruning. Builds fallback sources from embedded URLs.

### Renderers

DOM-rendering functions that build HTML for each view:

- **`renderers/kpi.js`** — KPI cards, severity-mix stacked bar, load donut chart, severity sorting helpers.
- **`renderers/radar.js`** — Unified item rendering in a single pane with per-scanner sections, inline DOM-based severity/status/new-item filters.
- **`renderers/tracking.js`** — Tracking item cards with schedule controls, update history, signal-type filters, work-hours toggle, pop-out button.
- **`renderers/scanner.js`** — Scanner management UI: create/edit form, schedule configuration, advanced settings (notification mode, signal filters, dedup strategy, exclude keywords, auto-archive, retention, missed-run policy).
- **`renderers/briefing.js`** — Briefing cards with expandable sections, day-briefing card, meeting prep rendering.
- **`renderers/history.js`** — Chronological history list entries with inline source links.
- **`renderers/actions.js`** — Action rendering, draft generation, and confirmation modal for suggested actions (Draft Reply, Create To-Do, Schedule 15-min, Nudge).

### Utilities (`renderer/utils.js`)

- `escapeHtml()` — HTML entity encoding for safe DOM insertion.
- `normalizeExternalUrl()` — URL cleaning, scheme validation, and generic-URL-pattern filtering.
- Display helpers: `relativeTime()`, `safeDate()`, `cleanDisplayText()`, `compactLinkLabel()`.
- URL extraction from free text (for evidence link discovery).

### JSON Parser (`renderer/json-parser.js`)

WorkIQ returns natural-language text mixed with JSON. The parser:

1. Looks for fenced code blocks (` ```json ... ``` `).
2. Falls back to extracting raw JSON objects from the text.
3. Normalizes Unicode quotes, strips ANSI contaminants, repairs trailing commas.
4. Multi-stage repair: normalize → parse → collapse whitespace → fix broken quotes.
5. Validates the structure before returning.

### Search (`renderer/search.js`)

- Activated by `Ctrl+K` or clicking the search bar.
- Fuzzy + token matching across radar items, tracking items, and briefings.
- Keyboard navigation (arrow keys, Enter) with active-index highlighting.
- Displays results in a dropdown with overlay backdrop.

### Prompt Construction (`renderer/prompts.js`)

- Loads prompt templates from disk (`prompts/*.md`) via IPC.
- Persists user-customized prompts to electron-store (keyed by prompt name).
- Falls back to bundled defaults when no customization exists.
- Manages a prompt cache for briefing and day-briefing templates.

### Pop-out Windows (`renderer/popout.js`)

- Detected via `?popout=<itemId>` query parameter.
- Renders only the specified tracking item with a dual-panel layout (details + history).
- Resizable panels with a drag handle; panel ratio persisted to `localStorage`.
- Listens for `tracker-state-sync` IPC events to reload when state changes in another window.
- Broadcasts state changes back to the main window and other pop-outs.

---

## Styles (`src/styles/`)

CSS is organized into modular files loaded by `index.html`:

| File | Purpose |
|---|---|
| `tokens.css` | Design tokens (colors, spacing, typography, dark/light theme variables) |
| `layout.css` | App shell layout, toolbar, tabs, grid |
| `components.css` | Shared components (cards, pills, buttons, toasts, inputs) |
| `radar.css` | Radar/tracking item card styles |
| `tracking.css` | Tracking-specific controls (schedule selects, signal filters) |
| `scanner.css` | Scanner form, scanner section headers, advanced settings |
| `briefing.css` | Briefing cards, day-briefing, ledger |
| `search.css` | Search overlay, dropdown, result highlighting |
| `modal.css` | Confirmation modal, action drafts |

---

## Prompt Templates (`src/prompts/`)

| File | Used by |
|---|---|
| `radar-scan.md` | Default radar scan prompt — scans M365 signals, classifies by urgency |
| `briefing.md` | Meeting prep prompt — talk track, risks, follow-ups |
| `day-briefing.md` | Morning "My Day" summary prompt |
| `scanner-template.md` | Default template for new scanner prompts — includes signal-type focus and due-date extraction rules |

---

## Security Model

| Layer | Measure |
|---|---|
| **CSP** | `default-src 'self'; style-src 'self'; script-src 'self'` |
| **Context isolation** | Enabled — renderer cannot access Node.js APIs |
| **Node integration** | Disabled |
| **IPC surface** | 20 named channels exposed through `preload.js`, defined in `shared/ipc-contract.js` |
| **External navigation** | Intercepted and opened in system browser |
| **URL validation** | Rejects non-HTTP(S) schemes; generic M365 root URLs filtered out |
| **LLM output** | HTML-escaped before DOM insertion |
| **PTY timeout** | 5-minute hard timeout kills hung WorkIQ processes |

---

## Data Flow: Radar Scan

```
User clicks "Refresh"
        │
        ▼
renderer/events.js ── reads prompt from prompts/radar-scan.md
        │                (or user-edited prompt)
        ▼
renderer/constants.js ── appends JSON schema suffix
        │
        ▼
window.workiq.ask(prompt) ── IPC invoke
        │
        ▼
main/ipc-handlers.js ── delegates to pty-bridge
        │
        ▼
main/pty-bridge.js ── spawns node-pty → WorkIQ CLI
        │                  waits for output (up to 5 min)
        ▼
Raw CLI output ── stripped of ANSI, filtered
        │
        ▼
renderer/json-parser.js ── extracts JSON from text
        │
        ▼
renderer/models/radar.js ── normalizes payload
        │
        ▼
renderer/renderers/kpi.js ── updates KPI cards
renderer/renderers/radar.js ── renders item cards
renderer/state.js ── persists to electron-store
renderer/renderers/history.js ── logs to history
```

---

## Data Flow: Tracked Item Update

```
monitor-engine.js tick (every 30s)
        │
        ▼
Check each tracking item schedule ── is it due?
        │  (interval / weekly / one-time)
        ▼
Build prompt with item context + last 2 summaries
        │
        ▼
window.workiq.ask(prompt) ── IPC invoke → PTY → WorkIQ
        │
        ▼
Parse JSON response
        │
        ▼
models/item.js ── compute change signature
        │              compare with previous
        ▼
Substantive change?
   ├── Yes → badge + desktop notification + history entry
   └── No  → silent log (or link-only note)
        │
        ▼
state.js ── persist updated item + history (electron-store)
popout.js ── broadcast state-changed to all windows
```

---

## Data Flow: Scanner Execution

```
scanner-engine.js tick (every 30s)
        │
        ▼
Check each scanner schedule ── is it due?
        │  (interval / weekly / one-time / run-on-startup)
        ▼
Build prompt from scanner.prompt + scanner-template.md
        │
        ▼
window.workiq.ask(prompt) ── IPC invoke → PTY → WorkIQ
        │
        ▼
Parse JSON response (json-parser.js)
        │
        ▼
models/item.js ── normalize discovered items
        │
        ▼
Cross-scanner dedup ── filter items already seen
        │
        ▼
Auto-monitor? (severity threshold check)
   ├── Yes → enable monitoring with scanner defaults
   └── No  → add as inbound item only
        │
        ▼
state.js ── persist scanner results + new items
renderers/radar.js ── render in scanner section
```

---

## Test Architecture

Tests use Node.js `node:test` runner with `node:assert`. No external test framework.

### Test Helpers (`test/helpers/`)

- **`electron-mock.js`** — Module-level mocks for `electron`, `node-pty`, and `electron-store`. Intercepts `require()` calls so main-process modules can be tested outside Electron.
- **`renderer-context.js`** — Creates a `vm.Context` with browser-API stubs (`document`, `localStorage`, `window`, `CSS.escape`) for testing vanilla-JS renderer modules that define globals instead of using `module.exports`.

### Test File Naming

Test files follow the pattern `{process}-{module}.test.js`:

| Test file | Module under test |
|---|---|
| `main-ipc-handlers.test.js` | `main/ipc-handlers.js` |
| `main-ipc-tracker-popout.test.js` | `main/ipc/tracker-popout.js` |
| `main-pty-bridge.test.js` | `main/pty-bridge.js` |
| `main-utils.test.js` | `main/utils.js` |
| `main-window-state.test.js` | `main/window-state.js` |
| `renderer-state.test.js` | `renderer/state.js` |
| `renderer-json-parser.test.js` | `renderer/json-parser.js` |
| `renderer-utils.test.js` | `renderer/utils.js` |
| `renderer-popout.test.js` | `renderer/popout.js` |
| `renderer-prompts.test.js` | `renderer/prompts.js` |
| `renderer-scanner-engine.test.js` | `renderer/scanner-engine.js` |
| `renderer-models-briefing.test.js` | `renderer/models/briefing.js` |
| `renderer-models-radar.test.js` | `renderer/models/radar.js` |
| `renderer-models-tracking.test.js` | `renderer/models/tracking.js` |
| `renderer-tracking-renderers.test.js` | `renderer/renderers/tracking.js` |
| `renderer-day-briefing.test.js` | Briefing renderer (day-briefing flow) |
| `renderer-delete-scanner.test.js` | Scanner deletion flow |
| `renderer-move-item.test.js` | Item reordering / cross-scanner moves |
