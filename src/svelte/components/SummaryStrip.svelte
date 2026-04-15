<script>
  import { kpis, mode, items, meetings, briefingsByMeetingId } from '../lib/stores.js';

  $: isBriefings = $mode === 'Briefings';

  // Briefing counts
  $: briefingCounts = (() => {
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
  })();

  // Severity counts
  $: criticalCount = isBriefings ? briefingCounts.unbriefed : $kpis.critical;
  $: elevatedCount = isBriefings ? briefingCounts.briefed : $kpis.elevated;
  $: observeCount = isBriefings ? 0 : $kpis.observe;

  // Bar percentages
  $: barTotal = isBriefings
    ? (briefingCounts.unbriefed + briefingCounts.briefed)
    : ($kpis.critical + $kpis.elevated + $kpis.observe);
  $: criticalPct = barTotal ? (criticalCount / barTotal * 100) : 0;
  $: elevatedPct = barTotal ? (elevatedCount / barTotal * 100) : 0;
  $: observePct = barTotal ? (observeCount / barTotal * 100) : 0;

  // Total label
  $: totalLabel = isBriefings
    ? `${briefingCounts.unbriefed + briefingCounts.briefed} meeting${(briefingCounts.unbriefed + briefingCounts.briefed) === 1 ? '' : 's'}`
    : `${$kpis.total} item${$kpis.total === 1 ? '' : 's'}`;

  // Blocked / new / complete
  $: blockedCount = $kpis.blocked || 0;
  $: newItemCount = $kpis.new || 0;
  $: completeCount = $kpis.complete || 0;
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
</section>
