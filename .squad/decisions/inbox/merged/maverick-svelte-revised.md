# DEC-084 Revised: Svelte Migration — Go Now

**Author:** Maverick (Lead) | **Date:** 2026-04-15 | **Status:** Revised Proposal — supersedes DEC-084 | **Requested by:** Kyle

## What changed

DEC-084 recommended ES modules + Vite first, Svelte later. I was wrong about the priority order. Kyle pushed back with lived experience, and after re-reading the codebase and change history, the evidence supports him.

**Previous position:** "Manual DOM updates could become a problem. Do ES modules first to reduce migration risk."

**Revised position:** "Manual DOM updates are *already* the primary source of bugs. The intermediate ES modules step doesn't address this, costs meaningful effort, and gets thrown away when Svelte arrives. Skip the intermediate step."

## Evidence: The DOM pattern is already the #1 bug source

### Git history tells the story

Out of 188 total commits, **29 are UI/render/state fix commits** — that's **15.4%** of the entire project history spent fixing DOM update bugs. Representative samples:

- `fix: Refresh scanner section headers and sort order on incremental updates` — partial DOM patching missed header re-render
- `fix: mark-as-seen updates card in-place, no DOM rebuild` — full innerHTML rebuild was destroying UI state
- `fix: remove duplicate green glow on new cards/rows` — stale CSS state survived innerHTML rebuild
- `fix: collapse other scanner sections when filter pill is clicked` — manual DOM vs state sync drift
- `fix: Revert Mark as Seen to button, fix new counts` — render function was re-invoked with stale count
- `fix: filter bar now works + lifecycle-based filters` — filter state wasn't propagating to render
- `fix: restore 3-tab card UI` — full rebuild clobbered tab state
- `fix: Stop dimming cards when scanner is paused` — state/render coupling crossed scanner boundaries
- `fix: status field now always drives lifecycleStatus pill` — state mutation order vs render timing
- `fix: prevent data loss from saves before state is loaded` — state lifecycle guard missing

These are not edge cases. They are symptoms of a fundamental architectural problem.

### The root cause pattern

The codebase follows a **mutate → save → render** pattern that requires three manual steps to stay in sync:

1. **Mutate state** (e.g., `item.hasNewUpdate = false`)
2. **Persist** (`savePersistentState()`)
3. **Re-render** (`renderRadarMode()`)

Every event handler must manually invoke all three. Miss one and you get a bug. The evidence:

- `events.js` (1,113 lines) calls `savePersistentState()` **17 times** and `renderRadarMode()` **17 times** — each pair manually wired.
- `renderRadarMode()` is called from **17+ sites** in events.js alone, plus 6 sites in app.js, plus scanner-engine.js and monitor-engine.js.
- Every full render calls `elements.radarList.innerHTML = html` which **destroys** all DOM state: expanded panels, active tabs, scroll position, focused inputs.
- This forced the creation of `captureRadarUiState()` / `restoreRadarUiState()` — a ~60-line workaround that manually saves and restores expansion state, tab state, prompt panel state, and scroll position.
- Then `patchSingleItem()` (80+ lines) was added as a band-aid to avoid full rebuilds during monitor ticks. It manually captures per-item UI state, builds new HTML, swaps the DOM node, and restores tab/panel/prompt/section state.

This is the classic symptom of a missing reactivity layer. A framework like Svelte eliminates all of this:

| Manual pattern today | Svelte equivalent |
|---|---|
| `item.field = x; savePersistentState(); renderRadarMode();` | `$items[i].field = x;` (auto-render + persist via store subscription) |
| `captureRadarUiState()` / `restoreRadarUiState()` | Eliminated — Svelte does surgical DOM updates, non-affected elements are untouched |
| `patchSingleItem()` (80 lines) | Eliminated — Svelte keyed `{#each}` updates only the changed item |
| `events.js` (1,113 lines of delegation) | Eliminated — event handlers are inline `on:click` in each component |
| `innerHTML = html` full rebuild | Eliminated — Svelte compiler generates targeted `textContent`/attribute/class updates |

