<script>
	import { getDownloadUrls } from '$lib/downloads.svelte.js';

	let sectionEl = $state(null);
	let visible = $state(false);
	const urls = getDownloadUrls();

	$effect(() => {
		if (!sectionEl) return;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.2 }
		);
		observer.observe(sectionEl);
		return () => observer.disconnect();
	});
</script>

<section bind:this={sectionEl} class="relative py-24 md:py-32">
	<div class="absolute inset-0 bg-gradient-to-t from-[#0a84ff]/[0.04] to-transparent pointer-events-none"></div>

	<div
		class="relative mx-auto max-w-4xl px-6 text-center"
		class:opacity-0={!visible}
		class:translate-y-8={!visible}
		class:opacity-100={visible}
		class:translate-y-0={visible}
		style="transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)"
	>
		<h2 class="text-3xl md:text-5xl font-bold tracking-tight mb-4">Ready for takeoff?</h2>
		<p class="text-lg text-themed-muted mb-12">Get FlightDeck on your machine in seconds.</p>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
			<!-- Windows -->
			<div class="rounded-2xl card-themed p-6">
				<div class="flex items-center gap-2 mb-4">
					<span class="text-lg">🪟</span>
					<h3 class="text-sm font-semibold uppercase tracking-wider">Windows</h3>
				</div>
				<div class="rounded-lg code-themed p-3 font-mono text-sm">
					<span class="opacity-30 select-none">❯ </span>winget install FlightDeck.FlightDeck
				</div>
			</div>

			<!-- macOS -->
			<div class="rounded-2xl card-themed p-6">
				<div class="flex items-center gap-2 mb-4">
					<span class="text-lg">🍎</span>
					<h3 class="text-sm font-semibold uppercase tracking-wider">macOS</h3>
				</div>
				<a
					href={urls.dmg ?? urls.fallback}
					class="inline-flex items-center gap-2 text-sm text-[#0a84ff] hover:text-[#64d2ff] transition-colors no-underline"
					target="_blank"
					rel="noopener"
				>
					Download DMG →
				</a>
			</div>

			<!-- Source -->
			<div class="rounded-2xl card-themed p-6">
				<div class="flex items-center gap-2 mb-4">
					<span class="text-lg">🛠</span>
					<h3 class="text-sm font-semibold uppercase tracking-wider">From source</h3>
				</div>
				<div class="rounded-lg code-themed p-3 font-mono text-xs space-y-1">
					<div><span class="opacity-30 select-none">❯ </span>git clone …FlightDeck</div>
					<div><span class="opacity-30 select-none">❯ </span>npm install && npm start</div>
				</div>
			</div>
		</div>

		<div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
			<a
				href={urls.msi ?? urls.fallback}
				class="inline-flex items-center gap-2 rounded-full bg-[#0a84ff] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#0a84ff]/25 transition-all duration-300 hover:shadow-xl hover:shadow-[#0a84ff]/30 hover:bg-[#0a84ff]/90 no-underline"
				target="_blank"
				rel="noopener"
			>
				Download Latest Release
			</a>
			<a
				href="https://github.com/kpoineal/FlightDeck"
				class="text-sm text-themed-muted hover:text-themed transition-colors no-underline"
				target="_blank"
				rel="noopener"
			>
				Star on GitHub ★
			</a>
		</div>
	</div>
</section>
