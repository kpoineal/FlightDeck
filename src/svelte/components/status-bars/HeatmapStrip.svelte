<script>
  import { items, highlightedItemId } from '../../lib/stores.js';
  import { normalizeSeverity } from '../../lib/utils.js';

  const SOURCE_TYPES = ['Email', 'Chat', 'Meeting', 'Doc', 'Custom'];

  let now = $state(new Date());
  let timer = $state(null);

  $effect(() => {
    timer = setInterval(() => { now = new Date(); }, 60_000);
    return () => clearInterval(timer);
  });

  // Group active items by sourceType
  let groups = $derived.by(() => {
    const active = ($items || []).filter(i =>
      i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived'
    );
    const map = {};
    for (const st of SOURCE_TYPES) {
      map[st] = [];
    }
    for (const item of active) {
      const st = SOURCE_TYPES.includes(item.sourceType) ? item.sourceType : 'Custom';
      map[st].push(item);
    }
    return map;
  });

  function severityColor(severity) {
    const sev = normalizeSeverity(severity);
    if (sev === 'Critical') return 'var(--color-critical, #ff453a)';
    if (sev === 'Elevated') return 'var(--color-elevated, #ff9f0a)';
    return 'var(--color-observe, #0a84ff)';
  }

  function isRecent(item) {
    const ts = item.updateHistory?.[0]?.timestamp || item.trackedAt;
    if (!ts) return false;
    return now.getTime() - new Date(ts).getTime() < 3_600_000;
  }

  function newCount(groupItems) {
    return groupItems.filter(i => i.hasNewUpdate || i.isNew).length;
  }

  let tooltip = $state({ visible: false, text: '', x: 0, y: 0 });

  function showTooltip(e, item) {
    const rect = e.currentTarget.getBoundingClientRect();
    tooltip = {
      visible: true,
      text: `${item.title} — ${normalizeSeverity(item.severity)}`,
      x: rect.left + rect.width / 2,
      y: rect.top - 4,
    };
  }

  function hideTooltip() {
    tooltip = { ...tooltip, visible: false };
  }

  function clickItem(item) {
    highlightedItemId.set(item.id);
  }
</script>

<div class="heatmap-strip">
  <div class="heatmap-groups">
    {#each SOURCE_TYPES as st}
      {@const groupItems = groups[st] || []}
      {#if groupItems.length > 0}
        <div class="heatmap-group">
          <div class="heatmap-squares">
            {#each groupItems as item (item.id)}
              <button
                class="heatmap-sq"
                class:heatmap-sq--pulse={isRecent(item)}
                style="--sq-color: {severityColor(item.severity)}"
                onclick={() => clickItem(item)}
                onmouseenter={(e) => showTooltip(e, item)}
                onmouseleave={hideTooltip}
                title={item.title}
              ></button>
            {/each}
          </div>
          <div class="heatmap-label">
            <span class="heatmap-source">{st}</span>
            {#if newCount(groupItems) > 0}
              <span class="heatmap-new">{newCount(groupItems)} new</span>
            {/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  {#if tooltip.visible}
    <div class="heatmap-tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
      {tooltip.text}
    </div>
  {/if}
</div>

<style>
  .heatmap-strip {
    padding: 6px 0 2px;
    position: relative;
  }
  .heatmap-groups {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }
  .heatmap-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .heatmap-squares {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .heatmap-sq {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--sq-color);
    border: none;
    cursor: pointer;
    padding: 0;
    opacity: 0.85;
    transition: opacity 0.15s, transform 0.15s;
  }
  .heatmap-sq:hover {
    opacity: 1;
    transform: scale(1.3);
  }
  .heatmap-sq--pulse {
    animation: sq-pulse 1.5s ease-in-out infinite;
  }
  @keyframes sq-pulse {
    0%, 100% { opacity: 0.85; box-shadow: none; }
    50% { opacity: 1; box-shadow: 0 0 6px var(--sq-color); }
  }
  .heatmap-label {
    display: flex;
    gap: 4px;
    align-items: baseline;
  }
  .heatmap-source {
    font-size: 0.62rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .heatmap-new {
    font-size: 0.6rem;
    color: var(--accent, #0a84ff);
  }
  .heatmap-tooltip {
    position: fixed;
    transform: translateX(-50%) translateY(-100%);
    background: var(--bg-surface, #1e1e1e);
    color: var(--text);
    font-size: 0.68rem;
    padding: 3px 8px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border);
    white-space: nowrap;
    pointer-events: none;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
</style>