### Why ES modules first doesn't help

DEC-084 recommended ES modules + Vite first as a lower-risk step. Re-evaluating:

| Concern | Does ESM+Vite fix it? | Does Svelte fix it? |
|---|---|---|
| State → render coupling | **No** | **Yes** (reactive stores) |
| innerHTML full-rebuild flicker | **No** | **Yes** (compiler-generated DOM updates) |
| Manual UI state capture/restore | **No** | **Yes** (non-affected DOM untouched) |
| 1,113-line event delegation file | **No** | **Yes** (events colocated with components) |
| Missing `renderX()` call = silent bug | **No** | **Yes** (auto-subscription) |
| Script tag load order fragility | **Yes** | **Yes** (comes free with Vite) |
| No HMR in dev | **Yes** | **Yes** (comes free with Vite) |
| Test migration needed | **Yes** (vm.runInContext breaks) | **Yes** (same cost) |

ES modules solve 2 of 7 problems. Svelte solves all 7. Both require test migration. The intermediate step is:

- **High effort:** Converting 22 script-tag globals to `import`/`export` touches every file, and tests must be rewritten away from `vm.runInContext` regardless.
- **Low value:** Doesn't address the actual pain point (DOM updates).
- **Throwaway:** Gets completely replaced when Svelte arrives — every `export function` becomes a Svelte component method or store.

The hard decomposition work (DEC-001 through DEC-004) already happened. The 25 modules map cleanly to ~35-40 Svelte components. Going straight to Svelte skips a throwaway intermediate.

## Recommendation: Proceed with Svelte migration incrementally

### Minimum Viable Setup (Proof of Concept)

**Goal:** Prove Svelte works inside FlightDeck's Electron shell with zero disruption.

1. Install `vite`, `@sveltejs/vite-plugin-svelte`, `svelte` as dev dependencies
2. Create `vite.config.js` targeting the renderer process
3. Create a single `HistoryView.svelte` component rendering the History tab
4. Mount it into the existing `#viewHistory` div alongside the vanilla JS
5. Create a Svelte writable store wrapping `state.history`
6. Validate: HMR works, CSP is satisfied, Electron IPC (`window.workiq`) works from Svelte

If this works, the migration path is proven. If CSP or Electron integration produces friction, we learn that cheaply before committing.

### Migration Order (simplest → most complex)

| Phase | Scope | Why this order | Risk |
|---|---|---|---|
| 0 — Proof of concept | History tab only | Read-only list, zero interactions, trivial validation | Minimal |
| 1 — Static views | KPI strip, morning banner, filter bar | Pure derived data, no user inputs | Low |
| 2 — Briefings | Meeting cards, day briefing, expand/collapse | Moderate interactions, self-contained view | Low-Medium |
| 3 — Radar cards | Scanner sections, tracking cards, tabs, panels | Highest complexity — inline editing, monitoring controls, schedule pickers | Medium |
| 4 — Modals + Popout | Scanner settings modal, search overlay, popout window | Separate entry point for popout | Medium |
| 5 — Cleanup | Remove events.js, old renderers, vanilla state.js | Final sweep — all views are Svelte | Low |

### Can it be incremental? Yes — here's how

**Coexistence strategy:** During migration, Svelte components mount into existing DOM targets. Both vanilla JS and Svelte read the same reactive store.

```
// store.js — thin Svelte wrapper around existing state
import { writable } from 'svelte/store';

export const items = writable(state.items);

// When vanilla JS mutates state (old code), sync to store:
items.set(state.items);

// When Svelte updates store (new code), sync back:
items.subscribe(val => { state.items = val; savePersistentState(); });
```

A migrated view (e.g., History) is a Svelte component. An unmigrated view (e.g., Radar) still uses vanilla `renderRadarMode()`. Both coexist until all views are converted.

