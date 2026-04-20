<script>
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import ThemeToggle from './ThemeToggle.svelte';

	let { darkMode = $bindable(true) } = $props();
	let scrolled = $state(false);

	$effect(() => {
		const handler = () => { scrolled = window.scrollY > 20; };
		window.addEventListener('scroll', handler, { passive: true });
		return () => window.removeEventListener('scroll', handler);
	});
</script>

<nav
	class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 {scrolled
		? 'bg-[#09090b]/80 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/10'
		: 'bg-transparent'}"
>
	<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
		<a href="{base}/" class="flex items-center gap-2.5 text-white no-underline">
			<span class="text-xl">✈</span>
			<span class="text-lg font-semibold tracking-tight">FlightDeck</span>
		</a>

		<div class="flex items-center gap-8">
			<a href="{base}/#features" class="text-sm text-white/60 transition-colors duration-200 hover:text-white no-underline">Features</a>
			<a href="{base}/docs" class="text-sm text-white/60 transition-colors duration-200 hover:text-white no-underline">Docs</a>
			<a href="https://github.com/kpoineal/FlightDeck/releases" class="text-sm text-white/60 transition-colors duration-200 hover:text-white no-underline" target="_blank" rel="noopener">Download</a>
			<ThemeToggle bind:darkMode />
		</div>
	</div>
</nav>
