<script>
	import { base } from '$app/paths';

	let pageEl = $state(null);
	let visible = $state(false);

	$effect(() => {
		if (!pageEl) return;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.1 }
		);
		observer.observe(pageEl);
		return () => observer.disconnect();
	});

	const platforms = [
		{ emoji: '🪟', name: 'Windows', requirement: 'Windows 10 or later (64-bit)' },
		{ emoji: '🍎', name: 'macOS', requirement: 'macOS 12 Monterey or later' }
	];
</script>

<svelte:head>
	<title>Requirements — FlightDeck</title>
	<meta name="description" content="What you need before installing FlightDeck — platform support, licenses, and software prerequisites." />
</svelte:head>

<div class="pt-20 pb-24" bind:this={pageEl}>
	<div class="mx-auto max-w-4xl px-6">

		<!-- Header -->
		<div
			class="text-center mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1)"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<p class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-3">Requirements</p>
			<h1 class="text-4xl md:text-5xl font-bold tracking-tight mb-4">What you need before installing FlightDeck.</h1>
			<p class="text-lg text-themed-muted">Platform support, licenses, and prerequisites at a glance.</p>
		</div>

		<!-- Platform Support -->
		<section
			class="mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 100ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">Platform</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
				{#each platforms as platform}
					<div class="rounded-2xl card-themed p-6">
						<div class="flex items-center gap-3 mb-2">
							<span class="text-2xl">{platform.emoji}</span>
							<h3 class="text-lg font-semibold">{platform.name}</h3>
						</div>
						<p class="text-sm text-themed-muted">{platform.requirement}</p>
					</div>
				{/each}
			</div>
		</section>

		<!-- Licenses & Access -->
		<section
			class="mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 200ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-3">Licenses &amp; Access</h2>
			<p class="text-sm text-themed-muted mb-6">FlightDeck uses Microsoft 365 Copilot (via the WorkIQ CLI) to scan, summarize, and generate briefings from your M365 data.</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
				<div class="rounded-2xl card-themed p-6">
					<div class="mb-4">
						<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="url(#req-copilot-gradient)"/>
							<path d="M19 2L19.9 4.1L22 5L19.9 5.9L19 8L18.1 5.9L16 5L18.1 4.1L19 2Z" fill="#64d2ff" opacity="0.7"/>
							<defs>
								<linearGradient id="req-copilot-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
									<stop stop-color="#0a84ff"/>
									<stop offset="1" stop-color="#64d2ff"/>
								</linearGradient>
							</defs>
						</svg>
					</div>
					<h3 class="text-xl font-semibold mb-2">Microsoft 365 Copilot Premium</h3>
					<p class="text-sm text-themed-muted leading-relaxed mb-4">FlightDeck uses Copilot to scan, summarize, and generate briefings from your M365 data. A Copilot Premium license is required.</p>
					<a
						href="https://www.microsoft.com/en-us/microsoft-365/copilot"
						target="_blank"
						rel="noopener"
						class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
					>
						Learn about M365 Copilot →
					</a>
				</div>

				<div class="rounded-2xl card-themed p-6">
					<div class="mb-4">
						<span class="text-3xl">⚡</span>
					</div>
					<h3 class="text-xl font-semibold mb-2">WorkIQ CLI (Tenant Enablement)</h3>
					<p class="text-sm text-themed-muted leading-relaxed mb-4">WorkIQ connects FlightDeck to your Microsoft 365 — email, Teams, calendar, and docs. Your tenant admin must grant WorkIQ access to M365 signals.</p>
					<a
						href="https://www.npmjs.com/package/@microsoft/workiq#admin-setup"
						target="_blank"
						rel="noopener"
						class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
					>
						WorkIQ admin setup →
					</a>
				</div>
			</div>
		</section>

		<!-- Software (build from source) -->
		<section
			class="mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 300ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-3">Software</h2>
			<p class="text-sm text-themed-muted mb-6">FlightDeck ships as a standalone app. The following are only needed if building from source.</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
				<div class="rounded-2xl card-themed p-6">
					<h3 class="text-lg font-semibold mb-1">Node.js v18+</h3>
					<p class="text-sm text-themed-muted mb-3">JavaScript runtime required to build and run from source.</p>
					<a
						href="https://nodejs.org"
						target="_blank"
						rel="noopener"
						class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
					>
						nodejs.org →
					</a>
				</div>
				<div class="rounded-2xl card-themed p-6">
					<h3 class="text-lg font-semibold mb-1">Git</h3>
					<p class="text-sm text-themed-muted">Version control — needed to clone the repository.</p>
				</div>
			</div>
		</section>

		<!-- Demo Mode callout -->
		<section
			class="mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 400ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<div class="rounded-2xl bg-[#0a84ff]/[0.06] border border-[#0a84ff]/20 p-8">
				<h3 class="text-xl font-semibold mb-2">No license? Try Demo Mode</h3>
				<p class="text-sm text-themed-muted leading-relaxed mb-4">
					Demo mode loads synthetic fixture data so you can explore FlightDeck without a WorkIQ connection or Copilot license. Just launch with the <code class="code-themed px-1.5 py-0.5 rounded text-xs">--demo</code> flag.
				</p>
				<a
					href="{base}/"
					class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
				>
					Download FlightDeck →
				</a>
			</div>
		</section>

		<!-- Back link -->
		<div
			class="transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 500ms"
			class:opacity-0={!visible}
			class:opacity-100={visible}
		>
			<a
				href="{base}/"
				class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
			>
				← Back to FlightDeck
			</a>
		</div>

	</div>
</div>
