<script>
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { darkMode } from '$lib/theme.js';

	let { children } = $props();
	let dark = $state(true);

	$effect(() => {
		darkMode.set(dark);
	});
</script>

<Nav bind:darkMode={dark} />

<main class="min-h-screen">
	{@render children()}
</main>

<Footer />
