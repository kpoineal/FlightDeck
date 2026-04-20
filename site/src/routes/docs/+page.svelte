<script>
	import { base } from '$app/paths';

	let activeSection = $state('first-launch');

	const sections = [
		{ id: 'first-launch', label: 'First Launch' },
		{ id: 'dashboard-overview', label: 'Dashboard Overview' },
		{ id: 'navigation', label: 'Navigation' },
		{ id: 'kpi-summary', label: 'KPI Summary Bar' },
		{ id: 'radar-view', label: 'Radar View' },
		{ id: 'scanners', label: 'Scanners' },
		{ id: 'tracked-items', label: 'Tracked Items' },
		{ id: 'briefings', label: 'Briefings' },
		{ id: 'history', label: 'History' },
		{ id: 'search', label: 'Search' },
		{ id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts' },
		{ id: 'system-tray', label: 'System Tray' },
		{ id: 'demo-mode', label: 'Demo Mode' },
	];
</script>

<svelte:head>
	<title>Docs — FlightDeck</title>
	<meta name="description" content="FlightDeck user guide — learn how to set up, configure, and use your personal work radar." />
</svelte:head>

<div class="pt-20 pb-24">
	<div class="mx-auto max-w-7xl px-6 flex gap-12">
		<!-- Sidebar -->
		<aside class="hidden lg:block w-56 shrink-0">
			<div class="sticky top-24">
				<h4 class="text-xs font-semibold uppercase tracking-wider text-white/30 mb-4">User Guide</h4>
				<nav class="space-y-1">
					{#each sections as section}
						<a
							href="#{section.id}"
							class="block rounded-lg px-3 py-1.5 text-sm transition-colors no-underline {activeSection === section.id
								? 'bg-[#0a84ff]/10 text-[#0a84ff]'
								: 'text-white/50 hover:text-white hover:bg-white/5'}"
							onclick={() => { activeSection = section.id; }}
						>
							{section.label}
						</a>
					{/each}
				</nav>
			</div>
		</aside>

		<!-- Content -->
		<article class="min-w-0 flex-1 prose prose-invert prose-flightdeck max-w-none
			prose-headings:font-semibold prose-headings:tracking-tight
			prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-16 prose-h2:mb-6
			prose-h3:text-lg prose-h3:mt-10 prose-h3:mb-4
			prose-p:text-white/70 prose-p:leading-relaxed
			prose-a:text-[#0a84ff] prose-a:no-underline hover:prose-a:underline
			prose-strong:text-white
			prose-code:text-[#0a84ff] prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
			prose-pre:bg-[#18181b] prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl
			prose-img:rounded-xl prose-img:border prose-img:border-white/10
			prose-table:text-sm
			prose-th:text-white/80 prose-th:font-medium prose-th:border-white/10
			prose-td:text-white/60 prose-td:border-white/10
			prose-li:text-white/70
		">
			<h1 class="!text-4xl md:!text-5xl">User Guide</h1>
			<p class="!text-lg !text-white/50 !mt-2 !mb-12">
				FlightDeck is a personal work-intelligence dashboard that connects to Microsoft 365 via
				the WorkIQ CLI. It scans your email, Teams chats, meetings, and documents, then surfaces
				the items that need your attention — ranked by urgency.
			</p>

			<!-- First Launch -->
			<h2 id="first-launch">First Launch</h2>
			<p>When you open FlightDeck for the first time:</p>
			<ol>
				<li><strong>You land on the Radar tab</strong> — This is the default view every time you open the app.</li>
				<li><strong>The Connect banner appears</strong> — You'll see a banner with an <strong>Enable WorkIQ</strong> button.</li>
				<li><strong>Click "Enable WorkIQ"</strong> — FlightDeck auto-accepts the WorkIQ EULA, runs a health check, and connects to your Microsoft 365.</li>
				<li><strong>Automatic first refresh</strong> — Once connected, FlightDeck runs a Radar scan and pulls your meetings in parallel.</li>
				<li><strong>Briefings are ready</strong> — Switch to Briefings to see your upcoming meetings. Generate briefings with one click.</li>
				<li><strong>Start tracking</strong> — Click <strong>Track Item</strong> on anything that needs ongoing monitoring.</li>
			</ol>
			<p>
				On subsequent launches, FlightDeck automatically reconnects and refreshes. Your tracked items,
				monitoring schedules, and preferences persist across sessions.
			</p>

			<!-- Dashboard Overview -->
			<h2 id="dashboard-overview">Dashboard Overview</h2>
			<img
				src="{base}/screenshots/01-radar-view-dark.png"
				alt="FlightDeck Radar View dashboard"
				class="screenshot-glow"
			/>
			<p>The dashboard is organized into three horizontal zones:</p>
			<ol>
				<li><strong>Top bar</strong> — App branding, global search, tab navigation, theme toggle, and connection status</li>
				<li><strong>KPI summary</strong> — At-a-glance severity counts, distribution bar, and item totals</li>
				<li><strong>Main content</strong> — The active view's cards and details</li>
			</ol>

			<!-- Navigation -->
			<h2 id="navigation">Navigation</h2>
			<img
				src="{base}/screenshots/09-topbar-dark.png"
				alt="FlightDeck topbar"
			/>
			<p>The top bar contains three main tabs:</p>
			<table>
				<thead>
					<tr>
						<th>Tab</th>
						<th>Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><strong>Radar</strong></td>
						<td>All items — inbound signals and monitored tasks — organized by scanner</td>
					</tr>
					<tr>
						<td><strong>Briefings</strong></td>
						<td>AI-generated meeting prep and daily briefings</td>
					</tr>
					<tr>
						<td><strong>History</strong></td>
						<td>Audit trail of every scan, update, and recommendation</td>
					</tr>
				</tbody>
			</table>

			<!-- KPI Summary Bar -->
			<h2 id="kpi-summary">KPI Summary Bar</h2>
			<img
				src="{base}/screenshots/02-summary-strip-dark.png"
				alt="KPI summary bar"
			/>
			<p>The KPI bar shows at-a-glance metrics with three severity counters:</p>
			<ul>
				<li><strong class="!text-[#ff453a]">Critical</strong> — Items needing action within 24 hours</li>
				<li><strong class="!text-[#ff9f0a]">Elevated</strong> — Items needing attention this week</li>
				<li><strong class="!text-[#64d2ff]">Observe</strong> — Items on your watchlist, no immediate action</li>
			</ul>
			<p>A color-coded severity distribution bar, item total, and attention badges complete the strip.</p>

			<!-- Radar View -->
			<h2 id="radar-view">Radar View</h2>
			<p>
				The Radar is FlightDeck's primary view. It shows all your items — both inbound signals
				discovered by scanners and items you're actively monitoring — organized into collapsible
				sections grouped by scanner.
			</p>
			<p>
				Each item displays three tabs: <strong>Activity</strong> (update timeline),
				<strong>Overview</strong> (metadata, people, links), and <strong>Monitor</strong> (schedule and signal controls).
			</p>
			<p>Item actions include: Track/Untrack, Mark as Seen, Snooze, Archive, Pop Out, and Delete.</p>
			<p>
				A filter bar lets you switch between <strong>All</strong> (active items) and
				<strong>Archived</strong> (completed/archived items). A density toggle switches between
				card view and compact list view.
			</p>

			<!-- Scanners -->
			<h2 id="scanners">Scanners</h2>
			<img
				src="{base}/screenshots/08-scanner-section-header-dark.png"
				alt="Scanner section header"
			/>
			<p>
				Scanners are the heart of FlightDeck's Radar. Each scanner is a named, scheduled AI scan
				that searches your M365 signals for specific topics.
			</p>
			<p>Each scanner section header shows:</p>
			<ul>
				<li>Scanner name and item count</li>
				<li>Severity dots — clickable to filter</li>
				<li>Attention badges and new indicators</li>
				<li>Next run countdown</li>
				<li>Action buttons: add (+), run now (⚡), pause (⏸), settings (⚙️), collapse (▾)</li>
			</ul>

			<h3>Adding a Scanner</h3>
			<img
				src="{base}/screenshots/11-add-task-modal-dark.png"
				alt="Add scanner modal"
			/>
			<p>Click <strong>+ Scanner</strong> at the top of the Radar view. Configure:</p>
			<table>
				<thead>
					<tr>
						<th>Field</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					<tr><td><strong>Name</strong></td><td>A descriptive label (e.g., "Competitor Intel")</td></tr>
					<tr><td><strong>Schedule</strong></td><td>Interval (15m–4h), Scheduled, or One-time</td></tr>
					<tr><td><strong>Prompt</strong></td><td>AI instructions — what signals to look for</td></tr>
				</tbody>
			</table>
			<p>
				Additional options: signal types, work hours only, run on startup, missed run policy,
				auto-monitor, notification mode, max items, dedup strategy, exclude keywords, auto-archive,
				retention, and webhook URL.
			</p>

			<h3>Scanner Settings</h3>
			<img
				src="{base}/screenshots/10-scanner-settings-modal-dark.png"
				alt="Scanner settings modal"
			/>
			<p>
				Click the <strong>⚙️ gear icon</strong> in any scanner's header to edit its settings.
				You can also pause/resume, run immediately, or delete a scanner.
			</p>

			<!-- Tracked Items -->
			<h2 id="tracked-items">Tracked Items & Monitoring</h2>
			<img
				src="{base}/screenshots/04-tracker-card-updated-dark.png"
				alt="Tracked item with update badge"
			/>
			<p>
				Click <strong>Track Item</strong> to promote any item to active monitoring. FlightDeck
				re-scans periodically and notifies you when something meaningful changes.
			</p>
			<p>Monitored items show a "Monitored" badge and offer:</p>
			<ul>
				<li><strong>NEW UPDATE badge</strong> — When a meaningful change is detected</li>
				<li><strong>Activity timeline</strong> — Progression of changes over time</li>
				<li><strong>Schedule configuration</strong> — Interval, Scheduled, or One-time checks</li>
				<li><strong>Signal selection</strong> — Toggle Email, Chat, Meetings, Documents</li>
				<li><strong>Custom monitoring prompt</strong> — Fine-tune what to look for</li>
			</ul>

			<h3>Lifecycle Statuses</h3>
			<table>
				<thead>
					<tr><th>Status</th><th>Meaning</th></tr>
				</thead>
				<tbody>
					<tr><td><strong>In Progress</strong></td><td>Active item being monitored</td></tr>
					<tr><td><strong>Blocked</strong></td><td>Stalled — detected from AI status reports</td></tr>
					<tr><td><strong>Waiting</strong></td><td>Pending external input</td></tr>
					<tr><td><strong>Snoozed</strong></td><td>Temporarily hidden; auto-un-snoozes later</td></tr>
					<tr><td><strong>Complete</strong></td><td>Resolved — monitoring auto-disables</td></tr>
					<tr><td><strong>Archived</strong></td><td>Cold storage for reference</td></tr>
				</tbody>
			</table>

			<!-- Briefings -->
			<h2 id="briefings">Briefings</h2>
			<img
				src="{base}/screenshots/05-briefings-view-dark.png"
				alt="Briefings view"
				class="screenshot-glow"
			/>
			<p>
				The Briefings view generates AI-powered meeting preparation and a daily overview.
			</p>

			<h3>My Day Briefing</h3>
			<p>The <strong>☀️ My Day</strong> briefing at the top gives you a comprehensive daily overview:</p>
			<ul>
				<li><strong>Headline</strong> — A one-line summary of your day</li>
				<li><strong>Top Priorities</strong> — The most important things to address</li>
				<li><strong>Meetings Requiring Prep</strong> — Meetings with complex agendas or risks</li>
				<li><strong>At-Risk Items</strong> — Critical-severity items that could escalate</li>
				<li><strong>Suggested Time Blocks</strong> — AI-recommended schedule</li>
				<li><strong>Follow-Ups</strong> — Actions to take after meetings</li>
			</ul>

			<h3>Meeting Briefings</h3>
			<p>
				Each upcoming meeting shows a <strong class="!text-[#30d158]">Briefed</strong> or
				<strong class="!text-[#ff9f0a]">Unbriefed</strong> badge. Expand to see the full briefing:
				headline, key updates, decisions needed, top risks, talk track, follow-ups, and sources.
			</p>

			<!-- History -->
			<h2 id="history">History</h2>
			<img
				src="{base}/screenshots/07-history-view-dark.png"
				alt="History view"
			/>
			<p>
				A chronological audit trail of everything FlightDeck has done — every scan, recommendation,
				and system event. Entries are color-coded by type: STARTUP, SCAN, and RECOMMENDATION.
			</p>

			<!-- Search -->
			<h2 id="search">Search</h2>
			<p>
				Press <code>Ctrl+K</code> to activate global search. Type to instantly filter across radar
				items, tracked tasks, and briefings. Results use fuzzy matching — multi-word queries match
				when all words appear somewhere in the item.
			</p>

			<!-- Keyboard Shortcuts -->
			<h2 id="keyboard-shortcuts">Keyboard Shortcuts</h2>
			<table>
				<thead>
					<tr><th>Shortcut</th><th>Action</th></tr>
				</thead>
				<tbody>
					<tr><td><code>Ctrl+K</code></td><td>Open global search</td></tr>
					<tr><td><code>Ctrl+R</code></td><td>Refresh current view</td></tr>
					<tr><td><code>Esc</code></td><td>Close search / dismiss popups</td></tr>
				</tbody>
			</table>

			<!-- System Tray -->
			<h2 id="system-tray">System Tray</h2>
			<p>
				FlightDeck runs in the system tray when minimized. Monitoring continues in the background —
				you'll receive desktop notifications when tracked items change. Click the tray icon to
				restore, right-click for options.
			</p>

			<!-- Demo Mode -->
			<h2 id="demo-mode">Demo Mode</h2>
			<p>
				FlightDeck includes demo mode for presentations and exploring without a Microsoft 365 connection.
			</p>
			<pre><code>npm run demo          # Launch with sample data
npm run demo:reseed   # Launch with fresh sample data</code></pre>
			<p>
				Demo mode loads realistic sample data, never calls WorkIQ, and uses a separate data store
				so your real data is never touched. Run <code>npm run screenshots</code> to capture all
				views in both themes.
			</p>
		</article>
	</div>
</div>
