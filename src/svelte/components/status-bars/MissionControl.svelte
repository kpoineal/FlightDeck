<script>
  import { items, scanners, meetings, highlightedItemId, mode } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 1000);
    return () => clearInterval(timer);
  });

  // Most recent escalation/change
  let recentEscalation = $derived.by(() => {
    let best = null;
    let bestTime = 0;
    for (const item of $items) {
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
      const hist = item.updateHistory;
      if (!hist?.length) continue;
      const latest = hist[0];
      const t = new Date(latest.timestamp).getTime();
      if (t > bestTime) {
        bestTime = t;
        best = { item, update: latest, time: t };
      }
    }
    return best;
  });

  // Next meeting countdown
  let nextMeeting = $derived.by(() => {
    const upcoming = ($meetings || [])
      .filter(m => new Date(m.startAt).getTime() > now.getTime())
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return upcoming[0] || null;
  });

  let countdown = $derived.by(() => {
    if (!nextMeeting) return null;
    const diff = new Date(nextMeeting.startAt).getTime() - now.getTime();
    if (diff <= 0) return 'now';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  });

  // Stale items (unchanged > 48 hours)
  let staleItems = $derived.by(() => {
    const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
    return ($items || []).filter(item => {
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') return false;
      const lastUpdate = item.updateHistory?.[0]?.timestamp || item.trackedAt;
      if (!lastUpdate) return true;
      return new Date(lastUpdate).getTime() < cutoff;
    });
  });

  function reviewItem() {
    if (recentEscalation) {
      highlightedItemId.set(recentEscalation.item.id);
    }
  }

  function prepBriefings() {
    mode.set('Briefings');
  }

  function triageStale() {
    if (staleItems.length > 0) {
      // Navigate to oldest stale item
      const oldest = staleItems.reduce((a, b) => {
        const aTime = new Date(a.updateHistory?.[0]?.timestamp || a.trackedAt || 0).getTime();
        const bTime = new Date(b.updateHistory?.[0]?.timestamp || b.trackedAt || 0).getTime();
        return aTime < bTime ? a : b;
      });
      highlightedItemId.set(oldest.id);
    }
  }

  function relativeTime(ms) {
    const diff = now.getTime() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }
</script>

<div class="mission-control">
  <div class="mc-columns">
    <!-- Left: recent escalation -->
    <div class="mc-col mc-col--left">
      {#if recentEscalation}
        <span class="mc-label">Latest</span>
        <span class="mc-change" title={recentEscalation.item.title}>
          {recentEscalation.update.changesDescription || recentEscalation.update.summary?.slice(0, 60) || recentEscalation.item.title}
        </span>
        <span class="mc-time">{relativeTime(recentEscalation.time)}</span>
        <button class="mc-btn mc-btn--review" onclick={reviewItem}>Review</button>
      {:else}
        <span class="mc-label">All quiet — no recent changes</span>
      {/if}
    </div>

    <!-- Right: next meeting -->
    <div class="mc-col mc-col--right">
      {#if nextMeeting}
        <span class="mc-label">Next meeting</span>
        <span class="mc-meeting-title" title={nextMeeting.title}>{nextMeeting.title}</span>
        <span class="mc-countdown">{countdown}</span>
        <button class="mc-btn mc-btn--prep" onclick={prepBriefings}>Prep</button>
      {:else}
        <span class="mc-label">No upcoming meetings</span>
      {/if}
    </div>
  </div>

  <!-- Bottom: stale items -->
  {#if staleItems.length > 0}
    <div class="mc-bottom">
      <span class="mc-stale-label">{staleItems.length} item{staleItems.length !== 1 ? 's' : ''} unchanged &gt;48h</span>
      <button class="mc-btn mc-btn--triage" onclick={triageStale}>Triage</button>
    </div>
  {/if}
</div>

<style>
  .mission-control {
    padding: 6px 0 2px;
    font-size: 0.76rem;
  }
  .mc-columns {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .mc-col {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .mc-label {
    color: var(--text-muted);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .mc-change, .mc-meeting-title {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .mc-time {
    color: var(--text-muted);
    font-size: 0.68rem;
    flex-shrink: 0;
  }
  .mc-countdown {
    color: var(--accent, #0a84ff);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .mc-btn {
    background: color-mix(in srgb, var(--accent, #0a84ff) 15%, transparent);
    color: var(--accent, #0a84ff);
    border: 1px solid color-mix(in srgb, var(--accent, #0a84ff) 30%, transparent);
    border-radius: var(--radius-sm, 4px);
    padding: 1px 8px;
    font-size: 0.68rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .mc-btn:hover {
    background: color-mix(in srgb, var(--accent, #0a84ff) 25%, transparent);
  }
  .mc-btn--triage {
    background: color-mix(in srgb, var(--color-elevated, #ff9f0a) 15%, transparent);
    color: var(--color-elevated, #ff9f0a);
    border-color: color-mix(in srgb, var(--color-elevated, #ff9f0a) 30%, transparent);
  }
  .mc-btn--triage:hover {
    background: color-mix(in srgb, var(--color-elevated, #ff9f0a) 25%, transparent);
  }
  .mc-bottom {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
  }
  .mc-stale-label {
    color: var(--text-muted);
    font-size: 0.7rem;
  }
</style>
