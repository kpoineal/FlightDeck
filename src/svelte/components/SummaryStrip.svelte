<script>
  import { kpis, mode, items, scanners, meetings, briefingsByMeetingId } from '../lib/stores.js';
  import { normalizeSeverity } from '../lib/utils.js';

  let isBriefings = $derived($mode === 'Briefings');
  let isRadar = $derived($mode === 'Radar');

  // Briefing counts
  let briefingCounts = $derived.by(() => {
    if (!isBriefings) return { briefed: 0, unbriefed: 0 };
    let briefed = 0;
    let unbriefed = 0;
    for (const meeting of ($meetings || [])) {
      const stored = ($briefingsByMeetingId || {})[meeting.id] || null;
      if (stored) {
        briefed++;
      } else {
        unbriefed++;
      }
    }
    return { briefed, unbriefed };
  });

  // Severity counts
  let criticalCount = $derived(isBriefings ? briefingCounts.unbriefed : $kpis.critical);
  let elevatedCount = $derived(isBriefings ? briefingCounts.briefed : $kpis.elevated);
  let observeCount = $derived(isBriefings ? 0 : $kpis.observe);

  // Bar percentages
  let barTotal = $derived(isBriefings
    ? (briefingCounts.unbriefed + briefingCounts.briefed)
    : ($kpis.critical + $kpis.elevated + $kpis.observe));
  let criticalPct = $derived(barTotal ? (criticalCount / barTotal * 100) : 0);
  let elevatedPct = $derived(barTotal ? (elevatedCount / barTotal * 100) : 0);
  let observePct = $derived(barTotal ? (observeCount / barTotal * 100) : 0);

  // Total label
  let totalLabel = $derived(isBriefings
    ? `${briefingCounts.unbriefed + briefingCounts.briefed} meeting${(briefingCounts.unbriefed + briefingCounts.briefed) === 1 ? '' : 's'}`
    : `${$kpis.total} item${$kpis.total === 1 ? '' : 's'}`);

  // Blocked / new / complete
  let blockedCount = $derived($kpis.blocked || 0);
  let newItemCount = $derived($kpis.new || 0);
  let completeCount = $derived($kpis.complete || 0);

  // ── Morning banner data (only used in Radar mode) ────────────────
  let detailOpen = $state(false);

  let activeItems = $derived(($items).filter(i => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived'));
  let bannerCriticalCount = $derived(activeItems.filter(i => normalizeSeverity(i.severity) === 'Critical').length);
  let bannerElevatedCount = $derived(activeItems.filter(i => normalizeSeverity(i.severity) === 'Elevated').length);
  let bannerNewCount = $derived(activeItems.filter(i => (i.isNew || i.hasNewUpdate) && i.lifecycleStatus !== 'snoozed').length);
  let bannerBlockedCount = $derived(activeItems.filter(i => i.lifecycleStatus === 'blocked').length);
  let snoozedCount = $derived(activeItems.filter(i => i.lifecycleStatus === 'snoozed').length);
  let completedItems = $derived(($items).filter(i => i.lifecycleStatus === 'complete'));
  let recentlyCompleted = $derived(
    completedItems
      .filter(i => i.completedAt && (Date.now() - new Date(i.completedAt).getTime()) < 24 * 60 * 60 * 1000)
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
  );
  let meetingCount = $derived(($meetings).length);
  let unbriefedCount = $derived(($meetings).filter(m => !($briefingsByMeetingId)[m.id]).length);
  let scannerCount = $derived(($scanners).filter(s => s.enabled).length);

  let hour = new Date().getHours();
  let greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  let icon = hour < 12 ? '☀️' : hour < 17 ? '🌤️' : '🌙';

  let highlights = $derived.by(() => {
    const h = [];
    if (bannerCriticalCount > 0) h.push({ text: `${bannerCriticalCount} critical`, cls: 'critical' });
    if (bannerNewCount > 0) h.push({ text: `${bannerNewCount} new update${bannerNewCount > 1 ? 's' : ''}` });
    if (bannerBlockedCount > 0) h.push({ text: `${bannerBlockedCount} blocked` });
    if (meetingCount > 0) h.push({ text: `${meetingCount} meeting${meetingCount > 1 ? 's' : ''} today` });
    if (recentlyCompleted.length > 0) h.push({ text: `${recentlyCompleted.length} completed` });
    return h;
  });
</script>

<section class="summary-strip">
  <div class="summary-strip-left">
    <span class="summary-sev summary-sev--critical" title={isBriefings ? 'Unbriefed meetings' : 'Critical items'}>
      <i class="legend-dot {isBriefings ? 'unbriefed' : 'critical'}"></i>
      <strong>{criticalCount}</strong> {isBriefings ? 'Unbriefed' : 'Critical'}
    </span>
    <span class="summary-sev summary-sev--elevated" title={isBriefings ? 'Briefed meetings' : 'Elevated items'}>
      <i class="legend-dot {isBriefings ? 'briefed' : 'elevated'}"></i>
      <strong>{elevatedCount}</strong> {isBriefings ? 'Briefed' : 'Elevated'}
    </span>
    {#if !isBriefings}
      <span class="summary-sev summary-sev--observe" title="Observe items">
        <i class="legend-dot observe"></i>
        <strong>{observeCount}</strong> Observe
      </span>
    {/if}
    <span class="summary-sep"></span>
    <div class="severity-stack summary-bar" aria-label="Severity distribution">
      <span class="stack-segment {isBriefings ? 'unbriefed' : 'critical'}"
        style="--bar-width: {criticalPct}%"></span>
      <span class="stack-segment {isBriefings ? 'briefed' : 'elevated'}"
        style="--bar-width: {elevatedPct}%"></span>
      <span class="stack-segment observe"
        style="--bar-width: {observePct}%; --bar-opacity: {isBriefings ? '0' : '1'}"></span>
    </div>
    <span class="summary-sep"></span>
    <span class="summary-total">{totalLabel}</span>
    {#if !isBriefings && blockedCount > 0}
      <span class="summary-attn">{blockedCount} blocked</span>
    {/if}
    {#if !isBriefings && newItemCount > 0}
      <span class="summary-attn">{newItemCount} new</span>
    {/if}
    {#if !isBriefings && completeCount > 0}
      <span class="summary-attn">{completeCount} complete</span>
    {/if}
  </div>

  {#if isRadar}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="greeting-row"
      on:click={() => { detailOpen = !detailOpen; }}
      role="button" tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && (detailOpen = !detailOpen)}>
      <div class="greeting-row-left">
        <span class="greeting-icon">{icon}</span>
        <span class="greeting-text">
          {greeting}{#if highlights.length} · {#each highlights as h, i}{#if i > 0} · {/if}{#if h.cls}<strong class="greeting-hl greeting-hl--{h.cls}">{h.text}</strong>{:else}{h.text}{/if}{/each}{:else} · All clear{/if}
        </span>
      </div>
      <div class="greeting-row-right">
        <span class="greeting-meta">{scannerCount} scanner{scannerCount !== 1 ? 's' : ''} · {activeItems.length} tracked</span>
        <span class="greeting-chevron" class:greeting-chevron--open={detailOpen}>▾</span>
      </div>
    </div>

    {#if detailOpen}
      <div class="greeting-detail">
        {#if bannerCriticalCount + bannerElevatedCount > 0}
          <div class="greeting-detail-card"><strong>🔴 Attention</strong> {bannerCriticalCount} critical, {bannerElevatedCount} elevated items need review</div>
        {/if}
        {#if meetingCount > 0}
          <div class="greeting-detail-card"><strong>📅 Meetings</strong> {meetingCount} today{unbriefedCount > 0 ? `, ${unbriefedCount} unbriefed` : ', all briefed'}</div>
        {:else}
          <div class="greeting-detail-card"><strong>📅 Meetings</strong> No meetings today</div>
        {/if}
        {#if snoozedCount > 0}
          <div class="greeting-detail-card"><strong>💤 Snoozed</strong> {snoozedCount} item{snoozedCount > 1 ? 's' : ''} snoozed</div>
        {/if}
        {#if bannerNewCount > 0}
          <div class="greeting-detail-card"><strong>🆕 Updates</strong> {bannerNewCount} item{bannerNewCount > 1 ? 's have' : ' has'} new activity</div>
        {:else}
          <div class="greeting-detail-card"><strong>✅ Current</strong> No new updates since last check</div>
        {/if}
        {#if recentlyCompleted.length > 0}
          <div class="greeting-detail-card">
            <strong>✅ Completed</strong> {recentlyCompleted.length} item{recentlyCompleted.length > 1 ? 's' : ''} completed recently
            {#each recentlyCompleted.slice(0, 3) as item}
              <br><small>• {item.title || 'Untitled'}</small>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .greeting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0 0;
    cursor: pointer;
    min-height: 22px;
  }
  .greeting-row-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .greeting-icon {
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  .greeting-text {
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .greeting-hl {
    font-weight: 600;
  }
  .greeting-hl--critical {
    color: var(--color-critical);
  }
  .greeting-row-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .greeting-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .greeting-chevron {
    font-size: 0.7rem;
    color: var(--text-muted);
    transition: transform 0.2s ease;
    display: inline-block;
  }
  .greeting-chevron--open {
    transform: rotate(180deg);
  }
  .greeting-detail {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .greeting-detail-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .greeting-detail-card strong {
    font-weight: 600;
    color: var(--text);
    font-size: 0.75rem;
  }
</style>
