# FlightDeck User Guide

FlightDeck is a personal work-intelligence dashboard that connects to Microsoft 365 via the WorkIQ CLI. It scans your email, Teams chats, meetings, and documents, then surfaces the items that need your attention — ranked by urgency.

---

## Table of Contents

- [First Launch](#first-launch)
- [Dashboard Overview](#dashboard-overview)
- [Navigation](#navigation)
- [KPI Summary Bar](#kpi-summary-bar)
- [Radar View](#radar-view)
  - [Scanners](#scanners)
  - [Adding a Scanner](#adding-a-scanner)
  - [Scanner Settings](#scanner-settings)
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

> **No manual EULA step needed.** FlightDeck automatically accepts the WorkIQ EULA when you click "Enable WorkIQ". You do **not** need to run `workiq accept-eula` in a terminal first — the app handles it for you.

1. **You land on the Radar tab** — This is the default view every time you open the app.
2. **The Connect banner appears** — At the top of the main area, you'll see a banner that says *"Connect: Requires Node.js, Copilot license, and tenant admin consent for WorkIQ data access."* with an **Enable WorkIQ** button.
3. **Click "Enable WorkIQ"** — This is the key step! FlightDeck will:
   - **Auto-accept the WorkIQ EULA** (handles Y/N prompts automatically)
   - **Run a health check** to verify your WorkIQ connection (status shows "Checking WorkIQ...")
   - If the EULA acceptance or health check fails, you'll see an error message with guidance
4. **Automatic first refresh** — Once connected, FlightDeck immediately runs a full refresh in parallel:
   - **Radar scan** — The AI scans your M365 signals (email, Teams, meetings, documents) and populates the Radar with prioritized items.
   - **Meetings refresh** — FlightDeck pulls your upcoming meetings for today and populates the Briefings view.
5. **Briefings are ready** — Switch to the Briefings tab and you'll see your meetings listed. Expand any meeting to generate a briefing, or click **Regenerate My Day** for your daily overview.
6. **Start tracking** — As you review Radar items, click **Track Item** on anything that needs ongoing monitoring. FlightDeck will watch it on a schedule and notify you of changes.

On subsequent launches, if you were previously connected, FlightDeck automatically verifies the connection and runs a full refresh — you'll see your Radar and Meetings update within seconds of opening the app. If the connection check fails (e.g., WorkIQ CLI isn't available), the Connect banner reappears.

> **Tip:** FlightDeck remembers your connection state, tracked items, and monitoring schedules in local storage. Your data persists across sessions.

> **EULA re-acceptance:** If the WorkIQ EULA needs to be re-accepted (e.g., after a WorkIQ reinstall or update), FlightDeck will automatically detect it. The "Enable WorkIQ" banner will reappear so you can click it to re-accept — no manual terminal commands needed.

---

## Dashboard Overview

When you launch FlightDeck, you'll see the main dashboard with three tabs: **Radar**, **Briefings**, and **History**. The active tab is highlighted in the top navigation bar.

![FlightDeck Radar View — the main dashboard showing inbound signals prioritized by severity](screenshots/01-radar-view-dark.png)

The dashboard is organized into three horizontal zones:

1. **Top bar** — App branding (with version badge), global search, tab navigation, theme toggle, and status pill
2. **KPI summary** — At-a-glance severity counts, severity distribution bar, and item totals
3. **Main content** — The active view's cards and details

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

The KPI summary bar appears at the top of the main content area with at-a-glance metrics.

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

The Radar is FlightDeck's primary view. It shows **all your items** — both inbound signals discovered by scanners and items you're actively monitoring — organized into collapsible sections grouped by scanner.

![Radar view showing prioritized inbound signals organized as cards](screenshots/01-radar-view-dark.png)

### Item Cards

Each item displays three tabs — **Activity** (update timeline), **Overview** (metadata, people, links), and **Monitor** (schedule and signal controls):

| Activity | Overview | Monitor |
|----------|----------|---------|
| ![Activity tab](screenshots/03a-tracker-card-activity-dark.png) | ![Overview tab](screenshots/03b-tracker-card-overview-dark.png) | ![Monitor tab](screenshots/03c-tracker-card-monitor-dark.png) |

Each item appears as a card with:

- **Severity badge** — Editable dropdown: `Critical` (red), `Elevated` (yellow), or `Observe` (blue)
- **Title** — A short descriptive title, editable inline (click to edit)
- **Summary** — AI-generated description of why this item was surfaced
- **Suggested next steps** — Actionable recommendations (0–2 concrete actions). On monitored items, clicking a suggestion generates an AI-drafted message.
- **Source** — Where the signal came from (Email, Chat, Meeting, Doc, etc.) and when
- **Owner** — Who the item is attributed to (editable inline)
- **Due date** — When action is needed (editable inline)
- **People** — Collapsible list of key contacts involved
- **Links** — Clickable deep links back to the original source materials in M365
- **Lifecycle badge** — Shows the item's current status: in-progress, blocked, waiting, snoozed, complete, or archived

### Item Actions

Each item card has action buttons including:

- **Track Item** — Enables ongoing monitoring for this item. FlightDeck will periodically re-scan it and notify you of meaningful changes.
- **Mark as Seen** — Clears the "NEW UPDATE" badge (appears only when there are unseen updates)
- **↗ Pop Out** — Opens the item in a dedicated window with item details on the left and full change history on the right
- **Delete** — Removes the item

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

### Tracked Items & Monitoring

Any item can be promoted to active monitoring. When you click **Track Item**, FlightDeck enables periodic re-scanning for that specific item and notifies you when something meaningful changes.

![Tracker card with NEW badge showing unseen updates and status transitions](screenshots/04-tracker-card-updated-dark.png)

Monitored items show a **"Monitored" badge** and have richer detail:

- **NEW UPDATE badge** — Appears when FlightDeck detects a meaningful change, with a timestamp
- **Activity timeline** — Shows the progression of changes over time
- **Updated timestamp** — When the last meaningful change was detected
- **Tracking timeline** — When the item was first tracked and last checked

Expand the **▸ Monitoring** section on any item to configure:

- **Enabled** checkbox — Turn monitoring on or off
- **Notifications** checkbox — Whether to send desktop notifications on changes
- **Schedule type**:
  - **Interval** — Check every 15m, 30m, 1h, 2h, or 4h
  - **Scheduled** — Check on specific days and times
  - **One-time** — Check once at a specific date/time, then auto-disable
- **Day selector** — Pick which days of the week to check (for Scheduled mode)
- **Time slots** — Set specific times; click **+ Add** for more slots
- **Work Hours** — Restrict interval checks to 8 AM – 5 PM
- **Run check now** — Manually trigger an immediate check
- **Signals** — Toggle which M365 sources to scan: 📧 Email, 💬 Chat, 📅 Meetings, 📄 Documents
- **▸ Edit monitoring prompt** — Customize the AI instructions for this item's checks

You can also add a custom monitored item directly to a scanner by clicking the **+ button** in that scanner's section header. Fill in a title, severity, and monitoring prompt to start tracking something specific.

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
