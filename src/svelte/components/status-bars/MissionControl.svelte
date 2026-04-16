<script>
  import { items, scanners, meetings, highlightedItemId, mode, filter, collapsedSections } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';
  import { get } from 'svelte/store';

  let now = $state(new Date());

  $effect(() => {
    const timer = setInterval(() => { now = new Date(); }, 1000);
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
        const changes = Array.isArray(latest.changes) ? latest.changes : [];
        const statusChange = changes.find(c => c.startsWith('Status:') || c.startsWith('Severity:'));

        // Parse status transition for pill rendering
        let statusTransition = null;
        if (statusChange) {
          const match = statusChange.match(/^(?:Status|Severity):\s*(.+?)\s*→\s*(.+)$/);
          if (match) {
            statusTransition = {
              from: match[1].trim(),
              fromClass: match[1].trim().toLowerCase().replace(/\s+/g, '-'),
              to: match[2].trim(),
              toClass: match[2].trim().toLowerCase().replace(/\s+/g, '-'),
            };
          }
        }

        let desc;
        if (!statusTransition) {
          if (latest.summary && latest.summary !== 'Updated' && latest.summary !== 'Discovered') {
            desc = latest.summary.length > 60 ? latest.summary.slice(0, 57) + '...' : latest.summary;
          } else {
            desc = null;
          }
        }

        best = { item, desc, statusTransition, time: t };
      }
    }
    return best;
  });

  // Upcoming meetings (up to 3)
  let upcomingMeetings = $derived.by(() => {
    return ($meetings || [])
      .filter(m => new Date(m.startAt).getTime() > now.getTime())
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 3);
  });

  function meetingCountdown(meeting) {
    const diff = new Date(meeting.startAt).getTime() - now.getTime();
    if (diff <= 0) return 'now';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function navigateToItem(itemId) {
    filter.set('all');
    mode.set('Radar');
    const targetItem = get(items).find(i => i.id === itemId);
    if (targetItem && targetItem.scannerId) {
      const sectionId = `scanner-${targetItem.scannerId}`;
      const allSectionIds = get(scanners).map(s => `scanner-${s.id}`);
      collapsedSections.set(allSectionIds.filter(id => id !== sectionId));
    }
    setTimeout(() => {
      highlightedItemId.set(itemId);
      setTimeout(() => highlightedItemId.set(null), 4000);
    }, 100);
  }

  function reviewItem() {
    if (recentEscalation) navigateToItem(recentEscalation.item.id);
  }

  function prepMeeting(meeting) {
    mode.set('Briefings');
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
  <div class="mc-row">
    <!-- Left: latest change -->
    <div class="mc-latest">
      {#if recentEscalation}
        <span class="mc-label">LATEST</span>
        <button class="mc-link" onclick={reviewItem} title="Click to navigate to this item">
          {recentEscalation.item.title}
        </button>
        {#if recentEscalation.statusTransition}
          <span class="at-status-transition">
            <span class="pill at-status-pill at-status-{recentEscalation.statusTransition.fromClass}">{recentEscalation.statusTransition.from}</span>
            <span class="at-arrow">→</span>
            <span class="pill at-status-pill at-status-{recentEscalation.statusTransition.toClass}">{recentEscalation.statusTransition.to}</span>
          </span>
        {:else if recentEscalation.desc}
          <span class="mc-desc">{recentEscalation.desc}</span>
        {/if}
        <span class="mc-time">{relativeTime(recentEscalation.time)}</span>
      {:else}
        <span class="mc-quiet">All quiet — no recent changes</span>
      {/if}
    </div>

    <!-- Right: upcoming meetings -->
    <div class="mc-meetings">
      {#if upcomingMeetings.length}
        <span class="mc-label">NEXT{upcomingMeetings.length > 1 ? ` ${upcomingMeetings.length} MEETINGS` : ' MEETING'}</span>
        <div class="mc-meeting-list">
          {#each upcomingMeetings as meeting}
            <button class="mc-meeting-item" onclick={() => prepMeeting(meeting)} title="Go to Briefings">
              <span class="mc-meeting-title">{meeting.title}</span>
              <span class="mc-meeting-time">{meetingCountdown(meeting)}</span>
            </button>
          {/each}
        </div>
      {:else}
        <span class="mc-quiet">No upcoming meetings</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .mission-control {
    padding: 6px 0 2px;
    font-size: 0.78rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
    margin-top: 6px;
  }
  .mc-row {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .mc-latest {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .mc-meetings {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-shrink: 0;
  }
  .mc-label {
    color: var(--text-muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    flex-shrink: 0;
  }
  .mc-link {
    color: var(--accent, #0a84ff);
    background: none;
    border: none;
    font-size: inherit;
    font-family: inherit;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
    text-decoration: none;
  }
  .mc-link:hover {
    text-decoration: underline;
  }
  .mc-desc {
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .mc-change {
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
  .mc-quiet {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .mc-btn {
    background: color-mix(in srgb, var(--accent, #0a84ff) 15%, transparent);
    color: var(--accent, #0a84ff);
    border: 1px solid color-mix(in srgb, var(--accent, #0a84ff) 30%, transparent);
    border-radius: var(--radius-sm, 4px);
    padding: 2px 10px;
    font-size: 0.68rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .mc-btn:hover {
    background: color-mix(in srgb, var(--accent, #0a84ff) 25%, transparent);
  }
  .mc-meeting-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mc-meeting-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.75rem;
    padding: 1px 0;
    cursor: pointer;
    text-align: left;
  }
  .mc-meeting-item:hover .mc-meeting-title {
    text-decoration: underline;
  }
  .mc-meeting-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .mc-meeting-time {
    color: var(--accent, #0a84ff);
    font-weight: 600;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
</style>
