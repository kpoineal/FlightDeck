<script>
  import { quintOut } from 'svelte/easing';
  import { tweened } from 'svelte/motion';
  import { kpis, mode, meetings, briefingsByMeetingId } from '../lib/stores.js';

  import MissionControl from './status-bars/MissionControl.svelte';

  let isBriefings = $derived($mode === 'Briefings');
  let isRadar = $derived($mode === 'Radar');

  // Briefing counts
  let briefingCounts = $derived.by(() => {
    if (!isBriefings) return { briefed: 0, unbriefed: 0 };
    let briefed = 0;
    let unbriefed = 0;
    for (const meeting of ($meetings || [])) {
      const stored = ($briefingsByMeetingId || {})[meeting.id] || null;
      if (stored) briefed++;
      else unbriefed++;
    }
    return { briefed, unbriefed };
  });

  // Severity counts
  let criticalCount = $derived(isBriefings ? briefingCounts.unbriefed : $kpis.critical);
  let elevatedCount = $derived(isBriefings ? briefingCounts.briefed : $kpis.elevated);
  let observeCount = $derived(isBriefings ? 0 : $kpis.observe);

  // Tweened KPI numbers
  let criticalTween = tweened(0, { duration: 400, easing: quintOut });
  let elevatedTween = tweened(0, { duration: 400, easing: quintOut });
  let observeTween = tweened(0, { duration: 400, easing: quintOut });

  $effect(() => { criticalTween.set(criticalCount); });
  $effect(() => { elevatedTween.set(elevatedCount); });
  $effect(() => { observeTween.set(observeCount); });

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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<section class="summary-strip summary-strip--stacked">
  <div class="summary-strip-left">
    <span class="summary-sev summary-sev--critical" title={isBriefings ? 'Unbriefed meetings' : 'Critical items'}>
      <i class="legend-dot {isBriefings ? 'unbriefed' : 'critical'}"></i>
      <strong>{Math.round($criticalTween)}</strong> {isBriefings ? 'Unbriefed' : 'Critical'}
    </span>
    <span class="summary-sev summary-sev--elevated" title={isBriefings ? 'Briefed meetings' : 'Elevated items'}>
      <i class="legend-dot {isBriefings ? 'briefed' : 'elevated'}"></i>
      <strong>{Math.round($elevatedTween)}</strong> {isBriefings ? 'Briefed' : 'Elevated'}
    </span>
    {#if !isBriefings}
      <span class="summary-sev summary-sev--observe" title="Observe items">
        <i class="legend-dot observe"></i>
        <strong>{Math.round($observeTween)}</strong> Observe
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
    <MissionControl />
  {/if}
</section>

<style>
  .summary-strip--stacked {
    flex-direction: column;
    align-items: stretch;
  }
</style>
