# Decision: Dismissed Radar Items No Longer Reappear

**Author:** Goose (Frontend Dev) | **Date:** 2026-03-12 | **Status:** Implemented | **Feature:** `feature/onedrive-context-file`

## Summary

Fixed the intentional TDD red introduced by Merlin: dismissed radar items were re-added on the next scan because the merge logic in `applyRadarPayload()` only deduped against `state.radarItems` (live items). Dismissed items had been removed from that array, so the merge treated them as brand-new on the next scan.

---

## Root Cause

`applyRadarPayload()` merge logic before this fix:

```js
const existingIds = new Set((state.radarItems || []).map((item) => item.id));
const newItems = mappedRadarItems.filter((item) => !existingIds.has(item.id));
state.radarItems = [...(state.radarItems || []), ...newItems];
```

`dismissRadarItem()` removes an item from `state.radarItems`. The next call to `applyRadarPayload()` builds `existingIds` from the (now shorter) `state.radarItems` — the dismissed item's ID is gone, so it passes the filter and is re-added.

---

## Decision

Maintain a `state.seenRadarIds` Set inside `applyRadarPayload()` that tracks every item ID ever appended to `state.radarItems`. Dismissed items remain in this Set after being removed from `radarItems`, so the merge filter skips them.

### Why `seenRadarIds` over `dismissedRadarIds`

The failing test simulates dismissal by directly mutating `ctx.state.radarItems` (it does not call `dismissRadarItem()`). A `dismissedRadarIds` Set populated only by `dismissRadarItem()` would not be populated in that path, and the test would still fail. The `seenRadarIds` "ever-seen" approach works regardless of how the removal happened.

---

## Change

**File:** `src/renderer/models/radar.js` — `applyRadarPayload()` merge section

```js
// Before
const existingIds = new Set((state.radarItems || []).map((item) => item.id));
const newItems = mappedRadarItems.filter((item) => !existingIds.has(item.id));
state.radarItems = [...(state.radarItems || []), ...newItems];

// After
if (!(state.seenRadarIds instanceof Set)) {
  state.seenRadarIds = new Set();
}
// Seed seen set with currently-live items so dismissals that happened before
// seenRadarIds existed (e.g. items loaded from persistent state) are covered.
for (const item of (state.radarItems || [])) {
  state.seenRadarIds.add(item.id);
}

const existingIds = new Set((state.radarItems || []).map((item) => item.id));
const newItems = mappedRadarItems.filter(
  (item) => !existingIds.has(item.id) && !state.seenRadarIds.has(item.id),
);
state.radarItems = [...(state.radarItems || []), ...newItems];
for (const item of newItems) {
  state.seenRadarIds.add(item.id);
}
```

---

## Test Result

| Tests | Pass | Fail |
|-------|------|------|
| 451   | 451  | 0    |

Previously failing test now passes:
> `applyRadarPayload() merge behavior > dismissed items (removed from state before scan) do NOT reappear`

---

## Trade-offs

- `seenRadarIds` is an in-memory Set (not persisted). App restart clears it, so a dismissed item *could* reappear after restart if the next scan returns it. For full persistence, `seenRadarIds` would need to be serialised to `electron-store`. This is not addressed here — restart-persist of dismissed items is a separate concern.
- The Set grows unboundedly across many scans. Radar item IDs are content-hash–based strings (~15 chars each); thousands of dismissed items would add negligible memory pressure.
