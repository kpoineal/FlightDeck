# Goose — History

## Project Context
- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Goal:** Decompose massive renderer.js (5,355 lines) and index.html (2,145 lines) into modular frontend code

## Core Context
- **Phase 1 (CSS Extraction):** Extracted inline CSS from `index.html` into 8 modular files in `styles/`. Tightened CSP to `style-src 'self'`.
- **Phase 3 (Renderer Foundation):** Extracted 11 non-rendering foundation modules from `renderer.js` into `renderer/` (e.g., `theme.js`, `state.js`, `models/`). Loaded via `<script>` tags.
- **Phase 4 (Renderer UI Decomposition):** Eliminated `renderer.js` monolith entirely by extracting 9 UI modules (e.g., `renderers/`, `events.js`, `app.js`). Shared popout handlers to reduce duplication.

## Learnings
<!-- Append learnings below -->

### 2026-02-26 — localStorage Leak Fixes
- **3 localStorage leaks identified and fixed** at The user's request:
  1. **Legacy v1 key never cleaned** (`renderer/state.js`): `loadPersistentState()` read from `LEGACY_STORAGE_KEY` but never removed it. Fixed by calling `localStorage.removeItem(LEGACY_STORAGE_KEY)` after successful migration read.
  2. **`briefingSeenAt` orphan entries** (`renderer/models/briefing.js`): `reconcileMeetingScopedState()` rebuilt `briefingsByMeetingId` but left stale keys in `briefingSeenAt`. Fixed by pruning `briefingSeenAt` to only keep keys present in updated `briefingsByMeetingId` or current meetings list.
  3. **History only pruned on load** (`renderer/state.js`): `pruneHistory()` was only called in `loadPersistentState()`. Added call to `pruneHistory()` at top of `savePersistentState()` before every write. Also added `HISTORY_MAX_ENTRIES = 500` cap in `renderer/constants.js` as belt-and-suspenders guard.
- **Key files**: `renderer/state.js`, `renderer/models/briefing.js`, `renderer/constants.js`
- **Pattern**: localStorage growth issues in long-running Electron apps require both time-based and count-based pruning, plus explicit cleanup of migration keys.

### 2026-02-26 — Ephemeral Data Persistence Reduction
- **Problem**: The user's localStorage at 385 KB (7.5% of 5 MB) after a few days. Previous leak fixes addressed future accumulation but didn't reduce existing payload size. `savePersistentState()` was persisting ephemeral data that doesn't survive restarts meaningfully.
- **4 changes made**:
  1. **Stopped persisting `radarItems`** (`renderer/state.js`): Removed from `savePersistentState()` payload and `loadPersistentState()`. Radar items are fully replaced every scan via `applyRadarPayload()` and re-fetched on connect via `refreshAllData()`. Stale scan results on restart are useless.
  2. **Stopped persisting `meetings`** (`renderer/state.js`): Removed from both save and load. Meetings are ephemeral — fully replaced on refresh via `applyMeetingsPayload()`, filtered to future-only. Refreshed immediately on connect.
  3. **Lowered `updateHistory` cap from 50 → 20** (`renderer/monitor-engine.js`): Reduced per-item history depth. Added load-time trim in `loadPersistentState()` so existing oversized histories get trimmed on first load after this change.
  4. **Lowered history cap from 500 → 200** (`renderer/constants.js`): Changed `HISTORY_MAX_ENTRIES` from 500 to 200. 200 entries is plenty for a 30-day rolling window at typical usage rates.
- **UI impact**: On app startup without a connection, radar and meetings render as empty arrays (the default), then populate after `refreshAllData()` completes (~1-2 second flash). `briefingsByMeetingId` still persisted since those require LLM calls to regenerate.
- **Tests updated**: 10 test assertions in `test/renderer-state.test.js` updated to reflect that `radarItems`/`meetings` are no longer round-tripped through persistence, and history cap is 200. All 30 state tests pass.
- **Key files**: `renderer/state.js`, `renderer/monitor-engine.js`, `renderer/constants.js`, `test/renderer-state.test.js`
### 2026-02-26 — Sleek Apple-Inspired UI Redesign
- **Goal**: Redesign the UI to be sleek, modern, and Apple-inspired.
- **Changes**: Updated CSS tokens and components to use system fonts (SF Pro, -apple-system), translucency (backdrop-filter: blur), subtle shadows, rounded corners, and smooth transitions.
- **Key files**: `styles/tokens.css`, `styles/layout.css`, `styles/components.css`, `styles/radar.css`, `styles/tracking.css`, `styles/search.css`, `styles/modal.css`.
- **Pattern**: Used CSS variables for border-radius and blur to maintain consistency across components. Added subtle hover and active states for interactive elements.

### 2026-02-26 — Light Mode Re-envisioning & Design System Overhaul
- **Goal**: Fix washed-out light mode and elevate both themes to Apple/macOS Sequoia quality.
- **tokens.css overhaul**: 
  - Added semantic color tokens (`--color-critical`, `--color-elevated`, `--color-observe`, `--color-success`) and `--shadow-hover` to both dark and light themes.
  - Light mode: warmer body (`#f5f5f7`), more opaque surfaces (0.88 vs 0.75), crisper borders (0.08-0.18 vs 0.05-0.15), dual-layer card shadows, stronger modal overlay (0.35 vs 0.2), warmer text (`#1d1d1f` vs `#000000`), increased blur radius (24px vs 20px), accessible green for briefed text (`#248a3d`).
  - Both light blocks (`html[data-theme="light"]` and `@media prefers-color-scheme: light`) kept perfectly in sync.
