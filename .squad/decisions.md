# Squad Decisions

### 2026-09-11: Radar duplicate prevention is prompt-hint plus exact-key filtering
**By:** Charlie
**What:** The anti-duplicate metadata is only partially effective. `buildScannerPrompt` sends a case-insensitive, exact-title list for up to 20 active items owned by the current scanner, plus names/topics of up to five other active scanners. It does not send stable item IDs, evidence URLs, source identity, summaries, or merge instructions. The stored `dedupStrategy`, `crossScannerDedup`, `recentTitles`, and `excludedItemIds` fields are not included in that prompt. After the model responds, `scanner-engine.js` filters exact IDs globally and exact normalized titles within the current scanner, with a 24-hour recent-title cache per scanner; it has no title similarity, evidence-URL, cross-scanner, or merge behavior.
**Why:** Similar issues can enter when scanners return different IDs or slightly different titles, and the model has no machine identity to correlate. Missing IDs are generated from title plus the current time, so they are not stable across runs. `buildMonitorPrompt` only carries the current item's prior summaries and evidence, while briefing prompts carry titles/counts without identity. Mailbox uniqueness is exact `item.id`; `summariesMatch` is exact normalized text equality and is not a merge path. The focused prompt/scanner/mailbox/exclusion tests pass, but they do not cover cross-scanner overlap, title similarity, evidence URL collisions, ignored strategy flags, or merge semantics.
**Recommendation:** Treat deterministic identity as the primary control: preserve a source-backed stable ID when available, otherwise derive a documented conservative fingerprint from canonical evidence/source fields, and enforce it in application code before insertion. Define explicit cross-scanner policy and conflict/merge rules before using similarity as anything more than a review candidate. Add tests for same evidence with different titles/IDs, near-title variants, cross-scanner duplicates, missing IDs, and each configured dedup strategy.

### 2026-09-11: Scanner anti-duplicate validation
**By:** Merlin (Tester), requested by the project owner
**What:** The scanner currently has prompt-level duplicate guidance and exact suppression, but no verified similarity/evidence merge path. Treat duplicate leakage as an ingestion-contract gap, not a radar navigation or sorting defect.
**Why:** Focused tests are green, while the implementation does not enforce the metadata and strategy names exposed by the scanner configuration.

## Validation commands

- `node --test test/prompt-fidelity.test.js test/scanner-engine-trigger.test.js test/scanner-exclusion.test.js`: exit 0; 11 passed, 0 failed, 0 skipped.
- `node --test --test-reporter=tap test/prompt-fidelity.test.js test/radar-navigation.test.js test/radar-selection-transition.test.js test/scanner-engine-trigger.test.js test/scanner-exclusion.test.js test/sort-utils.test.js`: exit 0; 64 passed, 0 failed, 0 skipped, 0 todo. Node reported non-failing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- `npm test`: exit 1; 358 tests, 353 passed, 1 failed, 4 skipped, 0 todo. The failure is `test/inbox-filters.test.js:111` (`due-soon includes overdue dates and excludes dates after seven calendar days`). This is unrelated to scanner deduplication.

The default `npm test` script includes prompt fidelity, radar navigation/selection, and scanner exclusion, but omits `test/scanner-engine-trigger.test.js` and `test/sort-utils.test.js`.

## What is actually enforced

