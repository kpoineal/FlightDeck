# Reload and persistence diagnostics

The original PR0 reports measured the former JSON startup order. Current application
code publishes cached data before independent validation, coalesces main readiness,
omits legacy array aliases on new saves and avoids subscription-triggered idle writes.
Production now uses the SQLite worker with bounded projections and incremental
commands. JSON reports below are historical baselines. See [state-storage.md](state-storage.md).

## Enable and retrieve

In PowerShell, opt in before launching the application:

```powershell
$env:FLIGHTDECK_STATE_DIAGNOSTICS = '1'
npm start
```

In the renderer's DevTools console:

```javascript
const report = await window.__flightdeck_state_diagnostics();
console.log(JSON.stringify(report, null, 2));
// Copy that JSON explicitly if needed; there is no automatic on-disk export.
```

`window.workiq.getStateDiagnostics()` retrieves the main buffer directly. Both
main and popout renderers expose the combined retrieval helper when enabled.
Fully quit the app before changing the environment variable. Disable with
`Remove-Item Env:FLIGHTDECK_STATE_DIAGNOSTICS` before the next launch.
Normal launches use the normal profile and normal connection behavior; **use the
offline commands below instead when testing generated data without remote access**.

Each process/renderer instance holds at most 256 records, with a random anonymous
run UUID, sequence numbers and dropped-record count. Renderer reload replaces its
buffer/run; main's buffer survives warm reloads. Retrieve promptly, especially
with popouts. Main navigation records have an incrementing local navigation
number; there is no cross-process clock subtraction or exact per-request tracing.

Only allowlisted operation names, monotonic durations, nonnegative safe-integer
counts/file bytes/navigation numbers and fixed outcome codes are recorded.
Snapshots contain no titles, prompts, addresses, source IDs, keys, paths, raw
errors, or payloads. No event invokes the persisted engine logger or performs an
extra JSON serialization. Enabled store spans use file stats; disabled spans
skip clocks, metadata inspection and stats. There is still a small function-call
cost; a 2% runtime-overhead budget has **not** been validated.

## Interpret the spans

- `app-start` duration is main module entry to app ready, **not** whole process launch.
- `window-navigation` is main-frame navigation to Electron `did-finish-load`,
  **not** cached-visible or usable UI. The first navigation is distinct from later
  same-main reloads. Renderer `renderer-bootstrap` / `renderer-reload` records
  use Navigation Timing's navigation type; popouts use `popout-bootstrap`.
- `hot-*` / `cold-*` measure synchronous electron-store wrappers, including
  enabled stat overhead. Their `bytes` field is the entire backing file's size
  after the operation, **not bytes transferred or bytes rewritten by that get**.
  Conf's internal read/parse/serialize/write phases are not separately measured.
- `ipc-*` measures main handler execution only, not queue wait or transport.
  `ipc-validate` includes existing CLI validation completion; it does not split
  process spawn, auth and remote latency.
- `hydrate-read` covers canonical/fallback IPC reads; `hydrate-normalize` covers
  item/scanner/proposal/briefing normalization and seed-prompt await if necessary.
  `connection-validate` includes the renderer's EULA IPC round trip.
- `remote-ready` means existing EULA validation succeeded. It is not a new
  authorization guarantee or a promise all remote operations will succeed.
- `hydrate-publish` is synchronous store publication; `cached-published` records
  its completion and hot count. Connected hydration now publishes **before validation
  completes**. `hydrate` still includes local repair saves/legacy cleanup.
- `svelte-tick` and `frame-opportunity` run asynchronously after hydration/mount.
  They are **not first paint, first usable UI, or interaction completion**.
- `log-load`, `version-load`, `update-check`, `engines-start`,
  `subscriptions-installed`, `startup-complete` show cached-first startup setup;
  version/log/update checks run independently.
  `app-mount` duration spans the awaited mount callback; it does not prove painting.
- `save-request` counts scheduling calls; initial Svelte subscription calls are skipped.
  `save-write` includes snapshot preparation/eviction and the hot write;
  `save-ipc` measures hot-write round trip. Cold work is visible in main spans.
  Failed/ambiguous receipts remain dirty and do not send success invalidation.
  Main revision-lease release now delivers production invalidation; the legacy
  renderer `invalidation` span is used only by bridges without the lease protocol.

## Offline correctness and reproducible baseline

Use the installed project toolchain (the existing tests require a modern Node
with `node:module.registerHooks`; exact host and Electron Node versions are in the reports).

```powershell
npm run test:state
npm run test:state:reload
npm run test:state:inbox
npm run bench:state:node
# Quick functional smoke, without percentile claims:
npm run test:state:reload -- --samples=1
```

