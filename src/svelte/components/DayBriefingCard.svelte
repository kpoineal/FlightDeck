<script>
  import { safeDate, sanitizeBriefingText } from '../lib/utils.js';

  let { briefing = null, unseen = false, generating = false, ongenerate } = $props();

  let hasBriefing = $derived(!!briefing);

  let priorities = $derived(briefing?.topPriorities?.length ? briefing.topPriorities : []);
  let prepMeetings = $derived(briefing?.meetingsRequiringPrep?.length ? briefing.meetingsRequiringPrep : []);
  let riskItems = $derived(briefing?.atRiskItems?.length ? briefing.atRiskItems : []);
  let timeBlocks = $derived(briefing?.suggestedTimeBlocks?.length ? briefing.suggestedTimeBlocks : []);
  let followUps = $derived(briefing?.todayFollowUps?.length ? briefing.todayFollowUps : []);
  let sources = $derived(briefing?.sources?.length ? briefing.sources : []);

  function handleGenerate() {
    ongenerate?.();
  }
</script>

{#if !hasBriefing}
  <details class="list-card day-briefing-card" open>
    <summary>
      <span class="pill unbriefed">My Day</span>
      <span class="list-title">☀️ My Day Briefing</span>
    </summary>
    <div class="card-body">
      <div class="empty">No day briefing generated yet. Synthesize your meetings, tracked items, and radar signals into one summary.</div>
      <div class="action-row">
        <button class="small-btn primary" class:is-loading={generating} disabled={generating} on:click={handleGenerate}>{generating ? 'Generating...' : 'Generate My Day'}</button>
      </div>
      {#if generating}
        <div class="generating-status">Generating your day briefing…</div>
      {/if}
    </div>
  </details>
{:else}
  <details class="list-card day-briefing-card" open>
    <summary>
      <span class="pill briefed">My Day</span>
      {#if unseen}
        <span class="pill briefed">New</span>
      {/if}
      <span class="list-title">☀️ My Day Briefing</span>
    </summary>
    <div class="card-body">
      <div class="action-row">
        <button class="small-btn primary" class:is-loading={generating} disabled={generating} on:click={handleGenerate}>{generating ? 'Generating...' : 'Regenerate My Day'}</button>
      </div>
      {#if generating}
        <div class="generating-status">Generating your day briefing…</div>
      {/if}
      <div class="evidence-box">
        <h3>{sanitizeBriefingText(briefing.headline || 'Your day at a glance')}</h3>
        <div class="panel-sub">Generated: {safeDate(briefing.generatedAt, 'Unknown')}</div>

        <h4>Top Priorities</h4>
        <ul>
          {#if priorities.length}
            {#each priorities as line}
              <li>{sanitizeBriefingText(line)}</li>
            {/each}
          {:else}
            <li>No priorities listed.</li>
          {/if}
        </ul>

        <h4>Meetings Requiring Prep</h4>
        <ul>
          {#if prepMeetings.length}
            {#each prepMeetings as m}
              <li>
                <strong>{sanitizeBriefingText(m.title)}</strong>{#if m.startAt} at {safeDate(m.startAt, 'TBD')}{/if} &mdash; {sanitizeBriefingText(m.whyPrepNeeded)}
              </li>
            {/each}
          {:else}
            <li>No meetings require special prep.</li>
          {/if}
        </ul>

        <h4>At-Risk Items</h4>
        <ul>
          {#if riskItems.length}
            {#each riskItems as item}
              <li>
                <span class="pill {(item.severity || 'observe').toLowerCase()}">{item.severity}</span>
                <strong>{sanitizeBriefingText(item.title)}</strong> &mdash; {sanitizeBriefingText(item.risk)}
              </li>
            {/each}
          {:else}
            <li>No items at risk.</li>
          {/if}
        </ul>

        <h4>Suggested Time Blocks</h4>
        <ul>
          {#if timeBlocks.length}
            {#each timeBlocks as block}
              <li>
                <strong>{sanitizeBriefingText(block.time)}</strong>: {sanitizeBriefingText(block.activity)} &mdash; {sanitizeBriefingText(block.rationale)}
              </li>
            {/each}
          {:else}
            <li>No time blocks suggested.</li>
          {/if}
        </ul>

        <h4>Follow-Ups</h4>
        <ul>
          {#if followUps.length}
            {#each followUps as line}
              <li>{sanitizeBriefingText(line)}</li>
            {/each}
          {:else}
            <li>No follow-up items.</li>
          {/if}
        </ul>

        <h4>Sources</h4>
        <ul>
          {#if sources.length}
            {#each sources as entry, index}
              <li>
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  {entry.label || `source ${index + 1}`}
                </a>
              </li>
            {/each}
          {:else}
            <li>No sources listed.</li>
          {/if}
        </ul>
      </div>
    </div>
  </details>
{/if}

<style>
  .generating-status {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 0.5rem 0;
    animation: badgePulse 2s ease-in-out infinite;
  }

  .day-briefing-card {
    border-radius: var(--radius-lg);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    border-color: color-mix(in srgb, var(--accent) 20%, var(--border-card));
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 3%, var(--bg-inset)) 0%, var(--bg-inset) 60%);
  }
  .day-briefing-card:hover {
    box-shadow: var(--shadow-hover);
  }
</style>
