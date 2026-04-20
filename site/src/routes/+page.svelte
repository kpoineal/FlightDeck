<script>
	import Hero from '$lib/components/Hero.svelte';
	import Features from '$lib/components/Features.svelte';
	import HowItWorks from '$lib/components/HowItWorks.svelte';
	import Details from '$lib/components/Details.svelte';
	import Download from '$lib/components/Download.svelte';
</script>

<svelte:head>
	<title>FlightDeck — Your Personal Work Radar</title>
	<meta name="description" content="FlightDeck scans your Microsoft 365 — email, Teams, meetings, docs — and surfaces what needs your attention. Prioritized. Monitored. Briefed." />
</svelte:head>

<Hero />
<Features />
<HowItWorks />
<Details />
<Download />
