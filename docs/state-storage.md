# Local state: production SQLite repository

## Ownership and startup

Normal production startup uses one main-owned worker repository for the active
OS-user profile. Normal and demo databases are completely separate:
`state-normal\state.sqlite` and `state-demo\state.sqlite` under `userData`.
`state-service.js` coalesces opening/import, runs due retention maintenance,
and exposes allowlisted queries and transactional commands. Renderers cannot
choose paths or execute SQL. No new database dependency is required.

Threads, events, sources, scanners/exclusions, proposals, tombstones, application
audit history and preferences are stored in normalized tables. Small unrelated
settings and engine logs can still use electron-store. Generic snapshot and
whole-cold IPC channels refuse migrated-domain access with
`SNAPSHOT_BACKEND_RETIRED`. Legacy JSON is backup/import input, **not a second
writer or a recovery fallback**.

Hydration publishes a bounded hot projection (at most 500 records, one recent
event per record). Detail/history is fetched on selection, including IDs outside
the current page. Existing Svelte stores are edit buffers: the save queue compares
fields to an immutable acknowledged baseline and sends only changed fields/rows.
Unchanged thread collections are not serialized into save IPC. In-place edits
are detected. Partial histories merge safely; opening detail does not truncate
the saved history. Proposal/scanner definitions and the retained global audit
projection continue to support the existing UI.

## Queries and UI

- Radar searches/filters/sorts retained rows in the worker and mounts at most 100
  rows per page. Archive membership/activity ordering and global view counts use
  covering expression indexes, with bounded detail retrieval. Unread candidates
  use indexed flags/events, including unread events outside the projected recent
  history. Advanced facets still use the pure filter oracle on row fields plus
  indexed unread evidence, without fetching each candidate's history. Normalized
  enum/boolean quick filters and severity/lifecycle/read/monitoring facets run
  directly in SQL before paging; arbitrary scanner IDs, signal values and dates
  retain the JS oracle's Unicode and local-calendar semantics.
  Navigation and popouts fetch any retained ID directly.
- Today uses **all retained nondeleted hot and cold records**, not whichever
  archive page happened to load. Counts, status/deadline/scanner buckets, local
  calendar/DST, latest non-archive lifecycle completion, snooze rules, verified
  communication deduplication and seven-day activity use the shared Today oracle.
  Only counts, small highlights and bounded selections leave the worker.
  Lazy per-thread history reductions cache seven-day activity counts, receipt
  identities and the latest non-archive lifecycle. Only edited/created/deleted
  threads invalidate those reductions, including maintenance and scanner
  dispositions; unrelated revisions do not reread retained events. Final folds
  preserve ID/ordinal ordering and cross-thread/cross-day receipt deduplication.
  Deadline/snooze predicates are recomputed for the requested time; crossing a
  future event refreshes its thread. Local-day rollover or moving time backwards
  rebuilds the relevant reductions, preserving DST and historical-query behavior.
  The first Today query after worker open and day rollover still read retained
  histories once; this is lazy work, not a startup/write-time full-history rebuild.
  Worker `status.todayProjection` counters expose rebuilt threads/events read
  for synthetic regression and benchmark verification. The worker uses the same
  OS local timezone as the application. No schema-version change or rewritten
  source events are required; added indexes are idempotent on existing databases.
- Scanner discovery does bounded indexed source/ID lookup, not whole archive
  hydration. Acceptance transactionally rechecks current scanner configuration,
  exclusions, tombstones, retained identities and duplicates within the response.
- Monitor scheduling queries up to 100 due records across both tiers using the
  monitoring index, so the 500-hot projection never disables retained schedules.
- History → **Review source collisions** queries the retained identity index.
  Pages contain at most 100 groups and 100 owners/group, with explicit truncation.
  Scanner/tier evidence and directional dedup policy are included. Revision-bound
  cursors refuse stale reports. Nothing automatically merges or deletes sources.
- Source identities are nonunique globally: same-scanner dedup and candidate
  scanner cross-scanner policy remain distinct. Titles are not identities.

## Commands, durability and concurrency

SQLite uses foreign keys, WAL, `synchronous=FULL` and a one-second busy timeout.
Main owns a bounded worker RPC queue. Each command atomically checks the repository
revision, changes affected rows and records a local idempotent retry receipt.
Changed-payload reuse of a command ID is refused. Per-record CAS is also available
on the thread-patch API. Stale windows cannot restore deleted rows.

The renderer retains a command ID/payload after an ambiguous acknowledgement and
retries that exact local transaction. This is **not remote-send idempotency**:
external dispatch verification, ambiguous outcomes and retry prohibitions are
unchanged. Deletion retains effectful/ambiguous proposal/action evidence and
removes no-effect proposals. Scanner delete/reassign is one transaction across
both tiers; reassignment to Unassigned is supported. Exclusions and global
tombstones retain their different meanings.

Status actions may include the legacy boolean `completed` flag when clearing an
old completion marker. Incremental thread commands accept that boolean through
the same item normalizer used for imports; only canonical lifecycle fields are
stored. Other unknown patch fields and non-boolean completion flags are refused.

Failed repository saves show a sanitized error code alongside **Local state:
failed** (or **conflict**), and main logs record the code without item content.
Local edit buffers and the pending command ID/payload are retained; **Retry save**
reuses that command safely. A successful save clears the error. Export local
edits before restarting a window that cannot save; do not discard or reload
unsaved work as a troubleshooting shortcut.

