# Decision: Always-visible Updated timestamp bar on tracker cards

**Author:** Goose (Frontend Dev)  
**Requested by:** Kyle Poineal  
**Date:** 2026-03-17  
**Status:** Implemented

## Context

The "Updated:" timestamp bar on tracker cards/rows only appeared when `hasNew` was true. After marking an item as seen, the bar disappeared entirely — removing useful context about when the latest update came in.

## Decision

Show the Updated bar whenever `item.lastRunAt` exists, regardless of seen/unseen state.

- **Green (`.tracker-updated-at--new`)** for unseen items — keeps the existing success color + pulse animation.
- **Neutral (`.tracker-updated-at`)** for seen items — muted text, subtle background, card-border left stripe, no animation.
- **Moved above the title** in card view so it's the first thing visible inside `card-body`.
- **Added to popout view** which previously had no Updated bar at all.

## Files Changed

| File | Change |
|---|---|
| `src/styles/tracking.css` | Split `.tracker-updated-at` into neutral base + `.tracker-updated-at--new` green modifier |
| `src/renderer/renderers/tracking.js` | Card view: moved Updated bar above title, always render when timestamp exists, conditional `--new` class. Row view: same logic, moved above summary. |
| `src/renderer/popout.js` | Added Updated bar inside `popout-panel-left`, above the title |

## Verification

All 430 tests pass with zero regressions.
