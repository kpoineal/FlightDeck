# Session: Persistence Trim

**Date:** 2026-02-26 | **Agents:** Goose, Merlin

Removed `radarItems` and `meetings` from localStorage persistence (ephemeral data re-fetched on connect). Lowered `updateHistory` cap 50→20 with load-time trim, and `HISTORY_MAX_ENTRIES` 500→200. Merlin added 4 new tests and updated existing assertions; 292 tests pass.

**Decision:** DEC-010
