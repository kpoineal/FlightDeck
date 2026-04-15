<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { items, meetings, briefingsByMeetingId } from '../lib/stores.js';
  import { escapeHtml } from '../lib/utils.js';

  const dispatch = createEventDispatcher();

  let query = '';
  let results = [];
  let activeIndex = -1;
  let showResults = false;
  let inputEl;
  let resultsEl;
  let debounceTimer = null;

  function fuzzyMatch(text, q) {
    const lower = text.toLowerCase();
    const lq = q.toLowerCase();
    if (lower.includes(lq)) return { match: true, score: lower.indexOf(lq) === 0 ? 2 : 1 };
    const tokens = lq.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => lower.includes(t))) {
      return { match: true, score: 0.5 };
    }
    return { match: false, score: 0 };
  }

  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${qEscaped})`, 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  }

  function gatherSearchItems() {
    const all = [];
    const trackedIds = new Set(($items || []).filter(i => i.tracked).map(i => i.id));

    for (const item of ($items || [])) {
      const isInbound = item.status === 'inbound' || item.status === 'new' || !item.tracked;
      const isTracked = item.tracked === true;
      all.push({
        type: isTracked ? 'tracker' : 'radar',
        id: item.id,
        title: item.title || '',
        meta: [item.severity, item.owner, item.sourceType].filter(Boolean).join(' \u00B7 '),
        summary: item.summary || '',
      });
    }

    for (const meeting of ($meetings || [])) {
      const briefing = ($briefingsByMeetingId || {})[meeting.id];
      all.push({
        type: 'briefing',
        id: meeting.id,
        title: meeting.title || '',
        meta: [meeting.organizer, meeting.startAt ? new Date(meeting.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' \u00B7 '),
        summary: briefing?.headline || '',
      });
    }

    return all;
  }

  function runSearch() {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      closeSearch();
      return;
    }

    const allItems = gatherSearchItems();
    const matches = [];
    for (const item of allItems) {
      const titleMatch = fuzzyMatch(item.title, trimmed);
      const metaMatch = fuzzyMatch(item.meta, trimmed);
      const summaryMatch = fuzzyMatch(item.summary, trimmed);
      const best = Math.max(titleMatch.score, metaMatch.score * 0.8, summaryMatch.score * 0.6);
      if (titleMatch.match || metaMatch.match || summaryMatch.match) {
        matches.push({ ...item, score: best });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    results = matches.slice(0, 20);
    showResults = true;
    activeIndex = results.length ? 0 : -1;
  }

  function closeSearch() {
    showResults = false;
    query = '';
    results = [];
    activeIndex = -1;
  }

  function navigateResult(result) {
    if (!result) return;
    dispatch('navigate', { type: result.type, id: result.id });
    closeSearch();
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 120);
  }

  function handleKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) activeIndex = (activeIndex + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) activeIndex = (activeIndex - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        navigateResult(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      closeSearch();
      if (inputEl) inputEl.blur();
    }
  }

  function handleGlobalKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }
  }

  function scrollActiveIntoView() {
    if (!resultsEl || activeIndex < 0) return;
    const items = resultsEl.querySelectorAll('.search-result-item');
    if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  $: if (activeIndex >= 0) scrollActiveIntoView();

  onMount(() => {
    document.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleGlobalKeydown);
    clearTimeout(debounceTimer);
  });
</script>

<div class="search-wrap">
  <span class="search-icon">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  </span>
  <input
    bind:this={inputEl}
    bind:value={query}
    class="search-input"
    type="text"
    placeholder="Search items\u2026"
    autocomplete="off"
    on:input={handleInput}
    on:keydown={handleKeydown}
  />
  <span class="search-kbd">Ctrl+K</span>
  <div class="search-results" class:show={showResults} bind:this={resultsEl}>
    {#if showResults && results.length === 0}
      <div class="search-empty">No matching items</div>
    {:else}
      {#each results as r, i}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
          class="search-result-item"
          class:is-active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          on:click={() => navigateResult(r)}
        >
          <span class="search-result-type {r.type}">
            {r.type === 'tracker' ? 'Track' : r.type === 'briefing' ? 'Brief' : 'Radar'}
          </span>
          <div class="search-result-body">
            <div class="search-result-title">{@html highlightMatch(r.title, query)}</div>
            <div class="search-result-meta">{@html highlightMatch(r.meta + (r.summary ? ' \u2014 ' + r.summary : ''), query)}</div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
{#if showResults}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="search-overlay show" on:click={closeSearch}></div>
{/if}
