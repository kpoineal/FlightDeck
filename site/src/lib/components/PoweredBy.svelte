<script>
	let sectionEl = $state(null);
	let visible = $state(false);

	$effect(() => {
		if (!sectionEl) return;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.15 }
		);
		observer.observe(sectionEl);
		return () => observer.disconnect();
	});

	const cards = [
		{
			icon: '✦',
			title: 'GitHub Copilot',
			description: 'The AI engine behind every scan, briefing, and recommendation. A Copilot license is required.',
			linkText: 'Get Copilot →',
			linkHref: 'https://github.com/features/copilot'
		},
		{
			icon: '⚡',
			title: 'WorkIQ',
			description: 'Connects FlightDeck to your Microsoft 365 — email, Teams, calendar, and docs. WorkIQ must be enabled in your tenant.',
			linkText: 'Learn about WorkIQ →',
			linkHref: 'https://learn.microsoft.com/microsoft-365-copilot/microsoft-365-copilot-overview'
		}
	];
</script>

<section id="powered-by" bind:this={sectionEl} class="relative py-16 md:py-20">
	<div class="mx-auto max-w-3xl px-6">
		<div class="text-center mb-10">
			<p class="text-sm font-semibold uppercase tracking-wider text-[#0a84ff] mb-3">Powered By</p>
			<h2 class="text-3xl md:text-4xl font-bold tracking-tight">Built on tools you already use.</h2>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
			{#each cards as card, i}
				<div
					class="rounded-2xl card-themed p-6 transition-all duration-500"
					style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: {i * 150}ms"
					class:opacity-0={!visible}
					class:translate-y-8={!visible}
					class:opacity-100={visible}
					class:translate-y-0={visible}
				>
					<div class="text-3xl mb-4">{card.icon}</div>
					<h3 class="text-xl font-semibold mb-2">{card.title}</h3>
					<p class="text-sm text-themed-muted leading-relaxed mb-4">{card.description}</p>
					<a
						href={card.linkHref}
						target="_blank"
						rel="noopener"
						class="text-sm font-medium text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors"
					>
						{card.linkText}
					</a>
				</div>
			{/each}
		</div>

		<p
			class="text-center text-sm text-themed-muted mt-8 transition-all duration-500"
			style="transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); transition-delay: 300ms"
			class:opacity-0={!visible}
			class:opacity-100={visible}
		>
			FlightDeck ships with the WorkIQ CLI built in. Just install and go.
		</p>
	</div>
</section>
