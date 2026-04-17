<script>
  import { items, scanners, meetings, briefingsByMeetingId } from '../lib/stores.js';
  import { normalizeSeverity } from '../lib/utils.js';

  let detailOpen = $state(false);

  let activeItems = $derived(($items).filter(i => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived'));
  let criticalCount = $derived(activeItems.filter(i => normalizeSeverity(i.severity) === 'Critical').length);
  let elevatedCount = $derived(activeItems.filter(i => normalizeSeverity(i.severity) === 'Elevated').length);
  let newCount = $derived(activeItems.filter(i => (i.isNew || i.hasNewUpdate) && i.lifecycleStatus !== 'snoozed').length);
  let blockedCount = $derived(activeItems.filter(i => i.lifecycleStatus === 'blocked').length);
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
    if (criticalCount > 0) h.push({ text: `${criticalCount} critical`, cls: 'critical' });
    if (newCount > 0) h.push({ text: `${newCount} new update${newCount > 1 ? 's' : ''}` });
    if (blockedCount > 0) h.push({ text: `${blockedCount} blocked` });
    if (meetingCount > 0) h.push({ text: `${meetingCount} meeting${meetingCount > 1 ? 's' : ''} today` });
    if (recentlyCompleted.length > 0) h.push({ text: `${recentlyCompleted.length} completed` });
    return h;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="morning-banner"
  on:click={() => { detailOpen = !detailOpen; }}
  role="button" tabindex="0"
  on:keydown={(e) => e.key === 'Enter' && (detailOpen = !detailOpen)}>
  <div class="morning-banner-header">
    <div class="morning-banner-headline">
      <span class="greeting-icon">{icon}</span>
      {greeting}{#if highlights.length}. {#each highlights as h, i}{#if i > 0} · {/if}{#if h.cls}<strong style="color:var(--color-{h.cls})">{h.text}</strong>{:else}{h.text}{/if}{/each}{:else}. All clear — no urgent items.{/if}
    </div>
    <div class="morning-banner-meta">
      <span>{scannerCount} scanner{scannerCount !== 1 ? 's' : ''} active</span>
      <span>{activeItems.length} items tracked</span>
    </div>
  </div>
  {#if detailOpen}
    <div class="morning-banner-detail">
      {#if criticalCount + elevatedCount > 0}
        <div class="morning-banner-detail-card"><strong>🔴 Attention</strong> {criticalCount} critical, {elevatedCount} elevated items need review</div>
      {/if}
      {#if meetingCount > 0}
        <div class="morning-banner-detail-card"><strong>📅 Meetings</strong> {meetingCount} today{unbriefedCount > 0 ? `, ${unbriefedCount} unbriefed` : ', all briefed'}</div>
      {:else}
        <div class="morning-banner-detail-card"><strong>📅 Meetings</strong> No meetings today</div>
      {/if}
      {#if snoozedCount > 0}
        <div class="morning-banner-detail-card"><strong>💤 Snoozed</strong> {snoozedCount} item{snoozedCount > 1 ? 's' : ''} snoozed</div>
      {/if}
      {#if newCount > 0}
        <div class="morning-banner-detail-card"><strong>🆕 Updates</strong> {newCount} item{newCount > 1 ? 's have' : ' has'} new activity</div>
      {:else}
        <div class="morning-banner-detail-card"><strong>✅ Current</strong> No new updates since last check</div>
      {/if}
      {#if recentlyCompleted.length > 0}
        <div class="morning-banner-detail-card">
          <strong>✅ Completed</strong> {recentlyCompleted.length} item{recentlyCompleted.length > 1 ? 's' : ''} completed recently
          {#each recentlyCompleted.slice(0, 3) as item}
            <br><small>• {item.title || 'Untitled'}</small>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
