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
