<script>
	import { base } from '$app/paths';
</script>

<footer class="footer-themed py-16">
	<div class="mx-auto max-w-6xl px-6">
		<div class="grid grid-cols-1 gap-12 md:grid-cols-4">
			<div class="md:col-span-2">
				<div class="flex items-center gap-2.5 mb-4">
					<img src="{base}/icon.png" alt="" class="h-6 w-6" />
					<span class="text-lg font-bold tracking-widest"><span class="text-themed">FLIGHT</span><span class="text-[#0a84ff]">DECK</span></span>
				</div>
				<p class="text-sm text-themed-muted leading-relaxed max-w-sm">
					Your personal work radar. Scans Microsoft 365 and surfaces what needs your attention — prioritized, monitored, briefed.
				</p>
			</div>

			<div>
				<h4 class="text-xs font-semibold uppercase tracking-wider text-themed-dim mb-4">Project</h4>
				<ul class="space-y-2.5">
					<li><a href="https://github.com/kpoineal/FlightDeck" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">GitHub</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/releases" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">Releases</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/CHANGELOG.md" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">Changelog</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/LICENSE" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">License (Apache 2.0)</a></li>
				</ul>
			</div>

			<div>
				<h4 class="text-xs font-semibold uppercase tracking-wider text-themed-dim mb-4">Resources</h4>
				<ul class="space-y-2.5">
					<li><a href="{base}/docs" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline">User Guide</a></li>
					<li><a href="{base}/requirements" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline">Requirements</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/blob/main/CONTRIBUTING.md" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">Contributing</a></li>
					<li><a href="https://github.com/kpoineal/FlightDeck/issues" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline" target="_blank" rel="noopener">Issues</a></li>
					<li><a href="{base}/privacy" class="text-sm text-themed-muted hover:text-themed transition-colors no-underline">Privacy</a></li>
				</ul>
			</div>
		</div>

		<div class="mt-12 pt-8 border-t border-themed text-center">
			<p class="text-xs text-themed-dim">
				Built with Electron + Svelte. Open source under the Apache 2.0 license.
			</p>
		</div>
	</div>
</footer>
