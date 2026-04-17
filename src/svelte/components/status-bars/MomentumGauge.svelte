<script>
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { items, history } from '../../lib/stores.js';

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 60_000);
    return () => clearInterval(timer);
  });

  let active = $derived(
    ($items || []).filter(i => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived')
  );

  // Triaged: items without new updates / total active
  let triagedRatio = $derived.by(() => {
    if (!active.length) return 0;
    const triaged = active.filter(i => !i.hasNewUpdate && !i.isNew).length;
    return triaged / active.length;
  });

  // Moving: items with recent activity (within 24h) / total active
  let movingRatio = $derived.by(() => {
    if (!active.length) return 0;
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    const moving = active.filter(i => {
      const ts = i.updateHistory?.[0]?.timestamp;
      return ts && new Date(ts).getTime() > cutoff;
    }).length;
    return moving / active.length;
  });

  // Closed: completed today vs estimated average daily
  let completedToday = $derived.by(() => {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return ($items || []).filter(i =>
      i.lifecycleStatus === 'complete' &&
      i.completedAt &&
      new Date(i.completedAt).getTime() >= startOfDay.getTime()
    ).length;
  });

  // Estimate average daily completions from history (scan entries over last 7 days)
  let avgDaily = $derived.by(() => {
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const completions = ($history || []).filter(h =>
      h.kind === 'complete' && new Date(h.at).getTime() > weekAgo
    ).length;
    return Math.max(completions / 7, 1);
  });

  let closedRatio = $derived(Math.min(completedToday / avgDaily, 1));

  // Tweened bar widths (0–100)
  let triagedBar = tweened(0, { duration: 500, easing: cubicOut });
  let movingBar = tweened(0, { duration: 500, easing: cubicOut });
  let closedBar = tweened(0, { duration: 500, easing: cubicOut });

  $effect(() => { triagedBar.set(triagedRatio * 100); });
  $effect(() => { movingBar.set(movingRatio * 100); });
  $effect(() => { closedBar.set(closedRatio * 100); });

  // Velocity
  let velocity = $derived.by(() => {
    if (avgDaily <= 0) return 0;
    return completedToday / avgDaily;
  });

  let velocityTween = tweened(0, { duration: 500, easing: cubicOut });
  $effect(() => { velocityTween.set(velocity); });

  // Natural language sentence
  let sentence = $derived.by(() => {
    const parts = [];
    const triagedPct = Math.round(triagedRatio * 100);
    if (triagedPct >= 80) parts.push('Most items triaged');
    else if (triagedPct >= 50) parts.push('Midway through triage');
    else parts.push('Triage needs attention');

    if (movingRatio > 0.6) parts.push('strong momentum');
    else if (movingRatio > 0.3) parts.push('moderate activity');
    else parts.push('things are quiet');

    return parts.join(' · ');
  });
</script>

<div class="momentum-gauge">
  <div class="mg-bars">
    <div class="mg-row">
      <span class="mg-label">Triaged</span>
      <div class="mg-track">
        <div class="mg-fill mg-fill--triaged" style="width: {$triagedBar}%"></div>
      </div>
      <span class="mg-pct">{Math.round($triagedBar)}%</span>
    </div>
    <div class="mg-row">
      <span class="mg-label">Moving</span>
      <div class="mg-track">
        <div class="mg-fill mg-fill--moving" style="width: {$movingBar}%"></div>
      </div>
      <span class="mg-pct">{Math.round($movingBar)}%</span>
    </div>
    <div class="mg-row">
      <span class="mg-label">Closed</span>
      <div class="mg-track">
        <div class="mg-fill mg-fill--closed" style="width: {$closedBar}%"></div>
      </div>
      <span class="mg-pct">{Math.round($closedBar)}%</span>
    </div>
  </div>

  <div class="mg-footer">
    <span class="mg-velocity">{$velocityTween.toFixed(1)}× velocity</span>
    <span class="mg-sentence">{sentence}</span>
  </div>
</div>

<style>
  .momentum-gauge {
    padding: 6px 0 2px;
  }
  .mg-bars {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .mg-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mg-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    width: 44px;
    text-align: right;
    flex-shrink: 0;
  }
  .mg-track {
    flex: 1;
    height: 6px;
    background: var(--bg-inset, #2a2a2a);
    border-radius: 3px;
    overflow: hidden;
  }
  .mg-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }
  .mg-fill--triaged {
    background: var(--accent, #0a84ff);
  }
  .mg-fill--moving {
    background: #30d158;
  }
  .mg-fill--closed {
    background: var(--color-elevated, #ff9f0a);
  }
  .mg-pct {
    font-size: 0.62rem;
    color: var(--text-muted);
    width: 28px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .mg-footer {
    display: flex;
    gap: 12px;
    margin-top: 4px;
    padding-top: 3px;
    font-size: 0.68rem;
  }
  .mg-velocity {
    color: var(--accent, #0a84ff);
    font-weight: 600;
  }
  .mg-sentence {
    color: var(--text-muted);
  }
</style>