- `src/svelte/lib/prompts.js` includes `lastRunAt` freshness instructions and a dedup list of up to 20 active, non-complete/non-archived titles belonging to the current scanner. It also includes up to five other active scanner topic summaries.
- The prompt dedup list contains normalized display titles only. It does not include item IDs, evidence URLs, source signal IDs, `signalAt`, or a canonical identity/merge instruction.
- `src/svelte/lib/scanner-engine.js` suppresses an incoming result only when its ID already exists globally, or its normalized title matches an existing/current `recentTitles` entry for the same scanner. `recentTitles` is retained for 24 hours.
- `excludedItemIds` and global `deletedItemIds` are applied by exact ID before insertion. Existing tests verify this exact-ID behavior, including that a distinct ID with the same title is not blocked by a deleted ID.
- `dedupStrategy` values (`evidence-url`, `title-similarity`, `both`) are normalized and exposed in `src/svelte/lib/models/scanner.js`, but scanner ingestion never reads the setting. The prompt test explicitly verifies that `dedupStrategy` is not leaked into the prompt.
- `crossScannerDedup` is normalized, but the scanner prompt builder does not gate its cross-scanner topic block on the setting, and scanner ingestion has no cross-scanner duplicate suppression.
- Freshness is an LLM instruction only. The engine does not post-filter returned `radarItems` by `signalAt` or another returned event timestamp against `scanner.lastRunAt`.
- There is no radar-item pooling or merge operation. RadarView's related-thread display groups a title prefix for presentation only. The duplicate grouping/deletion implementation in `action-proposals.js` applies to action proposals, not scanner radar items, and uses exact normalized fields.

## Test coverage gaps

1. Prompt fidelity does not assert a stable anti-duplicate identity contract (ID, evidence URL/source ID, and signal timestamp) because none is emitted.
2. Prompt fidelity checks freshness wording but not an end-to-end stale-result rejection.
3. Scanner trigger tests pass an empty current-item set for prompt forwarding; they do not prove that existing titles, IDs, or evidence metadata reach the WorkIQ prompt during a real scan.
4. No scanner test covers a near-duplicate with a new ID and slightly changed title, punctuation, or wording.
5. No scanner test covers duplicate evidence URLs with different titles or duplicate source IDs across scanners.
6. No scanner test covers a returned result at or before `lastRunAt`.
7. No test defines merge semantics: canonical item selection, evidence union, summary/history merge, severity/due-date precedence, or scanner reassignment.
8. The default test gate omits two requested suites, and currently has the unrelated `inbox-filters` failure noted above.

## Cheapest discriminating regression tests

- Prompt contract test: build a prompt with one existing item containing a stable ID, source/evidence URL, and `signalAt`; assert the anti-duplicate block carries those identity fields and tells the model how to treat them. This should be an acceptance test for the intended metadata contract.
- Exact end-to-end ingestion test: run a scanner with an existing item and return the same ID and same title; assert zero new items and unchanged item count. Keep both ID and title cases separate.
- Near-duplicate leakage test: return a new ID with a semantically equivalent title and the same evidence URL/source ID; assert suppression or merge according to the selected `dedupStrategy`. This is the cheapest test that would fail under the current implementation.
- Freshness enforcement test: return one item with `signalAt` equal to or before `lastRunAt` and one after it; assert only the newer item is accepted. This proves freshness outside the prompt text.
- Cross-scanner test: with `crossScannerDedup` enabled, return an equivalent item from scanner B when scanner A already owns it; assert one pooled canonical item. Add the disabled-setting case to prove the switch has an effect.
- Merge contract test: submit two equivalent results across successive scans and assert one canonical radar item, deterministic evidence union, and an auditable update-history entry. Do not leave merge precedence implicit.

## Proposed acceptance matrix

| Scenario | Identity signal | Expected behavior | Current status |
|---|---|---|---|
| Same result ID, same scanner | `id` | Suppress | Implemented; not directly covered with a non-empty current-item scan |
| Same normalized title, same scanner | exact normalized title | Suppress | Implemented; recent-title path exists, end-to-end regression should be added |
| Same title, different ID, deleted prior item | ID plus title | Accept distinct result | Implemented and covered |
| Different title, same evidence URL/source ID | evidence identity | Suppress or merge | Not implemented |
| Near-equivalent title, different ID | title similarity | Suppress or merge when configured | Not implemented; `dedupStrategy` is inert |
| Equivalent result across scanners | cross-scanner identity | Pool when enabled; preserve separate when disabled | Not implemented |
| Returned signal at/before `lastRunAt` | `signalAt` | Reject as stale | Not implemented; prompt-only instruction |
| Equivalent results in one response | evidence/title identity | One canonical item with deterministic merge | Not implemented |
| Existing item metadata in prompt | ID, source ID/URL, signal time | Model can identify exact prior work | Title-only prompt block today |

