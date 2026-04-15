<script>
  import { createEventDispatcher } from 'svelte';
  import { safeDate, sanitizeBriefingText } from '../lib/utils.js';

  export let briefing = null;
  export let unseen = false;

  const dispatch = createEventDispatcher();

  $: hasBriefing = !!briefing;

  $: priorities = briefing?.topPriorities?.length ? briefing.topPriorities : [];
  $: prepMeetings = briefing?.meetingsRequiringPrep?.length ? briefing.meetingsRequiringPrep : [];
  $: riskItems = briefing?.atRiskItems?.length ? briefing.atRiskItems : [];
  $: timeBlocks = briefing?.suggestedTimeBlocks?.length ? briefing.suggestedTimeBlocks : [];
  $: followUps = briefing?.todayFollowUps?.length ? briefing.todayFollowUps : [];
  $: sources = briefing?.sources?.length ? briefing.sources : [];

  function handleGenerate() {
    dispatch('generate');
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
        <button class="small-btn primary" on:click={handleGenerate}>Generate My Day</button>
      </div>
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
        <button class="small-btn primary" on:click={handleGenerate}>Regenerate My Day</button>
      </div>
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
