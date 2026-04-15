<script>
  export let entries = [];
  export let item = null;
  export let maxVisible = 3;

  import { normalizeSeverity } from '../lib/utils.js';

  let showingAll = false;

  $: slicedEntries = maxVisible && !showingAll && entries.length > maxVisible
    ? entries.slice(0, maxVisible)
    : entries;
  $: hiddenCount = entries.length - (maxVisible || entries.length);

  function severityLabel(sev) {
    const s = (sev || '').toLowerCase();
    if (s === 'critical') return 'Critical';
    if (s === 'elevated') return 'Elevated';
    return 'Observe';
  }

  function severityColorClass(sev) {
    const s = (sev || '').toLowerCase();
    if (s === 'critical') return 'at-event--critical';
    if (s === 'elevated') return 'at-event--elevated';
    return 'at-event--observe';
  }

  function timelineRelativeLabel(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function formatChange(c) {
    const statusMatch = c.match(/^Status:\s*(.+?)\s*\u2192\s*(.+)$/);
    if (statusMatch) {
      return {
        isStatus: true,
        from: statusMatch[1].trim(),
        fromClass: statusMatch[1].trim().toLowerCase().replace(/\s+/g, '-'),
        to: statusMatch[2].trim(),
        toClass: statusMatch[2].trim().toLowerCase().replace(/\s+/g, '-'),
      };
    }
    return { isStatus: false, text: c };
  }

  $: isTerminal = item && (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
</script>

{#if entries.length > 0}
  <div class="activity-timeline">
    {#each slicedEntries as e, i}
      {@const label = severityLabel(e.severity)}
      {@const timeLabel = timelineRelativeLabel(e.timestamp)}
      {@const colorClass = severityColorClass(e.severity)}
      {@const isNewest = i === 0}
      {@const isLast = i === (showingAll ? entries.length : slicedEntries.length) - 1}
      {@const isUnseen = !isTerminal && e.seen === false}
      {@const prevSeverity = i > 0 ? (entries[i - 1].severity || '').toLowerCase() : null}
      {@const curSeverity = (e.severity || '').toLowerCase()}
      {@const sevChanged = prevSeverity && prevSeverity !== curSeverity}
      {@const escalated = sevChanged && (curSeverity === 'critical' || (curSeverity === 'elevated' && prevSeverity === 'observe'))}
      <div
        class="at-event {colorClass}"
        class:at-event--newest={isNewest}
        class:at-event--unseen={isUnseen}
        style="--at-delay: {i * 30}ms"
      >
        <div class="at-track">
          <div class="at-node">
            {#if isNewest}<div class="at-node-ring"></div>{/if}
            <div class="at-node-dot"></div>
          </div>
          {#if !isLast}
            <div class="at-spine-segment" class:at-spine-transition={sevChanged}></div>
          {/if}
        </div>
        <div class="at-card">
          <div class="at-card-head">
            <span class="at-time">{timeLabel}</span>
            {#if !isNewest}
              <span class="at-severity pill severity-{curSeverity}">{label}</span>
            {/if}
            {#if sevChanged}
              <span class="at-transition-badge">{escalated ? '\u25b2' : '\u25bc'}</span>
            {/if}
          </div>
          <p class="at-changes">
            {#if Array.isArray(e.changes)}
              {#each e.changes as c, ci}
                {@const parsed = formatChange(c)}
                {#if ci > 0} &middot; {/if}
                {#if parsed.isStatus}
                  <span class="at-status-transition">
                    <span class="pill at-status-pill at-status-{parsed.fromClass}">{parsed.from}</span>
                    <span class="at-arrow">&rarr;</span>
                    <span class="pill at-status-pill at-status-{parsed.toClass}">{parsed.to}</span>
                  </span>
                {:else}
                  {parsed.text}
                {/if}
              {/each}
            {:else}
              No changes recorded
            {/if}
          </p>
          {#if e.summary && e.summary !== (Array.isArray(e.changes) ? e.changes.join(' \u00b7 ') : '')}
            <p class="at-summary">{e.summary}</p>
          {/if}
          {#if Array.isArray(e.newLinks) && e.newLinks.length}
            <span class="at-links">
              {#each e.newLinks as l}
                <a class="at-link-chip" href={l.url} target="_blank" rel="noopener noreferrer">{l.label || 'link'}</a>
              {/each}
            </span>
          {/if}
        </div>
      </div>
    {/each}

    {#if maxVisible && !showingAll && hiddenCount > 0}
      <button class="at-show-older" on:click={() => { showingAll = true; }}>
        Show {hiddenCount} older
      </button>
    {/if}
  </div>
{/if}
