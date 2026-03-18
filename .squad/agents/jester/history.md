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

### 2026-03-18 — Incremental Build Workflow & Versioning Strategy
- **Branch:** `squad/incremental-builds` — new workflow `.github/workflows/incremental.yml`.
- **Two-channel versioning:** Stable releases use `release.yml` (tag-triggered, `X.Y.0`). Incremental builds use `incremental.yml` (scheduled weekday 6AM UTC + manual dispatch, `X.Y.{run_number}`).
- **Version computation:** Reads major.minor from `package.json`, sets patch to `github.run_number` via PowerShell. Patch is ephemeral — never committed back.
- **Pipeline:** Checkout main → compute version → npm ci → tests → build MSI → Azure Login (OIDC) → Sign MSI (Trusted Signing) → create GitHub pre-release → cleanup incrementals older than 14 days.
- **Decision captured:** `.squad/decisions/inbox/jester-versioning-strategy.md` — full two-channel strategy.
- **Key detail:** Pre-releases auto-delete after 14 days to avoid clutter. Re-runs safe — existing tag/release deleted before re-creation.

### 2026-03-18 — Azure Trusted Signing (Code Signing)
- **PR #12** (`squad/code-signing`): Added Azure Trusted Signing to `release.yml` to sign the MSI before GitHub Release upload.
- **Approach:** OIDC-based Azure login via `azure/login@v2` + `azure/trusted-signing-action@v0.5.0`. Uses Workload Identity Federation — no client secrets stored in repo.
- **Permission:** Added `id-token: write` to workflow permissions (required for OIDC token exchange).
- **Signing config:** SHA256 digest, RFC 3161 timestamping via `timestamp.acs.microsoft.com`, certificate profile is Public Trust (CN=Kyle Poineal).
- **Secrets required:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CODE_SIGNING_ENDPOINT_URL`, `AZURE_CODE_SIGNING_ACCOUNT_NAME`, `AZURE_CODE_SIGNING_PROFILE_NAME` — all pre-configured by Kyle.
- **Step order:** Build MSI → Azure Login → Sign MSI → Create GitHub Release. No existing steps modified.
