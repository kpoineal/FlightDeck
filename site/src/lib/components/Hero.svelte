<script>
	import { base } from '$app/paths';
	import { fly } from 'svelte/transition';
	import { getDownloadUrls } from '$lib/downloads.svelte.js';

	let visible = $state(false);
	const urls = getDownloadUrls();

	$effect(() => {
		visible = true;
	});
</script>

<section class="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
	<!-- Gradient background -->
	<div class="absolute inset-0 bg-gradient-to-b from-[#0a84ff]/5 via-transparent to-transparent pointer-events-none"></div>
	<div class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#0a84ff]/5 rounded-full blur-[120px] pointer-events-none"></div>

	<div class="relative z-10 mx-auto max-w-6xl px-6 py-24 text-center">
		{#if visible}
			<div in:fly={{ y: 30, duration: 800, easing: (t) => 1 - Math.pow(1 - t, 4) }}>
				<h1 class="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
					Your personal<br />
					<span class="bg-gradient-to-r from-[#0a84ff] to-[#64d2ff] bg-clip-text text-transparent">work radar.</span>
				</h1>
			</div>

			<div in:fly={{ y: 30, duration: 800, delay: 150, easing: (t) => 1 - Math.pow(1 - t, 4) }}>
				<p class="mx-auto max-w-2xl text-lg md:text-xl text-themed-muted leading-relaxed mb-10">
					FlightDeck scans your Microsoft 365 — email, Teams, meetings, docs — and surfaces what needs your attention. Prioritized. Monitored. Briefed.
				</p>
			</div>

			<div in:fly={{ y: 30, duration: 800, delay: 300, easing: (t) => 1 - Math.pow(1 - t, 4) }} class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
				<a
					href={urls.msi ?? urls.fallback}
					class="inline-flex items-center gap-2 rounded-full bg-[#0a84ff] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#0a84ff]/25 transition-all duration-300 hover:shadow-xl hover:shadow-[#0a84ff]/30 hover:bg-[#0a84ff]/90 no-underline"
					target="_blank"
					rel="noopener"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
					</svg>
					Download for Windows
				</a>
				<a
					href="https://github.com/kpoineal/FlightDeck"
					class="text-sm text-themed-muted hover:text-themed transition-colors no-underline"
					target="_blank"
					rel="noopener"
				>
					View on GitHub →
				</a>
			</div>

			<div in:fly={{ y: 40, duration: 1000, delay: 500, easing: (t) => 1 - Math.pow(1 - t, 4) }} class="relative mx-auto max-w-4xl">
				<div class="absolute inset-0 bg-[#0a84ff]/10 rounded-2xl blur-[60px] -z-10"></div>
				<img
					src="{base}/screenshots/01-radar-view-dark.png"
					alt="FlightDeck Radar View — prioritized inbound signals"
					class="w-full rounded-2xl screenshot-border shadow-2xl shadow-black/50 screenshot-glow"
				/>
			</div>
		{/if}
	</div>
</section>
