<script>
	import { base } from '$app/paths';
</script>

<footer class="border-t border-white/10 bg-[#09090b] py-16">
	<div class="mx-auto max-w-6xl px-6">
		<div class="grid grid-cols-1 gap-12 md:grid-cols-4">
			<div class="md:col-span-2">
				<div class="flex items-center gap-2.5 mb-4">
					<span class="text-xl">✈</span>
					<span class="text-lg font-semibold tracking-tight text-white">FlightDeck</span>
				</div>
				<p class="text-sm text-white/50 leading-relaxed max-w-sm">
					Your personal work radar. Scans Microsoft 365 and surfaces what needs your attention — prioritized, monitored, briefed.
				</p>
			</div>

			<div>
				<h4 class="text-xs font-semibold uppercase tracking-wider text-white/30 mb-4">Project</h4>
				<ul class="space-y-2.5">
					<li><a href="https://github.com/kpoineal/FlightDeck" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">GitHub</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/releases" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">Releases</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/CHANGELOG.md" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">Changelog</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/LICENSE" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">License (Apache 2.0)</a></li>
				</ul>
			</div>

			<div>
				<h4 class="text-xs font-semibold uppercase tracking-wider text-white/30 mb-4">Resources</h4>
				<ul class="space-y-2.5">
					<li><a href="{base}/docs" class="text-sm text-white/50 hover:text-white transition-colors no-underline">User Guide</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/CONTRIBUTING.md" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">Contributing</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/issues" class="text-sm text-white/50 hover:text-white transition-colors no-underline" target="_blank" rel="noopener">Issues</a></li>
				</ul>
			</div>
		</div>

		<div class="mt-12 pt-8 border-t border-white/5 text-center">
			<p class="text-xs text-white/30">
				Built with Electron + Svelte. Open source under the Apache 2.0 license.
			</p>
		</div>
	</div>
</footer>
