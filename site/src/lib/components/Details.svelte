<script>
	import { base } from '$app/paths';
	import { darkMode } from '$lib/theme.js';

	let sectionEl = $state(null);
	let visible = $state(false);
	let theme = $state('dark');

	$effect(() => {
		const unsub = darkMode.subscribe(v => { theme = v ? 'dark' : 'light'; });
		return unsub;
	});

	$effect(() => {
		if (!sectionEl) return;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.1 }
		);
		observer.observe(sectionEl);
		return () => observer.disconnect();
	});

	const details = [
		{
			title: 'Smart Scanners',
			description: 'Create named, scheduled AI scanners that continuously search your Microsoft 365 for specific topics. Configure signal types, schedules, dedup strategies, and notification preferences.',
			screenshot: '08-scanner-section-header',
			reverse: false
		},
		{
			title: 'Automatic Status Tracking',
			description: 'FlightDeck continuously triages your items — automatically detecting when something becomes blocked, is waiting on someone else, or is complete. Define "done" criteria and the AI watches for the signals that match, updating status and disabling monitoring when the job is finished.',
			screenshot: '04-tracker-card-updated',
			reverse: true
		},
		{
			title: 'Full History',
			description: 'Every scan, every recommendation, every system event — timestamped and searchable. The complete audit trail of your work signals, always available.',
			screenshot: '07-history-view',
			reverse: true
		},
		{
			title: 'System Tray & Pop-outs',
			description: 'Minimize to the system tray and keep monitoring in the background. Pop out individual items into dedicated windows for deep-dive tracking alongside your other work.',
			screenshot: '04-tracker-card-updated',
			reverse: false
		}
	];
</script>

<section bind:this={sectionEl} class="py-24 md:py-32">
	<div class="mx-auto max-w-6xl px-6">
		<div class="text-center mb-20">
			<p class="text-sm font-semibold uppercase tracking-wider text-[#0a84ff] mb-3">Deep dive</p>
			<h2 class="text-3xl md:text-5xl font-bold tracking-tight">Designed for focus.</h2>
		</div>

		<div class="space-y-24 md:space-y-32">
			{#each details as detail, i}
				<div
					class="flex flex-col gap-12 md:gap-16 items-center {detail.reverse ? 'md:flex-row-reverse' : 'md:flex-row'}"
					class:opacity-0={!visible}
					class:translate-y-8={!visible}
					class:opacity-100={visible}
					class:translate-y-0={visible}
					style="transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1) {i * 200}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) {i * 200}ms"
				>
					<div class="flex-1">
						<h3 class="text-2xl md:text-3xl font-semibold mb-4">{detail.title}</h3>
						<p class="text-themed-muted leading-relaxed text-lg">{detail.description}</p>
					</div>
					<div class="flex-1">
						<div class="overflow-hidden rounded-2xl screenshot-border">
							<img
								src="{base}/screenshots/{detail.screenshot}-{theme}.png"
								alt="FlightDeck — {detail.title}"
								class="w-full screenshot-glow"
							/>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>
