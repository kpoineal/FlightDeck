### 2026-03-18: Branch protection guide for `main`
**By:** Maverick (requested by Kyle)
**What:** Step-by-step guide to enable branch protection on `main` via GitHub Settings.
**Why:** Protect the default branch from direct pushes, enforce PR reviews and CI checks.

---

## Enable Branch Protection on `main`

### 1. Create the branch protection rule

1. Go to **Settings → Branches → Add branch protection rule**
2. **Branch name pattern:** `main`

### 2. Configure the rule

Check these boxes and sub-options:

- [x] **Require a pull request before merging**
  - Require approvals: **1**
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - Search and add required check: **`CI / test`** (from `ci.yml`)
  - [x] Require branches to be up to date before merging
- [x] **Require linear history** (enforces squash or rebase merges)
- [x] **Do not allow force pushes**
- [x] **Do not allow deletions**

### 3. Optional bypass

- [x] **Allow specified actors to bypass required pull requests**
  - Add your GitHub account for emergency fixes.
  - 📌 *Remove this bypass once the contributor base grows — it's a temporary escape hatch.*

### 4. Leave disabled (for now)

- [ ] **Require signed commits** — adds friction for AI agents. Revisit later.

### 5. Save

Click **Create** to apply the rule.

---

## Protect Release Tags

After the branch rule is saved:

1. Go to **Settings → Tags → Add rule**
2. **Tag name pattern:** `v*`
3. Restrict to: **Maintainers**
4. Save.

This prevents anyone from pushing or deleting `v*` release tags without maintainer access.
