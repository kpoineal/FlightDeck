# Session Log — Links & Due Date Fixes

**Timestamp:** 2026-02-26T00:04:00Z  
**Requested by:** the project owner

## Summary

Fixed broken deep-link filtering and due date handling. `isDeepLink()` relaxed from rigid whitelist to permissive HTTPS gate. Ledger evidence links now accept structured `{label, type, url}` objects. Prompts updated with temporal inference and evidence link citation guidance.

## Agents

| Agent | Role | Outcome |
|-------|------|---------|
| Goose | Frontend fixes | SUCCESS |
| Merlin | Test coverage | SUCCESS (100/100) |
| Coordinator | HTTP protocol bugfix | Applied mid-session |

## Decisions Captured

- DEC-006: Links & Due Date Fixes (from Goose)
- DEC-007: Renderer Test Strategy — vm Context (from Merlin, Phase 5.2)
- Electron-store migration note captured to inbox
