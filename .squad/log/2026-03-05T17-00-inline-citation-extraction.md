# Session Log — 2026-03-05 Inline Citation Extraction

**Date:** 2026-03-05  
**Goal:** Extract inline markdown citations from AI summary/reason fields as supplementary evidence links  
**Requested by:** the project owner

## Summary

Implemented dual-source evidence link extraction: inline markdown citations (`[label](url)`) in AI-generated `summary`/`reason` fields are now extracted before `cleanDisplayText()` strips them, then merged with the structured `evidenceLinks` array using URL-based deduplication.

**Architecture (Maverick):**
- Evaluated three approaches (Replace, Supplement, Keep current). Recommended **SUPPLEMENT** — extract inline citations AND keep structured `evidenceLinks` as parallel sources.
- Defined critical order-of-operations: extract inline citations from raw text → normalize structured links → merge/dedup by URL → clean display text.
- Structured `evidenceLinks` retain priority (provide `signalAt` metadata not available from inline text).

**Parsing Analysis (Viper):**
- Confirmed inline citations are safe for JSON parsing — all markdown link characters are legal in JSON strings.
- Verified `sanitizeLikelyBrokenJson()`, `normalizeJsonCandidate()`, and `parseJsonWithRepair()` are unaffected.
- Recommended keeping structured `evidenceLinks` as primary with inline extraction as supplement.
- Designed three-layer citation defense: structured array (primary), inline extraction (new), footnote injection (existing).

**Implementation (Goose):**
- Added `extractInlineCitations(text)` in `src/renderer/utils.js` reusing existing URL validators.
- Modified `applyRadarPayload()` in `src/renderer/models/radar.js` — extract before clean, merge with dedup.
- Modified `normalizeTrackingItem()` in `src/renderer/models/tracking.js` — same pattern.
- Modified `monitorTaskItem()` in `src/renderer/monitor-engine.js` — inline links merged into `curatedLinks`.
- Relaxed prompt prohibitions in `src/renderer/constants.js` and `src/renderer/prompts.js`.
- No renderer changes needed — all views already consume `item.evidenceLinks`.

**Tests (Merlin):**
- 11 new tests for `extractInlineCitations()` covering happy path, type inference, hallucinated/generic URL filtering, deduplication, and edge cases.
- 4 new tests for `applyRadarPayload()` inline extraction covering extract-before-clean ordering, merge priority, and dedup.
- 15 new tests total. 338 tests pass, 0 failures.

**Decisions recorded:** DEC-029 (architecture + analysis), DEC-030 (implementation), DEC-031 (preload sandbox fix).
