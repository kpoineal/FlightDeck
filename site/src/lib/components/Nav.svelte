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
		? 'nav-scrolled'
		: 'bg-transparent'}"
>
	<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
		<a href="{base}/" class="flex shrink-0 items-center gap-2 sm:gap-2.5 no-underline">
			<img src="{base}/icon.png" alt="" class="h-7 w-7" />
			{#if darkMode}
				<img src="{base}/flightdeck-title-dark.svg" alt="FlightDeck" class="h-5" />
			{:else}
				<img src="{base}/flightdeck-title-light.svg" alt="FlightDeck" class="h-5" />
			{/if}
		</a>

		<div class="flex items-center gap-3 sm:gap-8">
			<a href="{base}/#features" class="text-xs sm:text-sm text-themed-muted transition-colors duration-200 hover:text-themed no-underline">Features</a>
			<a href="{base}/docs" class="text-xs sm:text-sm text-themed-muted transition-colors duration-200 hover:text-themed no-underline">Docs</a>
			<a href="https://github.com/kpoineal/FlightDeck/releases" class="text-xs sm:text-sm text-themed-muted transition-colors duration-200 hover:text-themed no-underline" target="_blank" rel="noopener">Download</a>
			<ThemeToggle bind:darkMode />
		</div>
	</div>
</nav>
