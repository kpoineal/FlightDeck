### 2026-03-18: Repository Protection Plan

**By:** Jester (DevOps) + Maverick (Lead) | **Status:** Approved by Kyle

**Summary:** Comprehensive repo protection strategy for FlightDeck as an open source project. Phased approach based on threat model analysis.

**Phase 1 — Must-Have (implementing now):**
1. **LICENSE file** — Apache 2.0. Chosen over MIT for explicit patent grant, change-notice requirements, and trademark clarity. Kyle evaluated GPL/MPL for copyleft protection but chose Apache for contributor friendliness.
2. **Branch protection on `main`** — Enforce DEC-013 at GitHub level: require PRs, require CI to pass, block force pushes, block direct pushes. (GitHub Settings — manual step.)
3. **SECURITY.md** — Vulnerability reporting channel using GitHub Security Advisories.
4. **Pin `node-pty` to exact version** — Remove `^` from `^1.1.0`. Native C++ module with shell access is the #1 threat vector.

**Phase 2 — Recommended (next few weeks):**
5. Add `npm audit --audit-level=high` to CI workflow
6. Enable Dependabot for npm + GitHub Actions
7. Add CODEOWNERS (require Kyle's review on `src/main/`, `preload.js`, `package.json`)
8. Require 1 review on PRs to main
9. PR template with security checklist
10. Issue templates (bug report + feature request — directory exists but is empty)
11. Protected tags (`v*`) — prevent unauthorized releases
12. Secret scanning (repo setting toggle)

**Phase 3 — Nice-to-Have (when ready):**
13. CodeQL / code scanning workflow
14. Linter in CI (oxlint or ESLint)
15. DCO/CLA (when external contributions ramp up)
16. Signed commits (deferred — friction for AI agents)

**Key threat model findings (Maverick):**
- `node-pty` is #1 threat — native C++ module that spawns shells. Pin version, audit every update manually.
- `preload.js` is the security perimeter — CODEOWNERS should gate changes.
- Current CSP + `escapeHtml()` + `contextIsolation` posture is strong.
- Supply chain visibility is the biggest gap (no dependency scanning).

**Why:** Kyle requested repo protection policies for open source readiness. Team researched current state, threat model, and phased recommendations. Kyle approved Phase 1 for immediate implementation.
