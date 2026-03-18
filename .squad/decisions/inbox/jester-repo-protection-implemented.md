### 2026-03-18: Repo protection policies implemented

**By:** Jester (DevOps) | **Requested by:** Kyle Poineal

**What:**
1. **LICENSE (MIT):** Added repo-root `LICENSE` file — MIT license, copyright Kyle Poineal 2026.
2. **SECURITY.md:** Added security policy with supported versions (1.0.x), GitHub Security Advisories reporting link, response SLA (48h/7d), responsible disclosure, Electron-specific scope, and out-of-scope exclusions.
3. **node-pty pinned:** Changed `"node-pty": "^1.1.0"` → `"1.1.0"` in package.json — exact version for critical native module.

**Why:** Repo protection audit identified missing LICENSE and SECURITY.md as critical gaps. Pinning node-pty prevents unintended upgrades of a security-sensitive native dependency.

**Test impact:** All 430 tests pass — no behavioral changes.
