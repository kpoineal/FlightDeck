# Decision: OneDrive Context File Tests

**Author:** Merlin (Tester) | **Date:** 2026-03-12 | **Status:** Proposed | **Feature:** `feature/onedrive-context-file`

## Summary

Tests written for the `feature/onedrive-context-file` changes. Two new test files added and one existing file extended. The full test suite now stands at 451 tests with 450 passing. One test is an intentional TDD red documenting an implementation gap.

---

## New Test Files

### `test/renderer-models-context-file.test.js`
Tests for `src/renderer/models/context-file.js` (11 tests).

- Each test creates a **fresh vm context** via `makeCtx()` — `context-file.js` holds module-level `_contextFilePath` state that cannot be reset without reloading.
- `window.workiq` is assigned to `ctx.window` after `createRendererContext()` but before `loadFile()`.
- No renderer utility chain required — `context-file.js` only depends on `state`, `window.workiq`, and built-in `Date`/`console`.

### `test/main-ipc-context-file.test.js`
Tests for the `WRITE_CONTEXT_FILE` and `GET_CONTEXT_FILE_PATH` IPC handlers (6 tests).

- Uses a real `os.tmpdir()` subfolder per test to exercise actual file system writes.
- `process.env.OneDriveCommercial` is saved/restored around each test (`delete` if originally undefined).
- `require.cache` for `ipc-handlers.js` is cleared in `beforeEach` to get fresh handler registration (established pattern from `main-ipc-handlers.test.js`).

---

## Extended Test File

### `test/renderer-models-radar.test.js` — new `applyRadarPayload() merge behavior` describe block (4 tests)

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Existing items persist when new scan has different items | ✅ Pass | Merge logic confirmed correct |
| 2 | New items from scan are added to existing set | ✅ Pass | Merge logic confirmed correct |
| 3 | Items with duplicate IDs are NOT duplicated | ✅ Pass | Dedup by content hash confirmed |
| 4 | Dismissed items do NOT reappear | ❌ Fail (intentional) | Dismissed-ID tracking not yet implemented |

---

## Intentional TDD Red — Dismissed-Item Tracking

**Test:** `applyRadarPayload() merge behavior > dismissed items (removed from state before scan) do NOT reappear`

**Root cause:** `applyRadarPayload` builds `existingIds` only from `state.radarItems` at call time. When `dismissRadarItem()` removes an item, its ID is gone from `state.radarItems`. The next scan treats it as "new" and re-adds it.

**Required fix:** Maintain a persistent set of dismissed IDs (e.g., `state.dismissedRadarIds` or a module-level `_dismissedIds` Set) and filter incoming items against it in `applyRadarPayload`. The dismissed set should be persisted to `electron-store` so it survives app restart.

**Owner:** Goose (Frontend Dev)

---

## package.json Change

`scripts.test` updated to include:
- `test/main-ipc-context-file.test.js`
- `test/renderer-models-context-file.test.js`

---

## Key Conventions Established

- **Fresh context per test** is the correct pattern for any renderer module with module-level mutable state (vs. `before()` + shared context for pure-function modules).
- **IPC handler tests with real fs** should use `os.tmpdir()` + unique subfolder + `afterEach` cleanup — do not mock `fs`.
- **Intentional TDD failures** are an acceptable state; they should be documented in history and this inbox so the owning agent can pick up the implementation.