- **components.css**: Replaced ~30 hardcoded color values with `var()` + `color-mix()` references (KPI borders/values, stack segments, legend dots, pill borders, severity-select borders). Switched hover shadows to `var(--shadow-hover)`.
- **tracking.css**: Fixed `.has-new-update` glow, `.tracker-updated-at` colors, and `updatedAtPulse` animation to use `--color-success` token. Added `@media prefers-color-scheme: light` handler for weekly time picker indicator.
- **radar.css, search.css, layout.css**: Theme-adaptive hover shadows, stronger search dropdown shadow, smooth body background transition on theme switch.
- **briefing.css**: Added prose styles for code, blockquotes, tables, and pre blocks within bucket components.
- **Pattern**: `color-mix(in srgb, var(...) 50%, transparent)` is a clean way to create semi-transparent borders from opaque color tokens in Electron/Chromium without needing extra tokens for every opacity variant.

### 2026-02-27 — CSP Inline Style Violation Fixes
- **Problem**: CSP `style-src 'self'` in `index.html` blocks all inline styles. the user reported hundreds of console CSP errors from `style=` attributes in HTML and `.style.property` / `.style.cssText` assignments in JS.
- **9 inline `style=` attributes removed from `index.html`**, replaced with CSS classes: `.topbar-controls`, `.d-none`, `.panel--full`, `.add-task-field--end`, `.add-task-label--inline`, `.signal-filter--flush`, plus `#customTaskWeeklyPanel` flex rule.
- **2 `.style.cssText` assignments eliminated**: `popout.js` container → `.popout-container` class; `kpi.js` measurer → `.kpi-measurer` class.
- **~40 `.style.property` assignments converted**:
  - Display toggles (`style.display = 'none'`/`''`) → `classList.toggle('d-none', condition)` or `classList.add/remove('d-none')` across `state.js`, `popout.js`, `events.js`, `app.js`, `tracking.js`, `kpi.js`.
  - Chevron rotations (`style.transform`) → `classList.toggle('chevron--expanded', bool)` in `events.js`, `tracking.js`.
  - Grid layout (`style.gridTemplateColumns`) → `classList.toggle('list--minimal', bool)` in `tracking.js`, `radar.js`; `classList.add/remove('viz-legend--briefing')` in `kpi.js`.
  - Dynamic KPI values (width, opacity, background gradients) → `style.setProperty('--bar-width'/'--bar-opacity'/'--donut-bg'/'--sel-width', value)` with CSS `var()` in `.stack-segment`, `.severity-donut`, `.severity-select`.
  - Textarea auto-resize → `style.setProperty('--auto-height', value)` with CSS `.tracking-textarea[style*="--auto-height"] { height: var(--auto-height); }`.
- **CSS classes added** to `styles/components.css` (16 new rules) and `styles/tracking.css` (1 new rule).
- **Pattern**: `style.setProperty('--custom-prop', dynamicValue)` is CSP-safe for truly dynamic values (widths, gradients). Use `classList.toggle` for boolean state. Use `.d-none { display: none !important; }` utility class for visibility toggling.
- **All 292 tests pass** (259 unit + 33 state tests).

