<script>
  import { items, history, scanners, meetings, highlightedItemId, mode, filter, collapsedSections } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';
  import { get } from 'svelte/store';

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 30_000);
    return () => clearInterval(timer);
  });

  let paused = $state(false);

  // Build "stories" — only actionable, non-redundant information
  let stories = $derived.by(() => {
    const s = [];
    const currentTime = now.getTime(); // use reactive now so stories refresh periodically
    const recentCutoff = currentTime - 24 * 60 * 60 * 1000; // last 24h only
    const seenItemIds = new Set();

    // Primary source: item updateHistory (the actual substance)
    // Show the LATEST update per item if it's recent
    for (const item of ($items || [])) {
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
      const updates = (item.updateHistory || []);
      if (!updates.length) continue;
      const latest = updates[0];
      const time = new Date(latest.timestamp).getTime();
      if (time < recentCutoff) continue;

      // Skip initial "Discovered" entries that have no real update
      const changes = Array.isArray(latest.changes) ? latest.changes : [];
      if (changes.length === 1 && changes[0] === 'Discovered' && updates.length === 1) continue;

      // Build a meaningful text from the update
      const statusChange = changes.find(c => /^(Status|Severity):/.test(c));

      let text;
      if (statusChange) {
        text = `${item.title}: ${statusChange}`;
      } else {
        const summaryText = latest.summary || '';
        const shortSummary = summaryText.length > 60 ? summaryText.slice(0, 57) + '...' : summaryText;
        text = shortSummary ? `${item.title}: ${shortSummary}` : `${item.title} updated`;
      }

      const isTerminal = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
      const cardIsNew = !isTerminal && item.isNew === true;
      const cardIsUpdated = !isTerminal && item.hasNewUpdate === true;

      seenItemIds.add(item.id);
      s.push({
        id: `${item.id}_${latest.timestamp}`,
        itemId: item.id,
        time,
        severity: normalizeSeverity(latest.severity || item.severity),
        text,
        isNew: cardIsNew,
        isUpdated: cardIsUpdated,
      });
    }

    // Secondary source: history store — only scanner results and failures
    // Skip: startup, meetings loaded, item deletions, mark as seen, generic "Meaningful change" entries
    for (const h of ($history || []).slice(0, 20)) {
      const time = new Date(h.at).getTime();
      if (time < recentCutoff) continue;

      // Skip all history entries — we build stories from items directly
      // History is too noisy and doesn't have item references for navigation
      continue;
    }


    // Upcoming meetings (within 60 minutes)
    const soonCutoff = currentTime + 60 * 60 * 1000;
    for (const m of ($meetings || [])) {
      const time = new Date(m.startAt).getTime();
      if (time > currentTime && time < soonCutoff) {
        const mins = Math.round((time - currentTime) / 60_000);
        s.push({
          id: `mtg_${m.id}`,
          itemId: null,
          time,
          severity: 'Observe',
          text: `📅 ${m.title} in ${mins}m`,
        });
      }
    }

    // Sort newest first
    s.sort((a, b) => b.time - a.time);
    return s.slice(0, 25);
  });

  function relativeTime(ms) {
    const diff = now.getTime() - ms;
    if (diff < 0) {
      const future = -diff;
      if (future < 3_600_000) return `in ${Math.floor(future / 60_000)}m`;
      return `in ${Math.floor(future / 3_600_000)}h`;
    }
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function dotColor(severity) {
    if (severity === 'Critical') return 'var(--color-critical, #ff453a)';
    if (severity === 'Elevated') return 'var(--color-elevated, #ff9f0a)';
    return 'var(--color-observe, #0a84ff)';
  }

  function clickStory(story) {
    if (story.itemId) {
      filter.set('all');
      mode.set('Radar');

      // Expand the scanner section containing this item
      const targetItem = get(items).find(i => i.id === story.itemId);
      if (targetItem && targetItem.scannerId) {
        const sectionId = `scanner-${targetItem.scannerId}`;
        const allSectionIds = get(scanners).map(s => `scanner-${s.id}`);
        collapsedSections.set(allSectionIds.filter(id => id !== sectionId));
      }

      // Delay highlight to let DOM update after section expansion
      setTimeout(() => {
        highlightedItemId.set(story.itemId);
        setTimeout(() => highlightedItemId.set(null), 4000);
      }, 100);
    }
  }
</script>

<div
  class="ticker-tape"
  class:ticker-tape--paused={paused}
  onmouseenter={() => { paused = true; }}
  onmouseleave={() => { paused = false; }}
  role="marquee"
  aria-live="polite"
>
  {#if stories.length === 0}
    <span class="ticker-quiet">All quiet — nothing changed recently</span>
  {:else}
    <div class="ticker-track">
      <div class="ticker-content">
        {#each stories as story (story.id)}
          <button
            class="ticker-story"
            class:ticker-story--clickable={!!story.itemId}
            class:ticker-story--new={story.isNew}
            class:ticker-story--updated={story.isUpdated}
            onclick={() => clickStory(story)}
          >
            <span class="ticker-dot" style="background: {dotColor(story.severity)}"></span>
            {#if story.isNew}<span class="ticker-new-badge">NEW</span>{/if}
            {#if story.isUpdated}<span class="ticker-updated-badge">UPDATED</span>{/if}
            <span class="ticker-text">{story.text}</span>
            <span class="ticker-time">{relativeTime(story.time)}</span>
          </button>
        {/each}
        <!-- Duplicate for seamless loop -->
        {#each stories as story (story.id + '_dup')}
          <button
            class="ticker-story"
            class:ticker-story--clickable={!!story.itemId}
            class:ticker-story--new={story.isNew}
            class:ticker-story--updated={story.isUpdated}
            onclick={() => clickStory(story)}
            aria-hidden="true"
          >
            <span class="ticker-dot" style="background: {dotColor(story.severity)}"></span>
            {#if story.isNew}<span class="ticker-new-badge">NEW</span>{/if}
            {#if story.isUpdated}<span class="ticker-updated-badge">UPDATED</span>{/if}
            <span class="ticker-text">{story.text}</span>
            <span class="ticker-time">{relativeTime(story.time)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .ticker-tape {
    padding: 8px 0 4px;
    overflow: hidden;
    position: relative;
    mask-image: linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%);
  }
  .ticker-quiet {
    font-size: 0.82rem;
    color: var(--text-muted);
    padding: 8px 0;
    display: block;
    text-align: center;
  }
  .ticker-track {
    overflow: hidden;
    width: 100%;
  }
  .ticker-content {
    display: flex;
    gap: 32px;
    white-space: nowrap;
    animation: ticker-scroll 40s linear infinite;
    width: max-content;
  }
  .ticker-tape--paused .ticker-content {
    animation-play-state: paused;
  }
  @keyframes ticker-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .ticker-story {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.82rem;
    padding: 3px 0;
    cursor: default;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ticker-story--clickable {
    cursor: pointer;
  }
  .ticker-story--clickable:hover .ticker-text {
    text-decoration: underline;
  }
  .ticker-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .ticker-text {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ticker-time {
    color: var(--text-muted);
    font-size: 0.72rem;
    flex-shrink: 0;
  }
  .ticker-new-badge {
    background: var(--color-new, #0a84ff);
    color: #fff;
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    animation: new-pulse 2s ease-in-out infinite;
  }
  .ticker-story--new .ticker-text {
    color: var(--text);
    font-weight: 500;
  }
  .ticker-updated-badge {
    background: var(--color-updated, #30d158);
    color: #fff;
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    animation: new-pulse 2s ease-in-out infinite;
  }
  .ticker-story--updated .ticker-text {
    color: var(--text);
    font-weight: 500;
  }
  @keyframes new-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
