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
			{ threshold: 0.15 }
		);
		observer.observe(sectionEl);
		return () => observer.disconnect();
	});

	const features = [
		{
			icon: '📡',
			title: 'Scan',
			tagline: 'See everything. Miss nothing.',
			description: 'AI-powered scanners continuously monitor your email, Teams chats, meetings, and documents. Every signal surfaces automatically — ranked by urgency.',
			screenshot: '01-radar-view'
		},
		{
			icon: '🎯',
			title: 'Track',
			tagline: 'Set it. Forget it. Get notified.',
			description: 'Promote any item to active monitoring. FlightDeck watches for meaningful changes on your schedule and sends desktop notifications when something moves.',
			screenshot: '03-tracker-card-expanded'
		},
		{
			icon: '📋',
			title: 'Brief',
			tagline: 'Walk into every meeting prepared.',
			description: 'AI-generated briefings pull context from related emails, chats, and documents. Get a daily overview plus per-meeting prep — automatically.',
			screenshot: '05-briefings-view'
		}
	];
</script>

<section id="features" bind:this={sectionEl} class="relative py-24 md:py-32">
	<div class="mx-auto max-w-6xl px-6">
		<div class="text-center mb-16">
			<p class="text-sm font-semibold uppercase tracking-wider text-[#0a84ff] mb-3">Features</p>
			<h2 class="text-3xl md:text-5xl font-bold tracking-tight">Everything surfaces.<br />Nothing slips.</h2>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
			{#each features as feature, i}
				<div
					class="group rounded-2xl card-themed p-6 transition-all duration-500"
					class:opacity-0={!visible}
					class:translate-y-8={!visible}
					class:opacity-100={visible}
					class:translate-y-0={visible}
					style="transition-delay: {i * 150}ms"
				>
					<div class="text-3xl mb-4">{feature.icon}</div>
					<h3 class="text-xl font-semibold mb-1">{feature.title}</h3>
					<p class="text-sm text-[#0a84ff] font-medium mb-3">{feature.tagline}</p>
					<p class="text-sm text-themed-muted leading-relaxed mb-6">{feature.description}</p>
					<div class="overflow-hidden rounded-xl screenshot-border">
						<img
							src="{base}/screenshots/{feature.screenshot}-{theme}.png"
							alt="FlightDeck {feature.title}"
							class="w-full transition-transform duration-500 group-hover:scale-[1.03]"
						/>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>
