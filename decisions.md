# Decisions

> Team decisions that all agents must respect. Append-only; never edit past entries.

<!-- Scribe merges entries from .squad/decisions/inbox/ into this file -->
<!-- Archived decisions: .squad/decisions/archive/2026-02-25-through-2026-04-27.md -->

---

## DEC-105: Team-Wide Squad Model and Reasoning Preference

**Author:** kpoineal (via Copilot) | **Date:** 2026-09-04 | **Status:** Active

**Summary:** Configure all Squad agents to use `gpt-5.6-luna` with `high` reasoning effort, including agents previously covered by model overrides.

**Key decisions:**
- `defaultModel` is `gpt-5.6-luna` for all Squad agents.
- `defaultReasoningEffort` is `high` for all Squad agents.
- Agent-specific model overrides must not supersede this team-wide preference.

**Source:** `.squad/decisions/inbox/copilot-directive-2026-09-04T11-50-01-06-00.md`

---

## DEC-106: Inbox-First Direction and Compatibility Guardrails

**Author:** kpoineal (via Copilot) | **Date:** 2026-09-04 | **Status:** Active

**Summary:** Treat the current Inbox-driven design as the desired product direction while using the pre-Inbox radar-card design as the functionality, settings, and capability parity baseline.

**Key decisions:**
- Restore missing capabilities in Inbox-native form rather than restoring the prior scanner-card layout.
- Surface orphaned or unreachable code for review before removing it. No orphan deletion is approved.
- Preserve the tuned prompt system, including prompt metadata, item surfacing, temporal and evidence behavior, and next-step behavior.
- Do not make unsolicited prompt improvements during refactoring. Intentional semantic changes require a field-by-field comparison, characterization tests, and explicit approval.

**Source:** `.squad/decisions/inbox/copilot-directive-2026-09-04-product-parity-review.md`

---

## DEC-107: Proposed Inbox Product Contract

**Author:** Iceman (Product Owner) | **Date:** 2026-09-04 | **Status:** Proposed - Pending User Confirmation

**Summary:** Continue with Inbox list/detail triage as FlightDeck's primary experience, use commit `47bb04831a037074f1f81b52b4d2693dd346c6d9` as the pre-Inbox capability/settings baseline, restore parity in Inbox-native form, and protect scanner/monitor prompt and metadata fidelity across the full lifecycle.

**Proposed contract:**
- Repair the P0 Add Item, scanner-deletion transaction, proposal timestamp/history, and Teams-review metadata defects before parity cleanup.
- Restore scanner movement, core metadata/context editing, operational context, meaningful sort/filter behavior, distinct NEW/UPDATED cues, snooze and monitoring state, and keyboard navigation in the mounted Inbox experience.
- Require deterministic characterization across prompt generation, parsing, normalization, persistence, monitoring, history, proposal synthesis, review, and execution before changing semantics.
- Keep old layouts retired while retaining their capabilities as parity evidence until replacements are characterized.

**Pending choices - none approved by this entry:**
- **D1 - Ordering:** Choose Priority default with Recent chronological alternative, Recent default with Priority alternative, or chronology only. Lead recommendation: Priority default, ordering NEW/UPDATED first, then severity/blocked, then recency with a stable ID tie-break.
- **D2 - Scanner deletion policy:** Choose explicit cascade, reassignment/archive, or blocking deletion until empty. Lead recommendation: explicit impact preview plus transactional cascade of scanner-owned hot/cold items and no-effect linked proposals, with audit evidence accounted for and tombstones preventing rediscovery.
- **D3 - Main versus advanced controls:** Confirm which controls remain in the primary list/detail experience versus advanced/popout settings. Lead recommendation: keep move, due, owner, done criteria, NEW/UPDATED, snooze, paused state, scanner counts/status/last-next run, run now, and useful list filters in the main experience; keep full prompt, signal, schedule-detail, dedup, and retention controls advanced.
- **D4 - Later orphan-removal slice:** Choose whether to authorize a separate evidence-only cleanup review after P0/P1 parity. Recommendation: authorize proof and a deletion proposal only; actual deletion still requires a second explicit approval naming the files.

**Deletion gate:** No orphan candidate or compatibility field may be deleted without reachability and bundle evidence, residual-reference inventory, capability mapping, prior-state migration proof, before/after characterization, full tests, renderer and browser validation, and explicit approval of the named deletion set.

**Source:** `.squad/decisions/inbox/iceman-inbox-product-contract.md`; consolidated review: `.squad/reviews/2026-09-04-inbox-parity-and-prompt-fidelity.md`

---

## DEC-108: Recent-First Inbox Ordering

**Author:** kpoineal (via Copilot) | **Date:** 2026-09-08 | **Status:** Active

**Summary:** Use Recent as the default Inbox ordering while preserving useful filtering for intentional thread and card triage.

**Key decisions:**
- Recent is the default Inbox ordering.
- The Inbox must provide useful filtering; choosing recency does not remove filtering capability.
- Exact filter dimensions and interaction design remain pending and are not approved by this entry.

**Source:** `.squad/decisions/inbox/copilot-decision-2026-09-08-inbox-ordering.md`

---

## DEC-109: Proposed Safe Scanner Deletion Policy

**Author:** Viper (Backend) | **Date:** 2026-09-08 | **Status:** Proposed - Pending User Confirmation

**Summary:** Replace immediate scanner deletion with an impact-preview transaction that defaults to preserving work through reassignment while retaining an explicit destructive cascade path.

**Proposed policy - not approved by this entry:**
- Present one impact-preview dialog with `Keep and reassign` as the default and `Delete all` as the explicit destructive alternative. Cancel is a no-op.
- `Keep and reassign` supports moving all matching hot and cold threads either to unassigned Inbox (`scannerId: null`) or to another existing scanner without breaking proposal or history links.
- `Delete all` uses one transaction across the scanner, hot and cold threads, linked proposals, history, deleted-item exclusions, and persisted state.
- The destructive path tombstones deleted threads, removes no-effect proposals and their administrative events, and retains confirmed or uncertain external-action evidence as audit-only records.
- The dialog reports unique hot, cold, proposal-effect, audit-receipt, tombstone, and selected-item counts.
- Success requires accepted external cold-store and canonical persistence receipts. Failure rolls back all deletion-owned changes; ambiguous rollback requires reload recovery.
- Scanner execution cannot overlap the transaction, and retained or reassigned cold threads continue to participate in rediscovery deduplication.

**Source:** `.squad/decisions/inbox/viper-d2-safe-scanner-deletion-policy-2026-09-08.md`
