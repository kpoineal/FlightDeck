<script>
  import { items, history, scanners, meetings, highlightedItemId } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 30_000);
    return () => clearInterval(timer);
  });

  let paused = $state(false);

  // Build "stories" from various sources
  let stories = $derived.by(() => {
    const s = [];

    // From item updateHistory (recent entries)
    for (const item of ($items || [])) {
      for (const upd of (item.updateHistory || []).slice(0, 2)) {
        s.push({
          id: `${item.id}_${upd.timestamp}`,
          itemId: item.id,
          time: new Date(upd.timestamp).getTime(),
          severity: normalizeSeverity(upd.severity || item.severity),
          text: upd.changesDescription || upd.summary?.slice(0, 80) || `${item.title} updated`,
        });
      }
    }

    // From history store (scan results, completions, etc.)
    for (const h of ($history || []).slice(0, 10)) {
      s.push({
        id: h.id,
        itemId: h.payload?.itemId || null,
        time: new Date(h.at).getTime(),
        severity: h.kind === 'failure' ? 'Critical' : h.kind === 'scan' ? 'Elevated' : 'Observe',
        text: h.summary?.slice(0, 80) || h.kind,
      });
    }

    // From meetings (upcoming)
    for (const m of ($meetings || [])) {
      s.push({
        id: `mtg_${m.id}`,
        itemId: null,
        time: new Date(m.startAt).getTime(),
        severity: 'Observe',
        text: `Meeting: ${m.title}`,
      });
    }

    // Deduplicate by id & sort newest first
    const seen = new Set();
    const unique = [];
    for (const story of s) {
      if (!seen.has(story.id)) {
        seen.add(story.id);
        unique.push(story);
      }
    }
    unique.sort((a, b) => b.time - a.time);
    return unique.slice(0, 20);
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
      highlightedItemId.set(story.itemId);
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
