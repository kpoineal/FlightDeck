# Decision: OneDrive Context File Frontend Integration

**Author:** Goose  
**Branch:** feature/onedrive-context-file  
**Date:** 2026-03-12  
**Status:** Implemented

---

## Decision 1: Radar merge replaces replace-all

**Context:** `applyRadarPayload()` previously wiped `state.radarItems` entirely on every scan. Cards the user hadn't acted on would disappear between scans.

**Decision:** Switch to a merge strategy — items with IDs already in state are preserved, only truly new IDs from the scan are appended.

```js
const existingIds = new Set((state.radarItems || []).map((item) => item.id));
const newItems = mappedRadarItems.filter((item) => !existingIds.has(item.id));
state.radarItems = [...(state.radarItems || []), ...newItems];
```

**Rationale:** Cards persist until explicitly dismissed. The `selectedRadarItemId` validity guard at line 113 still works correctly with merged state.

---

## Decision 2: context-file.js uses module-level path cache

**Context:** The OneDrive context file path is resolved async via IPC (`getContextFilePath()`). We need a synchronous accessor for use in `buildRadarScanPrompt()`.

**Decision:** `_contextFilePath` is a module-level variable cached by `initContextFilePath()` (called at app startup). `syncContextFile()` also updates the cache if `writeContextFile` returns a path. The synchronous `getContextFilePath()` returns the cached value.

**Rationale:** Avoids async chains in prompt construction. Path is stable after init — it only changes if the file is written to a new location.

---

## Decision 3: syncContextFile is fire-and-forget at all call sites

**Context:** Context file sync is triggered after every state mutation (upsert, remove, dismiss, field update, radar merge).

**Decision:** All call sites use `syncContextFile()` without `await`. No error handling at call sites — `syncContextFile` wraps itself in try/catch and logs warnings.

**Rationale:** State mutations are synchronous and should not be delayed by IPC. Sync failures are non-critical — the context file is advisory, not required for app function.

---

## Decision 4: context-file.js script tag position

**Context:** `context-file.js` defines globals (`syncContextFile`, `getContextFilePath`, `initContextFilePath`) used by `prompts.js`, `models/tracking.js`, and `models/radar.js`.

**Decision:** Script tag inserted immediately after `state.js` and before `prompts.js` in `src/index.html`.

**Rationale:** Ensures globals are defined before any dependent script loads. Consistent with the existing load order pattern (dependencies before dependents).

---

## Decision 5: Test beforeEach resets for merge-accumulating state

**Context:** `applyRadarPayload()` tests relied on `state.radarItems[0]` being the item just added. With merge behavior, previous test items persist in shared state.

**Decision:** Added `beforeEach(() => { ctx.state.radarItems = []; })` to the two `applyRadarPayload()` describe blocks in `renderer-models-radar.test.js`.

**Rationale:** Tests should own their preconditions. Index-based array access is fragile when state accumulates — explicit reset makes each test independent.
