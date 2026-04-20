<script>
	let sectionEl = $state(null);
	let visible = $state(false);

	$effect(() => {
		if (!sectionEl) return;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.2 }
		);
		observer.observe(sectionEl);
		return () => observer.disconnect();
	});

	const steps = [
		{
			number: '1',
			title: 'Connect',
			description: 'Link your Microsoft 365 in one click. FlightDeck handles the authentication — no terminal commands needed.'
		},
		{
			number: '2',
			title: 'Scan',
			description: 'AI-powered scanners run on your schedule, searching email, Teams, meetings, and docs for signals that matter.'
		},
		{
			number: '3',
			title: 'Act',
			description: 'Track items, monitor for changes, and get AI briefings — automatically. Walk into every meeting prepared.'
		}
	];
</script>

<section bind:this={sectionEl} class="relative py-24 md:py-32">
	<div class="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a84ff]/[0.03] to-transparent pointer-events-none"></div>

	<div class="relative mx-auto max-w-4xl px-6">
		<div class="text-center mb-16">
			<p class="text-sm font-semibold uppercase tracking-wider text-[#0a84ff] mb-3">How it works</p>
			<h2 class="text-3xl md:text-5xl font-bold tracking-tight">Three steps to clarity.</h2>
		</div>

		<div class="relative">
			<!-- Connector line -->
			<div class="absolute left-6 top-6 bottom-6 w-px bg-gradient-to-b from-[#0a84ff]/50 via-[#0a84ff]/20 to-transparent hidden md:block"></div>

			<div class="space-y-12 md:space-y-16">
				{#each steps as step, i}
					<div
						class="flex items-start gap-6 md:gap-8"
						class:opacity-0={!visible}
						class:translate-y-8={!visible}
						class:opacity-100={visible}
						class:translate-y-0={visible}
						style="transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1) {i * 200}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) {i * 200}ms"
					>
						<div class="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#0a84ff]/30 bg-[#0a84ff]/10 text-[#0a84ff] font-bold text-lg">
							{step.number}
						</div>
						<div>
							<h3 class="text-xl font-semibold mb-2">{step.title}</h3>
							<p class="text-themed-muted leading-relaxed">{step.description}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</section>
