# Jester — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** (project owner)
- **Repo:** FlightDeck
- **Test runner:** `node --test test/*.test.js`

## Learnings
<!-- Append new learnings below this line -->

### 2026-03-18 — Repo Protection Audit
- **LICENSE file:** MISSING — critical gap for open source
- **SECURITY.md:** does not exist
- **CODEOWNERS:** does not exist
- **PR template:** does not exist (`PULL_REQUEST_TEMPLATE.md` missing)
- **Issue templates:** `.github/ISSUE_TEMPLATE/` directory exists but is EMPTY
- **Dependabot:** not configured (no `.github/dependabot.yml`)
- **CodeQL / code scanning:** not configured
- **Linting:** no ESLint or Prettier config files found
- **Branch protection:** no evidence of GitHub branch protection rules on `main`
- **CI coverage:** `ci.yml` runs tests on PRs to main (windows-latest), `squad-ci.yml` runs on ubuntu (no native module rebuild). Neither runs a linter.
- **Existing guard:** `squad-main-guard.yml` blocks forbidden paths (.ai-team/, team-docs/, docs/proposals/) from main — good hygiene workflow
- **Release pipeline:** tag-triggered `release.yml` + push-to-main `squad-release.yml` — both run tests and create GitHub Releases
- **Repo:** `kpoineal/flightdeck` on GitHub
- **Key dependencies with security surface:** `node-pty` (native), `electron` (chromium), `electron-store`, `@microsoft/workiq`

### 2026-03-18 — Repo Protection Policies Implemented
- **LICENSE:** Created MIT license file at repo root (copyright Kyle Poineal 2026).
- **SECURITY.md:** Created security policy covering supported versions (1.0.x), vulnerability reporting via GitHub Security Advisories, response timeline (48h initial, 7d assessment), responsible disclosure, Electron-specific scope (main process, preload bridge, IPC surface, native modules, dependency CVEs), and out-of-scope items (social engineering, local DoS).
- **node-pty pinned:** Changed `"node-pty": "^1.1.0"` to `"node-pty": "1.1.0"` in package.json — exact version control for critical native C++ module.
- All 430 tests pass after changes.

### 2026-02-27 — Release & CI Pipeline
- **Release workflow** at `.github/workflows/release.yml`: triggers on push to `main`, runs on `windows-latest` (required for `node-pty` native module rebuild), reads version from `package.json`, skips if a release for that version already exists, builds MSI via `npm run dist`, creates git tag and GitHub Release with the MSI artifact attached.
- **CI workflow** at `.github/workflows/ci.yml`: triggers on PRs to `main` and pushes to `main`, runs on `windows-latest`, runs `node --test test/*.test.js`.
- MSI output lands in `dist/`, filename pattern `FlightDeck {version}.msi`.
- `electron-builder` config lives in `package.json` under `"build"` — uses `warningsAsErrors: false` for WiX ICE validation on non-admin CI runners.
- `version:patch` convenience script added: `npm version patch --no-git-tag-version` — git tag creation is handled by the release workflow.
- README now has a Download section with a badge linking to GitHub Releases.
- Existing squad workflows (`squad-release.yml`, `squad-ci.yml`) run on Ubuntu — the new `release.yml` and `ci.yml` run on Windows to handle native modules.