No production code or tests were modified in this validation pass.

### 2026-09-11: Prompt dedup is advisory; add evidence identity and reviewed similarity pools
**By:** Iceman (Product Owner)
**What:** The current anti-duplicate design is not an enforceable deduplication system. Prompt metadata should remain a helpful model hint, but duplicate prevention must be performed in the renderer after a scan response is normalized. Use exact source identity for automatic suppression or consolidation, and use similarity only to suggest a user-reviewed pool. Do not ship automatic title-based merges.
**Why:** A focused review of the scanner, item model, persistence, and Radar UI found no evidence-URL or similarity comparison in the scan acceptance path. The current prompt lists at most 20 active same-scanner titles, excludes terminal items, does not include source URLs or stable identity keys, and the runtime accepts model results when their id and normalized title are new. The persisted `dedupStrategy` and `crossScannerDedup` settings are exposed in the UI and normalized, but are not applied by prompt construction or scan acceptance. A response can also contain two same-title candidates in one scan because the candidate set is not updated while filtering. Cold items are not part of the scanner's duplicate comparison. The existing Radar "related thread" indicator is only a title-prefix count and has no pooling or merge action.

## Current user-visible lifecycle

1. A scanner definition and its prompt are built in `src/svelte/lib/prompts.js`.
2. `src/svelte/lib/scanner-engine.js` sends the prompt to WorkIQ, parses `radarItems`, normalizes each item, and assigns the model id or a timestamped title hash fallback.
3. New items are accepted when their id is not present and their normalized title is not already in the same scanner's title set or 24-hour `recentTitles`. The accepted records are prepended to the `items` store.
4. `src/svelte/lib/persistence.js` writes the item array to the canonical electron-store key. Completed or archived records can later move to cold storage.
5. Radar renders the record by its exact id. Evidence links are deduplicated only within an individual item by exact URL. Monitoring updates that same id and appends update history.
6. Delete removes the exact hot/cold id, records a deletion exclusion, and preserves effectful action audit records. There is no user-facing restore, pool, or merge operation.

## Findings

- Prompt-only dedup is probabilistic and lossy. The model sees title text, not a stable source identity, source URL set, or canonical identity contract. The list is capped and terminal items are omitted, so prompt context cannot cover the full persisted corpus.
- Runtime dedup is exact-id plus exact normalized title within the current scanner. It does not compare evidence URLs, semantic title similarity, counterparties, dates, or scanner-wide records.
- Same-scan duplicates are not rejected against one another because the acceptance filter reads a fixed `existingTitles` set while iterating the response.
- `crossScannerDedup` is stored and shown, but current runtime title matching is explicitly scoped to `i.scannerId === scanner.id`; the cross-scanner prompt block is emitted without using the setting and does not enforce anything after the response.
- `dedupStrategy` is stored and shown, but no evidence-URL or title-similarity algorithm consumes it in the scan path.
- A model-generated id is not necessarily stable. When absent, the fallback includes the current time, so repeated observations can become distinct records even when the title and source are the same.
- Scanner duplicate checks use hot `items`; evicted completed/archived records in cold storage are not considered during a new scan. This can allow an old source to reappear as a new active item.
- Similarity false positives are likely for generic titles, recurring meetings, shared documents, broad Teams threads, and the same source supporting separate work. Stale groups are also possible when a source has no recent activity or a member is deleted/archived.
- Action-proposal duplicate grouping is a separate, stronger exact-content feature. It must not be mistaken for radar-item duplicate detection and should not be silently rewritten by item pooling.

## Conservative MVP recommendation

### 1. Separate identity from similarity

