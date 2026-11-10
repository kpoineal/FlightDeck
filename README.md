<div align="center">
  <p>
    <img src="src/icon.png" alt="" height="48" />
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/flightdeck-title-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/flightdeck-title-light.svg">
      <img alt="FlightDeck" src="docs/flightdeck-title-dark.svg" height="28">
    </picture>
  </p>
  <p><strong>Your personal work-intelligence dashboard</strong></p>

  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
  ![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
  ![Electron](https://img.shields.io/badge/Electron-35%2B-47848F?logo=electron&logoColor=white)
  ![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
  [![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-blue)](CHANGELOG.md)
</div>

---

FlightDeck scans your Microsoft 365 signals — email, Teams, meetings, documents — and surfaces what needs your attention, ranked by priority. Track items over time with automated monitoring and walk into every meeting prepared with AI-generated briefings. All AI responses are grounded in your real M365 data with deep-link citations. Every prompt is visible and editable — no black boxes.

![Radar view — inbound signals prioritized by severity](docs/screenshots/01-radar-view-dark.png)

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Demo Mode](#demo-mode)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Data Persistence](#data-persistence)
- [Scripts Reference](#scripts-reference)
- [Testing](#testing)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Feature | Description |
|---|---|
| 📡 **Radar** | AI-prioritized signals classified as Critical / Elevated / Observe, organized by scanner |
| 🔍 **Scanners** | Named, scheduled AI scans with customizable prompts, dedup, auto-monitor, and notification controls |
| 📌 **Tracking** | Enable monitoring on any item with configurable schedules, signals, and desktop notifications |
| 📋 **Briefings** | One-click AI meeting prep — headline, key updates, risks, talk track, and more |
| ☀️ **My Day** | Daily briefing synthesizing meetings, tracked items, and priorities into a morning summary |
| 🕘 **History** | Audit trail of every scan, update, and detected change |
| 🔎 **Search** | Global search (`Ctrl+K`) across all items and briefings |
| 🖥️ **System Tray** | Runs in the background; monitors schedules and delivers notifications even when minimized |
| 🌓 **Light / Dark Theme** | Toggle between light and dark modes; follows system preference by default |
| 🪟 **Pop-out Windows** | Open any tracked item in its own window with real-time sync |
| ♻️ **Lifecycle Management** | Items progress through in-progress → blocked → waiting → complete → archived with auto-detection |

> [!TIP]
> See [docs/user-guide.md](docs/user-guide.md) for the full user guide with screenshots and walkthrough of every feature.

### 📡 Scan — surface what matters

Scanners are named, scheduled AI scans that you configure with custom prompts. Each scanner runs on its own schedule and surfaces items ranked by urgency: **Critical**, **Elevated**, or **Observe**. Items include a summary, the people involved, source links, and suggested next steps.

### 📌 Track — monitor what you care about

Enable monitoring on any item, or add a custom tracked item directly to a scanner. FlightDeck monitors items on a schedule you configure — by interval, day/time, or one-time — and notifies you via desktop toast when it detects net-new data.

![Tracker card — expanded item with activity timeline and status](docs/screenshots/03-tracker-card-expanded-dark.png)

### 📋 Brief — prepare for every meeting

Generate AI-powered briefings for your upcoming meetings. Each briefing surfaces key updates, decisions needed, top risks, a talk track, and follow-ups — all sourced from your real M365 activity.

![Briefings view — AI-generated meeting prep](docs/screenshots/05-briefings-view-dark.png)

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | Required when building from source ([download](https://nodejs.org/)); installers include their runtime |
| **WorkIQ CLI** | Windows bundles **1.0.1**; macOS/Linux require `npm i -g @microsoft/workiq@1.0.1` |
| **Microsoft Copilot license** | Required by WorkIQ for M365 data access |
| **Tenant admin consent** | Your organization must [grant WorkIQ access](https://github.com/microsoft/work-iq/blob/main/ADMIN-INSTRUCTIONS.md) to M365 signals |

---

## Quick Start

### Install from release

**Windows:**
```powershell
winget install FlightDeck.FlightDeck
```

**macOS:**
Download the latest `.dmg` from [GitHub Releases](../../releases/latest), open it, and drag FlightDeck to Applications.

### Build from source

```bash
git clone <repo-url>
cd FlightDeck
npm install
npm start          # builds the renderer then launches Electron
```

On first launch, click **Enable WorkIQ** in the connect banner. FlightDeck accepts the local WorkIQ EULA, then uses buffered CLI commands. WorkIQ owns Microsoft sign-in and credentials; complete its sign-in if prompted. Once connected, a Radar scan and calendar refresh run immediately.

> [!NOTE]
> WorkIQ answers use buffered `workiq ask --json --no-streaming` commands; structured reads and confirmed writes use CLI entity commands. FlightDeck does not start an MCP server or manage OAuth tokens. On macOS/Linux, ensure `workiq` and `node` are in your PATH. Windows prefers the bundled executable. Fully quit FlightDeck from the tray and relaunch with `npm start` after a main-process or dependency update.

### Build installers

```bash
npm run dist          # Windows MSI
npm run dist:mac      # macOS DMG
npm run dist:linux    # Linux AppImage + deb
```

Build output goes to the `dist/` directory.

---

## Demo Mode

Demo mode loads synthetic fixture data so you can explore FlightDeck without a WorkIQ connection or Copilot license.

```bash
npm run demo            # launch with cached demo data
npm run demo:reseed     # regenerate fixtures, then launch
```

Demo mode is read-only — scanners and monitoring are disabled.

---

## Project Structure

```
FlightDeck/
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.js               # App lifecycle, window & tray creation
│   │   ├── ipc-handlers.js        # IPC channel handlers (ask-workiq, store, popout, …)
│   │   ├── pty-bridge.js          # node-pty bridge to WorkIQ CLI
│   │   ├── store.js               # small settings / legacy import inputs
│   │   ├── state-service.js       # production SQLite ownership and engine leases
│   │   ├── state-worker.js        # indexed queries and atomic incremental commands
│   │   ├── utils.js               # Logging, URL safety, HTML/markdown helpers
│   │   ├── window-state.js        # Persist & restore window bounds
│   │   └── ipc/
│   │       └── tracker-popout.js  # Popout window IPC handlers
│   ├── svelte/                    # Renderer process (Svelte 5 + Vite)
│   │   ├── App.svelte             # Root component — routing, engines, persistence
│   │   ├── main.js                # Main window entry point
│   │   ├── popout.js              # Pop-out window entry point
│   │   ├── components/            # UI components (27 Svelte files)
│   │   │   ├── RadarView.svelte
│   │   │   ├── BriefingsView.svelte
│   │   │   ├── HistoryView.svelte
│   │   │   ├── TrackerCard.svelte
│   │   │   ├── ScannerSection.svelte
│   │   │   ├── SearchOverlay.svelte
│   │   │   └── …
│   │   └── lib/                   # Core logic & state
│   │       ├── stores.js          # Svelte reactive stores (items, scanners, meetings, …)
│   │       ├── persistence.js     # electron-store read/write via IPC
│   │       ├── scanner-engine.js  # Scanner tick engine
│   │       ├── monitor-engine.js  # Per-item monitoring tick engine
│   │       ├── json-parser.js     # Extract JSON from LLM output
│   │       ├── prompts.js         # Prompt template builders
│   │       ├── actions.js         # History, item CRUD helpers
│   │       ├── utils.js           # Renderer-side utilities
│   │       └── models/            # Data-model helpers (item, scanner, tracking)
│   ├── prompts/                   # Markdown prompt templates sent to WorkIQ
│   │   ├── radar-scan.md
│   │   ├── briefing.md
│   │   ├── day-briefing.md
│   │   └── scanner-template.md
│   ├── shared/
│   │   └── ipc-contract.js        # IPC channel name constants
│   ├── styles/                    # CSS (design tokens + component sheets)
│   ├── app.html                   # Main window HTML shell
│   ├── popout.html                # Popout window HTML shell
│   └── preload.js                 # contextBridge → window.workiq API
├── dist-renderer/                 # Vite build output (generated)
├── test/                          # Tests (Node.js built-in test runner)
│   └── helpers/                   # Electron mocks
├── docs/                          # Architecture docs & screenshots
├── scripts/                       # Tooling (screenshot capture)
├── vite.config.js                 # Vite + Svelte build configuration
├── svelte.config.js               # Svelte compiler config
└── package.json
```

---

## Architecture

FlightDeck is an Electron app with a **Svelte 5** renderer built by **Vite**.

```
┌──────────────────────────────────────────────────────┐
│  Renderer  (Svelte 5 · dist-renderer/)               │
│  stores.js ←→ persistence.js ──IPC──→ electron-store │
│  scanner-engine.js / monitor-engine.js               │
│  json-parser.js / prompts.js                         │
├──────────────────────────────────────────────────────┤
│  preload.js  (contextBridge → window.workiq)         │
├──────────────────────────────────────────────────────┤
│  Main Process  (Node.js)                             │
│  ipc-handlers.js → workiq-cli-client.js → CLI        │
│  store.js (electron-store)                           │
└──────────────┬───────────────────────────────────────┘
               │ ask --json --no-streaming / fetch / create
               ▼
        WorkIQ CLI → Microsoft Copilot → Microsoft Graph (M365)
```

1. The renderer loads a **prompt template** and sends it via IPC to the main process
2. The main process queues requests through local CLI subprocesses; generated answers use `workiq ask --json --no-streaming`, while structured operations use `fetch` and `create`
3. WorkIQ forwards the prompt to **Microsoft Copilot**, which queries **Microsoft Graph**
4. The complete CLI JSON envelope is validated before its answer is parsed; an empty answer with a conversation ID can resume within the two-attempt read budget
5. The renderer normalizes the payload, updates Svelte stores, and persists state to **electron-store** via IPC

> See [docs/architecture.md](docs/architecture.md) and [docs/architecture-diagrams.md](docs/architecture-diagrams.md) for detailed Mermaid diagrams.

---

## Data Persistence

Application domain state uses **SQLite**, owned by one main-process service and worker per profile. Renderers use revisioned incremental commands, bounded projections, archive pages and lazy details over IPC.

| What | Store | Key / Location |
|---|---|---|
| Threads, scanners, proposals, history, preferences | SQLite worker | `<userData>/state-normal/`; revisioned atomic commands |
| Archived / completed items | Same SQLite database | Indexed cold tier, paginated queries and lazy detail |
| Demo state | Separate SQLite database | `<userData>/state-demo/`; never shared with normal state |
| Legacy domain JSON | Import/recovery input only | Validated one-time import with pre-import backups; no dual writes |
| Window bounds & maximized state | File | `<userData>/window-state.json` |
| Theme preference | `localStorage` | `fd-theme` (only theme uses localStorage) |

History is auto-pruned to **200 entries / 30 days**. Stale briefings (for past meetings) are pruned on load.

Opt-in, bounded reload/persistence diagnostics and an **isolated offline Electron baseline**
are described in [docs/state-diagnostics.md](docs/state-diagnostics.md). Diagnostics are off
by default. Cached data now publishes before WorkIQ validation, while remote operations
remain gated. Writes omit duplicate legacy item arrays and controlled reload/quit
requires an acknowledged flush. See [state ownership and recovery](docs/state-storage.md).
The SQLite worker/importer is active in production. Invalid profiles fail visibly
without silently falling back to stale JSON or empty state.

---

## Scripts Reference

| Script | Command | Description |
|---|---|---|
| **start** | `npm start` | Build renderer then launch Electron |
| **dev** | `npm run dev` | Vite dev server (renderer only, hot reload) |
| **build:renderer** | `npm run build:renderer` | Vite production build → `dist-renderer/` |
| **demo** | `npm run demo` | Launch with demo fixture data |
| **demo:reseed** | `npm run demo:reseed` | Regenerate demo fixtures, then launch |
| **screenshots** | `npm run screenshots` | Capture screenshots via Playwright |
| **test** | `npm test` | Run all tests (Node.js built-in test runner) |
| **test:state** | `npm run test:state` | Offline persistence, IPC, diagnostics and startup regression tests |
| **test:state:reload** | `npm run test:state:reload` | Build and measure isolated generated profiles in Electron (30 warm reloads per scenario) |
| **test:state:durability** | `npm run test:state:durability` | Isolated production-renderer reload, failure, popout and source-review smoke |
| **test:state:sqlite** | `npm run test:state:sqlite` | Active worker repository/import/recovery tests |
| **test:state:production** | `npm run test:state:production` | Large generated-profile production-entry migration/reload/edit/delete/multiwindow acceptance |
| **test:state:runtime** | `npm run test:state:runtime` | Real Electron main/worker/production-renderer SQLite capability probe |
| **bench:state:sqlite** | `npm run bench:state:sqlite` | Generated Node worker bounded queries and incremental edits, 30 samples |
| **bench:state:node** | `npm run bench:state:node` | Isolated Conf storage microbenchmark; not Electron end-to-end |
| **dist** | `npm run dist` | Build renderer + Windows MSI installer |
| **dist:mac** | `npm run dist:mac` | Build renderer + macOS DMG |
| **dist:linux** | `npm run dist:linux` | Build renderer + Linux AppImage/deb |

---

## Testing

Tests use the **Node.js built-in test runner** — no extra framework required.

```bash
npm test
```

| File | Covers |
|---|---|
| `main-utils.test.js` | URL normalization, HTML escaping, markdown→HTML |
| `main-window-state.test.js` | State load/save, on-screen detection |
| `main-pty-bridge.test.js` | ANSI stripping, Node executable discovery |
| `main-ipc-handlers.test.js` | IPC channel handler logic |
| `main-ipc-tracker-popout.test.js` | Tracker pop-out IPC |

---

## Security

- **Context Isolation** enabled; `nodeIntegration` disabled
- **Content Security Policy**: `default-src 'self'; style-src 'self'; script-src 'self'`
- External URLs are intercepted and opened in the system browser — never inside the Electron window
- URL validation rejects non-HTTP(S) schemes before opening
- HTML in LLM output is escaped before rendering
- All renderer ↔ main communication goes through a typed IPC contract (`ipc-contract.js`)

---

## Tech Stack

| Component | Technology |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) 35+ |
| UI framework | [Svelte](https://svelte.dev/) 5 |
| Build tool | [Vite](https://vite.dev/) 8 |
| Terminal bridge | [node-pty](https://github.com/microsoft/node-pty) |
| AI backend | [Local WorkIQ CLI](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/workiq-overview) (Microsoft Copilot) |
| Persistence | [electron-store](https://github.com/sindresorhus/electron-store) |
| Tests | Node.js built-in `node:test` |
| Screenshots | [Playwright](https://playwright.dev/) |

---

## Contributing

Contributions are welcome! Whether it's a bug report, feature idea, or a pull request — we'd love your help.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, branching workflow, and the release process.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).