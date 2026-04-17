<script>
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { items, scanners } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';

  // Hour range for the sparkline (8am–6pm = 10 buckets)
  const START_HOUR = 8;
  const END_HOUR = 18;
  const BUCKET_COUNT = END_HOUR - START_HOUR;

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 60_000);
    return () => clearInterval(timer);
  });

  // Compute urgency scores per hour bucket from item updateHistory
  let buckets = $derived.by(() => {
    const scores = new Array(BUCKET_COUNT).fill(0);
    for (const item of $items) {
      if (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived') continue;
      const sev = normalizeSeverity(item.severity);
      const weight = sev === 'Critical' ? 3 : sev === 'Elevated' ? 2 : 1;
      // Place item in bucket based on most recent update hour, or trackedAt
      const ts = item.updateHistory?.[0]?.timestamp || item.trackedAt;
      if (!ts) continue;
      const d = new Date(ts);
      const hour = d.getHours();
      if (hour >= START_HOUR && hour < END_HOUR) {
        scores[hour - START_HOUR] += weight;
      }
    }
    return scores;
  });

  // SVG dimensions
  const W = 320;
  const H = 40;
  const PAD = 4;

  // Build SVG path from buckets
  let pathD = $derived.by(() => {
    const maxVal = Math.max(...buckets, 1);
    const stepX = (W - PAD * 2) / (BUCKET_COUNT - 1);
    const points = buckets.map((v, i) => ({
      x: PAD + i * stepX,
      y: H - PAD - ((v / maxVal) * (H - PAD * 2)),
    }));
    if (points.length < 2) return '';
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }
    return d;
  });

  let tweenedPath = tweened('', { duration: 600, easing: cubicOut });
  $effect(() => { tweenedPath.set(pathD); });

  // "Now" marker position
  let nowX = $derived.by(() => {
    const h = now.getHours() + now.getMinutes() / 60;
    const clamped = Math.max(START_HOUR, Math.min(END_HOUR, h));
    const pct = (clamped - START_HOUR) / BUCKET_COUNT;
    return PAD + pct * (W - PAD * 2);
  });

  // Annotations
  let spikeCount = $derived(buckets.filter(v => v >= Math.max(...buckets) * 0.75 && v > 0).length);
  let trend = $derived.by(() => {
    const mid = Math.floor(BUCKET_COUNT / 2);
    const first = buckets.slice(0, mid).reduce((a, b) => a + b, 0);
    const second = buckets.slice(mid).reduce((a, b) => a + b, 0);
    if (second > first * 1.2) return '↑ rising';
    if (second < first * 0.8) return '↓ falling';
    return '→ steady';
  });
  let nextScan = $derived.by(() => {
    const active = ($scanners || []).filter(s => s.enabled && s.nextRunAt);
    if (!active.length) return 'no scans';
    const next = active.reduce((a, b) =>
      new Date(a.nextRunAt) < new Date(b.nextRunAt) ? a : b
    );
    const diff = new Date(next.nextRunAt).getTime() - now.getTime();
    if (diff < 0) return 'overdue';
    const mins = Math.round(diff / 60_000);
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  });
</script>

<div class="pulse-strip">
  <svg viewBox="0 0 {W} {H}" class="pulse-svg" aria-label="Urgency pulse over workday">
    <!-- Grid lines -->
    {#each Array(BUCKET_COUNT) as _, i}
      <line
        x1={PAD + i * ((W - PAD * 2) / (BUCKET_COUNT - 1))}
        y1={PAD}
        x2={PAD + i * ((W - PAD * 2) / (BUCKET_COUNT - 1))}
        y2={H - PAD}
        class="grid-line"
      />
    {/each}
    <!-- Sparkline -->
    {#if $tweenedPath}
      <path d={$tweenedPath} class="spark-path" fill="none" />
    {/if}
    <!-- Now marker -->
    <line x1={nowX} y1={2} x2={nowX} y2={H - 2} class="now-line" />
    <circle cx={nowX} cy={2} r="2" class="now-dot" />
  </svg>
  <div class="pulse-annotations">
    <span class="pulse-ann">{spikeCount} spike{spikeCount !== 1 ? 's' : ''}</span>
    <span class="pulse-ann">{trend}</span>
    <span class="pulse-ann">next scan {nextScan}</span>
  </div>
</div>

<style>
  .pulse-strip {
    padding: 4px 0;
  }
  .pulse-svg {
    width: 100%;
    height: 40px;
    display: block;
  }
  .grid-line {
    stroke: var(--border);
    stroke-width: 0.5;
    opacity: 0.3;
  }
  .spark-path {
    stroke: var(--accent, #0a84ff);
    stroke-width: 2;
    stroke-linecap: round;
    filter: drop-shadow(0 0 3px var(--accent, #0a84ff));
  }
  .now-line {
    stroke: var(--color-critical, #ff453a);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    opacity: 0.8;
  }
  .now-dot {
    fill: var(--color-critical, #ff453a);
  }
  .pulse-annotations {
    display: flex;
    gap: 12px;
    padding: 2px 4px 0;
    font-size: 0.68rem;
    color: var(--text-muted);
  }
  .pulse-ann {
    white-space: nowrap;
  }
</style>
