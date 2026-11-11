# FlightDeck User Guide

FlightDeck is a personal work-intelligence dashboard that connects to Microsoft 365 via the local WorkIQ CLI. It scans your email, Teams chats, meetings, and documents, then surfaces the items that need your attention — ranked by urgency.

---

## Table of Contents

- [First Launch](#first-launch)
- [Dashboard Overview](#dashboard-overview)
- [Today View](#today-view)
- [Navigation](#navigation)
- [KPI Summary Bar](#kpi-summary-bar)
- [Radar View](#radar-view)
  - [Scanners](#scanners)
  - [Adding a Scanner](#adding-a-scanner)
  - [Scanner Settings](#scanner-settings)
  - [Scanner Examples](#scanner-examples)
  - [Prompt Writing Tips](#prompt-writing-tips)
  - [Tracked Items & Monitoring](#tracked-items--monitoring)
  - [Change History](#change-history)
  - [Lifecycle Statuses](#lifecycle-statuses)
- [Briefings View](#briefings-view)
- [History View](#history-view)
- [Search](#search)
- [Version Notifications](#version-notifications)
- [Theme](#theme)
- [System Tray](#system-tray)
- [Demo Mode](#demo-mode)
- [Keyboard Shortcuts](#keyboard-shortcuts)

---

## First Launch

When you open FlightDeck for the first time, here's what happens:

> **Local WorkIQ setup:** Windows includes the WorkIQ CLI; macOS/Linux require `npm i -g @microsoft/workiq@1.0.1`. FlightDeck uses its buffered CLI commands, not its MCP server. WorkIQ manages Microsoft sign-in and credentials; FlightDeck does not maintain a separate authorization.

1. **You land on the Radar tab** — This is the default view every time you open the app.
2. **The Connect banner appears** — At the top of the main area, you'll see a banner with an **Enable WorkIQ** button. WorkIQ requires a Microsoft account, Copilot license, and tenant admin consent.
3. **Click "Enable WorkIQ"** — This is the key step! FlightDeck will:
   - **Accept the local WorkIQ EULA**
   - Enable remote controls and use local **WorkIQ CLI commands** for requests
   - Let WorkIQ handle Microsoft sign-in if required
   - If sign-in or the connection check fails, retain your cached data and show **Retry WorkIQ**
4. **Automatic first refresh** — Once connected, FlightDeck immediately runs a full refresh in parallel:
   - **Radar scan** — The AI scans your M365 signals (email, Teams, meetings, documents) and populates the Radar with prioritized items.
   - **Meetings refresh** — FlightDeck pulls your upcoming meetings for today and populates the Briefings view.
5. **Briefings are ready** — Switch to the Briefings tab and you'll see your meetings listed. Expand any meeting to generate a briefing, or click **Regenerate My Day** for your daily overview.
6. **Start tracking** — As you review Radar items, click **Track Item** on anything that needs ongoing monitoring. FlightDeck will watch it on a schedule and notify you of changes.

On subsequent launches, if you were previously connected, FlightDeck repeats local WorkIQ setup and runs a refresh. WorkIQ reuses and renews its own credentials. If WorkIQ requires sign-in or cannot connect, use **Retry WorkIQ** and complete WorkIQ's prompts; FlightDeck does not run its own OAuth flow.

> **Tip:** FlightDeck remembers connection intent, tracked items, and monitoring schedules locally. Cached data is available while WorkIQ validates; local edits remain usable, but remote controls stay disabled until ready. If validation fails, use **Retry WorkIQ** without discarding cached data.

Normal background saves do not show a banner or shift the layout.
Local save failures/conflicts appear in a state banner in the main window and popouts.
Controlled Ctrl+R/F5, View → Reload, popout close and Quit wait for an acknowledged save.
Failure cancels that operation rather than silently discarding edits. Retry saving;
for a conflict, **Export local edits** before explicitly choosing **Discard edits and
refresh**. Exports contain private local content. OS/process termination cannot save
edits that have not yet reached disk. See [state recovery limitations](state-storage.md).

Local domain state now resides in a profile-specific SQLite database. On first
use, FlightDeck validates and backs up legacy JSON before importing it. Import or
integrity refusals show a recovery banner instead of an empty replacement profile.
After repairing the underlying problem, use **Retry reading profile**; keep the
original files and backups until recovery succeeds.

History → **Review source collisions** inspects exact retained source identities
across threads, scanners and archive tiers. It does not merge or delete threads.
Some cross-scanner duplicates are intentional when that scanner's dedup setting is off.
Reports page at most 100 collision groups and show scanner/tier evidence; very
large owner groups explicitly indicate truncation.

> **Reconnecting:** Use **Retry WorkIQ** to repeat local WorkIQ setup. Complete WorkIQ's Microsoft sign-in or consent if prompted. Cached FlightDeck data remains available.

---

## Dashboard Overview

When you launch FlightDeck, you'll see the main dashboard with **Today**, **Radar**, **Briefings**, and **History** views. The active view is highlighted in the top navigation bar.

![FlightDeck Radar View — the main dashboard showing inbound signals prioritized by severity](screenshots/01-radar-view-dark.png)

The dashboard is organized into three horizontal zones:

1. **Top bar** — App branding (with version badge), global search, tab navigation, theme toggle, and status pill
2. **KPI summary** — At-a-glance severity counts, severity distribution bar, and item totals
3. **Main content** — The active view's cards and details

## Today View

**Today** is a chart-led overview of existing tracked work: understand what is happening here, then open a thread in Radar to act.

- **The shape of your work** is a status donut with exact counts for **In progress**, **Blocked**, **Waiting**, and **Unclassified**. Click a segment or its label to explore the underlying threads. Segments also support Enter/Space; the labels provide standard keyboard-accessible buttons.
- **The deadline picture** compares **Overdue**, **Due today**, **Next 7 days**, **Later**, and **No valid deadline**. These buckets do not overlap: a deadline earlier today is overdue, not also due today. Date-only deadlines run through the end of that local calendar day; the next-seven-days bucket covers the seven calendar days after today. Missing or invalid dates are never invented.
- **What has been moving** shows seven local calendar days of recorded new signals, updates, status changes, and verified communication actions. Click a day's bar to see its related threads. This is a count of retained events, not a historical snapshot of workload or a productivity score; zero means no events in the available history.
- **Where work sits** shows active work grouped by saved scanner assignment, colored using the same status legend as the donut. It does not infer account/project names from thread titles. Unassigned or unavailable scanners are labeled explicitly; a long tail is grouped into **Other scanners**.
- **Worth your attention** shows at most three distinct threads, with remaining due-today deadlines first, followed by critical/blocked work and follow-ups. Older deadlines are flagged for verification rather than automatically outranking everything newer. **Open thread** takes you to the existing Radar work plan and its Email/Teams editors.
- **Today's schedule** uses the saved calendar data, with upcoming/ongoing meetings before earlier meetings. Selecting a meeting opens, expands, and focuses that specific meeting in Briefings. Use Briefings to refresh the calendar.
- **Progress recorded today** shows timestamped thread completions and verified communication activity. **Teams message sent** and **Outlook draft created** are distinct outcomes; creating a draft does not mean an email was sent. Failed or unconfirmed attempts are excluded. Reopened threads do not count as currently completed.
- **Review drafts** opens existing pending proposals in Actions; it does not manufacture another generic draft. Closing Actions returns focus to that button.

Selecting a chart opens a single matching-thread list rather than duplicating threads across multiple task queues. **Clear selection** returns focus to the chart control. Status and deadline charts describe different dimensions of the same active work; do not add their totals together.

Chart results (including **In progress**) and **Worth your attention** use the same compact thread cards. The default view shows badges, a title and next move of up to two lines each, owner, and a short deadline. **Show details** reveals the full title/next move, available summary, full deadline, scanner, and last recorded activity; **Hide details** collapses that card again. Expanding one card does not expand adjacent cards. Completed/archived threads do not suggest another next move. Use the title or **Open thread** to open the existing Radar work plan. Em dashes are removed from Today's displayed titles, without modifying saved source titles or navigation targets.

Counts describe all FlightDeck retained local records, including archive pages not currently loaded, not all activity in Microsoft 365. Snoozed, completed, archived, and deleted threads are excluded from active-work charts; retained activity can still include completed threads. Older events outside retained history are not reconstructed. Chart selections load 100 rows per page. The view refreshes its clock every minute and when the window regains focus, including across midnight. Opening Today or selecting charts does not issue Microsoft 365 reads or writes.

### WorkIQ activity and waiting

The top-bar status shows actual shared WorkIQ activity, for example **4 running / 12 queued**, rather than counting resource spinners as active requests. During a throttling cooldown it also shows **retry in Ns**. When idle, it retains **Connected** or **Ready**. Queue status contains counts and timing only, not prompt or response text.

Scheduled scanners and monitors can each dispatch up to five jobs, but all windows and features share application limits: **5 active requests total**, **at most 4 background requests**, with starts paced **250 ms** apart. Manual **Run Now / Check Now** uses interactive priority; background work leaves a slot available for clicks. Pending work is bounded to 50 requests (40 background). If that queue is full, automatic work stays due for a later tick rather than being marked failed or skipped.

Safe reads have at most **two total attempts**, including network retries, completed empty-answer recovery and JSON-response recovery. Throttling may delay work; these limits are not a guarantee of remote quotas or a proven sustained safe rate. Authentication and EULA problems require reconnecting. Writes still require their existing confirmations, and ambiguous write results are not automatically replayed.

Scanner/monitor reads and proposal synthesis each have a **five-minute** caller timeout. A timed-out CLI command is terminated, but keeps its slot until process closure is confirmed; unrelated commands are not cancelled. A timeout does **not** automatically retry an unresolved request. If activity remains stuck, **choose Quit in the FlightDeck tray menu, then relaunch FlightDeck**. Closing to the tray and reopening does not restart the main process.

All remote operations use the **local WorkIQ CLI**, without opening a terminal window for each request. Scans, monitoring, briefings and proposal generation use `workiq ask --json --no-streaming`; directory lookups and confirmed writes use `fetch` and `create`. FlightDeck waits for command completion and validates the JSON envelope before parsing its answer. Numeric answer text without citations remains valid. If WorkIQ finishes grounding without an answer but returns a conversation ID, the allowed read retry continues that same conversation rather than starting over; unrelated requests never share that conversation. Empty or malformed CLI envelopes are reported explicitly, never treated as successful answers. Confirmed writes still require verified receipts and are never automatically replayed. Fully quit and relaunch FlightDeck after this transport change.

The former MCP path sometimes returned an unfinished streaming fragment before a complete final JSON response, or only an incomplete answer. Production now uses buffered CLI answers instead. Existing JSON extraction and schema validation remain in place; scanner, monitoring and briefing reads may retry within their two-attempt budget, but a missing valid response is reported as a failure rather than invented.

A failed task-monitor check no longer advances its successful-check timestamp.
The next attempt still searches from the last successful check, so a failed
interval is not silently treated as already reviewed. Existing failure history
is retained; these changes do not rewrite previously recorded check timestamps.

### Email and Teams drafts

In the Inbox thread's **Work plan**, select a **Recommended next move**, then choose **Email** or **Teams** to draft a message focused on that step. The first move is selected initially; your selection stays with the thread while navigating. If no moves are recommended, either channel can still draft a follow-up from the thread's context. Generation uses a read-only WorkIQ request and does not create or send a Microsoft 365 message until you review and explicitly approve the separate action.

The compact **More thread actions** (...) menu beside the thread title contains Snooze, Archive and Delete from FlightDeck. The larger criticality and work state pills beneath the title are dropdown controls: choose **Complete** from **Work state** to complete a thread. Both controls support keyboard navigation. Completed actions continue to appear in the thread's activity history.

You can start a draft on thread A, move to thread B, and start another. Each thread retains its own **Drafting…** state, result, or retryable error. Returning to a thread restores its state; switching to Today or another tab does not discard pending work. Background completion does not open a review pane over a different thread or tab.

Busy threads also show a small spinner and **Drafting email...**, **Drafting Teams message...**, **Creating Outlook draft...**, or **Sending Teams message...** label in the Inbox list, even when another thread is selected. The indicator clears when the action finishes or fails. With reduced motion enabled, the circle stays still.

Draft generation can take up to five minutes while WorkIQ retrieves context. Failures show a prominent error panel with a channel-specific **Retry draft** button and a failed-draft label on the Inbox row. A timeout does not cancel the remote request: wait for WorkIQ activity to finish before retrying rather than repeatedly starting more requests.

The **Email** and **Teams** buttons explicitly request an editable draft, not a recommendation about whether to communicate. Missing recipient details do not prevent composing grounded text: review the draft and enter the verified recipient before creating an Outlook draft or sending a Teams message. If there is not enough observed context to compose without inventing facts, FlightDeck explains what is missing.

Both buttons open an **inline editor on the source thread**, not a separate review pane. Review the recipient and message in place; Email also has a subject. **Create Outlook draft** asks for native confirmation, then saves to Outlook Drafts without sending. **Send message** asks for native confirmation, then sends to Teams. Generation and editing alone never dispatch either action.

WorkIQ entity operations have a separate one-minute timeout from the short connection probe. A successful process exit alone is not delivery confirmation: FlightDeck verifies the returned draft or Teams message entity, including WorkIQ's status-prefixed create receipts. Writes are never automatically replayed after an uncertain result. If an earlier version reported an unconfirmed draft, check Outlook Drafts before trying again; the draft may already exist.

On desktop, the Work plan and thread context stay grouped beside Activity; on narrow screens they stack below it. Expanding activity history does not spread these sections apart.

After a confirmed Teams send or confirmed Outlook draft creation, the inline editor closes. The associated recommended next move is marked **Completed** and becomes unavailable in both channels; other next moves remain available. This completion survives restarts and does not mark the entire thread complete. An Outlook draft counts as completion of that work-plan action, but is always described as **created**, never **sent**. Cancelled, failed, and unconfirmed operations leave the editor open and do not complete the move.

Click **Action · View message** on a confirmed communication in the thread's Activity timeline to open a read-only message-history panel showing the recipient, confirmation time, message text, and email subject where applicable. Viewing history never sends or recreates anything. Confirmed Teams messages are saved locally as resolved actions, like successful Outlook draft proposals. Older Teams actions may not have retained message text; deleted proposals also leave metadata-only history. In either case, FlightDeck explains that the text is unavailable instead of inventing or silently regenerating it.

Unfinished email edits remain saved across restarts. **Close** hides the inline email editor without discarding it; **Review email draft** reopens it without regenerating. **Open in Actions** provides the existing queue, lifecycle, and management controls for the same saved proposal. Inline creation and Actions share execution state, so one cannot duplicate the other's pending operation. Once a next move is completed, Actions also prevents dispatching another proposal for that same move. Cancelling native confirmation preserves the draft and allows edits; editing invalidates the previous review before another confirmation. An uncertain Outlook result stays blocked: check Outlook Drafts rather than blindly creating another copy.

Teams drafts show both **Recipient name** and **Recipient email**. FlightDeck requests verified addresses rather than guessing them from names. Review or enter the correct address before sending; when supplied, the email identifies the recipient, not the display name. Changing the name clears the previous email so it cannot silently target the old person. A name-only draft can still be resolved against an exact, unique existing one-on-one chat. If the lookup is ambiguous, incomplete, rate limited, or requires sign-in, FlightDeck reports the failure rather than guessing a destination or claiming the message was sent.

For missing addresses, directory resolution checks an exact name first, then a unique name with a parenthesized directory qualifier such as "(International Supplier)." Verified SMTP aliases are supported; guest `#EXT#` sign-in names are not substituted for external email addresses. Ambiguous or incomplete results remain unresolved.

After you confirm **Send message** with a verified address, FlightDeck opens or reuses the one-to-one chat for your verified user IDs, creating it if needed. It independently reads back the chat and checks both members before posting. This avoids scanning hundreds of chat pages to find an older conversation. Draft generation and cancellation never open or create chats. Errors and unconfirmed delivery notices appear in red; cancellation remains a neutral status.

If delivery cannot be confirmed, the draft is preserved and **Send message** is disabled. Check the actual Teams conversation first. Only if the message is absent, use **I checked Teams; allow retry**, then explicitly send and confirm again. Enabling retry does not send anything, and an unconfirmed outcome is never automatically replayed.

Teams drafts and generation/error state are retained for the current renderer session (including tab changes), not across a full quit or reload. Saved email proposals remain in Actions across restarts. Deleting a thread discards its in-memory composer state and prevents late generation results from recreating it.

---

## Navigation

![Topbar with search, tab navigation, connection status, and theme toggle](screenshots/09-topbar-dark.png)

The top-right corner of the dashboard contains three main tabs:

| Tab | Purpose |
|-----|---------||
| **Radar** | All items — inbound signals and monitored tasks — organized by scanner, with inline tracking controls |
| **Briefings** | AI-generated meeting prep and daily briefings |
| **History** | Audit trail of every scan, update, and recommendation |

Click any tab to switch views. The active tab is highlighted with a colored background. To the right of the tabs, the **sun/moon icon** toggles between light and dark themes.

---

## KPI Summary Bar

![KPI summary bar showing severity counts, distribution bar, and upcoming meetings](screenshots/02-summary-strip-dark.png)

The KPI summary bar appears in Briefings and History. Radar omits the summary and
scrolling ticker so its threads and work plan have more room; Today provides the
workload overview.

The bar shows three severity counters:

- **CRITICAL** (red) — Items that need action within 24 hours
- **ELEVATED** (yellow) — Items that need attention this week
- **OBSERVE** (blue) — Items on your watchlist, no immediate action needed

Next to the counters:

- **Severity distribution bar** — A color-coded horizontal bar showing the proportion of Critical (red), Elevated (yellow), and Observe (blue) items
- **Item total** — Total count of active items
- **Attention badges** — Quick counts of blocked, new, or completed items when present

---

## Radar View

Radar uses two panes: a wider thread list and the selected thread's detail.
**Inbox** and **Priority**, with their counts, sit above the thread list instead
of in a separate sidebar. The **Monitored** dropdown
contains Monitored, Snoozed, Completed and Archive, with the selected secondary
view still identified in the navigation. Inbox remains the initial active view.
The dropdown closes when you select a view, click outside it, move keyboard
focus outside it, or press Escape. Select a scanner using the header
dropdown; **Scanner tools** provides Settings, Pause/Resume, Run scanner and
last/next run information. There is no duplicate scanner list.

On narrow screens, Radar opens directly to **Threads**, including its view
navigation and filters. Select a thread to open **Detail**; use **Back to threads**
to return to the same thread in the list.

**Unread** stays directly accessible. **Filters** contains the other quick
filters and all advanced facets; its count and removable chips show active
filters. Use **Done**, Escape, an outside click, or move keyboard focus outside
to close it without clearing your choices. Scanner tools and the thread's
**More** menu also close on an outside click or when focus moves outside.
The filter panel can extend over the detail pane without being cut off; in short
windows its contents scroll inside the panel.
Thread paging appears at the bottom only when more than 100 matching threads
exist, with the displayed range and total instead of an otherwise-empty paging row.

Opening an unread Inbox thread marks it read without resetting the current page
or scrolling the thread list. Arrow-key navigation previews threads without
marking them read; Enter or Space opens them. Read-state filters preserve their
matching threads when opened rather than immediately removing the selection.
Changing search, filters or sorting starts again at page one; background saves
and clock refreshes keep the current page.

**Selecting and deleting multiple cards:** Click a thread normally to select it and open its details. **Ctrl-click** (Windows/Linux) or **Cmd-click** (Mac) toggles individual cards; **Shift-click** selects the range from the last selection anchor. Selected rows are highlighted; modifier selection does not mark cards read or open details. **Ctrl/Cmd+A** while a thread row is focused selects only the current visible page, never all search results. **Escape** clears selection. Changing the page, search, filters, sort, scanner, or view clears selection; rows that disappear are removed from selection.

Right-click a selected row to apply **Archive/Restore**, **Mark read/unread**, **Change work status**, **Change criticality**, or **Snooze/Unsnooze** to all selected cards on the current page; menu labels show the count. Mixed selections are marked read if any card is unread, archived if any card is unarchived, and snoozed for the same 24-hour period unless all are already snoozed (then all are unsnoozed). Restore sets all cards to **In Progress**. Snoozing is disabled if any targeted card is inactive; reopen those cards first. Submenu current indicators appear only when all targeted cards agree. Targets are loaded before editing and saved sequentially; a load failure changes nothing, while a save failure stops and reports the confirmed count (unsaved local changes may remain—retry saving in the local-state banner before reloading). Surviving visible cards stay selected. Right-clicking an unselected row still changes only that row.

Email and Teams draft generation/review are disabled while multiple cards are selected, with **Select one thread to draft a message** as the reason. Existing draft editors are hidden without discarding their drafts. Click a single row normally (or choose **Open thread**) to return to single-thread drafting. These bulk actions only change local FlightDeck state; they never bulk-write or send Microsoft 365 messages. No row checkboxes or extra selection toolbar are required. Detail-local non-draft controls still affect only the displayed card.

Press **Delete** while a thread row is focused, or right-click a selected row and choose **Delete selected cards**, to review the count and confirm. Cancel leaves the selection intact. Deletion permanently removes local FlightDeck cards, not the original email, Teams content, meetings, documents, or any other Microsoft 365 source content. Cards are saved one at a time: if one fails, deletion stops, earlier successful deletions remain saved, and the remaining visible cards stay selected for retry. If a save acknowledgement is lost, a card may already be deleted; the error reports only confirmed successes and stops before attempting the rest. A recovery-required error blocks further deletion: use **Retry reading profile** in the local-state banner to recover the saved state, then reload before deleting again. Arrow keys, **Home**, and **End** still navigate without marking read; hold **Shift** to extend a range. Normal **Enter** opens details and applies the existing read behavior. The detail toolbar still deletes only its named card; right-clicking an unselected row deletes only that card.

**Experimental thread menu:** Right-click a thread in Inbox, Priority, Monitored, Snoozed, Completed, or Archive, or focus its row and press **Context Menu** / **Shift+F10**. Opening or dismissing the menu does not select or mark the thread read, or discard another thread's draft. Actions always apply to the named thread. The existing toolbar and left-click behavior remain available.

Use **Open thread**, **Mark read / unread**, **Change work status**, **Change criticality**, **Snooze for 24 hours / Unsnooze**, **Archive / Restore to In Progress**, or **Delete from FlightDeck…** (requires confirmation and never deletes M365 source content). Restore reopens work as In Progress; it does not automatically re-enable monitoring. Completed or archived work must be reopened before snoozing.

Hover over **Change work status** or **Change criticality** to expand its choices beside the compact, opaque menu. Both menu levels use solid backgrounds in dark and light themes so thread content does not show through. Choices open to the left when needed to stay on screen. Clicking and keyboard navigation still work; narrow windows show the choices inside the menu instead.

**Draft email / Teams message** opens that thread's existing Work plan editor and uses its selected available next move. Existing or busy drafts are exposed instead of regenerated; drafts on other threads remain untouched. Completed work cannot generate new drafts, but existing drafts can still be viewed. Nothing is sent or saved to Outlook automatically. Use arrow keys and Home/End within the menu; Right/Left opens/returns from status and criticality choices. Escape returns to the row (or the parent menu); clicking outside, scrolling elsewhere, resizing, or changing the view dismisses it.

The Radar is FlightDeck's primary view. It shows **all your items** — both inbound signals discovered by scanners and items you're actively monitoring — organized into collapsible sections grouped by scanner.

![Radar view showing prioritized inbound signals organized as cards](screenshots/01-radar-view-dark.png)

### Item Cards

Every item on the Radar — whether freshly discovered or actively monitored — appears as a card. Cards have a **header** strip and **three tabs** that organize all information and controls.

#### Card Header

The header strip across the top of every card contains:

- **Severity dropdown** — Click to change: `Critical` (red), `Elevated` (yellow), or `Observe` (blue). Sets the item's priority level and determines its position in the Radar sort order.
- **Lifecycle status dropdown** — Click to change: `In Progress`, `Blocked`, `Waiting`, `Snoozed`, `Complete`, or `Archived`. Tracks the item through its lifecycle. Setting an item to `Snoozed` adds a 💤 indicator with a relative countdown (e.g., "💤 2h left") showing when it will un-snooze.
- **Title** — A short descriptive title, editable inline (click to edit).
- **Status pills** (right side) — Contextual indicators that appear as needed:
  - **Paused** — Monitoring is disabled for this item
  - **NEW** — Item was discovered in the most recent scan and hasn't been seen yet
  - **UPDATED** (with count) — New changes detected since you last viewed the item (e.g., "UPDATED ×3")
  - **Relative time pill** — How long ago the last update occurred (e.g., "2h ago")
- **↗ Pop Out** — Opens the item in a dedicated window with item details on the left and full change history on the right

#### Activity Tab (⏱️)

![Activity tab showing update timeline](screenshots/03a-tracker-card-activity-dark.png)

The Activity tab shows a chronological timeline of every change FlightDeck has detected for this item. In Radar, the timeline grows with its content rather than stopping at a fixed height; the detail pane scrolls on desktop, while mobile uses the page scroll. Each entry in the timeline includes:

- **Timestamp** — When the change was detected
- **Severity badge** — The severity level at the time of that update
- **Changes description** — A structured summary of what changed (e.g., "Status: In Progress → Blocked" or "Links: +2 new")
- **Summary** — An AI-generated narrative of what happened and why it matters

Unseen entries are highlighted with a distinct background so you can immediately spot what's new. Click **Mark as Seen** to clear all unseen highlights and dismiss the NEW/UPDATED badge on the card header.

The card shows up to **3 recent entries** by default. Click the expand control to view the full history.

#### Overview Tab (📋)

![Overview tab showing metadata, due date, and done criteria](screenshots/03b-tracker-card-overview-dark.png)

The Overview tab collects all metadata, context, and actionable information about the item:

In Radar, these details live in the **Work plan** side pane instead of a separate control strip. Edit **Owner**, **Due date**, and **Scanner assignment** directly in the metadata section; **Done when** has a single multiline editor above it. Changes save automatically. The item header contains left-aligned editable **criticality** and **work state** pills beneath the title, styled like the Inbox pills: click or Tab to a pill to choose a value. For unread items, **Read** remains available alongside the pills. Radar uses the inline item details rather than an **Open** popout button.

- **Recommended next moves** — Up to two message-first asks grounded in current evidence, the owner, unresolved blocker, and **Done when**: for example, “Send a message to Sarah about the unresolved approval, asking for confirmation and the revised delivery date.” The named person is the intended recipient, not the action owner; if that person is unknown, the suggestion asks you to confirm who to contact. Choose one, then use **Email** or **Teams** to generate an editable draft. Suggestions request updates, confirmation, deliverables, or acceptance of ownership; they do not assign work or send anything. Existing stored suggestions keep their wording until a scan or monitor update produces new recommendations.
- **Custom next move** — A third radio option lets you write your own message instruction (up to 500 characters). Your text and selection save automatically per thread and survive navigation/reload. Blank or whitespace-only custom text disables drafting with an explanation. You can write a new custom follow-up even after both recommendations are completed. Changing the selected move or custom text hides drafts for a different ask; existing email proposals remain in the Action Queue. Review the recipient and wording before creating an Outlook draft or explicitly sending a Teams message. Multi-thread selection cannot draft.
- **Source** — Where the signal originated: Email, Chat, Meeting, or Doc.
- **Due date** — Editable inline. Click to open a date picker and set when action is needed. The AI automatically extracts due dates from temporal language in signals ("by Friday", "due March 1", "end of Q2"), but you can always override or clear the date manually.
- **Owner** — Editable inline. Who is responsible for this item.
- **Done when** — Editable inline. In Radar, click or Tab into the **Done when** textbox to edit it directly; changes save automatically. It supports multiple lines and up to 500 characters. Define what "done" looks like for this specific item, for example: "Jordan confirms receipt of the budget spreadsheet" or "Contract signed by both parties." This criteria is automatically included in the monitoring prompt, so FlightDeck's AI knows exactly what resolution looks like and can detect when the item is complete. If you leave this blank, the AI uses its own judgment to assess completion.
- **People** — Collapsible list of counterparties and key contacts involved in this item.
- **Evidence links** — Clickable deep links back to source materials in M365, with recency labels showing when each signal was last updated (e.g., "3h ago", "yesterday").
- **Tracked / Last checked** — Timestamps showing when the item entered tracking and when the monitoring engine last ran a check.

#### Monitor Tab (⚙️)

![Monitor tab showing schedule controls and signal filters](screenshots/03c-tracker-card-monitor-dark.png)

The Monitor tab gives you full control over how and when FlightDeck watches this item:

- **Source scanner** — Which scanner this item belongs to. You can move items between scanners if a different scanner's context is a better fit.
- **Schedule controls:**
  - **Enabled** checkbox — Master toggle for monitoring. Unchecking pauses all checks and shows a "Paused" pill on the card header.
  - **Notifications** checkbox — Whether to send desktop notifications when changes are detected.
  - **Work hours only** checkbox — Restrict interval-based checks to 8 AM – 5 PM. Only visible when the schedule type is set to Interval.
  - **Schedule type** dropdown:
    - **Interval** — Check on a recurring interval: every 15 minutes, 30 minutes, 1 hour, 2 hours, or 4 hours.
    - **Weekly** — Check on specific days of the week (Mon–Sun) at specific times. Defaults to weekdays at 8:00 AM and 12:00 PM. Click **+ Add** to add more time slots.
    - **One-time** — Check once at a specific date and time, then automatically disable monitoring.
  - **Next run** — Shows when the next scheduled check will fire.
  - **Run check now** — Trigger an immediate check without waiting for the schedule. Useful when you know something has changed and want instant results.
- **Signal filters** — Toggle which M365 sources to scan for this item: ✉️ Email, 💬 Chat, 📅 Meetings, 📄 Documents. Narrowing signals focuses the check and reduces noise — for example, turn off Documents for a purely email-based thread.
- **Edit monitoring prompt** — Expandable textarea showing the AI instructions used when checking this item. This prompt is auto-built from the item's title, summary, owner, people, source, and done criteria. You can customize it to add specific context, override defaults, or tune what the AI watches for.
- **Delete** — Remove this item from tracking entirely.

### Filter Bar

Above the item list, a filter bar lets you switch between:

- **All** — Shows all active items (excludes completed and archived)
- **Archived** — Shows completed and archived items (including items evicted to cold storage)

### Switching Between Card and List View

Click the **density toggle** button next to the filter bar to switch between the default **card view** (detailed cards) and **list view** (compact single-line rows).

### Scanners

![Scanner section header with severity counts, action buttons, and countdown](screenshots/08-scanner-section-header-dark.png)

Scanners are the heart of FlightDeck's Radar. Each scanner is a named, scheduled AI scan that searches your M365 signals for specific topics. Items discovered by a scanner appear grouped under that scanner's section header.

Each scanner section header shows:

- **Scanner name and item count** — e.g., "My Scanner (12)"
- **Severity dots** — Quick counts of Critical, Elevated, and Observe items (clickable to filter)
- **Attention badges** — Counts of blocked or waiting items (clickable to filter)
- **New indicator** — Count of new or recently updated items (clickable to filter)
- **Next run countdown** — Time until the scanner runs again (e.g., "⏱ 12m")
- **Action buttons** — Add item (+), run scan now (⚡), pause/resume (⏸/▶), settings (⚙️), collapse/expand (▾)

Click any severity dot, attention badge, or "new" indicator to filter that scanner's items inline. Click ✕ to clear the filter.

### Adding a Scanner

Click the **+ Scanner** button at the top of the Radar view to create a new scanner.

![Add Task modal for creating a new tracked item in a scanner](screenshots/11-add-task-modal-dark.png)

The scanner settings modal opens with:

| Field | Description |
|-------|-------------|
| **Name** | A descriptive label (e.g., "Competitor Intel", "Project X Updates") |
| **Schedule** | How often to scan: Interval (15m–4h), Scheduled (specific days/times), or One-time |
| **Prompt** | The AI instructions — tell it what signals to look for. Use `{lastRunAt}` for time-based filtering. |

Additional options include:

- **Signal types** — Which M365 sources to scan (Email, Chat, Meetings, Documents)
- **Work hours only** — Restrict scans to 8 AM – 5 PM
- **Run on startup** — Automatically run this scanner when FlightDeck launches
- **Missed run policy** — What to do when a scheduled scan was missed: skip, run once, or catch up (max 3)
- **Auto-monitor new items** — Automatically enable monitoring on newly discovered items
- **Notification mode** — All notifications, critical-only, or silent
- **Max items per scan** — Cap on how many items a single scan returns (1–25, default 10)
- **Dedup strategy** — How to detect duplicate items: by evidence URL, title similarity, or both
- **Cross-scanner dedup** — Whether to check for duplicates across all scanners
- **Exclude keywords** — Filter out items matching specific keywords
- **Auto-archive** — Automatically archive items after a set number of days
- **Retention** — How long to keep items before eviction (up to 365 days)
- **Webhook URL** — POST scan results to an external URL

### Scanner Settings

To edit an existing scanner's settings, click the **⚙️ gear icon** in that scanner's section header.

![Scanner settings modal showing prompt, signal types, schedule, and lifecycle options](screenshots/10-scanner-settings-modal-dark.png)

This opens the scanner settings modal where you can modify any of the options described above.

You can also:

- **Pause/resume** a scanner using the ⏸/▶ button in the section header
- **Run a scan immediately** using the ⚡ button
- **Delete a scanner** from the settings modal (items with completed/archived status are preserved)

### Scanner Examples

Not sure what to put in the prompt field? Here are ten ready-to-use scanner prompts organized from simple to advanced. Copy any prompt into a new scanner, adjust the settings, and you're scanning in under a minute.

Every scanner prompt builds on the same base template — you only write the **"Focus specifically on"** part. The template already handles time filtering (`{lastRunAt}`), citation rules, and due-date extraction.

---

#### Starter Examples

These prompts are short, focused, and a great first scanner to set up.

**Deadline Watchdog** — Catches upcoming deadlines mentioned across email, chats, and meetings so nothing sneaks past you.

**Prompt:**

> Focus specifically on: any deadlines, due dates, or time-sensitive commitments involving me — whether I set them or someone else did. Include items where a deadline is implied ("by end of week", "before the board meeting"). Classify as Critical if the deadline is within 48 hours, Elevated if within 7 days, Observe otherwise.

**Settings:** Schedule every 2 h · All signal types · Auto-monitor on · Max 10 items

💡 **Tip:** Pair this with a Scheduled run at 8 AM on Mondays to catch week-ahead deadlines in your morning routine.

---

**Action Items I Owe** — Finds commitments you made in meetings and chats — the stuff that slips through the cracks.

**Prompt:**

> Focus specifically on: action items, commitments, or promises that **I** made to others. Look for phrases like "I'll handle", "I'll send", "let me follow up", "I owe you", or any task I volunteered for. Do NOT surface items that others owe me — only things I need to deliver. Include the person I committed to and any stated or implied deadline.

**Settings:** Schedule every 4 h · Chat + Meetings signals · Max 10 items

💡 **Tip:** Turn on auto-monitor so FlightDeck keeps watching each commitment until you mark it complete.

---

**1:1 Prep Scanner** — Auto-generates talking points for your next 1:1 by scanning recent signals involving that person.

**Prompt:**

> Focus specifically on: any topics, updates, open questions, or unresolved threads involving my direct manager. Include status changes on shared projects, decisions that need alignment, blockers I should raise, and any praise or wins worth mentioning. Group by theme (updates, blockers, asks, wins).

**Settings:** Weekly, day before your 1:1 · All signal types · Max 8 items

💡 **Tip:** Swap "my direct manager" for a specific name. Duplicate this scanner for each person you have regular 1:1s with.

---

#### Intermediate Examples

These prompts use multi-signal filtering, negative instructions, and severity hints for more targeted scanning.

**Team Health Signals** — Monitors for burnout, overload, or morale signals from your direct reports. Built for managers.

**Prompt:**

> Focus specifically on: signals that indicate team health issues among my direct reports:
> - Late-night or weekend messages (potential overload)
> - Requests to reschedule or cancel 1:1s repeatedly
> - Language suggesting frustration, burnout, or disengagement ("swamped", "drowning", "can't keep up")
> - Missed deadlines or slipping commitments
> - Escalations or complaints from stakeholders about a report's work
>
> Do NOT surface routine status updates or normal work activity. Only flag patterns that suggest someone may need support. Classify as Critical if multiple signals appear for the same person, Elevated for isolated signals.

**Settings:** Schedule every 4 h · Email + Chat signals · Work hours only · Max 8 items · Critical-only notifications

💡 **Tip:** Set notifications to critical-only — you don't want a firehose, just early warning signs worth a check-in.

---

**Decisions That Affect My Work** — Catches decisions made in meetings you weren't in, so you're never blindsided. Built for ICs.

**Prompt:**

> Focus specifically on: decisions, approvals, direction changes, or priority shifts discussed in meetings I did NOT attend. Look for signals like "we decided", "leadership approved", "we're pivoting", "new priority", or "effective immediately" in meeting recaps, follow-up emails, and chat threads. Include who made the decision and what changed. Do NOT include meetings I attended — only information I might have missed.

**Settings:** Schedule every 2 h · Meetings + Email + Chat signals · Max 10 items

💡 **Tip:** Add exclude keywords for recurring meetings you always attend (e.g., your own team standup) to reduce noise.

---

**Sales Deal Radar** — Tracks deal momentum, buying signals, and competitor mentions across your pipeline.

**Prompt:**

> Focus specifically on: signals related to active sales opportunities:
> - Buying signals — budget approvals, executive sponsor engagement, procurement involvement, timeline discussions
> - Risk signals — going silent, postponed meetings, reduced stakeholder engagement, mentions of competing vendors
> - Competitor mentions — any reference to competing products or vendors by name in customer communications
> - Deal progression — contract redlines, legal review, POC feedback, reference requests
>
> Classify as Critical if a deal shows risk signals or competitor activity. Classify as Elevated for positive buying signals that need follow-up. Include the account/deal name and the specific signal detected.

**Settings:** Schedule every 1 h · Email + Chat signals · Max 15 items · Auto-monitor on

💡 **Tip:** Increase max items to 15 if you're managing 10+ active deals to make sure nothing gets clipped.

---

**Engineering Incident Monitor** — Surfaces P0/P1 alerts, production issues, and outage signals so you can respond fast.

**Prompt:**

> Focus specifically on: production incidents, outage signals, and high-severity engineering alerts:
> - P0/P1/Sev1/Sev2 mentions in any channel
> - Keywords: "outage", "incident", "degraded", "rollback", "hotfix", "pages", "on-call"
> - Customer-reported issues escalated to engineering
> - Post-incident review or retrospective scheduling
>
> Classify as Critical if the incident is active or unresolved. Classify as Elevated for post-incident follow-ups. Do NOT surface routine deployments, feature releases, or low-severity bugs.

**Settings:** Schedule every 30 m · Email + Chat signals · All notifications · Max 10 items · Run on startup

💡 **Tip:** Enable "Run on startup" so you immediately know about any incidents that fired overnight.

---

#### Advanced Examples

These prompts use multi-section extraction, structured severity classification, and complex filtering for power users.

**Executive Briefing Scanner** — Multi-section strategic scanner that surfaces risk, opportunity, and competitive intel for senior leaders.

**Prompt:**

> Focus specifically on: executive-level intelligence across these categories:
>
> **Strategic risks:**
> - Escalations reaching VP+ level
> - Budget or headcount changes
> - Key personnel departures or re-orgs
> - Customer churn signals or major account issues
>
> **Opportunities:**
> - New partnership or expansion discussions
> - Positive customer feedback or case study candidates
> - Cross-sell or upsell signals from existing accounts
>
> **Competitive intelligence:**
> - Competitor mentions in customer conversations
> - Win/loss signals and reasons cited
> - Market or analyst report references
>
> **Organizational signals:**
> - Cross-functional alignment issues
> - Recurring meeting cancellations at leadership level
> - Strategy or priority shifts signaled in all-hands or leadership threads
>
> Classify as Critical if a risk could impact quarterly targets or requires immediate executive attention. Classify as Elevated for opportunities with a time window. For each item, include the source, key people involved, and a one-line recommended action.

**Settings:** Weekly, 7 AM weekdays · All signal types · Max 15 items · Critical-only notifications

💡 **Tip:** Schedule this once per morning rather than on an interval — executive-level signals don't need real-time polling, and a daily digest is easier to act on.

---

**Compliance & Audit Watch** — Tracks regulatory deadlines, audit findings, policy changes, and vendor certification status.

**Prompt:**

> Focus specifically on: compliance, regulatory, and audit-related signals:
> - Upcoming regulatory deadlines or filing dates
> - Audit findings, action items, or remediation tracking
> - Policy changes or new compliance requirements
> - Vendor/third-party certification renewals or expirations
> - Data privacy requests (DSAR, GDPR, CCPA) and response deadlines
> - Internal control review results or exceptions
>
> Classify as Critical if a deadline is within 7 days or an audit finding is unresolved. Classify as Elevated for items within 30 days. Do NOT surface general legal discussions, routine contract renewals without compliance implications, or HR policy changes unrelated to regulatory requirements. Include the specific regulation, deadline, or finding reference where available.

**Settings:** Schedule every 4 h · Email + Documents signals · Auto-monitor on · Retention 365 days · Max 10 items

💡 **Tip:** Set retention to the maximum (365 days) — compliance items often have long timelines and you'll want the full audit trail.

---

**Cross-Team Dependency Tracker** — Structured extraction of inter-team blockers, handoffs, and delivery commitments.

**Prompt:**

> Focus specifically on: cross-team dependencies and inter-team coordination signals:
> - Deliverables my team is waiting on from other teams (and their stated timelines)
> - Deliverables other teams are waiting on from us
> - Blocked work items where the blocker is owned by another team
> - Handoff requests, API contract changes, or shared resource conflicts
> - Escalations about missed cross-team commitments
>
> For each item, extract:
> - **Dependency direction:** "We need from [Team]" or "[Team] needs from us"
> - **What:** The specific deliverable or blocker
> - **Deadline:** Any stated or implied timeline
> - **Status:** On track, at risk, or blocked
>
> Classify as Critical if a dependency is blocked or the deadline is within 3 days. Classify as Elevated if at risk or within 2 weeks. Do NOT include internal team tasks with no cross-team component.

**Settings:** Schedule every 2 h · All signal types · Auto-monitor on · Max 12 items

💡 **Tip:** Duplicate this scanner and customize one per partner team if you have complex multi-team dependencies — the cross-scanner dedup will prevent overlapping items automatically.

---

### Prompt Writing Tips

Getting the most out of your scanners comes down to writing clear, specific prompts. Here are practical tips to level up your scanner results.

1. **Be specific about what "actionable" means.** Don't just say "find important emails." Tell the scanner what makes something actionable: a deadline, a decision needed, a commitment made, a risk detected. The more concrete your criteria, the fewer false positives you'll get.

2. **Use bullet lists for multi-signal prompts.** When you're scanning for several types of signals, break them into a bulleted list inside the prompt. The AI handles structured lists better than run-on paragraphs, and it makes your prompt easier to edit later.

3. **Tell the AI what to ignore.** Negative instructions ("Do NOT surface routine status updates") are just as valuable as positive ones. Without them, you'll get flooded with technically-relevant-but-not-useful items. Be explicit about what's noise for your use case.

4. **Teach severity by example.** Rather than leaving severity classification to the AI's judgment, include concrete rules: "Classify as Critical if the deadline is within 48 hours" or "Classify as Elevated if a competitor is mentioned." This makes severity consistent across scans and makes the KPI bar meaningful.

5. **Match schedule frequency to urgency.** A production incident scanner should run every 30 minutes. A compliance scanner can run every 4 hours. An executive briefing works best as a once-daily scheduled run. Don't waste scan cycles on signals that don't change fast.

6. **Start simple, then layer on.** Your first version of a scanner prompt should be 2–3 lines. Run it a few times, see what comes back, then add negative instructions, severity rules, or additional signal categories. Prompt iteration beats prompt perfection.

7. **Pick the right signal types.** Not every scanner needs all four signal types (Email, Chat, Meetings, Documents). An incident monitor probably doesn't need Documents. A compliance scanner probably doesn't need Chat. Narrowing signal types reduces noise and speeds up scans.

### Tracked Items & Monitoring

Tracking is how you tell FlightDeck "keep watching this." Any item on the Radar can be promoted from a one-time signal to an actively monitored item. Once tracked, FlightDeck periodically re-scans that item's M365 sources and notifies you when something meaningful changes — a status shift, a new reply, an approaching deadline, or resolution of your "done" criteria.

![Tracker card with NEW badge showing unseen updates and status transitions](screenshots/04-tracker-card-updated-dark.png)

**How to track an item:**

- **From a scan result** — Click the **Track Item** button on any card. FlightDeck enables monitoring with sensible defaults (interval schedule, all signal types, auto-generated monitoring prompt).
- **Custom item** — Click the **+** button in any scanner's section header to create a tracked item from scratch. Fill in a title, severity, and monitoring prompt to start watching something specific that scanners haven't discovered yet.

**Tracked item badges:**

- **NEW** — This item was discovered for the first time in the most recent scan. It hasn't been viewed yet.
- **UPDATED** (with count) — FlightDeck has detected meaningful changes since you last viewed the item. The count shows how many new updates are waiting (e.g., "UPDATED ×3").

Tracked items use the same three-tab card layout — **Activity** (⏱️), **Overview** (📋), and **Monitor** (⚙️) — documented in detail in the [Item Cards](#item-cards) section above. The Overview tab is where you set **due dates** and **done criteria** that guide monitoring, and the Monitor tab is where you configure schedules, signal filters, and the monitoring prompt.

### Change History

Each monitored item maintains a **Change History** — a log of every meaningful change detected over time. Click **▸ Change History** to expand it.

Each entry includes:

- **Timestamp** — When the change was detected
- **Status transition** — What changed (e.g., "Status: Negotiation → Under Review · Links: +1 new")
- **Summary** — AI-generated description of what happened
- **Source link** — Clickable link to the original signal in M365
- **Suggested next step** — Recommended action based on the change

The most recent changes appear at the top. Entries are de-duplicated — the monitoring engine includes previous summaries in each check to avoid re-reporting the same information.

### Lifecycle Statuses

Every item has a lifecycle status that reflects its current state:

| Status | Meaning |
|--------|---------|
| **In Progress** | Active item being monitored or worked |
| **Blocked** | Item is stalled — detected automatically from AI status reports |
| **Waiting** | Pending external input or a response |
| **Snoozed** | Temporarily hidden; auto-un-snoozes when the snooze period expires |
| **Complete** | Resolved — monitoring auto-disables. Item moves to the Archived filter. |
| **Archived** | Manually or auto-archived. Preserved in cold storage for reference. |

Lifecycle transitions can happen automatically based on AI analysis (e.g., an item marked "resolved" by the AI is auto-completed) or manually via item actions.

### Automatic Status Detection

FlightDeck doesn't just track items — it triages them for you. Each time the monitoring AI checks an item, it analyzes the latest signals and automatically updates the lifecycle status based on what it finds:

- **Blocked** — If the AI detects language like "stalled," "blocked," or "waiting on a dependency," the item moves from In Progress to Blocked.
- **Waiting** — If signals indicate the ball is in someone else's court — "pending review," "awaiting response" — the status shifts to Waiting.
- **Complete** — When the AI sees "resolved," "completed," or "closed" — or when your **Done when** criteria are met — the item is marked Complete, monitoring is automatically disabled, and a completion timestamp is recorded.

You can always override a status manually, but in most cases FlightDeck handles it before you even check. The **triage progress bar** on the dashboard shows how many of your active items have been reviewed, so you can tell at a glance whether anything still needs your attention.

### Done Criteria

The **Done when** field on the Overview tab lets you define what "finished" looks like for each item — for example, *"Jordan confirms receipt of the budget spreadsheet"* or *"Contract signed by both parties."* This text is automatically woven into every monitoring prompt, so the AI actively watches for signals that match your criteria and marks the item complete when they appear.

---



---

## Briefings View

The Briefings view generates **AI-powered meeting preparation** for your upcoming meetings and a daily overview to start your day. When you switch to the Briefings tab for the first time in a session, FlightDeck automatically fetches your meetings if they haven't been loaded yet.

![Briefings view showing the My Day briefing with priorities, meetings, and suggested time blocks](screenshots/05-briefings-view-dark.png)

### My Day Briefing

At the top of the Briefings view, the **My Day** briefing gives you a comprehensive daily overview. It's marked with a ☀️ icon and generates automatically. The briefing includes:

- **Headline** — A one-line summary of your day (e.g., "Busy day: 4 meetings, 2 Critical items need attention")
- **Top Priorities** — The most important things to address today, with specific names and actions
- **Meetings Requiring Prep** — Meetings that have complex agendas or potential risks, with context
- **At-Risk Items** — Critical-severity items that could escalate, with red `Critical` badges
- **Suggested Time Blocks** — AI-recommended schedule showing what to work on and when (e.g., "8:00 – 8:30 AM: Review Contoso escalation telemetry")
- **Follow-Ups** — Actions to take after meetings or deadlines

Click **Regenerate My Day** to get a fresh briefing based on the latest data.

### Meeting Briefings

Below My Day, each upcoming meeting appears as a collapsible row with:

- **Status badge** — `Briefed` (green) if a briefing has been generated, or `Unbriefed` (orange) if not
- **New badge** — Orange `New` label if the briefing was recently generated
- **Meeting title** — Name of the meeting

Click a meeting row to expand it and see the full briefing.

![Expanded meeting briefing showing key updates, decisions needed, risks, talk track, and sources](screenshots/05-briefings-view-dark.png)

### Meeting Briefing Content

An expanded meeting briefing contains:

- **Meeting metadata** — Date/time, organizer, and a clickable **join meeting** link
- **Regenerate Briefing** button — Regenerate the briefing fresh
- **Headline** — AI-generated summary of the meeting's context and key tension points
- **Key Updates** — Bullet points on what happened since the last meeting, with specific people and facts
- **Decisions Needed** — Choices that must be made, with tradeoffs outlined
- **Top Risks** — What could go wrong if action isn't taken
- **Talk Track** — Suggested talking points and how to approach the discussion
- **Follow-Ups** — Post-meeting actions to take
- **Sources** — Clickable links back to the meetings, documents, chats, and emails that informed the briefing

### Editing the Briefing Prompt

Click **▸ Edit Briefing Prompt** to customize the AI instructions used to generate meeting briefings. You can adjust what the AI emphasizes, the level of detail, or the tone.

---

## History View

The History view is a chronological **audit trail** of everything FlightDeck has done — every scan, every recommendation, and every system event.

![History view showing the audit trail with timestamped events](screenshots/07-history-view-dark.png)

### Event Types

Each history entry is color-coded by type:

| Event | Description |
|-------|-------------|
| **STARTUP** | FlightDeck initialized or was restarted |
| **SCAN** | A monitoring cycle completed — shows what was checked and whether new information was found |
| **RECOMMENDATION** | The AI generated a briefing or recommended an action |

### History Entry Details

Each entry shows:

- **Event type and timestamp** — e.g., "SCAN · 3/2/2026, 7:00:00 AM"
- **Summary** — What happened during this event
- **Links** — When a scan detects changes, it shows the relevant source link (clickable, opens in M365)

The History view is read-only — it's a complete log that lets you understand the timeline of signals, scans, and recommendations.

---

## Search

FlightDeck includes a **global search** that works across all views.

- Press **Ctrl+K** (or click the search bar at the top) to activate search
- Type your query to instantly filter across radar items, tracked tasks, and briefings
- Results highlight matching text and show the item type (radar, tracker, or briefing)
- Click a result to jump to that item in its respective view

Search uses fuzzy matching — you don't need an exact match. Multi-word queries match when all words appear somewhere in the item.

---

## Version Notifications

FlightDeck checks for updates on startup. When a newer version is available:

- An **update indicator** (pulsing dot) appears next to the version badge in the top bar
- Hover to see the available version and a **View release ↗** link to the release page
- Click **×** to dismiss the notification for that version — it won't reappear until a newer version is released

---

## Theme

FlightDeck supports **dark** and **light** themes:

- Click the **sun/moon icon** in the top-right corner to toggle between themes
- By default, FlightDeck follows your system preference (Windows dark/light mode)
- Once you manually toggle, your choice is remembered across sessions

---

## System Tray

FlightDeck runs in the **system tray** when minimized:

- Close the window to minimize to tray (FlightDeck keeps running in the background)
- Monitoring schedules continue — you'll receive **desktop notifications** when tracked items have meaningful changes
- Click the tray icon to restore the window
- Right-click the tray icon for options

---

## Demo Mode

FlightDeck includes a demo mode for presentations, screenshots, and exploring the app without a Microsoft 365 connection.

### Running in Demo Mode

```bash
npm run demo          # Launch with sample data (cached between runs)
npm run demo:reseed   # Launch with fresh sample data (always resets)
```

Demo mode:
- Loads realistic sample data (9 items across 3 scanners, meetings, briefings, history)
- **Never calls WorkIQ** — all AI features are disabled, no M365 connection needed
- Uses a separate data store (`flightdeck.demo.v2`) — your real data is never touched
- Dates adjust automatically so the demo always looks current

### Automated Screenshots

```bash
npm run screenshots   # Capture all views in dark + light themes
```

Screenshots are saved to `docs/screenshots/` — useful for documentation, presentations, and README images.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+K** | Open global search |
| **Ctrl+R** | Refresh current view |
| **Esc** | Close search / dismiss popups |

---

## Tips & Best Practices

1. **Set up your scanners** — Create scanners for the topics you care about most. Each scanner runs on its own schedule and surfaces relevant signals automatically.

2. **Track what matters** — When you see an item that needs ongoing attention, click **Track Item**. FlightDeck will continuously monitor it and flag changes.

3. **Use Briefings before meetings** — Expand a meeting briefing 10–15 minutes before the call. The AI pulls context from related emails, chats, and documents so you walk in prepared.

4. **Start your day with My Day** — The daily briefing gives you a prioritized view of your day with suggested time blocks.

5. **Mark as Seen** — When you've reviewed a tracked item's update, mark it as seen. This keeps your dashboard clean and makes it easy to spot genuinely new updates.

6. **Pop out for focus** — Use the **↗ Pop Out** button to open a tracked item in its own window. This is useful when you need to reference it while working in another app.

7. **Customize your prompts** — Edit scanner prompts via the ⚙️ settings button to tailor what the AI looks for. Edit the briefing prompt to adjust meeting prep style.

8. **Use scanner filters** — Click the severity dots, attention badges, or "new" indicator in a scanner header to quickly filter items without leaving the Radar.

9. **Check History for context** — If you're unsure when something changed or what triggered a recommendation, the History view has the full timeline.

10. **Let auto-monitor work for you** — Enable "Auto-monitor new items" in scanner settings so newly discovered items are automatically tracked without manual action.
