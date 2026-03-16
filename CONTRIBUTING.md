# Contributing to FlightDeck

Thanks for your interest in contributing! This document covers the conventions and workflow for the project.

---

## Development Setup

```bash
git clone <repo-url>
cd FlightDeck
npm install
npm start          # Launch the Electron app
```

### Prerequisites

- **Node.js** v18+
- **WorkIQ CLI** installed globally (`npm i -g @microsoft/workiq`)
- A valid **Microsoft Copilot license** with tenant admin consent

---

## Project Conventions

### Code Style

- **No bundler** — the renderer loads plain `<script>` tags in order. Globals are shared between renderer modules.
- **No framework** — vanilla HTML, CSS, and JavaScript throughout the renderer.
- Use `const` by default; use `let` only when reassignment is necessary.
- Prefer named functions over anonymous arrow functions for top-level declarations.
- Keep files focused: models in `src/renderer/models/`, DOM rendering in `src/renderer/renderers/`, wiring in `src/renderer/events.js`.

### File Organization

| Directory | Purpose |
|---|---|
| `src/` | All application source code |
| `src/main/` | Electron main-process code (app lifecycle, IPC, PTY, utilities) |
| `src/renderer/` | Renderer-process code (UI logic, models, renderers) |
| `src/renderer/models/` | Pure data helpers — normalization, diffing, schedule math |
| `src/renderer/renderers/` | DOM-building functions (return HTML strings or manipulate the DOM) |
| `src/prompts/` | Markdown prompt templates sent to WorkIQ |
| `src/styles/` | CSS organized by component; design tokens in `tokens.css` |
| `test/` | Tests using the Node.js built-in test runner |
| `test/helpers/` | Shared mocks (Electron, renderer context) |

### Naming

- Files: `kebab-case.js`
- Test files: `<layer>-<module>.test.js` (e.g., `renderer-models-tracking.test.js`)
- CSS files: match the component they style (e.g., `radar.css` for the Radar view)

### Security

- Never bypass the Content Security Policy (`default-src 'self'`).
- All external URLs must go through `workiq.openExternal()` — never navigate the Electron window to an external URL.
- Escape any LLM-generated content before rendering it in the DOM.
- Keep `contextIsolation: true` and `nodeIntegration: false`.

---

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — keep commits focused and descriptive.

3. **Add or update tests** for any new logic in `renderer/models/` or `main/`.

4. **Run the test suite** before pushing:
   ```bash
   npm test
   ```

5. **Open a pull request** against `main` with a clear description of what changed and why.

---

## Testing

Tests use the **Node.js built-in test runner** (`node:test` module) — no external test framework is needed.

```bash
npm test
```

### Writing Tests

- Place test files in `test/` with the naming pattern `<layer>-<module>.test.js`.
- Use the helpers in `test/helpers/` to mock Electron APIs and renderer context:
  - `electron-mock.js` — stubs for `ipcRenderer`, `BrowserWindow`, etc.
  - `renderer-context.js` — sets up a minimal `window.workiq` and `localStorage` environment.
- Keep tests focused on pure logic (models, utilities, parsers). DOM interaction tests are not currently in scope.

### Test Coverage Map

| Test File | Module Under Test |
|---|---|
| `main-utils.test.js` | `main/utils.js` |
| `main-window-state.test.js` | `main/window-state.js` |
| `main-pty-bridge.test.js` | `main/pty-bridge.js` |
| `renderer-utils.test.js` | `renderer/utils.js` |
| `renderer-json-parser.test.js` | `renderer/json-parser.js` |
| `renderer-models-tracking.test.js` | `renderer/models/tracking.js` |
| `renderer-models-radar.test.js` | `renderer/models/radar.js` |
| `renderer-models-briefing.test.js` | `renderer/models/briefing.js` |
| `renderer-state.test.js` | `renderer/state.js` |

---

## Branching & Release Strategy

FlightDeck uses **tag-based releases**. PRs merge to `main` freely — no MSI is built until you explicitly tag a version.

### Workflow

```
feature/xyz ──PR──► main ──(accumulate changes)──► git tag v1.x.x ──► MSI built & GitHub Release created
```

1. **PRs merge to `main`** — CI runs tests on every PR and push. No installer is built.
2. **When ready to release**, bump the version and tag:
   ```bash
   npm version patch           # or minor / major — bumps package.json and creates git tag
   git push && git push --tags
   ```
3. **The `release.yml` workflow triggers on `v*` tags** — it builds the MSI, creates a GitHub Release, and attaches the installer.
4. **Manual trigger**: you can also run the Release workflow from the Actions tab with a specific tag via `workflow_dispatch`.

### Version Discipline

- The version in `package.json` **must match** the git tag. The release workflow verifies this and fails on mismatch.
- Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
- Update `CHANGELOG.md` before tagging a release.

---

## Pull Request Guidelines

- Keep PRs small and focused — one feature or fix per PR.
- Include a summary of what changed and link to any related issues.
- Ensure `npm test` passes locally before requesting review.
- If you modify prompts in `prompts/`, test the actual LLM output manually since prompt changes can't be unit-tested.
- Update the README or this file if your change affects setup, architecture, or conventions.

---

## Reporting Issues

Open an issue in the repository with:

- A clear description of the bug or feature request
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Your Node.js version and OS

---

## Questions?

Reach out to the team in the project's discussion channel.
