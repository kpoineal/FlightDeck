# Scribe — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner

## Learnings
<!-- Append learnings below -->

### 2026-03-03 — Ticket 5 + Follow-ups Decision Merge and Lead-Gate Logging

- Merged new inbox entries into `.squad/decisions.md` as DEC-026 (merge-hold directive), DEC-027 (Ticket 5 + follow-up completion), and DEC-028 (Maverick lead approval), preserving append-only ordering.
- Applied dedupe discipline by appending only entries not already present in canonical decisions.
- Cleared merged inbox payloads for this round to keep `.squad/decisions/inbox/` actionable for only unmerged decision content.
- Added one session log plus dedicated orchestration logs for Merlin and Maverick to capture completion evidence and lead disposition.

### 2026-03-03 — Maintainability Kickoff Logging Run

- Merged `.squad/decisions/inbox/maverick-maintainability-kickoff.md` into `.squad/decisions.md` as DEC-020 with append-only semantics.
- Cleared merged decision inbox item after canonicalization.
- Wrote session log and per-agent orchestration logs for Goose, Viper, Merlin, and Maverick.
- Synchronized cross-agent kickoff context by appending DEC-020 alignment entries in relevant agent `history.md` files.

### 2026-03-03 — T1/T2 Decision Merge + Approval Logging

- Merged new decision inbox entries into `.squad/decisions.md` as DEC-021 (Viper implementation) and DEC-022 (Merlin reviewer approval).
- Applied append-only + dedupe discipline by appending only new decision IDs and preserving prior canonical entries unchanged.
- Cleared merged inbox payloads for `viper-t1-t2-implementation.md` and `merlin-t1-t2-review.md` after canonical merge.
- Added short session log and dedicated orchestration logs for Viper and Merlin to capture implementation handoff and review-gate disposition.

### 2026-03-03 — Ticket 4 Slice 1 Decision Merge + Approval Logging

- Merged `.squad/decisions/inbox/merlin-ticket4-slice1-review.md` into `.squad/decisions.md` as DEC-023 with append-only + dedupe discipline.
- Cleared merged inbox payload after canonicalization to keep inbox actionable for only new decision entries.
- Added short session log for Ticket 4 Slice 1 implementation + reviewer approval.
- Added dedicated orchestration logs for Viper and Merlin for this slice to capture implementation and gate disposition.

### 2026-03-03 — Ticket 3 Slice 1 Decision Merge + Approval Logging

- Merged `.squad/decisions/inbox/goose-ticket3-slice1.md` and `.squad/decisions/inbox/merlin-ticket3-slice1-review.md` into `.squad/decisions.md` as DEC-024 and DEC-025 using append-only + dedupe discipline.
- Cleared merged inbox payloads after canonicalization to keep decision inbox focused on unmerged entries.
- Added short session log for Ticket 3 Slice 1 implementation + reviewer approval.
- Added dedicated orchestration logs for Goose and Merlin to capture implementation handoff and reviewer-gate disposition.

### 2026-11-04 — Consolidated shipped-feature handoff and evidence boundaries

- At Kyle Poineal's request, logged merged Email/Teams repair (#175), visual Today (#176), and shared Radar context menu (#177) through the configured Squad state backend only. Current supplied main is e7c8ef9af1a9b922e94cca7d716880e792e72256, clean and synchronized; no release tag or running-app restart. No pending session code tasks.
- Read decisions.md and my history first. identity/now.md was absent and was created as a current handoff. Preserved all existing history and decisions; did not inspect/merge/delete unknown inbox entries or create policy.
- Recorded only known actual agent execution: general-purpose inbox-context-menu, 44edaa12-d6d0-4c89-a1a4-cbd5132cb767, background frontend implementation. Hover flyout/compact opaque-surface refinements and commits/merge belong to coordinator; earlier agent identities are unknown.
- Preserve validation precision: context-menu npm test 506 passed / 4 skipped, build and three PR checks passed. Browser coverage totals 101 scenarios across separate passing runs, NOT a clean unfiltered full run. Existing Briefings Action Queue focus-restoration assertion intermittently races requestAnimationFrame; isolated case passed, unrelated code/assertions unchanged. npm audit not run. Today had 504 passed / 4 skipped and 95/95 browser scenarios.
- User prefers charts/visual overviews; existing decision 719cdfae-5504-4e36-9c5c-46017cb8e4f9 already covers it, so do not duplicate. Compact Today cards retain independent expansion; display-only title cleanup must preserve source text/IDs.
- Snooze/mute remains unresolved: user expected quiet updates while retaining visible threads; shipped Snooze still hides from Inbox into Snoozed. User deferred choosing mute, both mute/Hide, or relabeling. This is not approved behavior or policy; ask before implementation.
- No live M365 approval remains after the prior once-used approved Teams send; current feature tests mocked data. Further live writes require fresh explicit approval.
- Useful menu regression detail: pointermove avoids layout-driven pointerenter focus theft; do not reopen an unchanged branch on every move. Both menu levels use opaque --bg-overlay-panel.
- State keys: log/2026-11-04T22-58-48Z-today-and-inbox-context-menu.md; orchestration-log/2026-11-04T22-58-48Z-inbox-context-menu.md; agents/scribe/history.md; identity/now.md.
