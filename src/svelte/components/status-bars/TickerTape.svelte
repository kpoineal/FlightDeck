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
    const now = Date.now();
    const recentCutoff = now - 24 * 60 * 60 * 1000; // last 24h only
    const seenItemIds = new Set();

    // Primary source: item updateHistory (the actual substance)
    // Only show the LATEST update per item, and only if it has real content
    for (const item of ($items || [])) {
      const updates = (item.updateHistory || []);
      if (!updates.length) continue;
      const latest = updates[0];
      const time = new Date(latest.timestamp).getTime();
      if (time < recentCutoff) continue;

      // Build a meaningful text from the update
      const changes = Array.isArray(latest.changes) ? latest.changes : [];
      const statusChange = changes.find(c => c.startsWith('Status:') || c.startsWith('Severity:'));
      const summaryText = latest.summary || '';

      let text;
      if (statusChange) {
        text = `${item.title}: ${statusChange}`;
      } else if (summaryText && summaryText !== 'Updated') {
        // Use summary but truncate, and prefix with item title for context
        const shortSummary = summaryText.length > 60 ? summaryText.slice(0, 57) + '...' : summaryText;
        text = `${item.title}: ${shortSummary}`;
      } else {
        text = `${item.title} updated`;
      }

      seenItemIds.add(item.id);
      s.push({
        id: `${item.id}_${latest.timestamp}`,
        itemId: item.id,
        time,
        severity: normalizeSeverity(latest.severity || item.severity),
        text,
      });
    }

    // Secondary source: history store — only scanner results and failures
    // Skip: startup, meetings loaded, item deletions, mark as seen, generic "Meaningful change" entries
    for (const h of ($history || []).slice(0, 20)) {
      const time = new Date(h.at).getTime();
      if (time < recentCutoff) continue;

      // Skip noise
      if (h.kind === 'startup') continue;
      if (h.kind === 'action') continue;
      if (h.kind === 'intent') continue;
      if (h.kind === 'selection') continue;
      // Skip "Meaningful change detected" — the item updateHistory already covers this
      if (h.summary?.startsWith('Meaningful change')) continue;
      // Skip "Loaded N meetings" — noise
      if (h.summary?.startsWith('Loaded')) continue;
      // Skip entries for items we already have stories for
      if (h.payload?.itemId && seenItemIds.has(h.payload.itemId)) continue;

      // Only keep: scanner results, failures, completions
      if (h.kind === 'scan' && h.summary?.includes('found')) {
        s.push({
          id: h.id,
          itemId: null,
          time,
          severity: 'Elevated',
          text: h.summary.slice(0, 80),
        });
      } else if (h.kind === 'failure') {
        s.push({
          id: h.id,
          itemId: h.payload?.itemId || null,
          time,
          severity: 'Critical',
          text: h.summary?.slice(0, 80) || 'Operation failed',
        });
      }
    }

    // Upcoming meetings (within 60 minutes)
    const soonCutoff = now + 60 * 60 * 1000;
    for (const m of ($meetings || [])) {
      const time = new Date(m.startAt).getTime();
      if (time > now && time < soonCutoff) {
        const mins = Math.round((time - now) / 60_000);
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
    return s.slice(0, 15);
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
            onclick={() => clickStory(story)}
          >
            <span class="ticker-dot" style="background: {dotColor(story.severity)}"></span>
            <span class="ticker-text">{story.text}</span>
            <span class="ticker-time">{relativeTime(story.time)}</span>
          </button>
        {/each}
        <!-- Duplicate for seamless loop -->
        {#each stories as story (story.id + '_dup')}
          <button
            class="ticker-story"
            class:ticker-story--clickable={!!story.itemId}
            onclick={() => clickStory(story)}
            aria-hidden="true"
          >
            <span class="ticker-dot" style="background: {dotColor(story.severity)}"></span>
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
    padding: 6px 0 2px;
    overflow: hidden;
    position: relative;
    mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);
  }
  .ticker-quiet {
    font-size: 0.72rem;
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
    gap: 24px;
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
    gap: 5px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.72rem;
    padding: 2px 0;
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
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .ticker-text {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ticker-time {
    color: var(--text-muted);
    font-size: 0.62rem;
    flex-shrink: 0;
  }
</style>
