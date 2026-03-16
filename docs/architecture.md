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
│  │  tray       │  │ system APIs    │  │   5-min timeout      │  │
│  └─────────────┘  └────────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌─────────────┐  ┌────────────────┐                            │
│  │  utils.js   │  │ window-state.js│                            │
│  │  Logging,   │  │ Persist/restore│                            │
│  │  URL safety │  │ bounds to JSON │                            │
│  └─────────────┘  └────────────────┘                            │
└────────────────────────┬────────────────────────────────────────┘
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
│  │  Init & │  │ DOM event │  │ 30s tick,        │               │
│  │  tab    │  │ wiring    │  │ schedule checks  │               │
│  │  routing│  │           │  │ auto-scan        │               │
│  └─────────┘  └───────────┘  └─────────────────┘               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     models/                              │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐              │    │
│  │  │ radar.js │  │tracking.js│ │briefing.js│              │    │
│  │  │ Normalize│  │ Schedule  │  │ Cache &   │              │    │
│  │  │ payload  │  │ compute,  │  │ normalize │              │    │
│  │  │          │  │ change    │  │ meeting   │              │    │
│  │  │          │  │ detection │  │ data      │              │    │
│  │  └──────────┘  └──────────┘  └───────────┘              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   renderers/                             │    │
│  │  actions.js  briefing.js  history.js                     │    │
│  │  kpi.js      radar.js     tracking.js                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  state.js ── localStorage (flightdeck.persisted.v2)             │
│  json-parser.js ── extract JSON from LLM fenced blocks         │
│  search.js ── global search (Ctrl+K)                            │
│  theme.js ── light/dark toggle                                  │
│  popout.js ── pop-out window sync                               │
│  prompts.js ── in-app prompt editor                             │
│  constants.js ── JSON schemas & prompt suffixes                 │
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

All renderer↔main communication flows through named IPC channels exposed via `preload.js`:

| Channel | Direction | Purpose |
|---|---|---|
| `ask-workiq` | Renderer → Main | Execute a WorkIQ CLI query via PTY bridge |
| `read-prompt-file` | Renderer → Main | Load a markdown prompt template from `prompts/` |
| `open-markdown-window` | Renderer → Main | Open rendered markdown in a new window |
| `open-tracker-popout` | Renderer → Main | Pop out a tracking item into its own window |
| `open-external` | Renderer → Main | Open a URL in the system browser (with validation) |
| `show-desktop-notification` | Renderer → Main | Display an OS-level notification |
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

---

## Renderer Process

### Initialization (`renderer/app.js`)

- Bootstraps the app: loads persisted state, wires events, starts the monitor engine.
- Manages tab routing between Radar, Tracking, Briefings, and History views.

### State Management (`renderer/state.js`)

- Single `localStorage` key: `flightdeck.persisted.v2`.
- Stores: tracking items, briefings by meeting ID, briefing-seen-at timestamps, history entries, connected flag, density preferences.
- Automatic migration from v1 → v2 schema.
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

### Models

Pure data-processing modules with no DOM dependencies:

- **`models/radar.js`** — Normalizes and validates incoming radar scan payloads. Extracts KPI counts.
- **`models/tracking.js`** — Computes next-due timestamps, normalizes tracking items, builds change-detection signatures, determines if an update is substantive.
- **`models/briefing.js`** — Normalizes briefing responses, manages the per-meeting cache, handles daily pruning.

### Renderers

DOM-rendering functions that build HTML for each view:

- **`renderers/kpi.js`** — KPI cards, severity-mix stacked bar, load donut chart.
- **`renderers/radar.js`** — Radar item cards with severity badges, evidence links, next steps.
- **`renderers/tracking.js`** — Tracking item cards with schedule controls, update history, pop-out button.
- **`renderers/briefing.js`** — Briefing cards with expandable sections.
- **`renderers/history.js`** — Chronological history list entries.
- **`renderers/actions.js`** — Suggested-action chip rendering.

### JSON Parser (`renderer/json-parser.js`)

WorkIQ returns natural-language text mixed with JSON. The parser:

1. Looks for fenced code blocks (` ```json ... ``` `).
2. Falls back to extracting raw JSON objects from the text.
3. Validates the structure before returning.

### Search (`renderer/search.js`)

- Activated by `Ctrl+K` or clicking the search bar.
- Searches across radar items, tracking items, and briefings.
- Displays results in a dropdown with overlay backdrop.

### Pop-out Windows (`renderer/popout.js`)

- Detected via `?popout=<itemId>` query parameter.
- Renders only the specified tracking item.
- Listens for `tracker-state-sync` IPC events to reload when state changes in another window.
- Broadcasts state changes back to the main window and other pop-outs.

---

## Security Model

| Layer | Measure |
|---|---|
| **CSP** | `default-src 'self'; style-src 'self'; script-src 'self'` |
| **Context isolation** | Enabled — renderer cannot access Node.js APIs |
| **Node integration** | Disabled |
| **External navigation** | Intercepted and opened in system browser |
| **URL validation** | Rejects non-HTTP(S) schemes |
| **LLM output** | HTML-escaped before DOM insertion |

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
renderer/state.js ── persists to localStorage
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
models/tracking.js ── compute change signature
        │                 compare with previous
        ▼
Substantive change?
   ├── Yes → badge + desktop notification + history entry
   └── No  → silent log (or link-only note)
        │
        ▼
state.js ── persist updated item + history
popout.js ── broadcast state-changed to all windows
```
