### 2026-03-18: FlightDeck Versioning Strategy

**By:** Kyle Poineal + Jester (DevOps)
**Status:** Active

**Summary:** Two-channel versioning for FlightDeck releases.

**Channels:**
- **Release** (stable): `X.Y.0` — minor version bumped manually via `npm version minor`. Tagged `vX.Y.0`. Built by `release.yml`. GitHub Release marked as Latest.
- **Incremental** (pre-release): `X.Y.{run_number}` — patch auto-set to `github.run_number` in CI. Tagged `vX.Y.N`. Built by `incremental.yml` on schedule (weekday 6AM UTC) or manual dispatch. GitHub Release marked as Pre-release.

**Progression example:**
1.0.4 (incremental) → 1.0.5 (incremental) → 1.1.0 (release) → 1.1.1 (incremental) → 1.2.0 (release)

**Key decisions:**
- `package.json` version is the source of truth for major.minor only.
- Patch versions are NOT committed back to `package.json` — they're ephemeral, set in CI.
- Incremental releases auto-cleanup after 14 days.
- Both channels are code-signed via Azure Trusted Signing.
- MSI-compatible (3-part numeric versions throughout).