Committed revisions invalidate other windows. Dirty buffers are not silently
overwritten: conflicts retain local edits, offer export and explicit discard/
refresh. Pages reset on revision invalidation; worker cursors can reject expired
revisions. Main-issued execution leases elect one scheduled-engine owner and
prevent concurrent same-resource scans/checks. Interactive popout checks remain
available when the resource is idle. Navigation, renderer crash and destruction
release abandoned leases.

Existing retention remains: 20 action plus 20 other events/thread, evidence caps,
200 entries/30 days of global audit, seven-day auto-archive, 24-hour cold-candidate
classification and the 500-hot target. Cold placement is transactional, not a
separate JSON write.

Ctrl+R/F5/menu reload, popout close and normal quit request acknowledged renderer
flush. Quit then drains/checkpoints/closes the worker before IPC teardown.
Failure blocks controlled navigation. OS kill/crash can still lose edits not yet
delivered within the debounce window; no forensic-erase guarantee is made.

## Import, refusal and recovery

Before any renderer domain writer is enabled, the service:

1. Selects canonical v2 (including an empty array), otherwise v1/legacy aliases;
   hot wins duplicate IDs across tiers and tombstones exclude both.
2. Refuses malformed/null canonical state, conflicting IDs, unreadable stores,
   missing active DBs, corrupt/newer schemas and invalid markers. It never falls
   back to stale aliases after a canonical failure.
3. Preserves original bytes and SHA-256 manifests in private profile-local
   `backup-<fingerprint>` directories before import. Missing IDs receive recorded
   deterministic IDs. Unknown scanner references are retained as unassigned.
4. Imports into a staging DB transaction, verifies counts, event order, integrity
   and foreign keys, closes/checkpoints, renames and fsyncs an atomic backend marker.
5. On restart reconciles a committed database/marker rather than reimporting JSON.

Failures are visible in the persistence banner with safe refusal codes and an
explicit read retry. No empty replacement is authorized. Keep originals and the
active database/WAL together for investigation; do not delete the marker/database
to force stale JSON back into service. A post-cutover downgrade/restore needs a
current compatible export or a forward repair; original backups alone can lose
new edits, tombstones and external-action evidence. Automatic rollback to older
backups is deliberately not offered. Online backups must use SQLite's backup API,
not a live DB-only filesystem copy. Backups/WAL/free pages may retain private
deleted content; there is no automatic backup deletion or encryption guarantee.

Demo uses its own DB/backups/cold namespace. `--demo-reseed` resets only the demo
repository transactionally; normal-profile reseed commands are refused.
One OS-user profile does not imply account/tenant isolation.

## Validation and release limitations

```powershell
npm test
npm run test:state
npm run test:state:sqlite
npm run build:renderer
npm run test:state:production
npm run test:radar:browser
# Exact locked runtime when node_modules contains a different Electron:
$env:FLIGHTDECK_ELECTRON_PATH = 'C:\path\to\electron.exe'
node scripts\test-state-durability.js --large
node scripts\test-state-reload.js --samples=30
node scripts\bench-state-repository.js --xlarge
# Standard Windows MSI build; requires VS C++ x64/x86 tools and Spectre libraries:
npm run dist
# Administrative extraction only, not an installed application upgrade.
# Choose a new task-owned TARGETDIR for every run:
msiexec /a "dist\FlightDeck 1.3.0.msi" /qn TARGETDIR="C:\dev\repos\FlightDeck\test-results\msi-extracted-unique"
$env:FLIGHTDECK_PACKAGE_PATH = "C:\dev\repos\FlightDeck\test-results\msi-extracted-unique\FlightDeck\FlightDeck.exe"
node scripts\test-state-production-package.js
```

Tests generate marked isolated profiles under `test-results\state-reload`.
Production entry accepts `FLIGHTDECK_GENERATED_PROFILE` only for that explicit,
marked test boundary, before opening logs/settings; DNS is blocked in this mode.
Do not point test commands at private profiles.

Locked Electron 41.0.3 supports the built-in SQLite worker. Windows x64 normal
production-entry migration/reload/edit/delete/multiwindow tests are distinct from
package certification. The package harness requires an explicit executable path,
asserts `app.isPackaged`, exact Electron/Node/SQLite versions, ASAR worker/renderer,
all six shipped Windows x64 native modules, and a harmless local node-pty child
that exits successfully with disposed event subscriptions. It exercises current
fixtures and a separate faithful 1.0.3 (`f61ea51`) `trackingItems`-only snapshot
without a cold store. Both verify byte-identical backups/hash manifests, import
refusal/retry, incremental edit/deletion, multiwindow invalidation/stale conflict,
remote readiness refusal, coordinated quit and restart ignoring stale JSON.
The package harness blocks network requests and external links; WorkIQ is not
invoked. It waits for real renderer flush acknowledgements after asynchronous
invalidation before requesting quit. No production writes or failure gates are
stubbed. Structured evidence is written to
`test-results\state-reload\production-package.json`; generated profiles are removed.
Remove only the exact task-owned extraction after retaining its evidence/MSI.

A standard MSI build requires Visual Studio C++ tools and Spectre-mitigated
libraries for node-pty. On Windows, electron-builder's signing-tool archive may
also require elevation to extract its macOS symbolic links. Do not disable native
rebuild or executable editing to bypass these prerequisites. Neither extraction
nor an unsigned package smoke establishes an installed MSI upgrade, trusted
signing or release certification.
The durability harness observes and asserts the native delete-confirmation dialog;
its existing offline main-process dialog stub supplies the affirmative response.
Playwright must not try to dismiss or accept that already-resolved native dialog.
macOS DMG/ZIP (hardened runtime/notarization), Linux AppImage/DEB and other
architectures remain unverified on this Windows host.
