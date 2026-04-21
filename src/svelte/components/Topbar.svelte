<script>
  import { mode, connected, loading, highlightedItemId, filter, items, scanners, collapsedSections, activeOperations } from '../lib/stores.js';
  import { setMode } from '../lib/actions.js';
  import SearchOverlay from './SearchOverlay.svelte';
  import iconUrl from '../../icon.png';
  import { get } from 'svelte/store';

  let { version = '', updateAvailable = false, updateText = 'Update available', updateUrl = '', onupdatedismiss } = $props();

  let updateDismissed = $state(false);

  function handleModeClick(m) {
    setMode(m);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('fd-theme', next);
  }

  function dismissUpdate() {
    updateDismissed = true;
    onupdatedismiss?.();
  }

  function handleSearchNavigate(data) {
    const { type, id } = data;
    if (type === 'briefing') {
      setMode('Briefings');
    } else {
      filter.set('all');
      setMode('Radar');

      // Expand the scanner section containing this item
      const targetItem = get(items).find(i => i.id === id);
      if (targetItem && targetItem.scannerId) {
        const sectionId = `scanner-${targetItem.scannerId}`;
        const allSectionIds = get(scanners).map(s => `scanner-${s.id}`);
        collapsedSections.set(allSectionIds.filter(sid => sid !== sectionId));
      }

      // Highlight and scroll to item
      setTimeout(() => {
        highlightedItemId.set(id);
        setTimeout(() => highlightedItemId.set(null), 4000);
      }, 100);
    }
  }

  let activeCount = $derived($activeOperations.size);
  let statusLabel = $derived(
    activeCount > 1 ? `${activeCount} active` :
    activeCount === 1 ? 'Scanning\u2026' :
    $connected ? 'Connected' : 'Ready'
  );
  let statusClass = $derived(activeCount > 0 ? 'loading' : ($connected ? 'connected' : ''));
</script>

<header class="topbar">
  <div class="brand">
    <img class="brand-logo" src={iconUrl} alt="FlightDeck logo" />
    <span class="brand-name">FLIGHT<span class="brand-accent">DECK</span></span>
    {#if version}
      <span class="version-badge visible">v{version}</span>
    {/if}
    {#if updateAvailable && !updateDismissed}
      <span class="update-indicator">
        <span class="update-dot"></span>
        <span class="update-tooltip">
          <span>{updateText}</span>
          <span class="update-actions">
            {#if updateUrl}
              <a class="update-link" href={updateUrl} target="_blank" rel="noopener noreferrer">View release &#8599;</a>
            {/if}
            <button class="update-dismiss" title="Dismiss" on:click={dismissUpdate}>&times;</button>
          </span>
        </span>
      </span>
    {/if}
  </div>

  <SearchOverlay onnavigate={handleSearchNavigate} />

  <div class="topbar-tabs">
    <button class="mode-btn" class:active={$mode === 'Radar'}
      on:click={() => handleModeClick('Radar')}>Radar</button>
    <button class="mode-btn" class:active={$mode === 'Briefings'}
      on:click={() => handleModeClick('Briefings')}>Briefings</button>
    <button class="mode-btn" class:active={$mode === 'History'}
      on:click={() => handleModeClick('History')}>History</button>
  </div>

  <div class="topbar-controls">
    <span class="status-pill {statusClass}">{statusLabel}</span>
    <button class="theme-toggle" title="Toggle light/dark theme" aria-label="Toggle theme"
      on:click={toggleTheme}>
      <svg class="theme-icon sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
      <svg class="theme-icon moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>
  </div>
</header>
