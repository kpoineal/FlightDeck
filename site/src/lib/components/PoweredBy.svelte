<script>
	import { base } from '$app/paths';

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
			title: 'Microsoft 365 Copilot',
			description: 'The AI engine behind every scan, briefing, and recommendation. A Copilot Premium license is required.',
			linkText: 'Learn about M365 Copilot →',
			linkHref: 'https://www.microsoft.com/en-us/microsoft-365/copilot'
		},
		{
			title: 'WorkIQ CLI',
			description: 'Connects FlightDeck to your Microsoft 365 — email, Teams, calendar, and docs. Must be enabled by your tenant admin.',
			linkText: 'Enable WorkIQ CLI →',
			linkHref: 'https://www.npmjs.com/package/@microsoft/workiq#admin-setup'
		}
	];
</script>

<section id="powered-by" bind:this={sectionEl} class="relative py-16 md:py-20">
	<div class="mx-auto max-w-3xl px-6">
		<div class="text-center mb-10">
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
					<div class="mb-4">
						{#if i === 0}
							<!-- Copilot sparkle icon -->
							<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="url(#copilot-gradient)"/>
								<path d="M19 2L19.9 4.1L22 5L19.9 5.9L19 8L18.1 5.9L16 5L18.1 4.1L19 2Z" fill="#64d2ff" opacity="0.7"/>
								<defs>
									<linearGradient id="copilot-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
										<stop stop-color="#0a84ff"/>
										<stop offset="1" stop-color="#64d2ff"/>
									</linearGradient>
								</defs>
							</svg>
						{:else}
							<span class="text-3xl">⚡</span>
						{/if}
					</div>
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
			FlightDeck ships with the WorkIQ CLI built in. <a href="{base}/requirements" class="text-[#0a84ff] no-underline hover:text-[#64d2ff] transition-colors font-medium">Check the requirements →</a>
		</p>
	</div>
</section>
