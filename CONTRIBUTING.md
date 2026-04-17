# Contributing to FlightDeck

Thanks for your interest in contributing! This guide covers setup, conventions, and workflow.

---

## Getting Started

```bash
git clone <repo-url>
cd FlightDeck
npm install
npm run dev          # Start the Vite dev server (renderer hot-reload)
npm start            # Build renderer + launch Electron
```

### Prerequisites

- **Node.js** v18+
- **npm** v9+

---

## Development Workflow

FlightDeck is an Electron app with a **Svelte 5** renderer built by **Vite**.

- **`npm run dev`** — starts the Vite dev server for rapid UI iteration.
- **`npm start`** — builds the renderer then launches Electron.
- **`npm run demo`** — runs the app with demo fixture data.
- **`npm run demo:reseed`** — regenerates demo fixture data and launches.
- **`npm run screenshots`** — captures screenshots via Playwright.

### Renderer (Svelte 5)

UI code lives in `src/svelte/`. Components use **Svelte 5 runes** for reactivity:

- `$state` — reactive state
- `$derived` — computed values
- `$props` — component props

Entry points: `src/svelte/main.js` (app window) and `src/svelte/popout.js` (popout window).

### Main Process (Electron)

Main-process code lives in `src/main/`. Entry point: `src/main/index.js`.
IPC handlers, PTY bridge, store, and window-state management are separate modules.

---

## Build Process

Vite builds the renderer into `dist-renderer/`.

```bash
npm run build:renderer    # Vite build → dist-renderer/
npm run dist              # Build renderer + package MSI (Windows)
npm run dist:mac          # Build renderer + package DMG/zip (macOS)
npm run dist:linux        # Build renderer + package AppImage/deb (Linux)
```

Vite config: `vite.config.js` — root is `src/`, output is `dist-renderer/`, Svelte runtime is chunked into a shared bundle.

---

## File Organization

| Directory | Purpose |
|---|---|
| `src/main/` | Electron main process (lifecycle, IPC, PTY, utilities) |
| `src/main/ipc/` | IPC sub-handlers (e.g., tracker popout) |
| `src/svelte/` | Svelte 5 renderer entry points |
| `src/svelte/components/` | UI components (`.svelte` files) |
| `src/svelte/lib/` | Shared logic — stores, persistence, models, engines, utilities |
| `src/svelte/lib/models/` | Pure data helpers |
| `src/shared/` | Code shared between main and renderer (IPC contract) |
| `src/prompts/` | Markdown prompt templates for WorkIQ |
| `src/styles/` | CSS organized by component; design tokens in `tokens.css` |
| `src/demo/` | Demo fixture data |
| `test/` | Tests (Node.js built-in test runner) |
| `test/helpers/` | Shared mocks (`electron-mock.js`) |
| `dist-renderer/` | Vite build output (git-ignored) |

---

## Code Style

- Use `const` by default; `let` only when reassignment is needed.
- Files: `kebab-case.js` / `PascalCase.svelte`.
- CSS files match the component they style (e.g., `radar.css` for RadarView).
- Prefer Svelte 5 runes (`$state`, `$derived`, `$props`) over legacy reactive syntax.
- Keep components focused — split large views into child components.
- Shared logic belongs in `src/svelte/lib/`, not inline in components.

---

## Testing

Tests use the **Node.js built-in test runner** (`node:test`) — no external framework.

```bash
npm test
```

### Current Test Files

| Test File | Module Under Test |
|---|---|
| `main-utils.test.js` | `src/main/utils.js` |
| `main-window-state.test.js` | `src/main/window-state.js` |
| `main-pty-bridge.test.js` | `src/main/pty-bridge.js` |
| `main-ipc-handlers.test.js` | `src/main/ipc-handlers.js` |
| `main-ipc-tracker-popout.test.js` | `src/main/ipc/tracker-popout.js` |

### Writing Tests

- Place test files in `test/` with naming pattern `<layer>-<module>.test.js`.
- Use `test/helpers/electron-mock.js` to stub Electron APIs.
- Keep tests focused on pure logic (utilities, models, IPC handlers).

---

## Security Guidelines

- **CSP**: Never bypass the Content Security Policy (`default-src 'self'`).
- **Context isolation**: Keep `contextIsolation: true` and `nodeIntegration: false`.
- **IPC bridge**: All renderer ↔ main communication goes through `src/preload.js`. Never expose Node.js APIs directly.
- **External URLs**: Route through `workiq.openExternal()` — never navigate the Electron window to an external URL.
- **LLM content**: Sanitize any AI-generated content before rendering.

---

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** — keep commits focused and descriptive.
3. **Add or update tests** for new logic in `src/main/` or `src/svelte/lib/`.
4. **Run the test suite**:
   ```bash
   npm test
   ```
5. **Open a pull request** against `main`. Never push directly to `main`.

---

## Pull Request Guidelines

- One feature or fix per PR — keep them small and focused.
- Include a summary of what changed and link to related issues.
- Ensure `npm test` passes locally before requesting review.
- If you modify prompts in `src/prompts/`, test LLM output manually.
- Update README or this file if your change affects setup or conventions.

---

## Branching & Releases

FlightDeck uses **tag-based releases**. PRs merge to `main` freely — no installer is built until you tag.

```
feature/xyz ──PR──► main ──(accumulate)──► git tag v1.x.x ──► installer built
```

1. Bump version and tag: `npm version patch` (or `minor` / `major`).
2. Push: `git push && git push --tags`.
3. The release workflow builds the installer and creates a GitHub Release.

Use [Semantic Versioning](https://semver.org/). Update `CHANGELOG.md` before tagging.

---

## Questions?

Open an issue or reach out in the project's discussion channel.