### 2026-02-27 — Day Briefing Feature (P0-3)
- **Goal**: Implement "My Day" briefing that synthesizes meetings, tracked items, and radar KPIs into a single morning summary (P0-3 from Iceman's feature roadmap).
- **Prompt template**: Created `src/prompts/day-briefing.md` with strict JSON output constraints, field definitions (headline, topPriorities, meetingsRequiringPrep, atRiskItems, suggestedTimeBlocks, todayFollowUps, sources), and URL-safety rules.
- **Constants**: Added `DAY_BRIEFING_KEY = '__day_briefing__'` and `DAY_BRIEFING_JSON_SCHEMA` to `renderer/constants.js`.
- **Prompt builder**: `buildDayBriefingPrompt()` in `renderer/prompts.js` composes the full prompt from cached template + today's date + meetings list + tracked items with severity/status/due + KPI counts. Handles empty states gracefully.
- **Model logic** in `renderer/models/briefing.js`:
  - `applyDayBriefingPayload()` — normalizes all fields via `sanitizeBriefingText`, coerces missing arrays to `[]`, filters sources to valid URLs, defaults headline to "Your day at a glance", persists via `savePersistentState()`.
  - `getDayBriefing()` — retrieves from `briefingsByMeetingId[DAY_BRIEFING_KEY]` or returns null.
  - `generateDayBriefing()` — async flow with button loading, status messages, history logging, WorkIQ JSON call, error handling.
- **Reconciliation**: `reconcileMeetingScopedState()` now preserves `DAY_BRIEFING_KEY` unconditionally during meeting reconciliation.
- **Pruning**: `pruneStaleBriefings()` prunes day briefings if `generatedAt` is from a previous day (before today midnight), unlike meeting briefings which use `startAt`.
- **Renderer**: `renderDayBriefingCard()` in `renderers/briefing.js` — empty state with CTA button, populated state with headline, priorities, prep meetings, at-risk items (severity pills), time blocks, follow-ups, and sources.
- **Event wiring**: `events.js` delegates `[data-generate-day-briefing]` clicks to `generateDayBriefing()`.
- **Pattern**: Day briefing uses a synthetic key (`__day_briefing__`) in `briefingsByMeetingId` instead of a real meeting ID. This pattern is reusable for other non-meeting briefing types (project briefing, person briefing).
- **Key files**: `src/prompts/day-briefing.md`, `src/renderer/constants.js`, `src/renderer/prompts.js`, `src/renderer/models/briefing.js`, `src/renderer/renderers/briefing.js`, `src/renderer/events.js`, `src/renderer/state.js`.

### 2026-02-27 — Timestamp Decoupling Fix (Updated Bar vs Change History)
- **Problem**: the user reported "change history time seems to be pulling from the current status." The "Updated" bar timestamp and the latest Change History entry timestamp were literally the same value — both read `updateHistory[0].timestamp`. Additionally, `item.lastRunAt` is set in the same `monitorTaskItem()` call milliseconds before the history entry, so all three displayed the same second.
- **Root cause**: The "Updated" bar (and related "NEW UPDATE" badge / relative-time pill) read `updateHistory[0].timestamp` instead of an independent timestamp. Since the latest history entry IS `updateHistory[0]`, they were coupled by definition.
- **Fix**: Changed 5 locations to read `item.lastRunAt` instead of `updateHistory[0].timestamp`:
  1. **Row view — last-updated pill** (~line 437 in `renderers/tracking.js`)
  2. **Row view — "Updated:" bar** (~line 451 in `renderers/tracking.js`)
  3. **Card view — "NEW UPDATE" badge** (~line 546 in `renderers/tracking.js`) — had two references on same line (hasNew branch + else branch)
  4. **Card view — "Updated:" bar** (~line 558 in `renderers/tracking.js`)
  5. **Popout view — last-updated pill / badge** (~line 46 in `popout.js`)
- **Change History entries left as-is** — they correctly show `entry.timestamp` from when each change was detected.
- **Pattern**: `item.lastRunAt` represents "when the monitor last checked this item" — an independent timestamp from `nowIso()` set at the top of `monitorTaskItem()`. Using it for the UI status display decouples the display layer from the history data.
- **Key files**: `src/renderer/renderers/tracking.js`, `src/renderer/popout.js`, `src/renderer/monitor-engine.js` (reference only, unchanged).
- **All 322 tests pass** after the change.

### 2026-03-03 — Frontend Maintainability & Redundancy Audit Kickoff
- Completed a deep frontend maintainability review across `src/renderer/**`, `src/index.html`, and `src/styles/**`.
- Highest-risk themes identified:
  1. Large duplicated tracking/popout rendering and event logic (multiple near-identical markup/handler paths).

### 2026-03-03 — Inline Editing for Tracked Items
- **Goal**: Add inline editing for three tracked item fields: title, due date (date picker), and owner (free text).
- **Design pattern**: Click-to-edit with visual affordances (hover states, edit pencil icon for title, dashed underline for editable fields).
- **Model changes** (`renderer/models/tracking.js`):
  - Added `updateTrackingItemField(itemId, field, value)` — updates a single field on a tracking item and persists to localStorage. Returns `{ item, oldValue, newValue }` for potential undo/logging.
- **Template changes** (`renderer/renderers/tracking.js`):
  - **Card view**: Title wrapped in `.item-title-wrap` with `.editable-field` span and `.edit-field-btn` (pencil icon visible on hover). Due date and owner in `.tracker-meta` wrapped in `.editable-field` spans with placeholder text for unset values.
  - **Row view**: Title, due date, and owner all wrapped in `.editable-field` spans. Compact placeholders ("Set due") in row header for consistency.
- **Event handlers** (`renderer/events.js`):
  - Added `activateInlineEdit(span, field, itemId)` — replaces span content with appropriate input (`<input type="text">` for title/owner, `<input type="date">` for dueAt).
  - Save triggers: blur, Enter key, date picker change.
  - Cancel trigger: Escape key (reverts by re-rendering).
  - Date fields convert to/from ISO strings transparently.
  - Event delegation on `elements.trackingList` for clicks on `.editable-field` or `.edit-field-btn`.
- **CSS styles** (`styles/tracking.css`):
  - `.editable-field` — dashed underline on hover, cursor pointer.
  - `.edit-field-btn` — pencil icon opacity 0 by default, opacity 1 on parent hover.
  - `.inline-edit` — clean input styling with focus ring matching existing design system.
  - `.field-placeholder` — muted italic text for unset fields.
- **New fields**: `dueAt` and `owner` are now editable. These fields may be null on existing items. Placeholders guide users to set them inline.
- **Pattern**: Inline editing keeps users in context, avoiding modal dialogs. Re-rendering after save ensures all views (card, row, popout) stay in sync with the updated state.
- **Key files**: `renderer/models/tracking.js`, `renderer/renderers/tracking.js`, `renderer/events.js`, `styles/tracking.css`.
- **All 430 tests pass** after implementation.
  2. Architecture drift where `models/*` modules perform UI side-effects despite architecture doc describing them as data-only.
  3. Stale abstractions and dead code (unused ledger renderer path, hidden command input/intent parser path, unused helper functions).
  4. Script-tag global coupling and ordering dependence across renderer modules.
- Noted concrete bug while auditing: `refreshBriefingData()` leaves `state.loading = true` in `finally`, which can keep loading state sticky.
- Output prepared as a 2-week phased remediation plan with small, safe PR slices and preventative standards.

### 2026-03-03 — Cross-Agent Kickoff Alignment (DEC-020)
- Frontend audit findings were consolidated into DEC-020 maintainability program kickoff.
- Assigned execution owner for Ticket 3 (tracking/popout shared renderer primitive) under the common review gate.
- Downstream implementation slices must preserve current UX/DOM behavior while reducing duplication.

### 2026-03-03 — Ticket 3 Slice 1: Shared Tracking/Popout History Markup Primitive
- Extracted `buildTrackerHistoryMarkup(item, emptyText?)` in `src/renderer/renderers/tracking.js` to remove duplicated history-entry rendering logic.
- Rewired both tracking render paths (card + minimal row detail) and popout rendering to use the same primitive, preserving existing empty-state copy per view (`"No history yet."` vs detailed message).
- Kept scope tight: no main/backend changes, no UX changes, no event-contract changes.
- Added minimal unit coverage in `test/renderer-tracking-renderers.test.js` for default/custom empty states and populated history rendering (unseen class, links, suggestions).
- Validation: `npm test` passes with 302/302.

### 2026-03-05 — Inline Citation Link Extraction Analysis
- **Research task**: Analyzed frontend impact of extracting evidence links from inline markdown citations in summary/reason fields.
- **Root finding**: `cleanDisplayText()` in `utils.js` (L308-327) strips `[label](url)` patterns at ingestion time (model layer), long before any renderer sees the data. The destruction happens in `applyRadarPayload()`, `normalizeTrackingItem()`, `monitorTaskItem()`, and ledger normalization.
- **Recommended approach**: Extract-then-clean — a new `extractInlineCitationLinks(text)` utility runs on raw text BEFORE `cleanDisplayText()`, merges results into the existing `evidenceLinks` array, then cleaning proceeds normally. This means no renderer changes at all — all renderers already consume `item.evidenceLinks` via structured list UI.
- **Scope**: ~55 lines across 4 files (`utils.js`, `models/radar.js`, `models/tracking.js`, `monitor-engine.js`). Zero renderer changes, zero popout changes, zero main/preload changes.
- **Key pattern**: `renderMarkdownLinks()` is already used for summary display in tracking/popout, but since `cleanDisplayText()` runs first, it never sees any markdown links. Post-extraction the stored summary remains clean text, so plain-text display paths (`escapeHtml` in radar cards/rows) are unaffected.
- **Output**: Decision document at `.squad/decisions/inbox/goose-link-extraction-frontend.md`.
### 2026-03-05 — Inline Citation Extraction Implementation
- **Goal**: Extract evidence links from inline markdown citations (`[label](url)`) in AI-generated `summary`/`reason` fields before `cleanDisplayText()` strips them, supplementing the structured `evidenceLinks` array.
- **New function**: `extractInlineCitations(text)` added to `src/renderer/utils.js` near `extractExternalUrls()`. Uses existing validators (`normalizeExternalUrl`, `isGenericUrl`, `isHallucinatedUrl`, `isDeepLink`, `inferSignalTypeFromUrl`) and returns `Array<{label, type, url}>`. Deduplicates by normalized URL.
- **Integration points** (extract-before-clean pattern applied in 3 locations):
  1. `applyRadarPayload()` in `models/radar.js` — inline links merged after structured evidenceLinks via `seenUrls` dedup.
  2. `normalizeTrackingItem()` in `models/tracking.js` — same pattern.
  3. `monitorTaskItem()` in `monitor-engine.js` — inline links appended to `curatedLinks` before assignment.
- **Prompt relaxation**: Changed prohibition in `constants.js` (radar scan prompt) and `prompts.js` (monitoring prompt) to permissive language — structured `evidenceLinks` remains preferred, inline markdown citations allowed as supplementary.
- **No renderer changes**: All renderers already consume `item.evidenceLinks` via structured list UI. `cleanDisplayText()` still strips links for display text.
- **All 323 tests pass** after the change.
- **Key files**: `src/renderer/utils.js`, `src/renderer/models/radar.js`, `src/renderer/models/tracking.js`, `src/renderer/monitor-engine.js`, `src/renderer/constants.js`, `src/renderer/prompts.js`.

### 2026-03-05 — Radar Item ID Cross-Scan Collision Fix
- **Problem**: AI-provided IDs like `radar-001` are reused across scans. Different items with the same AI ID collide — previously tracked items cause new inbound items to be filtered out in `getInboundRadarItems()`.
- **Fix**: Changed `resolveRadarItemId()` in `src/renderer/models/radar.js` to always use content-based hashing via `radarItemIdentitySeed()`. The AI-provided `id` field is now ignored entirely. Items with identical content get the same hash (dedup), but different items always get different hashes.
- **Test updated**: `test/renderer-models-radar.test.js` — replaced "returns raw id when present" assertion with "ignores AI-provided id and uses content hash" that verifies the AI id is not used and the output is a content-based `radar_` hash.
- **All 338 tests pass** after the change.
- **Key files**: `src/renderer/models/radar.js`, `test/renderer-models-radar.test.js`.

### 2026-03-05 — Bare URL Extraction & Truncated URL Filtering
- **Problem 1**: AI puts bare URLs in summary/reason text instead of markdown `[label](url)` format. `extractInlineCitations()` only matches markdown `[label](url)`, so bare URLs are invisible to evidence link extraction.
- **Problem 2**: AI returns truncated/stub URLs (e.g. `https://contoso.sharepoint.com/teams/`, `/mail/inbox/id/`) that pass `isDeepLink()` but point to nothing specific.
- **Fix (bare URLs)**: Added `extractBareUrlCitations(text)` in `src/renderer/utils.js`. Strips markdown links first (replace with whitespace), then matches bare `https?://` URLs. Each URL goes through the same validation pipeline: `normalizeExternalUrl`, `isGenericUrl`, `isHallucinatedUrl`, `isDeepLink`. Infers type via `inferSignalTypeFromUrl()`, generates label via `compactLinkLabel()`. Used as fallback at three integration sites (`applyRadarPayload`, `normalizeTrackingItem`, `monitorTaskItem`) — only fires when `extractInlineCitations()` finds nothing.
- **Fix (truncated URLs)**: Added 5 patterns to `GENERIC_URL_PATTERNS` array: SharePoint site/library roots (`/teams/`, `/sites/`, `/personal/` with no document path), OneDrive personal root (`-my.sharepoint.com/personal/`), Outlook mail with empty ID (`/mail/.../id/`), Teams container-level paths (`/l/message|meeting|chat/` with no ID), and AI truncation artifacts (trailing `...`). These are blocked by the existing `isGenericUrl()` check used in `isSignalTypeDeepLink()` and all extraction functions.
- **Pattern**: Bare URL extraction as fallback (not replacement) preserves priority for structured markdown citations which carry richer labels. The markdown-stripping approach (replace with equal-length whitespace) prevents double-matching URLs that appear in both `[label](url)` and bare form.
- **All 338 tests pass** after the change.
- **Key files**: `src/renderer/utils.js`, `src/renderer/models/radar.js`, `src/renderer/models/tracking.js`, `src/renderer/monitor-engine.js`.

### 2026-03-06 — Persistent Prompt Storage
- **Goal**: Make user-edited radar and briefing prompts survive app reloads via localStorage.
- **Implementation**: Added `PROMPT_STORAGE_PREFIX = 'flightdeck.prompt.'` constant. Added three helper functions in `prompts.js`: `saveCustomPrompt(name, content)`, `loadCustomPrompt(name)`, `clearCustomPrompt(name)` — all with try/catch safety matching `state.js` patterns.
- **Load flow**: `loadPromptFiles()` checks localStorage first for each prompt (`radarScan`, `briefing`, `dayBriefing`). If a custom value exists, it takes priority over the on-disk default. Disk is still always read for fallback/reset.
- **Apply flow**: "Apply" click handlers now call `saveCustomPrompt()` after updating `promptCache`.
- **Reset flow**: "Reset" click handlers call `clearCustomPrompt()` first, then reload from disk. Status message changed to "Reset to default".
- **UI**: Button labels in `index.html` changed from "Reset to File" → "Reset to Default".
- **Day-briefing**: Included in persistence layer even though it has no editor — ready for future use.
- **All 371 tests pass** after the change.
- **Key files**: `src/renderer/constants.js`, `src/renderer/prompts.js`, `src/index.html`.

### 2026-03-10 — Tracker Popout Visual Improvement Review
- **Goal**: Analyze the tracker popout window and produce actionable UI recommendations (no code changes).
- **Findings**: The popout renders a two-panel layout via `popout.js` with card/history split. The left panel packs title, summary, next-step hints, meta, timestamps, People/Links collapsibles, and the full Monitoring controls block into a single scroll column. The right panel is a dense history list. Overall the layout lacks breathing room, visual hierarchy, and design cohesion with the Apple-inspired system.
- **12 recommendations delivered** covering: increased spacing/padding, title/summary typography hierarchy, card-style next-step hints, styled meta row, grouped monitoring section with disclosure, signal filter redesign, history entry scanability, action bar relocation, People/Links styling, popout header bar, responsive panel ratio, and subtle section dividers.
- **Key files reviewed**: `src/renderer/popout.js`, `src/styles/tracking.css`, `src/styles/components.css`, `src/styles/tokens.css`, `src/renderer/renderers/tracking.js`, `src/renderer/renderers/history.js`, `src/renderer/renderers/actions.js`.
- **Pattern**: Popout-specific classes (`.popout-panel-left`, `.tracker-card--popout`, etc.) are already isolated in `tracking.css`, making scoped styling changes low-risk.

### 2026-03-10 — Tracker Popout Visual Improvements (12 Changes Implemented)
- **Goal**: Implement all 12 popout UI visual improvements from the review — CSS and JS changes scoped exclusively to popout code paths.
- **CSS-only changes (tracking.css)**:
  1. `.popout-panel-left` — increased padding (20px 24px), added flex column + gap 16px for breathing room.
  2. `.tracker-card--popout .tracker-title` / `.tracker-summary` — stronger typography (1.15rem/700 title, 0.88rem/1.65 line-height summary with scroll cap).
  3. `.tracker-card--popout .next-step-hint` — card-like styling with accent border-left, bg-inset background.
  4. `.tracker-card--popout .tracker-meta span` — chip bar with pill styling, border-top divider.
  5. `.tracker-card--popout .signal-checkbox/.signal-label/.signal-icon/.signal-filter-label` — redesigned signal filters (icon-only, lower opacity for inactive).
  6. `.popout-history-scroll .tracker-history-entry` subselectors — improved history scanability (pill timestamps, block display, bordered summaries/suggestions).
  7. `.tracker-card--popout .tracker-section-toggle` — section dividers via border-top.
  8. `.tracker-card--popout .tracker-head` — frosted sticky header with backdrop-filter blur.
  9. `.popout-panels` — adjusted column ratio from 1fr 1fr → 3fr 2fr.
- **JS+CSS changes (popout.js + tracking.css)**:
  10. Monitoring section collapsed by default — replaced inline `<div class="tracker-schedule-bar">` with a `tracker-section-toggle` + `tracker-section-panel` pattern using `data-monitoring-toggle-id` / `data-monitoring-panel-id`. Summary text shows schedule type + signal count. Added click handler in `initPopoutMode()`.
  11. Action bar moved to header — mark-seen and delete buttons placed inside `.tracker-head` via `.popout-head-actions` div. Bottom `<div class="action-row">` removed.
  12. People rendered as chips — replaced comma-separated `<p class="people-text">` with `<div class="people-chips">` containing `<span class="people-chip">` per counterparty. Added `.people-chips`/`.people-chip` CSS plus styled People/Links panels.
- **Scoping**: All 12 changes scoped to `.tracker-card--popout`, `.popout-*`, or popout rendering functions. Main window tracker cards unaffected. Shared function `buildTrackerHistoryMarkup` not modified.
- **All 429 tests pass** after the changes.
- **Key files**: `src/styles/tracking.css`, `src/renderer/popout.js`.### 2026-03-12 — Lifecycle Model & Bulk Selection Revert (Phase 3 Removal)
- **Goal**: Remove Phase 3 lifecycle state machine (inbox/active/archived tabs) and bulk selection features from the tracking view, while preserving Phase 1 (origin indicators) and Phase 2 (visual polish) work.
- **Context**: the user requested reverting the lifecycle model added in Phase 3 to simplify the tracking UI. The branch is `feature/ui-ux-three-phase`.
- **Changes made**:
  1. **constants.js**: Removed `LIFECYCLE_STATES` and `LIFECYCLE_STATE_LABELS` enums. Kept `ORIGIN_LABELS`.
  2. **state.js**: Removed `trackingFilter` and `trackingBulkSelection` fields from state, persistence payload, and load logic.
  3. **models/tracking.js**: Removed `normalizeLifecycleState()`, `transitionLifecycleState()`, `bulkTransitionLifecycle()`, `markItemsSeen()`, `archiveCompletedItems()` functions. Removed lifecycle assignment line in `normalizeTrackingItem()`.
  4. **renderers/tracking.js**: Removed `filterItemsByLifecycle()` and `syncTrackingBulkSelection()` functions. Removed filter tab rendering, bulk checkbox inputs (`data-bulk-select-id`), `is-selected-bulk` CSS classes, and `updateBulkActionsBar()` calls. Simplified `renderTrackingMode()` to directly sort/render all items without filtering.
  5. **events.js**: Removed filter tab click handlers, bulk action button handlers (mark seen, archive, clear), `change` handler for bulk checkboxes, and `updateBulkActionsBar()` function. Simplified `handleMarkSeenClick()` to just mark items as seen without lifecycle transitions.
  6. **monitor-engine.js**: Removed `transitionLifecycleState(item, LIFECYCLE_STATES.INBOX)` call when substantive changes detected — now just sets `item.hasNewUpdate = true`.
  7. **index.html**: Removed filter tabs HTML and bulk actions bar HTML from tracking view header.
  8. **tracking.css**: Removed `.bulk-select-toggle`, `.is-selected-bulk`, `.filter-tabs`, `.filter-tab`, `.bulk-actions-bar`, and `.bulk-count` styles. Kept origin pill styles (`.origin-pill`, `.origin-pill--custom`, `.origin-pill--imported`).
  9. **test/renderer-models-tracking.test.js**: Removed tests for `normalizeLifecycleState()`, `transitionLifecycleState()`, `markItemsSeen()`, and `normalizeTrackingItem() with lifecycle`. Removed the `monitorTaskItem lifecycle inbox` test.
- **All 369 tests pass** after the changes.
- **Key files**: `src/renderer/constants.js`, `src/renderer/state.js`, `src/renderer/models/tracking.js`, `src/renderer/renderers/tracking.js`, `src/renderer/events.js`, `src/renderer/monitor-engine.js`, `src/index.html`, `src/styles/tracking.css`, `test/renderer-models-tracking.test.js`.
- **Pattern**: Phase 1 origin indicators (custom vs imported) remain intact. Phase 2 visual improvements (has-new-update badge, typography) preserved. Only Phase 3 lifecycle state machine and bulk selection removed.

## Learnings

### 2026-03-12 — Remove Origin Tags from Tracking Cards
- **Goal**: Remove "Custom"/"Imported" origin tags from tracking cards as requested by the user — they take up space and aren't useful.
- **Changes made**:
  1. **tracking.js**: Removed origin badge rendering logic (lines computing origin variable and originBadge template literal) from 
enderTrackingMode() card template. Removed ${originBadge} from .tracker-head-right div.
  2. **constants.js**: Removed ORIGIN_LABELS constant definition (including custom/imported labels and icons).
  3. **tracking.css**: Removed all origin-pill CSS rules (.origin-pill, .origin-pill--custom, .origin-pill--imported).
- **Verification**: Row rendering did not include origin pills (checked via grep). Only card rendering was affected.

### 2026-03-19 — Cross-Agent: Sparkline Feature Queued as P0

**Context:** Iceman and Maverick assessed three feature proposals. Sparkline/timeline for trackers is the top priority (P0) — both agents agree it ships first. Data already exists in `updateHistory[]` (timestamps + severity). Maverick's suggested approach: new `buildSparklineHtml(item)` in `renderers/tracking.js`, pure inline SVG, X-axis timestamps, Y-axis severity mapped to height, color-coded using existing `--color-critical/elevated/observe` tokens. Show when `updateHistory.length >= 3`. Place in tracking card header next to severity badge. See DEC-051 and DEC-052 for full details.
- **All 371 tests pass** after the changes.
- **Key files**: src/renderer/renderers/tracking.js, src/renderer/constants.js, src/styles/tracking.css.
- **Pattern**: Clean removal of unused visual indicator — CSS, JS rendering logic, and constant definition all removed as they served no other purpose. The origin field remains on tracking items in storage but is no longer displayed.

### 2026-03-12 — OneDrive Context File Sync (feature/onedrive-context-file)
- **Goal**: Wire up a new `context-file.js` module that generates and syncs a markdown FlightDeck context file to OneDrive via two new IPC methods (`writeContextFile`, `getContextFilePath`) added by Viper.
- **New file**: `src/renderer/models/context-file.js` — module-level `_contextFilePath` cache, exports `initContextFilePath()` (async, IPC init), `getContextFilePath()` (sync accessor), and `syncContextFile()` (async, builds markdown from `state.trackingItems` + `state.radarItems`, calls IPC, caches returned path). All wrapped in try/catch with `console.warn`, never throws.
- **radar.js change**: Replaced `state.radarItems = mappedRadarItems` with a merge strategy — existing items with IDs not in the new scan persist (no wipe), new IDs from the scan are appended. `syncContextFile()` fires after the merge (fire-and-forget).
- **tracking.js changes**: Added `syncContextFile()` fire-and-forget calls at the end of `upsertTrackingItemFromRadar`, `removeTrackingItem` (only when state changed), `dismissRadarItem`, and `updateTrackingItemField`.
- **prompts.js change**: Refactored `buildRadarScanPrompt()` to compose a context file block appended after the exclusion block when `getContextFilePath()` is non-null.
- **index.html**: Added `<script src="renderer/models/context-file.js"></script>` immediately after `state.js` and before `prompts.js` so `getContextFilePath` and `syncContextFile` globals are available to all subsequent scripts.
- **Test fixes**: Added `syncContextFile: () => {}` stub to 5 test contexts (radar, tracking, popout, state, monitor). Added `getContextFilePath: () => null` stub to prompts test. Added `beforeEach(() => { ctx.state.radarItems = []; })` to the two `applyRadarPayload()` describe blocks in the radar test since the merge logic now accumulates items across test calls. Added `beforeEach` import where missing.
- **All 430 tests pass** after changes.
- **Key files**: `src/renderer/models/context-file.js` (new), `src/renderer/models/radar.js`, `src/renderer/models/tracking.js`, `src/renderer/prompts.js`, `src/index.html`, `test/renderer-models-radar.test.js`, `test/renderer-models-tracking.test.js`, `test/renderer-state.test.js`, `test/renderer-popout.test.js`, `test/renderer-prompts.test.js`.
- **Pattern**: When changing accumulation vs. replacement behavior in model functions, tests that rely on index-based access (`state.radarItems[0]`) will break unless you reset shared state before each test. Use `beforeEach` resets in describe blocks that test stateful functions.

### 2026-03-12 — Dismissed Radar Item Reappearance Fix
- **Problem**: The TDD red left by Merlin — `applyRadarPayload() merge behavior > dismissed items (removed from state before scan) do NOT reappear` — was failing because the merge logic only deduped against `state.radarItems` (current live items). Dismissed items (removed from `radarItems` by `dismissRadarItem()`) would be re-added by the next scan because the merge treated them as brand-new.
- **Fix**: Added a `state.seenRadarIds` Set in `applyRadarPayload()`. On every call, (1) lazily initialise the Set, (2) seed it with all currently-live item IDs (handles pre-existing persistent state), (3) filter `newItems` against both `existingIds` AND `seenRadarIds`, (4) add newly-appended items to `seenRadarIds`. Dismissed items remain in `seenRadarIds` after they are removed from `radarItems`, so the next scan skips them.
- **Why not `dismissedRadarIds` + `dismissRadarItem` change**: The failing test simulates dismissal by directly mutating `ctx.state.radarItems`, not by calling `dismissRadarItem()`. A separate `dismissedRadarIds` populated only by `dismissRadarItem()` would not be visible to `applyRadarPayload` in that path. The `seenRadarIds` "ever-seen" approach works regardless of how the item was removed from `radarItems`.
- **All 451 tests pass** after the single-file change.
- **Key file**: `src/renderer/models/radar.js` (merge logic in `applyRadarPayload`).
- **Pattern**: When "dedup on current state" is insufficient (items can be removed), maintain an ever-growing "seen" set that survives removals. Seed it from current state on first use to cover items loaded from persistence before the set existed.

### 2026-03-19 — Radar JSON Parse Retry & Graceful Error Handling
- **Problem**: When WorkIQ returns malformed JSON for a radar scan, users see a scary red error box with a raw "bad payload error" or "Response JSON could not be parsed" message. No retry is attempted.
- **Fix**: Added configurable retry logic to `runWorkiqJson()` in `src/renderer/json-parser.js`:
  - New optional 4th parameter: `{ maxRetries, retryDelayMs, onRetry }`. Default: 1 retry, 2s delay.
  - On JSON parse failure, logs a `console.warn` with failure count and attempt number, then retries the full WorkIQ call.
  - EULA detection and WorkIQ-level failures (`!result.success`) still throw immediately without retrying.
  - A `_parseFailureCounts` object tracks cumulative parse failures per label for debugging diagnostics.
  - Final throw after all retries exhausted uses a user-friendly message: "Scan returned an unexpected response. Will try again on next refresh."
- **Caller changes** in `src/renderer/app.js`:
  - Both `refreshAllData()` and `refreshRadarData()` radar calls now pass `{ maxRetries: 1, onRetry }` to `runWorkiqJson`.
  - `onRetry` callback updates the status bar to "Retrying radar scan (1/1)…" so the user sees a subtle indication.
  - Error catch blocks changed: `class="error"` → `class="empty"` (no red box), status changed from "Refresh failed" → "Scan incomplete", history entries use "issue" instead of "failed".
- **All 430 tests pass** unchanged — retry logic is additive and the existing tests use the default (1 retry) path or mock at a higher level.
- **Key files**: `src/renderer/json-parser.js`, `src/renderer/app.js`.
- **Pattern**: Retry at the centralized `runWorkiqJson` chokepoint covers all 10+ call sites. The `onRetry` callback lets each caller decide how to show retry progress without coupling the parser to UI concerns.

### 2026-03-19 — Sparkline POC for Tracking Cards
- **Goal**: Add inline SVG sparkline/timeline visualization to tracking cards showing severity trend over update history.
- **New function**: `buildSparklineSvg(updateHistory)` in `renderers/tracking.js` — generates a compact SVG (120×24px) with dots connected by lines. X-axis = evenly spaced history entries (oldest→newest left→right), Y-axis = severity height (Critical=top, Elevated=mid, Observe=bottom). 3-entry minimum threshold.
- **Color mapping**: Uses existing CSS tokens — `--color-critical`, `--color-elevated`, `--color-observe`. Lines colored by target point's severity at 0.4 opacity; dots at full opacity.
- **Integration**: Rendered in both card view (`tracker-head-left`, after severity select) and minimal/row view (after severity select, before pills). Naturally fits the 20-entry history cap (DEC-010).
- **CSS**: `.sparkline-svg` styles in `tracking.css` — inline-block, flex-shrink:0, subtle hover opacity transition. Row view has reduced dimensions (80×20px).
- **Key files**: `src/renderer/renderers/tracking.js`, `src/styles/tracking.css`.
- **All 438 tests pass** — additive change only.

### 2026-03-19 — Sparkline → Timeline V2 (Popout Only)
- **Problem**: Kyle tested the sparkline POC on tracking cards and didn't like how it looked — too small, too stock-charty, not enough context.
- **Two requested changes**: (1) Move visualization to the popout view (more space), (2) Make it look like a timeline with time markers and severity-colored event nodes, not a sparkline.
- **Removed from cards**: Deleted `buildSparklineSvg()` calls from both card view (`tracker-head-left`) and row view in `renderers/tracking.js`. Removed `.sparkline-svg` CSS block.
- **Kept utility logic**: Severity-to-color mapping reused via extracted `severityColor()` and `severityLabel()` helpers.
- **New `buildTimelineHtml(updateHistory)`** in `renderers/tracking.js`:
  - Horizontal timeline with severity-colored dot nodes connected by colored lines
  - Time labels below each node (relative: "2h ago", "yesterday", or short date for older)
  - Severity labels under time labels
  - Hover tooltip per node: full timestamp, severity, change description, truncated summary
  - Collapsible section toggle ("Severity Timeline (N events)")
  - 2-entry minimum threshold (vs 3 for old sparkline)
  - Edge-aware tooltips (first/last child repositioned to stay on-screen)
- **Popout integration** in `popout.js`:
  - Timeline section placed between tracker-timestamp and People section
  - Toggle click handler added for `[data-timeline-toggle-id]` delegation
  - Starts expanded by default
- **CSS** in `tracking.css`:
  - Full `.tl-*` class system: `.tl-track` (flex container), `.tl-node`, `.tl-connector`, `.tl-dot`, `.tl-line-before/after`, `.tl-time`, `.tl-label`, `.tl-tooltip`
  - Dot glows via `color-mix()` with severity color, scales 1.4× on hover
  - Tooltip uses `--bg-surface`, blur backdrop, shadow — matches existing popout panel style
  - All colors via CSS tokens — works in both dark and light themes
- **Key files**: `src/renderer/renderers/tracking.js`, `src/renderer/popout.js`, `src/styles/tracking.css`
- **All 438 tests pass** after changes.

### 2026-03-19 — Activity Timeline V3 + Resizable Popout Panels
- **Problem**: Kyle said the horizontal timeline "isn't even really visible and kinda looks dumb." Wanted something "more interactive and modern" that would "make Apple's UI developers jealous." Also wanted resizable panels in the popout view.
- **Deliverable 1: Resizable Popout Panels**
  - Added drag handle between `.popout-panel-left` and `.popout-panel-right` — injected as DOM element in `applyPopoutPanelRatio()`, called after every `renderPopoutMode()` re-render.
  - Mousedown/move/up handlers in `initResize()` with `requestAnimationFrame` for smooth dragging. Minimum 250px per panel.
  - Panel ratio persisted to `localStorage` key `flightdeck_popout_panel_ratio` and restored on render.
  - CSS grid changed from `3fr 2fr` → `3fr 6px 2fr` (3 columns) to accommodate the handle element.
  - Handle styling: subtle borders, grip dots appear on hover, `col-resize` cursor.
- **Deliverable 2: Vertical Activity Timeline (Apple-quality)**
  - Removed entire `buildTimelineHtml` function and all `.tl-*` CSS (horizontal tooltip-based timeline).
  - New `buildActivityTimelineHtml(updateHistory)` — vertical layout, newest at top, oldest at bottom.
  - Each event: severity-colored node (14px dot with glow ring), connecting spine segments, event cards with relative time, severity pill, change summary, link chips.
  - Newest node has pulsing ring animation (`at-pulse` keyframes, 2s infinite).
  - Severity transitions between events show gradient spine segments and ▲/▼ direction badges.
  - Hover: node scales 1.3× with spring cubic-bezier, card gets severity-colored highlight border.
  - Click: smooth-scrolls right panel to matching history entry with pulse highlight animation.
  - Card entrance: staggered fade-up via `animation-delay` (30ms per card).
  - Spine draws itself on first render via `at-spine-draw` keyframe.
  - Max-height 420px with scrolling for long histories.
  - Light theme: solid shadows instead of glows (both explicit and `prefers-color-scheme` variants).
  - All colors via CSS custom property `--at-color` set per-node via inline style.
- **Key files**: `src/renderer/renderers/tracking.js`, `src/renderer/popout.js`, `src/styles/tracking.css`
- **All 438 tests pass** after changes.
