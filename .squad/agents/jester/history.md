# Jester — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** (project owner)
- **Repo:** FlightDeck
- **Test runner:** `node --test test/*.test.js`

## Learnings
<!-- Append new learnings below this line -->

### 2026-02-27 — Release & CI Pipeline
- **Release workflow** at `.github/workflows/release.yml`: triggers on push to `main`, runs on `windows-latest` (required for `node-pty` native module rebuild), reads version from `package.json`, skips if a release for that version already exists, builds MSI via `npm run dist`, creates git tag and GitHub Release with the MSI artifact attached.
- **CI workflow** at `.github/workflows/ci.yml`: triggers on PRs to `main` and pushes to `main`, runs on `windows-latest`, runs `node --test test/*.test.js`.
- MSI output lands in `dist/`, filename pattern `FlightDeck {version}.msi`.
- `electron-builder` config lives in `package.json` under `"build"` — uses `warningsAsErrors: false` for WiX ICE validation on non-admin CI runners.
- `version:patch` convenience script added: `npm version patch --no-git-tag-version` — git tag creation is handled by the release workflow.
- README now has a Download section with a badge linking to GitHub Releases.
- Existing squad workflows (`squad-release.yml`, `squad-ci.yml`) run on Ubuntu — the new `release.yml` and `ci.yml` run on Windows to handle native modules.
