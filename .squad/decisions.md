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
