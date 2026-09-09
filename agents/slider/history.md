# Slider — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC, electron-store
- **User:** the project owner

## Learnings

### 2026-03-30: Initial onboarding — memory crisis analysis
- App crashed with V8 OOM ("JavaScript heap out of memory") after 48h unattended over a weekend
- PTY buffers in pty-bridge.js are properly scoped (local to promise, GC'd after resolve) — NOT a leak
- The real problem is renderer-side state accumulation:
  - `state.items` grows unboundedly as scanners push new items via `state.items.push()`
  - Evidence links merge-accumulate per monitor cycle (mergedLinks preserves all previous + adds new)
  - `state.history` grows between saves; `pruneHistory()` only runs in `savePersistentState()`
  - `state.briefingsByMeetingId` accumulates briefing objects (~50KB each)
- Architecture: all data loaded into memory on startup, full JSON serialized on every save
  - `loadPersistentState()` deserializes entire blob into renderer `state` object
  - `savePersistentState()` serializes full state back via IPC to electron-store
  - Double memory pressure: data exists in both main + renderer process
- CSP `style-src 'self'` was generating 1,001+ violation events per render cycle (fixed — inline style= replaced with CSS classes + CSSOM)
- Auto-archive runs every tick but only removes archived/complete items older than retentionDays
- `updateHistory` capped at 20 per item but trimmed after insert, not before
- Sequential processing guards (`scannerCycleInProgress`, `monitorCycleInProgress`) mean at most 2 PTY calls concurrent

### 2026-09-08: Inbox filtering, scanner deletion, Radar, and persistence profile
- Environment: Windows, Node v26.2.0, deterministic fixed-time fixtures, forced-GC memory sampling; focused tests passed 56/56.
- Thresholds used: interactive computation <=16.7 ms/frame; user-command preview <=100 ms and data-only transaction <=250 ms; rapid-save bursts should coalesce to bounded writes rather than grow linearly.
- Inbox filters preserve source order and do not mutate input. Median/p95 at 100, 1,000, 10,000 items: selective combined quick+facet filter 0.011/0.017, 0.068/0.078, 1.192/1.266 ms; signal+due allocation-heavy filter 0.072/0.080, 0.714/1.184, 11.679/14.258 ms.
- Recent and Priority sorts are deterministic and stable via ID tie-breaks, without input mutation. Recent median/p95: 0.110/0.120, 2.942/3.468, 41.160/43.173 ms. Priority: 0.134/0.146, 4.486/4.740, 67.950/83.415 ms. No retained heap growth after GC; 10k transient bursts were about 5.7 MB Recent and 12.0 MB Priority.
- Scanner deletion correctness held for preview, reassign, and delete-all. At 1,000 owned items, steady medians were 5.7-6.2 ms preview and 6.7-7.3 ms execute; GC/cold-start outliers reached 70-118 ms.
- At 10,000 owned items with the production-shaped 500-hot/9,500-cold split, reassign preview/execute were 479/493 ms median (653/654 ms p95) and delete-all 500/509 ms median (645/656 ms p95). Preview plus confirmation therefore costs about 1 second before Electron IPC cloning, electron-store serialization, or disk I/O. Transient heap was about 16-27 MB for preview and 30-39 MB for execute; post-GC retention was negligible.
- Scanner deletion scaling is superlinear. Primary causes: repeated array `includes()` membership checks while building the preview token, repeated proposal/event scans, stable serialization of the full affected record set, and execute recomputing the complete snapshot/token after preview. Changes are required before shipping deletion against unbounded cold storage; no policy decision is needed, only implementation optimization preserving the transaction contract.
- Mounted Radar computation at 10,000 projected items costs about 47.7 ms before DOM work: nested hot/cold projection dedup 31.5 ms, filter+Recent sort 11.3 ms, repeated view/scanner counts 3.8 ms, selected duplicate scan 1.0 ms. At 1,000 items the same bundle is about 2.3 ms. The 500 hot-item cap protects normal Inbox use, but large cold Archive projections can miss the frame budget. Replace nested `some()` dedup and aggregate counts in one pass before large-archive shipment.
- Persistence queue does not coalesce ordinary rapid saves: 50 requests produced 50 full writes and drained in 91.5 ms with zero injected store latency or 785.6 ms with 10 ms/write. A transaction attempted during an active write fails immediately with `BUSY`; by contrast, 20 saves requested during an already-active transaction correctly collapsed to one follow-up write and all waiters resolved.
- Save-storm risk is commit-level rather than keystroke-level because editable fields commit on blur/change. Each item mutation still invokes an immediate full save while App subscriptions schedule another 500 ms save. Coalesce queued ordinary saves to the latest snapshot and let scanner transactions wait behind or atomically fence the queue; otherwise backlog can starve user-initiated deletion under rapid edits.

### 2026-09-08: Independent rejected-test revision
- Added focused regression coverage for authoritative external-only cold scanner deletion, audit-only proposal inertness, eviction convergence, and local calendar boundaries. Integrated touched-unit result: 93 total, 86 passed, 7 intentional product failures, 0 harness or unrelated failures.
- Finding counts: external-only cold state 0 green/3 red unit tests plus 0 green/1 red browser scenario; audit-only inertness 2 green/0 red; age/cap eviction convergence 0 green/2 red; local calendar boundaries 0 green/2 red.
- The renderer build succeeded with 195 modules transformed. The unhydrated-Archive browser scenario made no external requests and had no page, console, overflow, or overlap failures; it failed only because deletion preview never read authoritative cold storage.
- Contract assumptions: scanner deletion preview may become async and its token must cover the accepted authoritative cold snapshot; `auditOnly` remains persisted evidence but is excluded from active views and every mutation/execution/management/navigation path; accepted eviction removes the same IDs from live, canonical, and cold tiers before resolving; Due soon includes the full seventh local calendar day and Today begins at local midnight, including across DST offset changes.

### 2026-09-09: Ingestion-trigger regression coverage
- Added `test/scanner-engine-trigger.test.js` as an independent lifecycle suite for immediate due checks, explicit resume/restart guards, interval idempotence, overlap protection, zero-item scanner bookkeeping, and prompt pass-through.
- The suite uses fake intervals and a mocked `runWorkiqJson` transport, so it exercises no real WorkIQ credentials or network behavior.
- Manual scanner Run Now is covered with a narrow `RadarView.svelte` source-contract assertion because the current test architecture has no mounted Svelte component runner; the assertion requires the shared `runScannerNow` helper to catch rejection and surface a toast/status path.
- Validation: focused trigger suite 5/5 passed; adjacent scanner exclusion and prompt fidelity tests 6/6 passed; `git diff --check` passed.