### What stays unchanged

- `src/main/` (6 files) — Node.js, no DOM, no migration needed
- `src/preload.js` — unchanged, Svelte accesses `window.workiq` normally
- `src/shared/ipc-contract.js` — pure constants, imported as-is
- `src/prompts/` — markdown files, unchanged
- `src/demo/fixture.json` — static data, unchanged
- `src/renderer/models/*.js` — pure logic, imported as ES modules into Svelte (minor syntax change: add `export`)
- `src/renderer/utils.js` — pure functions, imported as ES module
- `src/renderer/json-parser.js` — pure function, imported as ES module
- `src/renderer/constants.js` — pure constants, imported as ES module

### What gets eliminated

| File | Lines | Replacement |
|---|---|---|
| `events.js` | 1,113 | Eliminated — events inline in components |
| `renderers/radar.js` | 922 | Split into ~8 Svelte components |
| `renderers/tracking.js` | 934 | Merged into Svelte card components |
| `renderers/briefing.js` | 247 | 2-3 Svelte components |
| `renderers/history.js` | ~30 | 1 Svelte component |
| `renderers/kpi.js` | ~100 | 1 Svelte component |
| `state.js` (DOM cache + render helpers) | 437 | Svelte stores + eliminated |
| `popout.js` | 322 | 1 Svelte entry point |
| `app.js` (composition root) | 320 | App.svelte |
| `captureRadarUiState` / `restoreRadarUiState` | ~60 | Eliminated entirely |
| `patchSingleItem` | ~80 | Eliminated entirely |

**Total eliminated/replaced:** ~4,500 lines → ~2,000-2,500 Svelte component lines (reactive model is more concise than manual DOM).

### Testing strategy

Tests must be rewritten regardless of whether we do ESM-only or Svelte — `vm.runInContext` doesn't work with either. This is the same cost for both paths.

- **New test stack:** Vitest + @testing-library/svelte (or Svelte's built-in test utils)
- **Migration approach:** Rewrite tests view-by-view alongside component migration (Phase 0 test alongside Phase 0 component)
- **Model/utility tests** (`renderer-utils.test.js`, `renderer-json-parser.test.js`, etc.) convert to ESM imports with minimal changes — these test pure functions
- **Main-process tests** (`main-*.test.js`) are unaffected — they don't touch the renderer

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Electron + Vite CSP | Use `electron-vite` or configure Vite to avoid inline scripts. Test in Phase 0. |
| State migration complexity | Thin store wrapper first. Actual Svelte store conversion happens per-view. |
| Popout window needs separate entry point | Svelte supports multiple entry points. `Popout.svelte` compiled as a separate bundle. |
| Demo mode interceptor uses monkey-patching | Convert to dependency injection — pass `runWorkiqJson` as a prop or context. |
| Team learning curve | Svelte is the simplest framework to learn from vanilla JS. Syntax is closest to HTML+JS. |

## Summary

I'm reversing my DEC-084 recommendation. The evidence is clear:

1. **29 of 188 commits (15.4%) are UI/render/state bug fixes** — this is the dominant pain point, not module loading.
2. ES modules solve script loading but not the render problem. It's effort spent on the wrong problem.
3. The test suite must be rewritten for either path — no cost savings from the intermediate step.
4. The existing modular decomposition (25 files, clean separation) means Svelte components map 1:1 to existing modules. The hard work is done.
5. Kyle is experiencing these bugs as the primary user. His feedback about what hurts most should carry weight.

The phased approach I originally recommended was cautious but misguided. When the intermediate step doesn't address the actual pain and gets thrown away, it's not de-risking — it's delay.

**Decision:** Proceed with incremental Svelte migration, starting with a Phase 0 proof of concept (History tab). If Phase 0 validates the Electron+Svelte+CSP integration, continue through Phases 1-5. If Phase 0 surfaces blocking issues, reassess then — but on specific technical evidence, not hypothetical risk.