- **Identity:** exact canonical source reference. Prefer a normalized deep-link evidence URL or a provider-stable source key. If a response has multiple evidence links, match an existing item when any verified source identity overlaps, then union the evidence rather than creating another item. Treat an LLM-provided id as a hint unless it is backed by a source identity contract.
- **Similarity:** a suggestion that two distinct records may describe the same work. Use conservative signals such as token-normalized title similarity plus overlapping people, source type, time window, or evidence overlap. Similarity alone must never suppress a result or delete data.
- Make the setting behavior real in the acceptance path: exact identity matching is always available; `crossScannerDedup` controls whether identity matches can pool across scanners; `dedupStrategy` controls only suggestion scope, not whether a user-confirmed merge is reversible.

### 2. Put detection after normalization, before append

Create one testable dedup/pooling helper beside the item model and call it from `runScanner` after `normalizeItem` and before `items.update`. It must compare the full hot and cold identity index, dedupe candidates within the same response, and return explicit outcomes such as `new`, `same-source`, and `similar-suggestion`. Prompt construction can include a compact identity summary for model behavior, but it is not the authority.

### 3. Put review in the existing Radar detail surface

Replace the current related-count-only treatment in `RadarView.svelte` with a small "Similar items" section on the selected item. Show why each candidate was suggested, its source links, scanner, age, and lifecycle. Offer one explicit user action to pool into the selected canonical item. Keep this out of scanner settings because pooling is an item-level decision and can cross scanner boundaries.

### 4. Make pooling reversible and evidence-preserving

- Keep the selected item as the canonical record.
- Retain every absorbed record and its original id, scanner, title, discovery times, evidence links, update history, and action-proposal references in persisted merge metadata. Do not hard-delete absorbed records.
- Mark an absorbed record as merged and exclude it from active Radar projections while retaining it for Archive and undo. Record canonical id, absorbed id, actor, timestamp, and reason.
- Union evidence by canonical URL, and annotate imported history/evidence with the originating item id or merge id so provenance is visible.
- Provide `Undo pool` as a transaction using the existing persistence transaction pattern. Undo must restore the absorbed record and its original scanner placement without duplicating evidence or history.
- Do not transfer or delete external action effects automatically. Preserve action proposals and audit events against their original source item; surface them as provenance on the canonical view.

### 5. Staleness and false-positive policy

- Never auto-merge on title similarity alone.
- Show a stale marker when a pool's supporting evidence is no longer recent or all members are terminal/deleted; do not silently dissolve the pool.
- Let the user unpool a stale or incorrect suggestion. Deleted source ids remain deletion exclusions and must not be resurrected by a stale scan result.

## Acceptance criteria

1. Two candidates in one scan with the same verified evidence URL but different model ids and titles produce one canonical active item; the item keeps both source labels where applicable and no second card is created.
2. The same behavior works across scanner boundaries only when `crossScannerDedup` is enabled. With it disabled, the product does not silently pool cross-scanner records.
3. Two candidates in one response with the same normalized title are not both inserted when they represent the same source; the test covers the fixed-point candidate set, not only prior persisted items.
4. Title-only similarity never suppresses a result. It creates a visible suggestion with match reasons and a user decision.
5. A confirmed pool preserves both original ids, scanner assignments, source URLs, discovery timestamps, update history, and linked action audit evidence.
6. Undo restores the absorbed item as it was before pooling, is persisted atomically, and is safe to repeat without duplicating records or evidence.
7. A failed persistence write leaves both items and all provenance unchanged.
8. Hot and cold records participate in identity lookup, while exact deleted ids remain excluded.
9. Tests cover evidence identity, same-scan duplicates, title variants, cross-scanner on/off, cold storage, false-positive suggestions, merge undo, persistence rollback, and action-proposal provenance.

## Product boundary

The MVP should not attempt full semantic clustering, automatic cross-scanner reconciliation, background re-ranking of every historical item, or destructive merge/delete behavior. First make exact source identity reliable and observable; then use user-confirmed pools to collect the ambiguous cases that can teach a later similarity model.