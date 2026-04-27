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
</script>

<svelte:head>
	<title>Privacy — FlightDeck</title>
	<meta name="description" content="FlightDeck privacy policy — how we handle your data (we don't collect any)." />
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
			<p class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-3">Privacy</p>
			<h1 class="text-4xl md:text-5xl font-bold tracking-tight mb-4">Your data stays yours.</h1>
			<p class="text-lg text-themed-muted">FlightDeck is a local-first desktop app. We don't collect, store, or transmit your personal data.</p>
		</div>

		<!-- No Data Collection -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 100ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">What we collect</h2>
			<div class="rounded-2xl card-themed p-6">
				<p class="text-lg font-semibold mb-2">Nothing.</p>
				<p class="text-themed-muted leading-relaxed">
					FlightDeck does not collect any personal information, usage analytics, telemetry, or crash reports.
					There are no accounts, no sign-ups, and no tracking of any kind.
				</p>
			</div>
		</section>

		<!-- Local Storage -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 200ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">Where your data lives</h2>
			<div class="rounded-2xl card-themed p-6 space-y-4">
				<p class="text-themed-muted leading-relaxed">
					All data FlightDeck works with — tracked items, briefings, scanner configurations, and preferences — is stored
					<strong class="text-themed">locally on your machine</strong> in your operating system's standard application data directory.
				</p>
				<p class="text-themed-muted leading-relaxed">
					Nothing is sent to our servers because we don't have any. FlightDeck is an open-source desktop application that runs entirely on your computer.
				</p>
			</div>
		</section>

		<!-- Microsoft 365 Connection -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 300ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">Microsoft 365 connection</h2>
			<div class="rounded-2xl card-themed p-6 space-y-4">
				<p class="text-themed-muted leading-relaxed">
					FlightDeck connects to Microsoft 365 through the <strong class="text-themed">WorkIQ CLI</strong>.
					FlightDeck itself does not ask for your credentials, manage authentication, or handle tokens directly.
				</p>
				<p class="text-themed-muted leading-relaxed">
					All authentication and Microsoft Graph API access is handled entirely by the WorkIQ CLI, which authenticates
					with Microsoft's identity platform using OAuth 2.0 and delegated permissions to read your emails, calendar events,
					and chat messages on your behalf.
				</p>
				<p class="text-themed-muted leading-relaxed">
					Your Microsoft 365 credentials are never seen or stored by FlightDeck. Data retrieved from Microsoft 365 is
					processed locally on your device and is never transmitted to any third party.
				</p>
			</div>
		</section>

		<!-- AI Processing -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 400ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">AI processing</h2>
			<div class="rounded-2xl card-themed p-6 space-y-4">
				<p class="text-themed-muted leading-relaxed">
					FlightDeck uses AI to generate briefings, prioritize items, and scan for actionable work. AI features are powered
					by the <strong class="text-themed">WorkIQ CLI</strong>, which uses Copilot as its backend.
				</p>
				<p class="text-themed-muted leading-relaxed">
					FlightDeck does not store API keys or connect to third-party AI services.
					All AI interactions are handled through your existing Copilot subscription.
				</p>
			</div>
		</section>

		<!-- Third Parties -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 500ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">Third parties</h2>
			<div class="rounded-2xl card-themed p-6 space-y-4">
				<p class="text-themed-muted leading-relaxed">
					FlightDeck does not share, sell, or transmit your data to any third party. The only external services FlightDeck
					communicates with are the ones you explicitly configure: Microsoft 365 (for work data) and your AI provider (for
					briefings and scanning).
				</p>
			</div>
		</section>

		<!-- Website -->
		<section
			class="mb-12 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 600ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">This website</h2>
			<div class="rounded-2xl card-themed p-6 space-y-4">
				<p class="text-themed-muted leading-relaxed">
					This website is a static site hosted on GitHub Pages. It does not use cookies, analytics, or any form of tracking.
					GitHub Pages may collect basic server logs as described in
					<a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" class="text-[#0a84ff] hover:underline" target="_blank" rel="noopener">GitHub's Privacy Statement</a>.
				</p>
			</div>
		</section>

		<!-- Contact -->
		<section
			class="mb-16 transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 700ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<h2 class="text-xs font-semibold uppercase tracking-widest text-[#0a84ff] mb-6">Questions?</h2>
			<div class="rounded-2xl card-themed p-6">
				<p class="text-themed-muted leading-relaxed">
					If you have questions about this privacy policy, please
					<a href="https://github.com/kpoineal/FlightDeck/issues" class="text-[#0a84ff] hover:underline" target="_blank" rel="noopener">open an issue</a>
					on GitHub.
				</p>
			</div>
		</section>

		<!-- Back link -->
		<div
			class="text-center transition-all duration-700"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 800ms"
			class:opacity-0={!visible}
			class:translate-y-8={!visible}
			class:opacity-100={visible}
			class:translate-y-0={visible}
		>
			<a href="{base}/" class="text-sm text-[#0a84ff] hover:underline no-underline">← Back to FlightDeck</a>
		</div>
	</div>
</div>
