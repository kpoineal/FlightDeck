# Svelte Migration Feasibility Assessment

**Author:** Maverick (Lead) | **Date:** 2026-04-15 | **Status:** Assessment | **Requested by:** Kyle

## Summary

Kyle asked whether FlightDeck should migrate from vanilla JS to Svelte. This is a full architecture-level assessment covering current state, migration strategy, LOE breakdown, risks, and recommendation.

## Recommendation

**Not yet — but the codebase is well-positioned if/when the threshold is crossed.**

The current modular architecture (25 focused files, clear separation of concerns) already delivers most of the maintainability benefits a framework would provide. The primary gains from Svelte — reactive state, declarative templates, scoped styles — are real, but the migration cost is XL (essentially a full renderer rewrite). The better near-term move is: ES modules + Vite (vanilla mode) as an incremental step. This unlocks HMR, tree-shaking, and proper import/export at ~20% of the Svelte migration cost.

**Revisit Svelte when:**
- The app adds significant new UI complexity (new views, nested interactive components)
- The manual DOM update pattern becomes the dominant source of bugs
- The team is ready to invest in a full testing rewrite

## LOE Breakdown

| Area | Size | Notes |
|------|------|-------|
| Build tooling (Vite + Svelte + Electron) | S | electron-vite or manual Vite config, well-documented |
| Component conversion (renderers → .svelte) | L | ~2,800 lines of HTML-string renderers to declarative templates |
| State management (mutable → Svelte stores) | M-L | Touches every module; highest-risk area |
| Styling (CSS → scoped styles) | S-M | Mostly mechanical, 3,600 lines to redistribute |
| IPC integration | S | `window.workiq` works as-is from Svelte |
| Event migration | M | events.js (1,113L) eliminated; logic moves into components |
| Models/logic (non-rendering code) | S | item.js, scanner.js, briefing.js stay as-is |
| Testing migration | L | 5,350 lines rewritten for Vitest + @testing-library/svelte |
| **Overall** | **XL** | Full renderer layer rewrite |

## What Changes vs. What Stays

### Stays (no changes)
- `src/main/` — all 6 files (CommonJS, Node.js, Electron main process)
- `src/preload.js` — contextBridge, IPC channel definitions
- `src/shared/ipc-contract.js` — channel constants
- `src/prompts/` — markdown prompt templates
- `src/demo/fixture.json` — demo data

### Changes completely
- `src/renderer/renderers/*.js` → Svelte components (7 files, ~2,800 lines)
- `src/renderer/events.js` → eliminated (1,113 lines absorbed into components)
- `src/renderer/state.js` → Svelte store(s) + persistence layer
- `src/renderer/app.js` → Svelte App.svelte root component
- `src/renderer/popout.js` → Popout.svelte
- `src/renderer/theme.js` → Svelte store or context
- `src/renderer/search.js` → SearchOverlay.svelte
- `src/index.html` → minimal Vite entry point (replaced by Svelte mount)
- `src/styles/*.css` → distributed into component `<style>` blocks + global tokens
- `test/*.test.js` → all 18 test files rewritten

### Partially changes
- `src/renderer/models/*.js` → pure logic stays, but import/export pattern changes
- `src/renderer/utils.js` → stays as utility module, just gets ES module exports
- `src/renderer/constants.js` → same
- `src/renderer/json-parser.js` → same
- `src/renderer/prompts.js` → same
- `src/renderer/monitor-engine.js` → stays, needs store integration
- `src/renderer/scanner-engine.js` → stays, needs store integration
- `src/renderer/demo.js` → interceptor pattern needs adaptation for Vite build

## Risks & Gotchas

1. **Electron + Vite CSP** — Current CSP is `script-src 'self'`. Vite dev server injects inline scripts. Need to relax CSP in dev or use `electron-vite` which handles this.
2. **Native modules in Vite** — `node-pty` and `@microsoft/workiq` must be externalized from Vite's bundle. Standard but requires config.
3. **State migration is highest risk** — The shared mutable `state` object is referenced by every module. Converting to reactive Svelte stores means rethinking how 14 modules read/write state. A bridge pattern (reactive wrapper around mutable object) could ease the transition but adds complexity.
4. **innerHTML → {@html}** — Renderers use `escapeHtml()` for XSS safety. Svelte's `{@html}` directive requires the same discipline. The safe pattern is to avoid `{@html}` entirely and use Svelte templating, but some WorkIQ-generated content may require it.
5. **Demo mode interceptor** — Currently monkey-patches `runWorkiqJson()` at the global scope. In a module system, this needs a dependency injection pattern instead.
6. **Popout window** — The tracker popout loads the same HTML with a `?popout=` query param. In Svelte, this needs a separate entry point or conditional root component.
7. **Testing cliff** — The `vm.runInContext` testing pattern is specific to vanilla JS globals. Migration means all 5,350 lines of tests are rewritten from scratch, not incrementally migrated.

## Alternative: ES Modules + Vite (No Framework)

A lighter-weight modernization path:
1. Convert 22 `<script>` tags to ES module `import`/`export` (M effort)
2. Add Vite as dev server + bundler (S effort)
3. Keep vanilla JS DOM manipulation as-is
4. Gain: HMR, tree-shaking, proper dependency graph, import/export, dev server
5. Cost: ~20% of full Svelte migration
6. This also makes a future Svelte migration easier (modules already use import/export)

This is the recommended next step before any framework consideration.
