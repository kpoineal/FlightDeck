<script>
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children } = $props();
	let darkMode = $state(true);
</script>

<Nav bind:darkMode />

<main class="min-h-screen">
	{@render children()}
</main>

<Footer />