`test:state:inbox` opens 205 generated unread threads using the production SQLite
path. It checks persisted read state, selection, list/document scroll and page
retention on the first two pages, plus keyboard activation, unread-filter
membership and last-page deletion clamping. It waits for the committed revision's
page query rather than a fixed delay. A DOM observer checks that routine saves
never insert a persistence banner, even briefly, and layout-position assertions
catch shifts separately from scroll changes. It uses the same isolated offline
bootstrap and profile cleanup.

The Electron command builds the **production renderer**, then launches the normal
main/preload/renderer path through an offline-only bootstrap. It creates a unique
marked `test-results\state-reload\generated-profile-*` directory before opening
stores. `userData`, session data, logs, window state, hot and cold JSON, and a
separate generated demo snapshot stay there. Production dot-notation storage keys
are used. No existing profile is accepted as input; no shared demo cold data,
real WorkIQ, login, auth or update network request is used. WorkIQ validation and
meetings are stubbed; unexpected external requests fail the run. The bootstrap
does not load the real WorkIQ client or PTY module. Disabled generated scanners
and monitors prevent background work. Profiles are removed in `finally`, only
after verifying their exact parent/prefix/marker. A forced process kill may leave
a marked generated directory; inspect it rather than deleting broad parents.

Deterministic fixtures:

| Fixture | Hot | Cold | Events/item | Summary size target |
|---|---:|---:|---:|---:|
| small | 100 | 0 | 0 | 64 characters |
| large | 500 | 5,000 | 40 (20 action + 20 other) | 1,024 characters |

Both preserve `items`, `trackingItems`, `radarItems` aliases and include an isolated
demo copy, two disabled scanners with different cross-scanner dedup settings,
exclusions and a tombstone. Source-provider-qualified identities deliberately
collide within/across scanners while canonical item IDs remain unique. Nothing
merges these records or adds uniqueness rules. Proposals, meetings and briefings
are empty in this representative reload matrix. Separate repository tests cover
proposals, retained execution evidence, import interruption/refusal and Today/DST
oracle parity. The large production durability smoke covers archive paging, cold
popouts outside page one, cold edits/deletes, stale revisions and restart without
JSON resurrection. The SQLite benchmark supports `--xlarge` (20,000 cold) and
measures production Radar pages, global Today queries and incremental writes.

Electron scenarios pair the same fixture size with disconnected vs persisted
connected snapshots and fixed successful offline validators. Held and failed
validators now verify expected cached counts plus a completed local interaction,
with remote IPC returning `CONNECTION_NOT_READY`. Warm success reuses main readiness.
The startup trace verifies publication → subscriptions → startup completion,
without waiting for update checks or auth.

Each scenario records one cold application launch and 30 warm renderer reloads
in the same main process/profile. The observer's warm interval starts immediately
before native Ctrl+R and ends after the expected Today count, an enabled local status
button click, and a visible selection panel. This exercises the production
acknowledged-flush reload route rather than bypassing it with automation navigation.
It includes flush and Playwright observer overhead; it is **not the earliest usable
moment or pure app latency**. Samples allow debounced maintenance time between
reloads; disconnected idle scenarios assert zero
snapshot writes. Node microbenchmarks strip canonical aliases before measurement.
Initial generated disk files retain baseline legacy arrays and the independent demo
snapshot, so whole-file sizes include that intentionally retained legacy data.
OS filesystem caches are uncontrolled. Cold-start samples are not percentiles.

Reports are explicit harness outputs, not per-event app logging:

- `test-results\state-reload\electron-baseline.json`: raw timings, sample counts,
  median, nearest-rank p95, max (only for ≥30 samples), fixture bytes, runtime and
  last bounded main/renderer trace for each scenario.
- `test-results\state-reload\node-baseline.json`: direct underlying **Conf**
  read/set/cold-read microbenchmark, not Electron IPC/hydration/rendering.
  Canonical aliases are removed before timing; the independent pre-existing demo
  snapshot is retained. Sets use Conf's normal atomic writes/pretty serialization.
  Initial fixture bytes precede those writes; `measuredFileBytes` records the
  actual files used by the microbenchmark.

If Electron cannot launch, retain the exact error, fix feasible blockers, and run
`npm run bench:state:node`; that fallback is explicitly **not E2E**. These measurements
do not establish latency SLOs, diagnostics-off/on overhead compliance, a real
WorkIQ latency distribution, or any SQL comparison. Rerun on a quiet agreed
reference machine and alternate baseline/candidate runs for later comparisons.
